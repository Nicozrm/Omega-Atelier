#!/usr/bin/env python3
"""
preview.py — render the generated GLBs to a contact sheet.

Geometry that is never looked at is geometry nobody can vouch for. This imports
each exported asset back in, lights it neutrally, and renders a three-quarter
view — so the assets can be reviewed as pictures rather than as triangle counts,
and a builder that produces a plausible-looking manifest but a broken shape is
visible immediately.

    python3 tools/blender/preview.py --out /tmp/previews
    blender --background --python tools/blender/preview.py -- --only sofa-3seat

Renders are a review aid and are not committed.
"""

from __future__ import annotations

import argparse

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from omega import pieces  # noqa: E402


def _argv() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:] if not sys.argv[0].endswith("blender") else []


def _bounds() -> tuple[list[float], list[float]]:
    import mathutils

    lo, hi = [1e9] * 3, [-1e9] * 3
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return lo, hi


def render(glb_path: str, out_png: str, samples: int = 24) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    lo, hi = _bounds()
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = max(hi[i] - lo[i] for i in range(3)) or 1.0

    # Ground plane, so the piece is seen standing on something and its contact
    # shadow reads — the quickest way to spot a model floating or sunk.
    bpy.ops.mesh.primitive_plane_add(size=radius * 14, location=(0, 0, lo[2]))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.22, 0.23, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.85
    ground.data.materials.append(mat)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.055, 0.065, 1)
    bpy.context.scene.world = world

    # Sun lamps, not area lamps. A sun is specified in irradiance and does not
    # fall off with distance, so one rig exposes a barstool and a wardrobe
    # identically — an area light scaled by the object's own size blew every
    # asset out to flat white on the first pass.
    key = bpy.data.lights.new("key", type="SUN")
    key.energy = 3.2
    key.angle = 0.16  # soft-edged contact shadow
    key_obj = bpy.data.objects.new("key", key)
    key_obj.rotation_euler = (0.85, 0.0, 0.95)
    bpy.context.collection.objects.link(key_obj)

    fill = bpy.data.lights.new("fill", type="SUN")
    fill.energy = 1.1
    fill.angle = 0.5
    fill_obj = bpy.data.objects.new("fill", fill)
    fill_obj.rotation_euler = (1.2, 0.0, -1.1)
    bpy.context.collection.objects.link(fill_obj)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 62
    cam = bpy.data.objects.new("cam", cam_data)
    # Three-quarter front view: the front of a piece is at -Y in Blender, so the
    # camera sits on -Y and swings to +X.
    dist = radius * 2.25
    cam.location = (
        centre[0] + dist * 0.78,
        centre[1] - dist * 1.05,
        centre[2] + radius * 0.85,
    )
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    target = bpy.data.objects.new("target", None)
    target.location = (centre[0], centre[1], centre[2] - radius * 0.05)
    bpy.context.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = False
    scene.render.filepath = out_png
    # AgX (Blender 4.x+) rolls highlights off instead of clipping them; whichever
    # transforms this build ships, fall through to whatever loads.
    for transform in ("AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = transform
            break
        except TypeError:
            continue
    scene.view_settings.look = "None"
    bpy.ops.render.render(write_still=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render previews of the generated GLBs.")
    parser.add_argument("--only", help="comma-separated asset ids")
    parser.add_argument("--models", default=os.path.join(ROOT, "public", "models"))
    parser.add_argument("--out", default="/tmp/omega-previews")
    parser.add_argument("--samples", type=int, default=24)
    args = parser.parse_args(_argv())

    ids = [i.strip() for i in args.only.split(",")] if args.only else sorted(pieces.REGISTRY)
    os.makedirs(args.out, exist_ok=True)
    for asset_id in ids:
        glb = os.path.join(args.models, f"{asset_id}.glb")
        if not os.path.exists(glb):
            print(f"  · {asset_id}: no GLB, skipped", file=sys.stderr)
            continue
        png = os.path.join(args.out, f"{asset_id}.png")
        render(glb, png, args.samples)
        print(f"  ✓ {asset_id} → {png}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
