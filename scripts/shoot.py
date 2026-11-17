#!/usr/bin/env python3
"""Drive the built game in headless Chromium and capture what a player sees.

The hosted browser tool tears its tab down whenever a WebGL page is clicked,
which makes iteration on lighting and animation a guessing game. This script
keeps a real browser open for the whole run, waits for the engine to report a
phase, drives input through the DOM event system, and writes a PNG plus a JSON
readout of the HUD — so "did the dodge cost stamina" is answered by the game,
not by looking at a screenshot and hoping.

    python3 scripts/shoot.py --url URL --out shot.png [--mobile] [--keys KeyW:1200]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import time

from playwright.sync_api import sync_playwright

BOOT_SELECTOR = ".screen, .hud, .fatal"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mobile", action="store_true", help=" emulate a phone")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument(
        "--keys",
        action="append",
        default=[],
        help="key to hold, as 'Code:ms' — repeatable. Runs in order.",
    )
    ap.add_argument("--click-joystick", action="store_true")
    ap.add_argument("--wait", type=float, default=12.0, help="seconds to let the scene run")
    ap.add_argument("--dpr", type=float, default=1.0)
    args = ap.parse_args()

    viewport = {"width": 390, "height": 844} if args.mobile else {"width": args.width, "height": args.height}
    device_scale = 3.0 if args.mobile else args.dpr

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path="/usr/bin/chromium",
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-gpu-sandbox",
                "--autoplay-policy=no-user-gesture-required",
                # Headless tabs count as hidden, which throttles
                # requestAnimationFrame to about one tick per second and makes
                # the game clock look frozen when nothing is actually wrong.
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
                "--run-all-compositor-stages-before-draw",
            ],
        )
        ctx = browser.new_context(
            viewport=viewport,
            device_scale_factor=device_scale,
            has_touch=args.mobile,
            is_mobile=args.mobile,
            # A phone build must report touch, or the joystick never appears.
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                if args.mobile
                else "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()

        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None,
        )

        page.goto(args.url, wait_until="domcontentloaded")
        try:
            page.wait_for_selector(BOOT_SELECTOR, timeout=60_000)
        except Exception as exc:  # noqa: BLE001 - a report is more useful than a crash
            errors.append(f"wait_for_selector failed: {exc}")

        # Let the boot stages run; the engine yields a frame between them.
        deadline = time.time() + args.wait
        while time.time() < deadline:
            phase = page.evaluate(
                "() => document.querySelector('.hud') ? 'ingame' : (document.querySelector('.fatal') ? 'fatal' : 'menu')"
            )
            if phase == "fatal":
                break
            time.sleep(0.6)

        if args.click_joystick:
            pad = page.locator(".joystick")
            if pad.count() > 0:
                box = pad.bounding_box()
                if box:
                    page.touchscreen.tap(box["x"] + box["width"] * 0.8, box["y"] + box["height"] * 0.5)

        # `Code:holdMs:gapMs` lets one entry model a repeated tap, which is how
        # a three-hit combo has to be tested: the chain window is short.
        for spec in args.keys:
            parts = spec.split(":")
            code = parts[0]
            hold = int(parts[1]) if len(parts) > 1 and parts[1] else 600
            gap = int(parts[2]) if len(parts) > 2 and parts[2] else 150
            reps = int(parts[3]) if len(parts) > 3 and parts[3] else 1
            name = _keyname(code)
            for _ in range(reps):
                page.keyboard.down(name)
                time.sleep(hold / 1000)
                page.keyboard.up(name)
                time.sleep(gap / 1000)

        time.sleep(1.0)

        out = pathlib.Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(out))

        readout = page.evaluate(
            """() => {
              const txt = (sel) => { const n = document.querySelector(sel); return n ? n.textContent.trim() : null; };
              const widths = [...document.querySelectorAll('.bar-line')].map((b) => {
                const f = b.querySelector('.fill');
                return f ? Math.round((f.getBoundingClientRect().width / b.getBoundingClientRect().width) * 100) : null;
              });
              return {
                vitals: txt('.vitals-label'),
                kills: txt('.kills'),
                combo: txt('.combo'),
                target: txt('.target .name'),
                toast: txt('.toast'),
                perf: txt('.perf'),
                bars: widths,
                floaters: [...document.querySelectorAll('.dmg-num')].map((n) => n.textContent),
                joystick: !!document.querySelector('.joystick'),
                actions: [...document.querySelectorAll('.act')].length,
                fatal: txt('.fatal h2'),
              };
            }"""
        )

        print(json.dumps({"screenshot": str(out), "readout": readout, "errors": errors[:12]}, indent=2))
        browser.close()


def _keyname(code: str) -> str:
    """Map a KeyboardEvent.code to something Playwright accepts."""
    table = {
        "KeyW": "w",
        "KeyA": "a",
        "KeyS": "s",
        "KeyD": "d",
        "KeyJ": "j",
        "KeyK": "k",
        "KeyQ": "q",
        "KeyR": "r",
        "Escape": "Escape",
        "Space": "Space",
        "ShiftLeft": "Shift",
    }
    return table.get(code, code)


if __name__ == "__main__":
    main()
