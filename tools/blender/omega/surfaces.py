"""
surfaces.py — procedural node graphs for the outdoor material library.

## Why bake at all

The world around the plan — facades, roofs, lawn, asphalt, kerbs — is drawn by
the canvas generators in `src/lib/proceduralTextures.ts`. Those paint rectangles
and speckle, which is enough for a pattern and structurally incapable of grain:
a roof reads as roof-coloured stripes, a lawn as a green plane. That is the
"Umgebung zu schwach".

Blender can express the thing canvas cannot — noise with real spatial structure,
bump-derived normals, per-cell variation — and bake it down to three small
images the browser samples for free.

## Seamless tiling, properly

A texture that does not tile is useless here: every surface in the scene repeats
its map many times over. Blender's noise is 3D and does not tile on a plane.

The fix is the **flat torus**. Map the UV square onto

    (cos 2πu, sin 2πu, cos 2πv)  with W = sin 2πv

and sample *4D* noise there. Opposite edges of the UV square land on the same
point in 4D, so the result is periodic by construction — no offset-and-blend
seam, no mirrored halves, no blurred band down the middle. The equal-radius flat
torus is also an isometric embedding, so the noise stays uniform rather than
stretching toward the edges.

`Brick`-based surfaces (roof pantiles, klinker) tile natively on integer counts
and use the UV directly.
"""

from __future__ import annotations

import math

import bpy

from .materials import hex_to_linear_rgba

TAU = math.pi * 2.0


def _new_material(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree, bpy.types.Node]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    return mat, tree, bsdf


def tileable_coords(tree: bpy.types.NodeTree) -> tuple[bpy.types.Node, bpy.types.NodeSocket]:
    """The flat-torus mapping. Returns (vector node, W socket).

    Feed the vector into a 4D noise/voronoi's `Vector` and the socket into its
    `W`, and the result tiles perfectly across the UV square.
    """
    coord = tree.nodes.new("ShaderNodeTexCoord")
    split = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], split.inputs["Vector"])

    def angle(socket: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        mul = tree.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = TAU
        tree.links.new(socket, mul.inputs[0])
        return mul.outputs[0]

    def trig(socket: bpy.types.NodeSocket, op: str) -> bpy.types.NodeSocket:
        node = tree.nodes.new("ShaderNodeMath")
        node.operation = op
        tree.links.new(socket, node.inputs[0])
        return node.outputs[0]

    u_ang, v_ang = angle(split.outputs["X"]), angle(split.outputs["Y"])
    combine = tree.nodes.new("ShaderNodeCombineXYZ")
    tree.links.new(trig(u_ang, "COSINE"), combine.inputs["X"])
    tree.links.new(trig(u_ang, "SINE"), combine.inputs["Y"])
    tree.links.new(trig(v_ang, "COSINE"), combine.inputs["Z"])
    return combine, trig(v_ang, "SINE")


def tiling_noise(
    tree: bpy.types.NodeTree,
    scale: float,
    detail: float = 6.0,
    roughness: float = 0.5,
    distortion: float = 0.0,
) -> bpy.types.NodeSocket:
    """A seamless noise field over the UV square. Returns the `Fac` socket.

    `scale` counts **features across one tile**, which is the only unit worth
    thinking in here. The torus traverses a circle of circumference 2π per tile,
    so a raw Blender scale means 2π times as many features as it looks like —
    the first bake asked for 110 grass blades and got roughly 690, every one of
    them sub-pixel at 512², which averaged out to a flat green square.
    """
    vector, w = tileable_coords(tree)
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = scale / TAU
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = roughness
    if "Distortion" in noise.inputs:
        noise.inputs["Distortion"].default_value = distortion
    tree.links.new(vector.outputs["Vector"], noise.inputs["Vector"])
    tree.links.new(w, noise.inputs["W"])
    return noise.outputs["Fac"]


def tiling_voronoi(
    tree: bpy.types.NodeTree,
    scale: float,
    feature: str = "F1",
    randomness: float = 1.0,
    output: str = "Distance",
) -> bpy.types.NodeSocket:
    """Seamless Voronoi cells — pebbles, aggregate, grass clumps."""
    vector, w = tileable_coords(tree)
    vor = tree.nodes.new("ShaderNodeTexVoronoi")
    vor.voronoi_dimensions = "4D"
    vor.feature = feature
    # Same unit as `tiling_noise`: cells across one tile.
    vor.inputs["Scale"].default_value = scale / TAU
    if "Randomness" in vor.inputs:
        vor.inputs["Randomness"].default_value = randomness
    tree.links.new(vector.outputs["Vector"], vor.inputs["Vector"])
    tree.links.new(w, vor.inputs["W"])
    return vor.outputs[output]


def ramp(
    tree: bpy.types.NodeTree,
    fac: bpy.types.NodeSocket,
    stops: list[tuple[float, str]],
) -> bpy.types.NodeSocket:
    """A colour ramp over `fac`. `stops` are (position, hex)."""
    node = tree.nodes.new("ShaderNodeValToRGB")
    tree.links.new(fac, node.inputs["Fac"])
    elements = node.color_ramp.elements
    while len(elements) > 1:
        elements.remove(elements[-1])
    for i, (pos, hex_value) in enumerate(stops):
        element = elements[0] if i == 0 else elements.new(pos)
        element.position = pos
        element.color = hex_to_linear_rgba(hex_value)
    return node.outputs["Color"]


def mix(tree: bpy.types.NodeTree, fac: bpy.types.NodeSocket,
        a: bpy.types.NodeSocket, b: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    tree.links.new(fac, node.inputs["Factor"])
    tree.links.new(a, node.inputs[6])   # A (colour)
    tree.links.new(b, node.inputs[7])   # B (colour)
    return node.outputs[2]              # Result (colour)


def math_node(tree: bpy.types.NodeTree, op: str, a: bpy.types.NodeSocket,
              b: float | bpy.types.NodeSocket) -> bpy.types.NodeSocket:
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = op
    tree.links.new(a, node.inputs[0])
    if isinstance(b, float) or isinstance(b, int):
        node.inputs[1].default_value = float(b)
    else:
        tree.links.new(b, node.inputs[1])
    return node.outputs[0]


# The height socket each surface bumped with, keyed by material name.
#
# The app's outdoor materials drive `bumpMap`, not just `normalMap` (see the
# neighbourhood and roof materials in ThreeDView), so the height field has to be
# baked out as its own map rather than existing only inside the Bump node.
HEIGHT_OF: dict[str, bpy.types.NodeSocket] = {}


def bump(tree: bpy.types.NodeTree, bsdf: bpy.types.Node,
         height: bpy.types.NodeSocket, strength: float) -> None:
    """Drive the shading normal from a height field, so NORMAL can be baked."""
    node = tree.nodes.new("ShaderNodeBump")
    node.inputs["Strength"].default_value = strength
    tree.links.new(height, node.inputs["Height"])
    tree.links.new(node.outputs["Normal"], bsdf.inputs["Normal"])
    HEIGHT_OF[tree.nodes.id_data.name] = height


def one_minus(tree: bpy.types.NodeTree, socket: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
    """1 − x. Needed because a mortar *mask* has to become a mortar *recess*."""
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = "SUBTRACT"
    node.inputs[0].default_value = 1.0
    tree.links.new(socket, node.inputs[1])
    return node.outputs[0]


def wave_bands(
    tree: bpy.types.NodeTree,
    count: int,
    direction: str = "Y",
    profile: str = "SAW",
) -> bpy.types.NodeSocket:
    """`count` bands across the UV square, natively tiling on an integer count.

    A sawtooth here means "position within the current course", which is what
    turns a brick lattice into a roof: the overlap shadow falls at a fixed
    fraction of every course, and that horizontal rhythm is what the eye uses to
    read a roof at all. Without it a pantile map is just a wall lying down.
    """
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexWave")
    node.wave_type = "BANDS"
    node.bands_direction = direction
    node.wave_profile = profile
    node.inputs["Scale"].default_value = float(count)
    node.inputs["Distortion"].default_value = 0.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    return node.outputs["Fac"]


def brick(
    tree: bpy.types.NodeTree,
    rows: float,
    columns: float,
    joint: float = 0.12,
    squash: float = 1.0,
) -> tuple[bpy.types.NodeSocket, bpy.types.NodeSocket]:
    """A natively tiling brick lattice.

    Returns `(variation, mortar)`:

    * **variation** — the node's `Color`, with the two brick colours set to
      black and white, is a *per-brick random grey*. That randomness is the
      whole reason to use the node rather than draw a grid: every brick gets its
      own tone from one cheap lookup.
    * **mortar** — the node's `Fac`, which is 1 in the joint and 0 on the brick.

    `joint` is the mortar thickness **as a fraction of the row height**. The
    node's own `Mortar Size` is absolute in texture space, and passing a
    fraction-looking number straight into it is how the first bake produced a
    surface that was 100 % mortar — a flat brown blob with no bricks in it at
    all.

    **`rows` must be even.** Running bond shifts every other course by half a
    brick, so the stagger has a period of two rows. With an odd count the top
    edge of the tile carries the opposite parity to the bottom edge and the bond
    breaks where the texture wraps — the bake's seam check caught exactly that
    on all three lattice surfaces at once (roof 5.03, klinker 2.41, paver 1.96
    against a limit of 2.5).
    """
    if int(rows) % 2 != 0:
        raise ValueError(f"brick(): rows must be even for the bond to tile, got {rows}")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexBrick")
    node.offset = 0.5
    node.squash = squash
    row_height = 1.0 / rows
    node.inputs["Scale"].default_value = 1.0
    node.inputs["Row Height"].default_value = row_height
    node.inputs["Brick Width"].default_value = 1.0 / columns
    node.inputs["Mortar Size"].default_value = row_height * joint
    node.inputs["Mortar Smooth"].default_value = 0.02
    node.inputs["Color1"].default_value = (0, 0, 0, 1)
    node.inputs["Color2"].default_value = (1, 1, 1, 1)
    node.inputs["Mortar"].default_value = (0, 0, 0, 1)
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    return node.outputs["Color"], node.outputs["Fac"]


# ── The surfaces ─────────────────────────────────────────────────────────────

Builder = "Callable[[], bpy.types.Material]"
SURFACES: dict[str, object] = {}


def surface(name: str):
    def wrap(fn):
        SURFACES[name] = fn
        return fn
    return wrap


@surface("roof-tile")
def roof_tile() -> bpy.types.Material:
    """Clay pantiles seen from above.

    The weighting is the whole trick. A roof is read from its **courses**: each
    tile laps the one below, so a shadow runs across the slope every course,
    while the joints between neighbouring tiles in a course are hairline by
    comparison. Giving both the same weight — which is what a plain brick
    lattice does — produces a brick wall lying down.

    The shadow is a *band*, not a half. Ramping it over 60 % of the course made
    the map read as dark stripes; a lap covers something like a sixth of the
    tile it sits on, and the ramp says so.
    """
    mat, tree, bsdf = _new_material("roof-tile")
    COURSES = 12
    tile, joint = brick(tree, rows=COURSES, columns=8, joint=0.035)
    course = wave_bands(tree, COURSES, "Y", "SAW")
    drift = tiling_noise(tree, scale=6.0, detail=3.0)
    grain = tiling_noise(tree, scale=64.0, detail=5.0)

    clay = mix(
        tree, drift,
        ramp(tree, tile, [(0.0, "#96492f"), (0.5, "#b96444"), (1.0, "#cd7d52")]),
        ramp(tree, tile, [(0.0, "#843d27"), (0.5, "#a95739"), (1.0, "#c06c44")]),
    )
    clay = mix(tree, grain, clay, ramp(tree, tile, [(0.0, "#9c4d33"), (1.0, "#c2704d")]))
    # Hairline joint between neighbouring tiles — present, never dominant.
    clay = mix(tree, joint, clay, ramp(tree, grain, [(0.0, "#8a4530"), (1.0, "#9d5138")]))

    # The lap shadow: a band across the top sixth of each course, and a darker
    # clay rather than black — a roof in daylight has no black on it.
    lap = ramp(tree, course, [(0.0, "#000000"), (0.13, "#000000"), (0.20, "#ffffff"), (1.0, "#ffffff")])
    tree.links.new(
        mix(tree, lap, ramp(tree, grain, [(0.0, "#4a2318"), (1.0, "#5d2f20")]), clay),
        bsdf.inputs["Base Color"],
    )

    height = math_node(tree, "MULTIPLY", course, 0.7)
    height = math_node(tree, "ADD", height, math_node(tree, "MULTIPLY", one_minus(tree, joint), 0.2))
    height = math_node(tree, "ADD", height, math_node(tree, "MULTIPLY", grain, 0.1))
    bump(tree, bsdf, height, 0.9)
    tree.links.new(ramp(tree, grain, [(0.0, "#9e9e9e"), (1.0, "#d4d4d4")]), bsdf.inputs["Roughness"])
    return mat

@surface("facade-plaster")
def facade_plaster() -> bpy.types.Material:
    """Rendered exterior wall: fine float texture, almost no colour variation."""
    mat, tree, bsdf = _new_material("facade-plaster")
    grain = tiling_noise(tree, scale=64.0, detail=8.0, roughness=0.62)
    broad = tiling_noise(tree, scale=4.0, detail=3.0)
    tint = mix(
        tree, broad,
        ramp(tree, grain, [(0.0, "#d9d3c8"), (1.0, "#efe9de")]),
        ramp(tree, grain, [(0.0, "#cfc8bc"), (1.0, "#e6e0d5")]),
    )
    tree.links.new(tint, bsdf.inputs["Base Color"])
    bump(tree, bsdf, grain, 0.28)
    tree.links.new(ramp(tree, grain, [(0.0, "#d4d4d4"), (1.0, "#f2f2f2")]), bsdf.inputs["Roughness"])
    return mat


@surface("klinker")
def klinker() -> bpy.types.Material:
    """North-German facing brick: running bond, sintered colour spread."""
    mat, tree, bsdf = _new_material("klinker")
    variation, joint = brick(tree, rows=14, columns=4, joint=0.15)
    grain = tiling_noise(tree, scale=72.0, detail=6.0)
    stone = mix(
        tree, grain,
        ramp(tree, variation, [(0.0, "#54291f"), (0.35, "#8a4a34"), (0.7, "#a8603f"), (1.0, "#6d3a29")]),
        ramp(tree, variation, [(0.0, "#5f2f23"), (0.5, "#94523a"), (1.0, "#7a4230")]),
    )
    mortar = ramp(tree, grain, [(0.0, "#585149"), (1.0, "#6f675e")])
    tree.links.new(mix(tree, joint, stone, mortar), bsdf.inputs["Base Color"])
    height = math_node(tree, "MULTIPLY", one_minus(tree, joint), 0.9)
    height = math_node(tree, "ADD", height, math_node(tree, "MULTIPLY", grain, 0.1))
    bump(tree, bsdf, height, 0.9)
    # The fired stone is glassier than the mortar; that jump at every joint edge
    # is what makes brick read as brick.
    tree.links.new(
        mix(tree, joint,
            ramp(tree, grain, [(0.0, "#8f8f8f"), (1.0, "#b8b8b8")]),
            ramp(tree, grain, [(0.0, "#e8e8e8"), (1.0, "#fafafa")])),
        bsdf.inputs["Roughness"],
    )
    return mat

@surface("lawn")
def lawn() -> bpy.types.Material:
    """Mown grass seen from above: clumped blades, mower drift, dry patches."""
    mat, tree, bsdf = _new_material("lawn")
    blades = tiling_voronoi(tree, scale=46.0, feature="F1", randomness=1.0)
    clumps = tiling_noise(tree, scale=11.0, detail=8.0, roughness=0.7)
    dry = tiling_noise(tree, scale=3.0, detail=3.0)
    green = mix(
        tree, clumps,
        ramp(tree, blades, [(0.0, "#2c4f22"), (0.45, "#4d8438"), (1.0, "#7cb356")]),
        ramp(tree, blades, [(0.0, "#24421d"), (0.55, "#3f7130"), (1.0, "#6aa049")]),
    )
    tree.links.new(mix(tree, dry, green, ramp(tree, blades, [(0.0, "#5d6f38"), (1.0, "#93a05e")])),
                   bsdf.inputs["Base Color"])
    bump(tree, bsdf, math_node(tree, "ADD",
                               math_node(tree, "MULTIPLY", blades, 0.7),
                               math_node(tree, "MULTIPLY", clumps, 0.3)), 0.55)
    bsdf.inputs["Roughness"].default_value = 0.93
    return mat


@surface("asphalt")
def asphalt() -> bpy.types.Material:
    """Road surface: bitumen with exposed aggregate and tyre polish."""
    mat, tree, bsdf = _new_material("asphalt")
    aggregate = tiling_voronoi(tree, scale=44.0, feature="F1")
    grit = tiling_noise(tree, scale=96.0, detail=8.0)
    patch = tiling_noise(tree, scale=2.5, detail=2.0)
    stone = ramp(tree, aggregate, [(0.0, "#2f3236"), (0.45, "#3c4045"), (1.0, "#4a4f55")])
    worn = ramp(tree, patch, [(0.0, "#33363a"), (1.0, "#43474c")])
    tree.links.new(mix(tree, grit, stone, worn), bsdf.inputs["Base Color"])
    bump(tree, bsdf, math_node(tree, "ADD",
                               math_node(tree, "MULTIPLY", aggregate, 0.6),
                               math_node(tree, "MULTIPLY", grit, 0.4)), 0.4)
    tree.links.new(ramp(tree, patch, [(0.0, "#b0b0b0"), (1.0, "#e8e8e8")]), bsdf.inputs["Roughness"])
    return mat


@surface("paver")
def paver() -> bpy.types.Material:
    """Concrete block paving: driveways, aprons, footpaths."""
    mat, tree, bsdf = _new_material("paver")
    variation, joint = brick(tree, rows=10, columns=5, joint=0.12)
    grit = tiling_noise(tree, scale=84.0, detail=6.0)
    stone = mix(
        tree, grit,
        ramp(tree, variation, [(0.0, "#807d78"), (0.5, "#a3a099"), (1.0, "#bcb8af")]),
        ramp(tree, variation, [(0.0, "#8b8880"), (1.0, "#adaaa1")]),
    )
    sand = ramp(tree, grit, [(0.0, "#6a655c"), (1.0, "#7e786d")])
    tree.links.new(mix(tree, joint, stone, sand), bsdf.inputs["Base Color"])
    height = math_node(tree, "MULTIPLY", one_minus(tree, joint), 0.85)
    height = math_node(tree, "ADD", height, math_node(tree, "MULTIPLY", grit, 0.15))
    bump(tree, bsdf, height, 0.8)
    tree.links.new(ramp(tree, grit, [(0.0, "#c8c8c8"), (1.0, "#efefef")]), bsdf.inputs["Roughness"])
    return mat

@surface("gravel")
def gravel() -> bpy.types.Material:
    """Loose chippings — parking strips, borders, flat-roof ballast."""
    mat, tree, bsdf = _new_material("gravel")
    stones = tiling_voronoi(tree, scale=26.0, feature="F1")
    tone = tiling_voronoi(tree, scale=26.0, feature="F1", output="Color")
    grit = tiling_noise(tree, scale=100.0, detail=6.0)
    base = ramp(tree, stones, [(0.0, "#a8a29a"), (0.4, "#8d877f"), (1.0, "#6c665f")])
    tree.links.new(mix(tree, grit, base, tone), bsdf.inputs["Base Color"])
    bump(tree, bsdf, math_node(tree, "ADD",
                               math_node(tree, "MULTIPLY", stones, 0.8),
                               math_node(tree, "MULTIPLY", grit, 0.2)), 0.85)
    bsdf.inputs["Roughness"].default_value = 0.88
    return mat
