#!/usr/bin/env python3
"""Build the Shield launcher eyes from the source art.

The source is one image. The left half shows a black disc with two red, round, angry eyes.
The right half shows an off-white disc with the same eyes. The checkerboard
behind the discs is painted into the pixels, so it is not transparency.

This script:
  1. finds both discs (centre and diameter) and prints the two circle fits;
  2. samples the two disc colours and the eye red, and prints them as hex;
  3. extracts the eye alpha mask from red dominance, on both discs, and
     prints how well the two masks agree (IoU);
  4. writes launcher_eyes.png and launcher_eyes_mono.png (432 x 432 px, which
     is 108 dp at xxxhdpi) into the drawable-xxxhdpi folder;
  5. writes a preview PNG when --preview is given.

Usage:
  python3 make_launcher_eyes.py SOURCE.jpg [--res RES_DIR] [--preview OUT.png]

Needs Pillow and numpy.
"""
import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LAYER_PX = 432          # 108 dp at xxxhdpi (4 px per dp)
DISC_PX = 288           # the disc maps to 72 dp
SAFE_RADIUS_PX = 132    # 66 dp safe-zone circle


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int32)


def luma(rgb):
    return (299 * rgb[..., 0] + 587 * rgb[..., 1] + 114 * rgb[..., 2]) // 1000


def dominance(rgb):
    return rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])


def largest_component(mask, block=4):
    """Largest 4-connected region of a block-averaged mask, back at full size."""
    h, w = mask.shape
    hb, wb = h // block, w // block
    small = mask[: hb * block, : wb * block].reshape(hb, block, wb, block).mean((1, 3)) > 0.5
    seen = np.zeros_like(small, dtype=bool)
    best = []
    for sy, sx in zip(*np.nonzero(small)):
        if seen[sy, sx]:
            continue
        comp = []
        queue = deque([(sy, sx)])
        seen[sy, sx] = True
        while queue:
            y, x = queue.popleft()
            comp.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < hb and 0 <= nx < wb and small[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if len(comp) > len(best):
            best = comp
    region = np.zeros_like(small)
    for y, x in best:
        region[y, x] = True
    # grow by 3 blocks so the true edge stays inside the region
    grown = region.copy()
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            grown |= np.roll(np.roll(region, dy, 0), dx, 1)
    full = np.zeros(mask.shape, dtype=bool)
    full[: hb * block, : wb * block] = np.repeat(np.repeat(grown, block, 0), block, 1)
    return full


def fit_circle(mask):
    """Fit a circle to the edge of the disc mask. Returns (cx, cy, diameter, bbox)."""
    region = largest_component(mask)
    m = mask & region
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    r = ((x1 - x0 + 1) + (y1 - y0 + 1)) / 4.0
    inner = m.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        inner &= np.roll(np.roll(m, dy, 0), dx, 1)
    ey, ex = np.nonzero(m & ~inner)
    ex = ex.astype(np.float64)
    ey = ey.astype(np.float64)
    for tol in (6.0, 2.5):
        keep = np.abs(np.hypot(ex - cx, ey - cy) - r) < tol
        px, py = ex[keep], ey[keep]
        # Kasa least-squares circle fit
        a = np.column_stack([2 * px, 2 * py, np.ones_like(px)])
        b = px * px + py * py
        sol = np.linalg.lstsq(a, b, rcond=None)[0]
        cx, cy = sol[0], sol[1]
        r = float(np.sqrt(sol[2] + cx * cx + cy * cy))
    return cx, cy, 2 * r, (int(x0), int(y0), int(x1), int(y1))


def disc_masks(rgb):
    h, w, _ = rgb.shape
    half = w // 2
    lum = luma(rgb)
    dark = (lum < 40)
    dark[:, half:] = False
    # The disc is warm off-white (blue lower than green by about 6).
    # The checkerboard is neutral grey and white, so blue is close to green.
    light = (lum > 225) & (lum < 252) & ((rgb[..., 1] - rgb[..., 2]) >= 5)
    light[:, :half] = False
    return dark, light


def hexcolor(rgb):
    return "#%02X%02X%02X" % tuple(int(v) for v in rgb)


def sample_disc_color(rgb, cx, cy, d):
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.hypot(xx - cx, yy - cy) < 0.9 * d / 2
    sel = inside & (dominance(rgb) < 8)
    return np.median(rgb[sel], axis=0)


def alpha_from(rgb, core):
    """Eye alpha 0..1 from red dominance. Linear in the blend of red with the disc."""
    dom = dominance(rgb).astype(np.float64)
    lo, hi = 0.05 * core, 0.92 * core
    return np.clip((dom - lo) / (hi - lo), 0.0, 1.0)


def crop_around(a, cx, cy, half):
    out = np.zeros((2 * half, 2 * half), dtype=a.dtype)
    x0, y0 = int(round(cx)) - half, int(round(cy)) - half
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + 2 * half, a.shape[1]), min(y0 + 2 * half, a.shape[0])
    out[sy0 - y0: sy1 - y0, sx0 - x0: sx1 - x0] = a[sy0:sy1, sx0:sx1]
    return out


def best_iou(a, b, search=8):
    a = a > 0.5
    best = (0.0, 0, 0)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            s = np.roll(np.roll(b > 0.5, dy, 0), dx, 1)
            union = (a | s).sum()
            iou = (a & s).sum() / union if union else 0.0
            if iou > best[0]:
                best = (iou, dx, dy)
    return best


def layer_from(alpha, cx, cy, diameter):
    """Scale so the disc diameter is DISC_PX, centred on the disc, 432 x 432."""
    s = DISC_PX / diameter
    pad = int(LAYER_PX / s) + 8
    padded = np.pad(alpha.astype(np.float32), pad)
    half = LAYER_PX / 2 / s
    box = (cx + pad - half, cy + pad - half, cx + pad + half, cy + pad + half)
    img = Image.fromarray(padded, mode="F").resize((LAYER_PX, LAYER_PX), Image.LANCZOS, box=box)
    return np.clip(np.asarray(img), 0.0, 1.0)


def rgba(alpha, color):
    out = np.zeros(alpha.shape + (4,), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = color
    out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def icon_as_shown(bg, layer_rgba, size):
    """Background colour + foreground inside a circle of 72 dp, drawn at `size` px."""
    ss = 4
    big = size * ss
    canvas = Image.new("RGBA", (big, big), bg + (255,))
    scale = big / 72.0 / 4.0  # layer px (4 per dp) to canvas px
    fg = layer_rgba.resize((round(LAYER_PX * scale), round(LAYER_PX * scale)), Image.LANCZOS)
    canvas.alpha_composite(fg, ((big - fg.width) // 2, (big - fg.height) // 2))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    canvas.putalpha(mask)
    return canvas.resize((size, size), Image.LANCZOS)


def write_preview(path, rgb, discs, layer_png, mono_png, colors):
    page = (128, 128, 128)
    font = ImageFont.load_default(size=16)
    pad, cell = 24, 300
    rows = []
    for name, (bg, tint_bg, tint_fg), (cx, cy, d) in discs:
        src = Image.fromarray(rgb[int(cy - d / 2): int(cy + d / 2), int(cx - d / 2): int(cx + d / 2)].astype(np.uint8))
        src = src.resize((cell, cell), Image.LANCZOS)
        big = icon_as_shown(bg, layer_png, 192)
        small = icon_as_shown(bg, layer_png, 48)
        mono_alpha = np.asarray(mono_png)[..., 3]
        tinted = rgba(mono_alpha / 255.0, tint_fg)
        mono = icon_as_shown(tint_bg, tinted, 192)
        rows.append((name, src, big, small, mono))
    width = pad + 4 * (cell + pad)
    height = pad + len(rows) * (cell + 40 + pad)
    img = Image.new("RGB", (width, height), page)
    draw = ImageDraw.Draw(img)
    for i, (name, src, big, small, mono) in enumerate(rows):
        top = pad + i * (cell + 40 + pad)
        x = pad
        for label, tile in (("source " + name, src), ("icon 192 px, " + name, big),
                            ("icon 48 px, " + name, small), ("themed mono, " + name, mono)):
            draw.text((x, top), label, fill=(255, 255, 255), font=font)
            ty = top + 28
            if tile.mode == "RGBA":
                img.paste(tile, (x + (cell - tile.width) // 2, ty + (cell - tile.height) // 2), tile)
            else:
                img.paste(tile, (x, ty))
            x += cell + pad
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="the source JPEG (dark disc left, light disc right)")
    default_res = Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "res"
    ap.add_argument("--res", default=str(default_res), help="res folder to write into")
    ap.add_argument("--preview", help="write a preview PNG to this path")
    args = ap.parse_args()

    rgb = load(args.source)
    dark_m, light_m = disc_masks(rgb)
    dcx, dcy, dd, dbox = fit_circle(dark_m)
    lcx, lcy, ld, lbox = fit_circle(light_m)
    print("dark disc : centre (%.1f, %.1f) px, diameter %.1f px, bbox %s" % (dcx, dcy, dd, dbox))
    print("light disc: centre (%.1f, %.1f) px, diameter %.1f px, bbox %s" % (lcx, lcy, ld, lbox))

    dark_col = sample_disc_color(rgb, dcx, dcy, dd)
    light_col = sample_disc_color(rgb, lcx, lcy, ld)
    dom = dominance(rgb)
    yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
    in_d = np.hypot(xx - dcx, yy - dcy) < dd / 2 * 0.98
    in_l = np.hypot(xx - lcx, yy - lcy) < ld / 2 * 0.98
    strong = dom > 90
    red_d = np.median(rgb[strong & in_d], axis=0)
    red_l = np.median(rgb[strong & in_l], axis=0)
    red = np.median(rgb[strong & (in_d | in_l)], axis=0)
    core = float(np.median(dom[strong & in_d]))
    print("disc colours: dark %s, light %s" % (hexcolor(dark_col), hexcolor(light_col)))
    print("eye red: dark disc %s, light disc %s, used %s (dominance core %.1f)"
          % (hexcolor(red_d), hexcolor(red_l), hexcolor(red), core))

    a_dark = np.where(in_d, alpha_from(rgb, core), 0.0)
    core_l = float(np.median(dom[strong & in_l]))
    a_light = np.where(in_l, alpha_from(rgb, core_l), 0.0)
    half = int(max(dd, ld) / 2) + 20
    ca = crop_around(a_dark, dcx, dcy, half)
    cb = crop_around(a_light, lcx, lcy, half)
    iou, dx, dy = best_iou(ca, cb)
    print("eye mask IoU, dark vs light (alpha > 0.5, shift %+d,%+d px): %.4f" % (dx, dy, iou))
    print("eye mask pixels (alpha > 0.5): dark %d, light %d" % ((ca > 0.5).sum(), (cb > 0.5).sum()))

    layer = layer_from(a_dark, dcx, dcy, dd)
    ys, xs = np.nonzero(layer > 0)
    dist = np.hypot(xs - (LAYER_PX - 1) / 2.0, ys - (LAYER_PX - 1) / 2.0)
    # pixel centres: a pixel at index i covers [i, i+1], so use its far corner
    far = np.hypot(np.abs(xs + 0.5 - LAYER_PX / 2.0) + 0.5, np.abs(ys + 0.5 - LAYER_PX / 2.0) + 0.5)
    print("largest distance from the centre, non-transparent pixels: %.1f px (centre) / %.1f px (far corner); limit %d px"
          % (dist.max(), far.max(), SAFE_RADIUS_PX))
    if far.max() > SAFE_RADIUS_PX:
        sys.exit("error: art leaves the safe zone")

    res = Path(args.res) / "drawable-xxxhdpi"
    res.mkdir(parents=True, exist_ok=True)
    eyes = rgba(layer, tuple(int(v) for v in red))
    mono = rgba(layer, (255, 255, 255))
    eyes.save(res / "launcher_eyes.png", optimize=True)
    mono.save(res / "launcher_eyes_mono.png", optimize=True)
    print("wrote launcher_eyes.png and launcher_eyes_mono.png, %dx%d, into %s" % (LAYER_PX, LAYER_PX, res.name))

    if args.preview:
        discs = [
            ("light", (tuple(int(v) for v in light_col), (232, 222, 248), (74, 68, 88)), (lcx, lcy, ld)),
            ("dark", (tuple(int(v) for v in dark_col), (74, 68, 88), (232, 222, 248)), (dcx, dcy, dd)),
        ]
        write_preview(args.preview, rgb, discs, eyes, mono, None)
        print("wrote preview")


if __name__ == "__main__":
    main()
