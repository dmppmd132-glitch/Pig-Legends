#!/usr/bin/env python3
"""Drive the game with the `?debug=1` hook and print what the simulation did.

Screenshots answer "does it look right"; only the engine's own state answers
"does it work". This opens the built game, samples the debug snapshot, performs
a scripted input sequence, and reports the deltas — so a missed swing, a lock-on
that never engages or a wolf that ignores the player is visible as data instead
of being inferred from a still frame.

    python3 scripts/probe.py --url "http://localhost:4174/Pig-Legends/?mode=hunt&debug=1"
"""

from __future__ import annotations

import argparse
import json
import time

from playwright.sync_api import sync_playwright

SNAPSHOT = """() => {
  const e = window.pigDebug;
  if (!e) return null;
  const v = e.debugView;
  return {
    player: v.player,
    wolves: v.wolves,
    locked: v.locked,
    run: v.run,
    hud: e.hud.getSnapshot(),
    meshes: v.scene.meshes.length,
    activeMeshes: v.scene.getActiveMeshes().length,
    fps: Math.round(v.scene.getEngine().getFps()),
  };
}"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--mobile", action="store_true")
    ap.add_argument("--secs", type=float, default=6.0, help="seconds to sample after input")
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
            viewport={"width": 390, "height": 844} if args.mobile else {"width": 1100, "height": 700},
            device_scale_factor=3.0 if args.mobile else 1.0,
            has_touch=args.mobile,
            is_mobile=args.mobile,
        )
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)

        page.goto(args.url, wait_until="domcontentloaded")

        # Wait for the engine itself, not for a DOM node: boot yields frames.
        for _ in range(240):
            if page.evaluate("() => !!window.pigDebug"):
                break
            time.sleep(0.5)
        else:
            print(json.dumps({"fatal": "engine hook never appeared", "errors": errors}))
            browser.close()
            return

        first = page.evaluate(SNAPSHOT)
        assert first is not None
        print("boot:", json.dumps(compact(first)))

        log = [first]
        page.mouse.click(560, 360)  # give the canvas focus, like a real player

        if args.mobile:
            pad = page.locator(".joystick")
            box = pad.bounding_box() if pad.count() else None
            if box:
                # Hold the stick forward-left, then tap attack twice.
                px, py = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.touchscreen.tap(px, py - box["height"] * 0.42)
                print("touched stick; taps do not hold, so movement is checked via keys instead")
        else:
            page.keyboard.down("Shift")
            page.keyboard.down("w")

        deadline = time.time() + args.secs
        while time.time() < deadline:
            snap = page.evaluate(SNAPSHOT)
            if snap:
                log.append(snap)
            time.sleep(0.5)

        if not args.mobile:
            page.keyboard.up("w")
            page.keyboard.up("Shift")

        # Walk toward the wolf and swing until something connects.
        for _ in range(6):
            page.keyboard.press("j")
            time.sleep(0.35)
        last = page.evaluate(SNAPSHOT)
        assert last is not None
        log.append(last)

        print("end:  ", json.dumps(compact(last)))
        report(log, errors)
        browser.close()


def compact(s: dict) -> dict:
    w = (s.get("wolves") or [{}])[0]
    return {
        "p": [s["player"]["x"], s["player"]["z"]],
        "pst": s["player"]["state"],
        "hp": s["player"]["hp"],
        "st": s["player"]["stamina"],
        "w": [w.get("x"), w.get("z")],
        "wst": w.get("state"),
        "whp": w.get("hp"),
        "lock": s["locked"],
        "kills": s["run"]["kills"],
        "t": round(s["run"]["timeMs"] / 1000, 1),
        "fps": s.get("fps"),
        "active": s.get("activeMeshes"),
    }


def report(log: list[dict], errors: list[str]) -> None:
    first, last = compact(log[0]), compact(log[-1])
    moved = ((last["p"][0] - first["p"][0]) ** 2 + (last["p"][1] - first["p"][1]) ** 2) ** 0.5
    dist = (
        (last["w"][0] - last["p"][0]) ** 2 + (last["w"][1] - last["p"][1]) ** 2
    ) ** 0.5 if last["w"][0] is not None else None
    print(
        json.dumps(
            {
                "movedMetres": round(moved, 2),
                "playerToWolf": round(dist, 2) if dist is not None else None,
                "wolfHpLost": (first["whp"] or 0) - (last["whp"] or 0),
                "statesSeen": sorted({s2["player"]["state"] for s2 in log}),
                "wolfStatesSeen": sorted({(s2.get("wolves") or [{}])[0].get("state", "?") for s2 in log}),
                "errors": errors[:8],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
