"""
shapes.py — the modelling vocabulary the furniture builders are written in.

## Why these exist at all

The app already draws every piece of furniture from `RoundedBox` compositions,
and they are carefully made. What a box composition cannot do is the thing that
makes furniture read as furniture: a bevel that catches a highlight along an
edge, a cushion that bulges, a leg that tapers, a shell whose corners are round
in all three axes at once. Those are modelling operations, and this is what
Blender is here for.

## Conventions (they matter downstream)

* **Units are metres**, matching the app's model registry.
* **Blender is Z-up**: X = width, Y = depth, Z = height.
* **The front of a piece faces -Y.** The glTF exporter's Y-up conversion maps
  Blender -Y onto glTF +Z, which is the "front faces +Z" the registry documents.
* **A piece sits on the floor**: its lowest vertex is at Z = 0, and it is
  centred on X/Y, so the app can place it by its footprint centre.

Every helper applies its own scale before adding a bevel — a bevel modifier on a
non-uniformly scaled object produces visibly different widths per axis, which is
the single easiest way to make a generated set look wrong.
"""

from __future__ import annotations

import bpy

from .materials import material

Vec3 = tuple[float, float, float]


def _apply_scale(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def _assign(obj: bpy.types.Object, mat: str) -> None:
    obj.data.materials.append(material(mat))


def _bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = 0.79  # ~45°, so only real corners round over
    mod.harden_normals = True
    mod.miter_outer = "MITER_ARC"


def box(
    name: str,
    size: Vec3,
    center: Vec3,
    mat: str,
    bevel: float = 0.012,
    segments: int = 2,
    rot: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """A rounded-edge box — the workhorse.

    `center` is the box's centre, not its corner: furniture reads more naturally
    written as "this panel is here and this big" than as corner arithmetic.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    _apply_scale(obj)
    # Clamp so a thin panel is not swallowed by its own bevel.
    _bevel(obj, min(bevel, min(size) * 0.32), segments)
    bpy.ops.object.shade_auto_smooth(angle=0.61)
    _assign(obj, mat)
    return obj


def slab(name: str, size: Vec3, center: Vec3, mat: str, **kw) -> bpy.types.Object:
    """A thin panel — a shelf, a door, a table top. Softer, smaller bevel."""
    kw.setdefault("bevel", 0.006)
    return box(name, size, center, mat, **kw)


def cushion(
    name: str,
    size: Vec3,
    center: Vec3,
    mat: str,
    plump: float = 1.0,
) -> bpy.types.Object:
    """An upholstered cushion: heavily bevelled, then subdivided so it bulges.

    This is the shape the app's `RoundedBox` approximates and cannot reach — the
    subdivision pulls the faces outward into a pillow instead of a rounded brick.
    One subdivision level only; two would quadruple the triangles for a
    difference nobody sees at furniture scale.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    _apply_scale(obj)
    _bevel(obj, min(size) * 0.42 * plump, 3)
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    bpy.ops.object.shade_auto_smooth(angle=1.2)
    _assign(obj, mat)
    return obj


def cylinder(
    name: str,
    radius: float,
    height: float,
    center: Vec3,
    mat: str,
    segments: int = 16,
    rot: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=height, location=center, rotation=rot, vertices=segments
    )
    obj = bpy.context.active_object
    obj.name = name
    _bevel(obj, min(radius, height) * 0.12, 1)
    bpy.ops.object.shade_auto_smooth(angle=0.9)
    _assign(obj, mat)
    return obj


def leg(
    name: str,
    top_radius: float,
    bottom_radius: float,
    height: float,
    foot: tuple[float, float],
    mat: str,
    segments: int = 12,
) -> bpy.types.Object:
    """A tapered leg standing on the floor at `foot` (x, y).

    Tapering is most of what separates a designed piece from a crate on stilts,
    and it costs nothing — a cone is the same triangle count as a cylinder.
    """
    bpy.ops.mesh.primitive_cone_add(
        radius1=bottom_radius,
        radius2=top_radius,
        depth=height,
        location=(foot[0], foot[1], height / 2.0),
        vertices=segments,
    )
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_auto_smooth(angle=0.9)
    _assign(obj, mat)
    return obj


def legs_at_corners(
    prefix: str,
    span: tuple[float, float],
    inset: float,
    height: float,
    mat: str,
    top_radius: float = 0.018,
    bottom_radius: float = 0.014,
) -> list[bpy.types.Object]:
    """Four tapered legs inset from a footprint's corners."""
    hx, hy = span[0] / 2.0 - inset, span[1] / 2.0 - inset
    return [
        leg(f"{prefix}_{i}", top_radius, bottom_radius, height, (x, y), mat)
        for i, (x, y) in enumerate(((-hx, -hy), (hx, -hy), (-hx, hy), (hx, hy)))
    ]


# Which axis-aligned face each opening name refers to, as a normal direction.
_FACE_NORMALS: dict[str, Vec3] = {
    "front": (0.0, -1.0, 0.0),
    "back": (0.0, 1.0, 0.0),
    "top": (0.0, 0.0, 1.0),
    "bottom": (0.0, 0.0, -1.0),
    "left": (-1.0, 0.0, 0.0),
    "right": (1.0, 0.0, 0.0),
}


def shell(
    name: str,
    size: Vec3,
    center: Vec3,
    mat: str,
    thickness: float = 0.018,
    open_faces: tuple[str, ...] = ("front",),
    bevel: float = 0.01,
) -> bpy.types.Object:
    """A hollow carcass — the shape of every shelf, cabinet, tub and shell chair.

    Built by solidifying a surface rather than by stacking six panels: the
    corners then actually meet, and the whole carcass is one object with one
    material instead of six.

    `open_faces` decides what it *is*. A wardrobe opens at the front; a bathtub
    opens at the top; a moulded shell chair opens at front and top both — and
    that last one is the reason this is a tuple rather than a boolean. Opening
    only the front turned the lounge chair into a sideboard with a cushion
    sealed inside it.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    _apply_scale(obj)

    if open_faces:
        import bmesh

        unknown = set(open_faces) - set(_FACE_NORMALS)
        if unknown:
            raise KeyError(f"{name}: unknown shell face(s) {sorted(unknown)}")
        wanted = [_FACE_NORMALS[f] for f in open_faces]
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        doomed = [
            face
            for face in bm.faces
            if any(
                face.normal.x * n[0] + face.normal.y * n[1] + face.normal.z * n[2] > 0.9
                for n in wanted
            )
        ]
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(mesh)
        bm.free()

    mod = obj.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = thickness
    # -1 grows the shell inward from the authored surface, so a carcass built at
    # 2.00 m stays 2.00 m. With Blender's default (+1) every shell grew by its
    # own wall thickness on all six sides, which the build's footprint check
    # caught on all five carcass pieces at once.
    mod.offset = -1.0
    _bevel(obj, bevel, 2)
    bpy.ops.object.shade_auto_smooth(angle=0.61)
    _assign(obj, mat)
    return obj


def rounded_tube(
    name: str,
    radius: float,
    length: float,
    center: Vec3,
    mat: str,
    axis: str = "X",
    segments: int = 12,
) -> bpy.types.Object:
    """A capsule-ish rail: towel bars, handles, bed rails, grill legs."""
    rot = {"X": (0.0, 1.5708, 0.0), "Y": (1.5708, 0.0, 0.0), "Z": (0.0, 0.0, 0.0)}[axis]
    return cylinder(name, radius, length, center, mat, segments=segments, rot=rot)
