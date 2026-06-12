"""Generate the app icon: a flame with a dollar sign, on a dark rounded tile.

Writes app-icon.png (1024x1024) at the repo root; `npx tauri icon app-icon.png`
then produces every platform size including src-tauri/icons/icon.ico.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (13, 17, 23, 255)  # app background #0d1117
ORANGE = (240, 136, 62, 255)  # outer flame #f0883e
AMBER = (255, 196, 0, 255)
YELLOW = (255, 211, 61, 255)  # inner flame #ffd33d
DARK = (13, 17, 23, 255)


def quad_bezier(p0, p1, p2, n=60):
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1],
        )
        for t in (i / n for i in range(n + 1))
    ]


def flame_points(cx, tip_y, bottom_cy, radius, bulge):
    """Teardrop flame: curved sides from the tip into a round bottom."""
    import math

    tip = (cx, tip_y)
    right_anchor = (cx + radius, bottom_cy)
    left_anchor = (cx - radius, bottom_cy)
    pts = quad_bezier(tip, (cx + bulge, (tip_y + bottom_cy) / 2), right_anchor)
    # bottom arc, right -> bottom -> left
    for deg in range(0, 181, 4):
        a = math.radians(deg)
        pts.append((cx + radius * math.cos(a), bottom_cy + radius * math.sin(a)))
    pts += quad_bezier(left_anchor, (cx - bulge, (tip_y + bottom_cy) / 2), tip)
    return pts


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # dark rounded tile
    d.rounded_rectangle([24, 24, SIZE - 24, SIZE - 24], radius=190, fill=BG)

    # flame: outer orange, middle amber, inner yellow
    d.polygon(flame_points(512, 120, 660, 250, 330), fill=ORANGE)
    d.polygon(flame_points(512, 270, 678, 196, 250), fill=AMBER)
    d.polygon(flame_points(512, 400, 692, 150, 185), fill=YELLOW)

    # dollar sign carved into the inner flame
    font = None
    for name in ("arialbd.ttf", "seguisb.ttf", "arial.ttf"):
        try:
            font = ImageFont.truetype(f"C:/Windows/Fonts/{name}", 300)
            break
        except OSError:
            continue
    if font is None:
        raise SystemExit("no usable font found")
    d.text((512, 672), "$", font=font, fill=DARK, anchor="mm")

    out = Path(__file__).resolve().parents[2] / "app-icon.png"
    img.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
