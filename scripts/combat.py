#!/usr/bin/env python3
"""Closed-loop combat test: chase the wolf with real input, then swing.

Software rendering runs this game at 1-2 fps, which leaves barely a second of
simulated time per minute of wall clock. The script buys that time back by
forcing Low quality and a coarse hardware scaling level — both are ordinary
settings a player can reach — and then drives the character with a feedback
loop: read the camera's yaw, pick the key that points at the wolf, press it,
and attack once inside range.

It reports exactly the facts that matter: did the swing cost stamina, did the
wolf take damage, did it react, and did a kill land.

    python3 scripts/combat.py --url "http://localhost:4174/Pig-Legends/?mode=hunt&debug=1"
"""

from __future__ import annotations

import argparse
import json
import time

from playwright.sync_api import sync_playwright

STATE = """() => {
  const e = window.pigDebug;
  if (!e) return null;
  const v = e.debugView;
  const cam = v.camera;
  return {
    player: v.player,
    wolves: v.wolves,
    locked: v.locked,
    run: v.run,
    camYaw: cam.rotation.y,
    fps: Math.round(v.scene.getEngine().getFps()),
  };
}"""

FAST = """() => {
  const e = window.pigDebug;
  e.setQuality('low');
  const scene = e.debugView.scene;
  scene.getEngine().setHardwareScalingLevel(8);
  return true;
}"""


def angle_delta(a: float, b: float) -> float:
    d = (b - a + 3.14159265) % 6.2831853 - 3.14159265
    return d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--seconds", type=float, default=150.0)
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
        page = browser.new_context(viewport={"width": 420, "height": 240}).new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(args.url, wait_until="domcontentloaded")
        for _ in range(300):
            if page.evaluate("() => !!window.pigDebug"):
                break
            time.sleep(0.4)
        else:
            print(json.dumps({"fatal": "no engine hook", "errors": errors[:5]}))
            browser.close()
            return

        page.evaluate(FAST)
        page.mouse.click(320, 180)  # focus the canvas

        # Lock-on then a roll: both are press-driven, so they double as a check
        # that the input buffer covers every action, not just the sword.
        page.keyboard.press("q")
        time.sleep(1.2)
        locked_after_q = page.evaluate("() => window.pigDebug.debugView.locked")
        page.keyboard.press("Space")
        time.sleep(1.2)
        state_after_space = page.evaluate("() => window.pigDebug.debugView.player.state")
        print(f"lock-on after Q: {locked_after_q}   player state after Space: {state_after_space}", flush=True)

        held: str | None = None
        started = time.time()
        events: list[dict] = []
        min_distance = 999.0
        swings = 0
        attacks_accepted = 0
        frames = 0

        while time.time() - started < args.seconds:
            s = page.evaluate(STATE)
            if not s:
                break
            frames += 1
            p = s["player"]
            alive = [w for w in s["wolves"] if w["alive"]]
            if not alive:
                events.append({"t": round(time.time() - started, 1), "note": "no live wolf", "kills": s["run"]["kills"]})
                break
            w = min(alive, key=lambda x: (x["x"] - p["x"]) ** 2 + (x["z"] - p["z"]) ** 2)
            dist = ((w["x"] - p["x"]) ** 2 + (w["z"] - p["z"]) ** 2) ** 0.5
            min_distance = min(min_distance, dist)

            if dist > 1.7:
                # Steer with the keyboard the way a player would: choose the
                # key whose world direction best matches "toward the wolf".
                yaw = s["camYaw"]
                import math

                bearing = math.atan2(w["x"] - p["x"], w["z"] - p["z"])
                forward_err = angle_delta(yaw, bearing)
                want = "w" if abs(forward_err) < 1.3 else ("s" if abs(forward_err) > 1.9 else ("a" if forward_err > 0 else "d"))
                if want != held:
                    if held:
                        page.keyboard.up(held)
                    page.keyboard.down(want)
                    held = want
            else:
                if held:
                    page.keyboard.up(held)
                    held = None
                before = w["hp"]
                page.keyboard.press("j")
                swings += 1
                time.sleep(0.45)
                after = page.evaluate(STATE)
                aw = after["wolves"][0] if after and after["wolves"] else {"hp": before}
                if aw.get("hp", before) < before:
                    attacks_accepted += 1
                    events.append(
                        {
                            "t": round(time.time() - started, 1),
                            "hit": before - aw["hp"],
                            "wolfState": aw.get("state"),
                            "stamina": after["player"]["stamina"],
                        }
                    )

            if len(events) >= 4 or s["run"]["kills"] > 0:
                break
            if frames % 40 == 0:
                print(f"  … {round(time.time()-started)}s wall  sim={s['run']['timeMs']/1000:.1f}s  dist={dist:.1f}m  fps={s['fps']}  swings={swings}", flush=True)

        if held:
            page.keyboard.up(held)

        final = page.evaluate(STATE)
        print(
            json.dumps(
                {
                    "wallSeconds": round(time.time() - started, 1),
                    "simSeconds": round((final["run"]["timeMs"] or 0) / 1000, 1) if final else None,
                    "samples": frames,
                    "swings": swings,
                    "landedHits": attacks_accepted,
                    "events": events,
                    "closestMetres": round(min_distance, 2),
                    "kills": final["run"]["kills"] if final else None,
                    "waveCleared": bool(final and final["run"]["kills"] > 0),
                    "final": final,
                    "errors": errors[:6],
                },
                indent=2,
            )
        )
        browser.close()


if __name__ == "__main__":
    main()
