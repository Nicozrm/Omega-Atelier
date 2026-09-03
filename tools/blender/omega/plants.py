"""
plants.py — the vegetation of the surrounding world.

## Why these, and why low-poly

After the baked surfaces, the trees are the largest mass in the scene that is
still built from bare primitives: a six-sided cylinder for a trunk and a stack
of cones or one noise-displaced blob for the crown. The canopies are already
irregular; the *trunks* are not, and a tree without branch structure reads as a
lollipop from any angle that matters.

The budget is the constraint that shapes everything here. A neighbourhood plants
hundreds of these, and they are merged by `Static` into a few draw calls — so
every triangle is paid for a few hundred times over. Each plant is therefore
held to a few hundred triangles: a tapered trunk, three or four real branches,
and a crown of overlapping perturbed icospheres. That is enough for a silhouette,
which is the only thing a tree at this distance is.

Same conventions as the furniture (`shapes`): metres, Z up, origin centred on the
footprint, base at Z = 0.
"""

from __future__ import annotations

import math
import random
from typing import Callable

import bpy
import bmesh

from .materials import material
from .shapes import cylinder, leg

PLANTS: dict[str, tuple[Callable[[], None], float]] = {}


def plant(name: str, height_m: float):
    """Register a builder together with the height it is authored at."""
    def wrap(fn: Callable[[], None]) -> Callable[[], None]:
        PLANTS[name] = (fn, height_m)
        return fn
    return wrap


def blob(
    name: str,
    radius: float,
    center: tuple[float, float, float],
    mat: str,
    squash: tuple[float, float, float] = (1.0, 1.0, 1.0),
    jitter: float = 0.22,
    seed: int = 0,
    subdivisions: int = 1,
) -> bpy.types.Object:
    """An irregular foliage mass.

    An icosphere at subdivision 1 is 80 triangles and perfectly round, which
    reads as a ball rather than as leaves. Perturbing each vertex along its own
    normal costs nothing and is the whole difference — the silhouette breaks up,
    and the smooth normals still catch light like a canopy.
    """
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=center)
    obj = bpy.context.active_object
    obj.name = name

    rng = random.Random(seed)
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for vert in bm.verts:
        vert.co += vert.normal * (rng.uniform(-jitter, jitter) * radius)
    bm.to_mesh(mesh)
    bm.free()

    obj.scale = squash
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_auto_smooth(angle=1.4)
    obj.data.materials.append(material(mat))
    return obj


def branch(
    name: str,
    base: tuple[float, float, float],
    length: float,
    radius: float,
    yaw: float,
    pitch: float,
    mat: str = "walnut",
) -> bpy.types.Object:
    """One limb, angled out and up from the trunk.

    Placed at its own midpoint and rotated in a single euler — the same
    arithmetic the office chair's star base needed, and for the same reason:
    rotating after placement swings a limb around its own centre instead of
    around the trunk.
    """
    dx = math.sin(pitch) * math.cos(yaw)
    dy = math.sin(pitch) * math.sin(yaw)
    dz = math.cos(pitch)
    centre = (
        base[0] + dx * length / 2,
        base[1] + dy * length / 2,
        base[2] + dz * length / 2,
    )
    return cylinder(name, radius, length, centre, mat, segments=5, rot=(0.0, pitch, yaw + math.pi / 2))


def trunk(name: str, height: float, bottom: float, top: float, mat: str = "walnut") -> bpy.types.Object:
    """A tapered stem standing on the ground."""
    return leg(name, top, bottom, height, (0.0, 0.0), mat, segments=7)


# ── The plants ───────────────────────────────────────────────────────────────


@plant("tree-broadleaf", 6.41)
def tree_broadleaf() -> None:
    """A full-crowned deciduous tree — the default street and garden tree.

    The stem runs *into* the crown and the limbs end *inside* it. Stopping both
    short left the canopy hovering over an umbrella frame, which is obvious at
    any distance — a tree is read by where its mass sits over its base.
    """
    trunk("stem", 4.3, 0.19, 0.11)
    for i, (yaw, pitch, length) in enumerate((
        (0.4, 0.62, 1.7), (2.5, 0.70, 1.5), (4.4, 0.58, 1.8), (5.6, 0.75, 1.35),
    )):
        branch(f"limb{i}", (0.0, 0.0, 3.0 + i * 0.22), length, 0.062, yaw, pitch)
    # The main mass carries the silhouette, so it gets the extra subdivision;
    # the satellites only break its outline and stay cheap. At subdivision 1
    # throughout, the crown read as a pile of angular chunks rather than foliage.
    blob("crown0", 1.9, (0.0, 0.05, 4.8), "lawn_green", (1.15, 1.1, 0.88), 0.1, 11, subdivisions=2)
    blob("crown1", 1.25, (-1.3, -0.5, 4.3), "lawn_green", (1.0, 1.0, 0.9), 0.13, 12)
    blob("crown2", 1.2, (1.35, 0.45, 4.45), "lawn_green", (1.0, 1.0, 0.92), 0.13, 13)


@plant("tree-conifer", 7.5)
def tree_conifer() -> None:
    """A spruce: a short bare stem under tiers that narrow toward the tip."""
    trunk("stem", 1.5, 0.2, 0.15)
    tiers = ((2.0, 1.6, 1.5), (3.3, 1.32, 1.35), (4.5, 1.04, 1.2), (5.6, 0.76, 1.05), (6.6, 0.5, 0.9))
    for i, (z, radius, height) in enumerate(tiers):
        bpy.ops.mesh.primitive_cone_add(
            radius1=radius, radius2=radius * 0.16, depth=height,
            location=(0.0, 0.0, z + height / 2), vertices=9,
            rotation=(0.0, 0.0, i * 0.7),
        )
        obj = bpy.context.active_object
        obj.name = f"tier{i}"
        bpy.ops.object.shade_auto_smooth(angle=0.9)
        obj.data.materials.append(material("conifer_green"))


@plant("tree-cypress", 7.45)
def tree_cypress() -> None:
    """A Mediterranean column — almost all silhouette, and that is the point."""
    trunk("stem", 1.0, 0.15, 0.12)
    blob("column0", 1.0, (0.0, 0.0, 3.0), "conifer_green", (0.62, 0.62, 2.35), 0.08, 21, subdivisions=2)
    blob("column1", 0.72, (0.05, 0.0, 6.3), "conifer_green", (0.62, 0.62, 1.7), 0.1, 22)


@plant("tree-birch", 5.93)
def tree_birch() -> None:
    """Slender, pale-barked, with a light open crown."""
    trunk("stem", 4.6, 0.12, 0.07, "birch_bark")
    for i, (yaw, pitch, length) in enumerate(((0.9, 0.66, 1.25), (3.4, 0.74, 1.15), (5.2, 0.6, 1.05))):
        branch(f"limb{i}", (0.0, 0.0, 3.3 + i * 0.24), length, 0.042, yaw, pitch, "birch_bark")
    blob("crown0", 1.4, (0.0, 0.0, 4.7), "birch_leaf", (1.0, 1.0, 0.95), 0.1, 31, subdivisions=2)
    blob("crown1", 0.95, (-0.9, 0.3, 4.3), "birch_leaf", (1.0, 1.0, 0.92), 0.14, 32)
