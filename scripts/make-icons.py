#!/usr/bin/env python3
"""Generate the Pig Legends PWA icon set.

Everything is drawn procedurally with Pillow so the repo carries no binary
assets that we cannot explain or regenerate. Run:

    python3 scripts/make-icons.py

Writes into public/ and public/icons/.
"""

import math
import pathlib

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / "public"
ICONS = OUT / "icons"
ICONS.mkdir(parents=True, exist_ok=True)

# Palette mirrors the CSS variables in src/styles/global.css so the icon,
# the boot shell and the in-game UI read as one product.
WOOD_DEEP = (12, 16, 12, 255)
WOOD_MID = (26, 34, 26, 255)
WOOD_PALE = (44, 53, 38, 255)
BONE = (230, 220, 195, 255)
BRASS = (184, 145, 47, 255)
BRASS_LIT = (232, 199, 106, 255)
WITCH = (121, 230, 160, 255)
EMBER = (216, 73, 47, 255)


def backdrop(size: int) -> Image.Image:
    """Vignette: dark green-black with a moonlit top-left, like the game's sky."""
    img = Image.new("RGBA", (size, size), WOOD_DEEP)
    d = ImageDraw.Draw(img)
    # Concentric ellipses are cheaper and smoother to eyeball than a gradient
    # API that Pillow does not have.
    steps = 64
    for i in range(steps, 0, -1):
        r = size * (0.28 + 0.9 * i / steps)
        t = 1.0 - i / steps
        col = (
            int(WOOD_DEEP[0] + (WOOD_PALE[0] - WOOD_DEEP[0]) * t * 0.9),
            int(WOOD_DEEP[1] + (WOOD_PALE[1] - WOOD_DEEP[1]) * t * 0.9),
            int(WOOD_DEEP[2] + (WOOD_PALE[2] - WOOD_DEEP[2]) * t * 0.9),
            255,
        )
        d.ellipse([-r * 0.7, -r * 0.9, r, r * 1.1], fill=col)
    return img


def shield(size: float, cx: float, cy: float, w: float, h: float) -> list:
    """Heater-shield outline, pointed at the bottom."""
    hw = w / 2
    return [
        (cx - hw, cy - h * 0.46),
        (cx - hw * 0.55, cy - h * 0.5),
        (cx, cy - h * 0.47),
        (cx + hw * 0.55, cy - h * 0.5),
        (cx + hw, cy - h * 0.46),
        (cx + hw * 0.96, cy + h * 0.02),
        (cx + hw * 0.72, cy + h * 0.3),
        (cx, cy + h * 0.5),
        (cx - hw * 0.72, cy + h * 0.3),
        (cx - hw * 0.96, cy + h * 0.02),
    ]


def pig_knight(size: int, pad: float = 0.06) -> Image.Image:
    """
    The mark: a boar-headed knight's helm with a plume, over a crossed sword.
    Drawn on a 1000-unit grid then scaled, so tuning the silhouette means
    changing numbers here, not re-deriving pixel coordinates.
    """
    img = backdrop(size)
    s = size / 1000.0
    U = lambda v: v * s  # noqa: E731 - grid unit to pixels

    cx, cy = size / 2, size * 0.47

    # --- shield ---
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = 1000 * (1 - 2 * pad), 1000 * (1 - 2 * pad)
    d.polygon(shield(size, cx, cy, w, h), fill=(16, 21, 16, 255))
    for i, width in enumerate((14, 6)):
        col = BRASS if i == 0 else (BRASS_LIT[0], BRASS_LIT[1], BRASS_LIT[2], 190)
        inset = (i + 1) * 10 * s
        poly = [
            (px + (cx - px) * (inset / (w / 2) if px != cx else 0), py)
            for (px, py) in shield(size, cx, cy, w - inset * 2, h - inset * 2)
        ]
        d.line(poly + [poly[0]], fill=col, width=max(2, int(width * s)), joint="curve")
    img = Image.alpha_composite(img, layer)

    d = ImageDraw.Draw(img)

    # --- crossed sword behind the helm ---
    blade_w = max(3, int(26 * s))
    bx, by = cx, cy - 10 * s
    arm = 300 * s
    for sign in (-1, 1):
        x0, y0 = bx - sign * arm, by + arm * 0.78
        x1, y1 = bx + sign * arm, by - arm * 0.78
        d.line([(x0, y0), (x1, y1)], fill=(150, 158, 150, 255), width=blade_w)
        d.line([(x0, y0), (x1, y1)], fill=(206, 214, 206, 255), width=max(1, blade_w // 3))
        # Cross-guard sits a third of the way in from the pommel.
        gx = x0 + (x1 - x0) * 0.22
        gy = y0 + (y1 - y0) * 0.22
        gw = 70 * s
        d.line([(gx - gw * 0.5, gy - gw * 0.35), (gx + gw * 0.5, gy + gw * 0.35)], fill=BRASS, width=max(2, int(20 * s)))

    # --- boar helm ---
    helm = [
        (cx - 210 * s, cy + 60 * s),
        (cx - 205 * s, cy - 90 * s),
        (cx - 150 * s, cy - 205 * s),
        (cx, cy - 235 * s),
        (cx + 150 * s, cy - 205 * s),
        (cx + 205 * s, cy - 90 * s),
        (cx + 210 * s, cy + 60 * s),
        (cx + 120 * s, cy + 165 * s),
        (cx, cy + 195 * s),
        (cx - 120 * s, cy + 165 * s),
    ]
    d.polygon(helm, fill=(58, 66, 56, 255))
    d.polygon(helm, outline=(96, 108, 92, 255))
    for w_ in (10, 4):
        d.line(helm + [helm[0]], fill=(122, 134, 118, 255), width=max(2, int(w_ * s)), joint="curve")

    # Snout: the whole point of the mark. A disc with two nostrils.
    snout_cy = cy + 60 * s
    rx, ry = 132 * s, 104 * s
    d.ellipse([cx - rx, snout_cy - ry, cx + rx, snout_cy + ry], fill=(124, 92, 96, 255))
    d.ellipse([cx - rx, snout_cy - ry, cx + rx, snout_cy + ry], outline=(160, 122, 124, 255), width=max(2, int(8 * s)))
    for sign in (-1, 1):
        nx = cx + sign * 52 * s
        d.ellipse([nx - 20 * s, snout_cy - 30 * s, nx + 20 * s, snout_cy + 30 * s], fill=(22, 18, 18, 255))

    # Tusks curving up from under the snout.
    for sign in (-1, 1):
        base_x = cx + sign * 118 * s
        pts = [
            (base_x, snout_cy + 58 * s),
            (base_x + sign * 46 * s, snout_cy + 30 * s),
            (base_x + sign * 62 * s, snout_cy - 42 * s),
            (base_x + sign * 44 * s, snout_cy - 96 * s),
        ]
        d.line(pts, fill=BONE, width=max(3, int(26 * s)), joint="curve")
        d.line(pts, fill=(246, 240, 222, 255), width=max(1, int(10 * s)), joint="curve")

    # Eyes: narrow slits behind the visor, lit with the witch-green of the game.
    for sign in (-1, 1):
        ex = cx + sign * 92 * s
        ey = cy - 62 * s
        d.ellipse([ex - 44 * s, ey - 16 * s, ex + 44 * s, ey + 16 * s], fill=(14, 18, 14, 255))
        d.ellipse([ex - 30 * s, ey - 8 * s, ex + 30 * s, ey + 8 * s], fill=WITCH)

    # Visor bar across the brow so it reads as armour, not a pig face.
    d.rounded_rectangle(
        [cx - 208 * s, cy - 116 * s, cx + 208 * s, cy - 78 * s],
        radius=max(2, int(12 * s)),
        fill=(78, 86, 74, 255),
        outline=(120, 130, 116, 255),
        width=max(1, int(5 * s)),
    )

    # Plume: three feathers, ember-tipped, arcing back over the helm.
    for i, (dx, stiff) in enumerate(((-40, 0.9), (10, 1.15), (66, 0.95))):
        top = (cx + dx * s, cy - 232 * s)
        tip = (cx + (dx - 120 * stiff) * s, cy - 392 * s)
        ctrl = (cx + (dx - 30) * s, cy - 330 * s)
        steps = 26
        curve = []
        for k in range(steps + 1):
            t = k / steps
            x = (1 - t) ** 2 * top[0] + 2 * (1 - t) * t * ctrl[0] + t ** 2 * tip[0]
            y = (1 - t) ** 2 * top[1] + 2 * (1 - t) * t * ctrl[1] + t ** 2 * tip[1]
            curve.append((x, y))
        for k in range(1, len(curve)):
            frac = k / len(curve)
            wd = max(2, int((30 * (1 - frac) + 6) * s))
            col = EMBER if frac > 0.72 else (BRASS if i == 1 else (150, 118, 40, 255))
            d.line([curve[k - 1], curve[k]], fill=col, width=wd)

    # Soft edge so the mark does not look pasted onto the vignette.
    img = img.filter(ImageFilter.UnsharpMask(radius=max(1, size // 200), percent=52, threshold=2))
    return img


def square(img: Image.Image, size: int, radius: int = 0) -> Image.Image:
    """Flatten onto an opaque, optionally rounded canvas."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.resize((size, size), Image.LANCZOS), (0, 0))
    if radius:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
        flat = Image.new("RGBA", (size, size), WOOD_DEEP)
        out = Image.composite(out, flat, mask)
    return out


def main() -> None:
    master = pig_knight(1024)

    for name, px, radius in (
        ("icon-512.png", 512, 96),
        ("icon-192.png", 192, 40),
        ("icon-180.png", 180, 36),
        ("icon-144.png", 144, 30),
        ("icon-96.png", 96, 20),
        ("icon-72.png", 72, 16),
        ("icon-48.png", 48, 10),
    ):
        square(master, px, radius).convert("RGB").save(ICONS / name, "PNG", optimize=True)

    # Maskable icons need the artwork inside the ~80% safe zone, so the mark
    # is re-drawn smaller and centred on a full-bleed background.
    mask_base = pig_knight(1024, pad=0.2)
    safe = Image.new("RGBA", (1024, 1024), WOOD_DEEP)
    safe.paste(mask_base.resize((820, 820), Image.LANCZOS), (102, 102))
    square(safe, 512).convert("RGB").save(ICONS / "maskable-512.png", "PNG", optimize=True)
    square(safe, 192).convert("RGB").save(ICONS / "maskable-192.png", "PNG", optimize=True)

    # Apple touch icon: iOS ignores maskable and rounded corners.
    square(master, 180).convert("RGB").save(OUT / "apple-touch-icon.png", "PNG", optimize=True)
    square(master, 32, 6).convert("RGB").save(OUT / "favicon-32.png", "PNG", optimize=True)
    square(master, 180).convert("RGB").save(OUT / "og-image.png", "PNG", optimize=True)

    print("icons written to", ICONS)
    for f in sorted(ICONS.glob("*.png")) + sorted(OUT.glob("*.png")):
        print("  ", pathlib.Path(f).name)


if __name__ == "__main__":
    main()
