"""
normalize.py — fit a source asset to the footprint the plan actually reserves
for it, using headless Blender.

## Why this exists

The app places furniture from a catalogue that declares a footprint in
centimetres (`src/data/furniture.ts`, e.g. `size: [110, 60]`). A downloaded
asset knows nothing about that, so dropping one in gives a model whose real
dimensions have no relation to the box the planner drew. Measured on the six
assets this project already shipped:

  * `plant` is 17 x 18 cm in a 50 x 50 cm footprint — a desk plant standing in
    for a floor plant, roughly a third of the size it should be.
  * `table-coffee` is 60 wide x 120 deep against a catalogue 110 x 60: the model
    is simply turned 90 degrees from the axis convention the planner uses.
  * `nightstand` overhangs its footprint by ~20 %.

Hand-patching `scale` and `rotationY` per entry in the model registry is how
that gets papered over, and it does not scale past a handful of assets. This
script does it as a build step instead, from the catalogue's own numbers.

## What it does

  1. Imports the asset (GLB/glTF/FBX/OBJ).
  2. Measures the combined world bounding box of every mesh.
  3. Turns it 90 degrees if its footprint is oriented across the target's — a
     wide model in a deep slot, or the reverse.
  4. Scales it **uniformly** so the footprint fits the target. Uniform on
     purpose: stretching a chair to hit an exact 45 x 50 would distort it, and
     the catalogue footprint is a placement box, not a measurement.
  5. Sits it on the floor and centres it on the origin, so the app can place it
     by its plan position with no per-asset offset.
  6. Exports a GLB.

Coordinate note: glTF is Y-up, Blender is Z-up, and Blender's importer converts
between them. So inside this script the footprint is the X/Y plane and height is
Z; on export the conversion is undone. The catalogue's `[w, h]` is glTF `[X, Z]`,
which is Blender `[X, Y]`.

## Usage

    python3 scripts/assets/normalize.py in.glb --out out.glb --fit 110x60
    python3 scripts/assets/normalize.py in.glb --out out.glb --fit 50x50 --no-rotate

Run through `pip install bpy` (no Blender GUI needed).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

CM = 0.01


def reset_scene() -> None:
    """Start from a genuinely empty file — importers append to whatever is open."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_asset(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    else:
        raise SystemExit(f"Unsupported source format: {path.suffix}")


def mesh_objects() -> list:
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_bounds(objects) -> tuple[Vector, Vector]:
    """
    Combined world-space AABB over every mesh corner.

    Measured from actual vertices of the *evaluated* objects, which is slower
    than reading `Object.bound_box` and is the only way to get a tight answer.

    `bound_box` is each object's **local** box, so transforming its eight corners
    into world space gives the AABB of a rotated box rather than the AABB of the
    geometry. For an asset whose parts sit at an angle — a table set with its
    chairs turned in — that reads about 6 % too large, and everything downstream
    inherits the error: the asset is fitted smaller than intended, and the size
    handed to the runtime does not match what is in the file.

    Evaluated, so modifiers count: the exporter applies them, so the measurement
    has to as well.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            matrix = evaluated.matrix_world
            for vertex in mesh.vertices:
                world = matrix @ vertex.co
                for axis in range(3):
                    lo[axis] = min(lo[axis], world[axis])
                    hi[axis] = max(hi[axis], world[axis])
        finally:
            evaluated.to_mesh_clear()
    return lo, hi


def roots() -> list:
    return [o for o in bpy.context.scene.objects if o.parent is None]


def normalize(target_w: float, target_d: float, allow_rotate: bool) -> dict:
    """Fit the imported asset to a target footprint, in metres."""
    meshes = mesh_objects()
    if not meshes:
        raise SystemExit("Asset contains no meshes")

    # Everything is driven through one empty so the whole hierarchy moves as a
    # unit and no object-level transforms have to be applied (which is where
    # parented/instanced sources come apart).
    pivot = bpy.data.objects.new("normalize_pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    for obj in roots():
        if obj is not pivot:
            obj.parent = pivot
            obj.matrix_parent_inverse = pivot.matrix_world.inverted()

    lo, hi = world_bounds(meshes)
    size = hi - lo
    before = (size.x, size.y, size.z)

    # A model whose footprint runs across the target's is turned, not squashed.
    rotated = False
    if allow_rotate and size.x > 1e-6 and size.y > 1e-6:
        model_wide = size.x >= size.y
        target_wide = target_w >= target_d
        if model_wide != target_wide:
            pivot.rotation_euler[2] += math.radians(90)
            bpy.context.view_layer.update()
            rotated = True
            lo, hi = world_bounds(meshes)
            size = hi - lo

    # Uniform scale: fill the footprint as far as it goes without overflowing it.
    scale = min(
        target_w / size.x if size.x > 1e-6 else math.inf,
        target_d / size.y if size.y > 1e-6 else math.inf,
    )
    if not math.isfinite(scale) or scale <= 0:
        scale = 1.0
    pivot.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    # Centre on the origin in plan, and sit it on the floor.
    lo, hi = world_bounds(meshes)
    centre = (lo + hi) * 0.5
    pivot.location.x -= centre.x
    pivot.location.y -= centre.y
    pivot.location.z -= lo.z
    bpy.context.view_layer.update()

    lo, hi = world_bounds(meshes)
    size = hi - lo
    return {
        "before": before,
        "after": (size.x, size.y, size.z),
        "scale": scale,
        "rotated": rotated,
        "floor_offset": lo.z,
    }


def export(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--fit",
        required=True,
        help="Target footprint in centimetres, WxD — the catalogue's `size`, e.g. 110x60",
    )
    parser.add_argument(
        "--no-rotate",
        action="store_true",
        help="Never turn the asset, even if its footprint runs across the target's",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Write the resulting size (metres) as JSON. This is the authoritative "
             "measurement: it comes from the same tool that did the fitting, over "
             "every mesh corner in world space.",
    )
    args = parser.parse_args()

    try:
        w_cm, d_cm = (float(v) for v in args.fit.lower().split("x"))
    except ValueError:
        raise SystemExit(f"--fit expects WxD in cm, got {args.fit!r}")

    reset_scene()
    import_asset(args.source)
    report = normalize(w_cm * CM, d_cm * CM, allow_rotate=not args.no_rotate)
    export(args.out)

    if args.report:
        # Emit in glTF axis order. Everything above works in Blender's Z-up frame
        # (X, Y = depth, Z = height); the exported file and every consumer of this
        # report are Y-up (X, Y = height, Z = depth). Reporting Blender's order
        # would silently hand the runtime a height where it expects a depth.
        bx, by, bz = report["after"]
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({
            "size": [round(bx, 6), round(bz, 6), round(by, 6)],
            "scale": report["scale"],
            "rotated": report["rotated"],
        }) + "\n")

    b, a = report["before"], report["after"]
    print(
        f"{args.source.name:22s} "
        f"{b[0]*100:6.1f}x{b[1]*100:6.1f}x{b[2]*100:6.1f} cm -> "
        f"{a[0]*100:6.1f}x{a[1]*100:6.1f}x{a[2]*100:6.1f} cm  "
        f"(scale {report['scale']:.3f}{', rotated 90' if report['rotated'] else ''})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
