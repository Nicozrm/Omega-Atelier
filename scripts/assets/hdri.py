"""
hdri.py — turn a captured HDRI into something the app can afford, and find its sun.

## Why captured light

The scene's environment map has until now been synthetic: an analytic Preetham
sky over a few flat bounce panels. That is physically reasonable and it is why
reflections track the time of day at all — but it is *smooth*. Real skies are
not. The structure a captured sky carries (cloud edges, the gradient around the
sun, the warm band at the horizon) is most of what makes a reflective floor or a
chrome tap read as photographed rather than rendered, and no amount of tuning an
analytic model produces it.

## Why the sun has to be measured

An HDRI has its sun baked in at whatever bearing the photographer stood at. The
app computes a *real* solar position from date, latitude and time, and casts its
shadows from that. Drop an HDRI in unrotated and the two disagree: highlights
come from one side, shadows fall to the other. Nothing looks more obviously
wrong, and it is the reason "just use an HDRI" is not a one-line change.

So this measures where the sun actually is in each image and records it. The
runtime then rotates the environment by the difference, and the captured sun
lands exactly where the shadow-casting light already is.

The measurement is a luminance-weighted **circular** mean of azimuth over the
brightest pixels. Circular because azimuth wraps at ±180°, and a plain average
of angles either side of the seam gives the opposite bearing. Weighted by a high
power of luminance so the sun dominates: a sun is orders of magnitude brighter
than sky, and cubing that difference makes the estimate ignore everything else.

An overcast or moonless sky has no distinct sun. The estimate still returns the
brightest bearing, which is the right answer there too — and rotation barely
matters when the source is uniform.

## Usage

    python3 scripts/assets/hdri.py in.exr --out public/hdri/day.hdr \
        --width 512 --report public/hdri/day.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy


def load_scaled(path: Path, width: int) -> bpy.types.Image:
    """Load an EXR and scale it to `width` x `width/2` (equirectangular)."""
    image = bpy.data.images.load(str(path))
    image.scale(width, width // 2)
    return image


def measure_sun_azimuth(image: bpy.types.Image) -> tuple[float, float]:
    """
    Brightest bearing in the image.

    Returns `(azimuth_radians, concentration)`. Azimuth follows three's
    equirectangular convention: `u = 0.5` is +X, increasing u turns toward +Z.

    `concentration` is the resultant length of the circular mean, 0…1 — high
    when one direction dominates (a clear sun), near zero when the sky is
    uniform (overcast). The runtime uses it to decide whether aligning the
    rotation is even meaningful.
    """
    width, height = image.size
    pixels = list(image.pixels)   # RGBA floats, bottom row first

    # Luminance, cubed, so the sun swamps everything else.
    sum_x = 0.0
    sum_y = 0.0
    total = 0.0
    for index in range(width * height):
        base = index * 4
        r, g, b = pixels[base], pixels[base + 1], pixels[base + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if lum <= 0.0:
            continue
        weight = lum ** 3
        px = index % width
        # Pixel centre → u → bearing.
        u = (px + 0.5) / width
        angle = (u - 0.5) * 2.0 * math.pi
        sum_x += weight * math.cos(angle)
        sum_y += weight * math.sin(angle)
        total += weight

    if total <= 0.0:
        return 0.0, 0.0
    mean_x = sum_x / total
    mean_y = sum_y / total
    return math.atan2(mean_y, mean_x), math.hypot(mean_x, mean_y)


def mean_luminance(image: bpy.types.Image) -> float:
    """Average linear luminance — the map's overall light level."""
    pixels = list(image.pixels)
    count = image.size[0] * image.size[1]
    total = 0.0
    for index in range(count):
        base = index * 4
        total += 0.2126 * pixels[base] + 0.7152 * pixels[base + 1] + 0.0722 * pixels[base + 2]
    return total / max(1, count)


def save_hdr(image: bpy.types.Image, out: Path) -> None:
    """Write Radiance HDR (RGBE): three reads it, and it is far smaller than EXR
    at the resolutions an environment map actually needs."""
    out.parent.mkdir(parents=True, exist_ok=True)
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "HDR"
    image.save_render(filepath=str(out))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--width", type=int, default=512,
        help="Equirect width; height is half. 512 is ample for image-based "
             "lighting, which is a blurred convolution of this — only a mirror "
             "would resolve more, and nothing in the scene is a mirror.",
    )
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    image = load_scaled(args.source, args.width)
    azimuth, concentration = measure_sun_azimuth(image)
    luminance = mean_luminance(image)
    save_hdr(image, args.out)

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({
            "sunAzimuth": round(azimuth, 6),
            "concentration": round(concentration, 4),
            "meanLuminance": round(luminance, 6),
            "width": args.width,
        }) + "\n")

    print(
        f"{args.source.name:34s} -> {args.out.name:18s} "
        f"sun {math.degrees(azimuth):7.1f}deg  conc {concentration:.3f}  "
        f"mean L {luminance:.4f}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
