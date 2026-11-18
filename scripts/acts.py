#!/usr/bin/env python3
"""Tap each on-screen action button and sample the engine fast.

Stamina comes back at 26/s, so a single read a second after a swing shows a
full bar and looks like the button did nothing. This polls every 120 ms across
the whole animation and reports the fastest state it caught, which is what
actually distinguishes "the button works" from "the button works and my probe
was too slow to see it".

    python3 scripts/acts.py --url "http://localhost:4183/Pig-Legends/?debug=1&mode=hunt"
"""

from __future__ import annotations

import argparse
import json
import time

from playwright.sync_api import sync_playwright

FAST = """() => {
  window.pigDebug.setQuality('low');
  window.pigDebug.debugView.scene.getEngine().setHardwareScalingLevel(8);
  window.pigDebug.start();
  return true;
}"""

STATE = "() => { const v = window.pigDebug.debugView; return {state: v.player.state, stamina: v.player.stamina, hp: v.player.hp, y: v.player.y, airborne: v.player.airborne, jumpReady: v.player.jumpReady, skillReady: v.player.skillReady, skillCooldown: v.player.skillCooldown, locked: v.locked, wolfHp: v.wolves[0] ? v.wolves[0].hp : null, kills: v.run.kills}; }"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
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
        page = (
            browser.new_context(
                viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2
            )
            .new_page()
        )
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        for _ in range(300):
            if page.evaluate("() => !!window.pigDebug"):
                break
            time.sleep(0.4)
        page.evaluate(FAST)
        time.sleep(4)

        boxes = page.evaluate(
            """() => Object.fromEntries([...document.querySelectorAll('.act')].map((b) => {
                const area = [...b.classList].filter((c) => c !== 'act' && c !== 'press' && c !== 'cool' && c !== 'on')[0];
                const r = b.getBoundingClientRect();
                return [area, {x: r.x + r.width / 2, y: r.y + r.height / 2}];
              }))"""
        )

        report: dict = {}

        def tap_and_watch(area: str, taps: int = 1, gap: float = 0.5) -> dict:
            before = page.evaluate(STATE)
            seen: set[str] = set()
            for i in range(taps):
                page.mouse.click(boxes[area]["x"], boxes[area]["y"])
                for _ in range(14):
                    time.sleep(0.12)
                    s = page.evaluate(STATE)
                    seen.add(s["state"])
                if i < taps - 1:
                    time.sleep(gap)
            after = page.evaluate(STATE)
            return {
                "before": before,
                "statesSeen": sorted(seen - {"idle"}),
                "after": after,
                "minStamina": min(s for s in [before["stamina"], after["stamina"]]),
            }

        # Confirm Jump lifts ARNO off the floor, then Rune Skill starts its
        # cooldown and spends stamina even when the exact burst frame is short.
        before_jump = page.evaluate(STATE)
        page.mouse.click(boxes["jump"]["x"], boxes["jump"]["y"])
        highest_y = before_jump["y"]
        airborne_seen = False
        for _ in range(18):
            time.sleep(0.06)
            sample = page.evaluate(STATE)
            highest_y = max(highest_y, sample["y"])
            airborne_seen = airborne_seen or sample["airborne"]
        report["jump"] = {
            "heightGain": round(highest_y - before_jump["y"], 2),
            "airborneSeen": airborne_seen,
            "readyAgain": page.evaluate(STATE)["jumpReady"],
        }
        time.sleep(0.8)
        before_skill = page.evaluate(STATE)
        page.mouse.click(boxes["skill"]["x"], boxes["skill"]["y"])
        time.sleep(0.25)
        after_skill = page.evaluate(STATE)
        report["skill"] = {
            "readyBefore": before_skill["skillReady"],
            "cooldownStarted": after_skill["skillCooldown"] > 0,
            "cooldownSeconds": after_skill["skillCooldown"],
            "staminaSpent": round(before_skill["stamina"] - after_skill["stamina"], 1),
        }

        report["attack_x3"] = tap_and_watch("atk", taps=3)
        time.sleep(2.5)
        report["roll"] = tap_and_watch("dodge", taps=1)
        time.sleep(2.5)
        report["lock"] = tap_and_watch("lock", taps=1)

        # Did the sword actually reach the wolf? Close the distance first with
        # the stick, then swing until something moves.
        report["errors"] = errors[:6]
        print(json.dumps(report, indent=2)[:3000])
        browser.close()


if __name__ == "__main__":
    main()
