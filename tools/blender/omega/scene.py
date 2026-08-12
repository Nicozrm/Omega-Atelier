"""
scene.py — reset, finish and export.

`finish()` is where the conventions the app depends on are *enforced* rather
than trusted: a piece is centred on its footprint, seated on the floor, joined
into a single object, and reported with its real triangle count and footprint.
A builder that quietly drifts off the origin or grows to 40 000 triangles is
caught here, not in the browser.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import bpy


@dataclass
class BuiltAsset:
    """What one finished piece turned out to be — the build's own receipt."""

    asset_id: str
    triangles: int
    materials: int
    """Footprint and height in metres, measured from the exported geometry."""
    size: tuple[float, float, float]
    bytes: int

    @property
    def nominal(self) -> tuple[float, float]:
        return (round(self.size[0], 4), round(self.size[1], 4))


def reset() -> None:
    """A pristine, empty scene. Called before every asset so builds cannot leak."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Orphan data survives a factory reset; purge so material names stay stable
    # (`fabric_beige.001` would silently become a second glTF material).
    for _ in range(3):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def _all_meshes() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _select(objs: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def _apply_modifiers(objs: list[bpy.types.Object]) -> None:
    for obj in objs:
        if not obj.modifiers:
            continue
        _select([obj])
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:
                # A modifier that cannot apply (degenerate geometry) is dropped
                # rather than exported half-evaluated.
                obj.modifiers.remove(mod)


def _bounds(objs: list[bpy.types.Object]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for obj in objs:
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__("mathutils").Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return tuple(lo), tuple(hi)  # type: ignore[return-value]


def _triangles(obj: bpy.types.Object) -> int:
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def finish(asset_id: str, out_dir: str, max_triangles: int = 12000) -> BuiltAsset:
    """Join, seat, export — and measure.

    Joining into ONE object is deliberate. The procedural fallback draws a sofa
    from ~20 meshes; a joined asset draws it from one node with a primitive per
    material, which is typically two or three. That is the performance half of
    the upgrade, and it is free.
    """
    objs = _all_meshes()
    if not objs:
        raise RuntimeError(f"{asset_id}: builder produced no geometry")

    _apply_modifiers(objs)
    objs = _all_meshes()

    _select(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = asset_id

    # Seat and centre: X/Y centred on the footprint, Z resting on the floor.
    lo, hi = _bounds([obj])
    obj.location.x -= (lo[0] + hi[0]) / 2.0
    obj.location.y -= (lo[1] + hi[1]) / 2.0
    obj.location.z -= lo[2]
    _select([obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Weld coincident vertices left by joining parts that share a face.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.object.mode_set(mode="OBJECT")

    tris = _triangles(obj)
    if tris > max_triangles:
        dec = obj.modifiers.new("decimate", "DECIMATE")
        dec.ratio = max_triangles / tris
        _select([obj])
        bpy.ops.object.modifier_apply(modifier=dec.name)
        tris = _triangles(obj)

    lo, hi = _bounds([obj])
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{asset_id}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_texcoords=False,  # untextured palette — UVs would be dead weight
        export_normals=True,
        export_extras=False,
        use_selection=False,
    )

    return BuiltAsset(
        asset_id=asset_id,
        triangles=tris,
        materials=len(obj.data.materials),
        size=(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]),
        bytes=os.path.getsize(path),
    )
