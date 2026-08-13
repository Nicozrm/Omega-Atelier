#!/usr/bin/env python3
"""
bake.py — bake the outdoor material library to tileable PBR images.

    blender --background --python tools/blender/bake.py -- --only lawn
    python3 tools/blender/bake.py

Writes `public/textures/outdoor/<name>_{diff,nor,rough}.jpg` plus
`tools/blender/textures.json`, which the app's table is asserted against.

Baking, not rendering: each surface is a Cycles node graph on a UV-unwrapped
plane, and the three passes come out of `bpy.ops.object.bake` — DIFFUSE with
only the colour pass (so no lighting is baked in), NORMAL in tangent space from
the graph's own bump, and ROUGHNESS straight off the BSDF input. The result is
three flat images with no light, no shadow and no camera in them, which is what
a material map has to be.

Seamlessness comes from the graphs themselves (see `omega/surfaces`), not from a
post-process, so there is no cross-fade band and no mirrored half.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from omega import surfaces  # noqa: E402

DEFAULT_OUT = os.path.join(ROOT, "public", "textures", "outdoor")
MANIFEST = os.path.join(HERE, "textures.json")

# One bake pass → one map file.
# A wrapped-edge step this many times the interior step counts as a real seam.
SEAM_LIMIT = 1.5

PASSES = (
    ("diff", "DIFFUSE", True),
    ("nor", "NORMAL", False),
    ("rough", "ROUGHNESS", False),
    # Cycles has no "height" bake, so the height field is routed through an
    # Emission shader and baked as EMIT. The app needs it: the outdoor
    # materials drive `bumpMap`, and dropping it would have meant editing every
    # one of those call sites instead.
    ("bump", "EMIT", False),
)


def _argv() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:] if not sys.argv[0].endswith("blender") else []


def _prepare_scene(size: int, samples: int) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 0  # the island fills the whole image; margin would break tiling
    scene.render.bake.use_clear = True
    scene.render.bake.normal_space = "TANGENT"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    _ = size


def _plane(material: bpy.types.Material) -> bpy.types.Object:
    """A UV-unwrapped unit plane — the whole 0..1 square, one island."""
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    obj = bpy.context.active_object
    obj.data.materials.append(material)
    return obj


def _pixels(image: bpy.types.Image, size: int):
    """The baked image as an (h, w, 3) float array."""
    import numpy as np

    buf = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    return buf.reshape(size, size, 4)[:, :, :3]


def _seam_ratio(a) -> float:
    """How much worse the wrapped edge is than the interior.

    The tiling claim is checkable, so it is checked. If a texture tiles, the two
    outermost rows are simply adjacent rows of the infinite pattern, and the
    step between them has to look like an ordinary step taken elsewhere in the
    image.

    Measured against the **99th percentile** of interior steps, not their mean.
    A structured surface — a roof of flat clay crossed by a few hard lap shadows
    — has a tiny mean step and a handful of large ones, so a wrap that lands on
    a lap boundary scored 2.6 against the mean while tiling perfectly well. The
    percentile asks the right question: is this step unusual for this texture?
    """
    import numpy as np

    rows = np.abs(a[1:, :] - a[:-1, :]).mean(axis=(1, 2))
    cols = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(0, 2))
    reference = float(np.percentile(np.concatenate([rows, cols]), 99))
    if reference < 1e-6:
        return 1.0
    wrap = max(
        float(np.abs(a[-1, :] - a[0, :]).mean()),
        float(np.abs(a[:, -1] - a[:, 0]).mean()),
    )
    return float(wrap / reference)


def _constant_value(a) -> float | None:
    """The single value this map carries, or None if it actually varies.

    A constant map is a 512² image of one number. Shipping it costs bandwidth
    and a texture unit to say what a scalar already says, so the manifest
    records the value and the file is not written at all.
    """
    import numpy as np

    if float(a.max() - a.min()) > 0.02:
        return None
    return round(float(a.mean()), 4)


def bake_surface(name: str, out_dir: str, size: int, samples: int) -> dict:
    builder = surfaces.SURFACES[name]
    _prepare_scene(size, samples)
    material = builder()
    obj = _plane(material)

    tree = material.node_tree
    target = tree.nodes.new("ShaderNodeTexImage")
    tree.nodes.active = target

    os.makedirs(out_dir, exist_ok=True)
    written: dict[str, int] = {}
    constants: dict[str, float] = {}
    seams: dict[str, float] = {}

    for suffix, bake_type, srgb in PASSES:
        image = bpy.data.images.new(f"{name}_{suffix}", width=size, height=size, alpha=False)
        # A colour map is sRGB; normal and roughness carry data and must stay
        # linear, or every surface is lit and shaped wrongly in the browser.
        image.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        target.image = image

        if bake_type == "EMIT":
            height = surfaces.HEIGHT_OF.get(material.node_tree.nodes.id_data.name)
            if height is None:
                bpy.data.images.remove(image)
                continue
            emission = tree.nodes.new("ShaderNodeEmission")
            tree.links.new(height, emission.inputs["Color"])
            output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
            tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])

        bake = bpy.context.scene.render.bake
        if bake_type == "DIFFUSE":
            bake.use_pass_direct = False
            bake.use_pass_indirect = False
            bake.use_pass_color = True

        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type=bake_type)

        pixels = _pixels(image, size)
        path = os.path.join(out_dir, f"{name}_{suffix}.jpg")
        constant = _constant_value(pixels) if suffix not in ("nor", "bump") else None
        if constant is not None:
            # Nothing to sample — the app sets the scalar instead.
            constants[suffix] = constant
            if os.path.exists(path):
                os.remove(path)
        else:
            seams[suffix] = round(_seam_ratio(pixels), 3)
            image.filepath_raw = path
            image.file_format = "JPEG"
            image.save()
            written[suffix] = os.path.getsize(path)
        bpy.data.images.remove(image)

    worst = max(seams.values(), default=1.0)
    if worst > SEAM_LIMIT:
        print(f"  ! {name}: seam ratio {worst:.2f} — does not tile cleanly", file=sys.stderr)

    return {
        "size": size,
        "maps": sorted(written),
        "bytes": written,
        "constants": constants,
        "seam": seams,
        "total": sum(written.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Bake OMEGA outdoor PBR textures with Blender.")
    parser.add_argument("--only", help="comma-separated surface names")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--size", type=int, default=512, help="square resolution (default 512)")
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(_argv())

    if args.list:
        for name in sorted(surfaces.SURFACES):
            print(name)
        return 0

    names = (
        [n.strip() for n in args.only.split(",") if n.strip()]
        if args.only
        else sorted(surfaces.SURFACES)
    )
    unknown = [n for n in names if n not in surfaces.SURFACES]
    if unknown:
        print(f"unknown surfaces: {', '.join(unknown)}", file=sys.stderr)
        return 2

    manifest: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as fh:
            manifest = json.load(fh).get("surfaces", {})

    ok = 0
    for name in names:
        try:
            record = bake_surface(name, args.out, args.size, args.samples)
        except Exception as exc:
            print(f"  ✗ {name}: {exc}", file=sys.stderr)
            continue
        manifest[name] = record
        ok += 1
        maps = "+".join(record["maps"]) or "—"
        const = "".join(f" {k}={v}" for k, v in record["constants"].items())
        seam = max(record["seam"].values(), default=1.0)
        print(
            f"  ✓ {name:16s} {record['size']}²  {record['total'] / 1024:6.1f} KB  "
            f"{maps:16s} seam {seam:.2f}{const}"
        )

    # Same pruning as the other two builders.
    manifest = {k: v for k, v in manifest.items() if k in surfaces.SURFACES}

    with open(MANIFEST, "w") as fh:
        json.dump(
            {
                "note": "Generated by tools/blender/bake.py — do not edit by hand.",
                "surfaces": dict(sorted(manifest.items())),
            },
            fh,
            indent=2,
        )
        fh.write("\n")

    total = sum(m["total"] for m in manifest.values())
    print(f"\n{ok}/{len(names)} surfaces · {total / 1024:.0f} KB → {args.out}")
    return 0 if ok == len(names) else 1


if __name__ == "__main__":
    raise SystemExit(main())
