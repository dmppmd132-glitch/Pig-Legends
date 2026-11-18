#!/usr/bin/env python3
"""Verify the touch layer actually drives the game.

A virtual stick is easy to draw and easy to get wrong: pointer capture,
`touch-action`, and the deadzone all have to line up or the knob moves while
nothing happens in the world. This loads the built game as a phone, checks the
stick and buttons exist, then pushes the stick with a real pointer and measures
how far ARNO went, then taps ATTACK and ROLL and reads the consequences back
out of the engine through the `?debug=1` hook. Jump and Rune Skill are also sampled.

    python3 scripts/mobile.py --url "http://localhost:4174/Pig-Legends/?mode=hunt&debug=1"
"""

from __future__ import annotations

import argparse
import json
import time

from playwright.sync_api import sync_playwright

SNAP = """() => {
  const v = window.pigDebug.debugView;
  return {
    x: v.player.x, y: v.player.y, z: v.player.z, state: v.player.state,
    hp: v.player.hp, stamina: v.player.stamina,
    airborne: v.player.airborne, jumpReady: v.player.jumpReady,
    skillReady: v.player.skillReady, skillCooldown: v.player.skillCooldown,
    wolves: v.wolves, locked: v.locked, kills: v.run.kills,
  };
}"""

FAST = """() => {
  window.pigDebug.setQuality('low');
  window.pigDebug.debugView.scene.getEngine().setHardwareScalingLevel(8);
  return true;
}"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--secs", type=float, default=90.0)
    args = ap.parse_args()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path="/usr/bin/chromium",
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
            ],
        )
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        )
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(args.url, wait_until="domcontentloaded")
        for _ in range(300):
            if page.evaluate("() => !!window.pigDebug"):
                break
            time.sleep(0.4)
        else:
            print(json.dumps({"fatal": "engine never booted", "errors": errors[:5]}))
            browser.close()
            return

        page.evaluate(FAST)
        # Let the menu's idle orbit settle, then start the hunt.
        page.evaluate("() => window.pigDebug.start()")

        layout = page.evaluate(
            """() => {
              const q = (s) => document.querySelector(s);
              const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; };
              const acts = [...document.querySelectorAll('.act')].map((b) => ({
                label: [...b.classList].filter((c) => c !== 'act' && c !== 'press' && c !== 'cool' && c !== 'on').join('.'),
                box: (() => { const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })(),
              }));
              return {
                joystick: box('.joystick'),
                knob: box('.joystick .knob'),
                stickVisible: !!q('.joystick'),
                acts,
                hudVisible: !!q('.hud'),
                orientationLock: !!q('.joystick'),
                touchMedia: window.matchMedia('(pointer: coarse)').matches,
              };
            }"""
        )

        result: dict = {
            "stickVisible": layout["stickVisible"],
            "stickBoxPx": layout["joystick"],
            "actionButtons": [a["label"] for a in layout["acts"]],
            "coarsePointer": layout["touchMedia"],
            "hudVisible": layout["hudVisible"],
        }

        if layout["joystick"]:
            jx = layout["joystick"]["x"] + layout["joystick"]["w"] / 2
            jy = layout["joystick"]["y"] + layout["joystick"]["h"] / 2
            before = page.evaluate(SNAP)
            # Pointer events back the stick, so a mouse drag exercises exactly
            # the same code path a thumb does.
            page.mouse.move(jx, jy)
            page.mouse.down()
            page.mouse.move(jx, jy - layout["joystick"]["h"] * 0.42, steps=6)  # push forward
            held = page.evaluate(
                """() => { const k = document.querySelector('.joystick .knob'); const r = k.getBoundingClientRect(); const h = document.querySelector('.joystick').getBoundingClientRect(); return {knobDx: +(r.x + r.width/2 - (h.x + h.width/2)).toFixed(1), knobDy: +(r.y + r.height/2 - (h.y + h.height/2)).toFixed(1)}; }"""
            )
            time.sleep(args.secs)
            during = page.evaluate(SNAP)
            page.mouse.up()
            moved = ((during["x"] - before["x"]) ** 2 + (during["z"] - before["z"]) ** 2) ** 0.5
            result["stickHold"] = held
            result["movedMetres"] = round(moved, 2)
            result["stateWhileHeld"] = during["state"]

        # Buttons are drawn as glyphs, so the action class is the stable handle.
        by_area = {a["label"]: a for a in layout["acts"]}
        jump = by_area.get("jump")
        skill = by_area.get("skill")

        if jump:
            before = page.evaluate(SNAP)
            page.mouse.click(jump["box"]["x"], jump["box"]["y"])
            highest_y = before["y"]
            airborne_seen = False
            deadline = time.time() + 2.5
            landed = before
            while time.time() < deadline:
                landed = page.evaluate(SNAP)
                highest_y = max(highest_y, landed["y"])
                airborne_seen = airborne_seen or landed["airborne"]
                if airborne_seen and landed["jumpReady"]:
                    break
                time.sleep(0.055)
            landed = page.evaluate(SNAP)
            result["jumpTap"] = {
                "heightGainMetres": round(highest_y - before["y"], 2),
                "airborneSeen": airborne_seen,
                "readyAfterLanding": landed["jumpReady"],
            }

        if skill:
            # Give the jump its short landing window before testing the next
            # action; the skill remains available in mid-air too.
            deadline = time.time() + 1.2
            while time.time() < deadline and not page.evaluate(SNAP)["jumpReady"]:
                time.sleep(0.04)
            before = page.evaluate(SNAP)
            page.mouse.click(skill["box"]["x"], skill["box"]["y"])
            time.sleep(0.25)
            after = page.evaluate(SNAP)
            result["skillTap"] = {
                "readyBefore": before["skillReady"],
                "cooldownStarted": after["skillCooldown"] > 0,
                "cooldownSeconds": after["skillCooldown"],
                "staminaSpent": round(before["stamina"] - after["stamina"], 1),
            }

        attack = by_area.get("atk")
        roll = by_area.get("dodge")

        if attack:
            st0 = page.evaluate(SNAP)
            page.mouse.click(attack["box"]["x"], attack["box"]["y"])
            time.sleep(6)
            st1 = page.evaluate(SNAP)
            result["attackTap"] = {
                "stateSeen": st1["state"],
                "staminaDelta": round(st1["stamina"] - st0["stamina"], 1),
            }
        if roll:
            st0 = page.evaluate(SNAP)
            page.mouse.click(roll["box"]["x"], roll["box"]["y"])
            time.sleep(6)
            st1 = page.evaluate(SNAP)
            result["rollTap"] = {
                "stateSeen": st1["state"],
                "staminaDelta": round(st1["stamina"] - st0["stamina"], 1),
            }

        lock = by_area.get("lock")
        if lock:
            page.mouse.click(lock["box"]["x"], lock["box"]["y"])
            time.sleep(3)
            result["lockTap"] = page.evaluate("() => window.pigDebug.debugView.locked")

        result["errors"] = errors[:6]
        print(json.dumps(result, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
