#!/usr/bin/env python3
# PDF -> long horizontal score strip -> transparent scroll frames (forScore-style).
# Slices each page into systems (bands containing staff lines = rows with heavy ink
# coverage), aligns them on the staff center, concatenates horizontally, keys the ink
# to white-on-transparent, and writes constant-speed scroll frames. No UI elements.
#
#   python3 render-pdf-scroll.py <pdf> <outDir> [--dpi 200] [--height 560] [--speed 260]
#                                [--fps 30] [--max-seconds 0] [--frame 1200]
#   height/speed/frame are in output (device) pixels; speed is px/second.
#   Writes <outDir>/f%05d.png plus strip.png (the full keyed strip) for reuse.

import sys, os, argparse
import numpy as np
from PIL import Image
import pymupdf

ap = argparse.ArgumentParser()
ap.add_argument("pdf"); ap.add_argument("outdir")
ap.add_argument("--dpi", type=int, default=200)
ap.add_argument("--staff-px", type=int, default=90)    # displayed staff height (5 lines)
ap.add_argument("--speed", type=float, default=260)    # device px / second
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--max-seconds", type=float, default=0)
ap.add_argument("--frame", type=int, default=1200)     # square frame size
ap.add_argument("--gap", type=int, default=36)         # px between systems (native)
a = ap.parse_args()
os.makedirs(a.outdir, exist_ok=True)

doc = pymupdf.open(a.pdf)
systems = []   # (ink 2D array, staff_center_row)
for pno in range(len(doc)):
    pix = doc[pno].get_pixmap(dpi=a.dpi, colorspace=pymupdf.csGRAY)
    g = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.float32)
    ink = 255.0 - g                                    # 0 = paper, 255 = ink
    ink[ink < 40] = 0                                  # kill scan haze
    # trim page margins
    cols = ink.sum(0) > 0; rows = ink.sum(1) > 0
    if not cols.any(): continue
    x0, x1 = np.argmax(cols), len(cols) - np.argmax(cols[::-1])
    ink = ink[:, x0:x1]
    W = ink.shape[1]
    rowfrac = (ink > 60).sum(1) / W                    # fraction of row that is ink
    inkrow = rowfrac > 0.012                           # any content
    staffrow = rowfrac > 0.40                          # long horizontal line = staff
    # group content rows into bands (gap tolerance ~ a few px)
    bands, y, H = [], 0, ink.shape[0]
    while y < H:
        if inkrow[y]:
            y2 = y
            gaprun = 0
            while y2 < H and gaprun <= int(a.dpi * 0.03):
                gaprun = 0 if inkrow[y2] else gaprun + 1
                y2 += 1
            bands.append((y, y2 - gaprun)); y = y2
        else: y += 1
    # a band may contain 2+ systems bridged by slurs/text: split between staff clusters
    def staff_clusters(b0, b1):
        srows = np.where(staffrow[b0:b1])[0] + b0
        if len(srows) < 4: return []
        groups, cur = [], [srows[0]]
        for r in srows[1:]:
            if r - cur[-1] > int(a.dpi * 0.12): groups.append(cur); cur = [r]
            else: cur.append(r)
        groups.append(cur)
        return [g for g in groups if len(g) >= 4]
    pagecount = 0
    for (b0, b1) in bands:
        groups = staff_clusters(b0, b1)
        if not groups: continue                        # text/title band, no staff
        # split points: ink minimum between consecutive staff clusters
        cuts = [b0]
        for gi in range(len(groups) - 1):
            lo, hi = groups[gi][-1] + 1, groups[gi + 1][0]
            cuts.append(lo + int(np.argmin(rowfrac[lo:hi])))
        cuts.append(b1)
        for gi, g in enumerate(groups):
            pad = int(a.dpi * 0.02)
            c0, c1 = max(cuts[gi] - pad, 0), min(cuts[gi + 1] + pad, H)
            band = ink[c0:c1]
            bcols = band.sum(0) > 0
            if not bcols.any(): continue
            bx0, bx1 = np.argmax(bcols), len(bcols) - np.argmax(bcols[::-1])
            center = int(np.mean(g)) - c0
            systems.append((band[:, bx0:bx1], center, g[-1] - g[0]))
            pagecount += 1
    print(f"page {pno + 1}: total systems so far {len(systems)}")
print(f"{len(doc)} pages -> {len(systems)} systems")

# canvas from the 98th percentile of staff-relative extents (extreme ledger-line
# peaks are rare; clipping a few pixels beats shrinking every staff for them)
aboves = sorted(c for _, c, _s in systems)
belows = sorted(b.shape[0] - c for b, c, _s in systems)
above = aboves[min(len(aboves) - 1, int(len(aboves) * 0.98))]
below = belows[min(len(belows) - 1, int(len(belows) * 0.98))]
SH = above + below
spans = sorted(sp for _, _, sp in systems)
scale = a.staff_px / spans[len(spans) // 2]            # median staff -> --staff-px
height = int(SH * scale)
# assemble only as much strip as the clip needs
if a.max_seconds:
    need = (a.speed * a.max_seconds + a.frame) / scale + 10
    acc, w = [], 0
    for sysb in systems:
        acc.append(sysb); w += sysb[0].shape[1] + a.gap
        if w > need: break
    systems = acc
totalW = sum(b.shape[1] for b, _, _s in systems) + a.gap * (len(systems) - 1)
strip = np.zeros((SH, totalW), np.float32)
x = 0
for band, c, _s in systems:
    # place aligned on staff center; clip what falls outside the canvas
    y0 = above - c
    s0, s1 = max(0, -y0), min(band.shape[0], SH - y0)
    strip[y0 + s0: y0 + s1, x: x + band.shape[1]] = band[s0:s1]
    x += band.shape[1] + a.gap

# key to white ink on transparency
alpha = np.clip(strip * 1.25, 0, 255).astype(np.uint8)
rgba = np.zeros((SH, totalW, 4), np.uint8); rgba[..., :3] = 255; rgba[..., 3] = alpha
img = Image.fromarray(rgba, "RGBA")
img = img.resize((int(totalW * scale), height), Image.LANCZOS)
img.save(os.path.join(a.outdir, "strip.png"))
W = img.width
print(f"strip: {W}x{height}px (staff {a.staff_px}px), covers {(W / a.speed):.1f}s at {a.speed}px/s")

dur = W / a.speed
if a.max_seconds: dur = min(dur, a.max_seconds)
n = int(dur * a.fps)
top = (a.frame - height) // 2
for f in range(n):
    xoff = int(f / a.fps * a.speed)
    frame = Image.new("RGBA", (a.frame, a.frame), (0, 0, 0, 0))
    win = img.crop((xoff, 0, min(xoff + a.frame, W), height))
    frame.paste(win, (0, top))
    frame.save(os.path.join(a.outdir, f"f{f:05d}.png"))
    if f % 200 == 0: print(f"  {f}/{n}", end="\r")
print(f"\nwrote {n} frames to {a.outdir}")
