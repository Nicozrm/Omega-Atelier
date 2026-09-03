"""
pieces.py — one builder per furniture id.

Each builder models a piece at the **catalog's nominal footprint** (see
`src/data/furniture.ts`; note the catalog has duplicate ids and the app resolves
them last-wins via `Object.fromEntries`, so the sizes here follow that). The
build then measures what it actually produced and writes that into the manifest,
which is what the app scales against — so a builder and the registry can never
disagree about how big a piece is.

Reminder of the conventions from `shapes`: metres, Z up, front at -Y, floor at
Z = 0, centred on X/Y. `finish()` re-centres and re-seats regardless, so a
builder that is a centimetre off is corrected rather than shipped crooked.
"""

from __future__ import annotations

from typing import Callable

import bpy

from .shapes import box, cushion, cylinder, leg, legs_at_corners, rounded_tube, shell, slab

# id -> (builder, nominal footprint in cm as the catalog states it)
Builder = Callable[[], None]
REGISTRY: dict[str, tuple[Builder, tuple[int, int]]] = {}


def piece(asset_id: str, width_cm: int, depth_cm: int):
    def wrap(fn: Builder) -> Builder:
        REGISTRY[asset_id] = (fn, (width_cm, depth_cm))
        return fn

    return wrap


# ── Seating ──────────────────────────────────────────────────────────────────


def _sofa(width: float, depth: float, seats: int, fabric: str = "fabric_beige") -> None:
    """A shared sofa body: plinth, arms, back, and one cushion per seat.

    The cushions are `cushion()` rather than boxes, which is the whole point —
    a subdivided, heavily bevelled slab reads as upholstery where a rounded box
    reads as a rounded box.

    Everything above the floor is offset by `lift`, the leg height. Building the
    plinth from Z = 0 instead left the legs entirely inside it: the first render
    showed a sofa sitting flat on the ground with one leg poking out through an
    armrest.
    """
    lift, arm_w, back_t = 0.12, 0.16, 0.17
    seat_h = 0.28  # plinth height above the legs
    top = lift + seat_h
    box("plinth", (width, depth, seat_h), (0, 0, lift + seat_h / 2), fabric, bevel=0.03)
    # The back spans only the width *between* the arms. Running it the full
    # width put two bevelled edges against each other at each end, leaving a
    # shadowed sliver that rendered as a dark notch in the armrest.
    box(
        "back",
        (width - 2 * arm_w + 0.04, back_t, 0.46),
        (0, depth / 2 - back_t / 2, top + 0.19),
        fabric,
        bevel=0.05,
    )
    for sign in (-1, 1):
        box(
            "arm",
            (arm_w, depth, 0.26),
            (sign * (width / 2 - arm_w / 2), 0, top + 0.10),
            fabric,
            bevel=0.07,
        )

    inner = width - 2 * arm_w - 0.04
    seat_d = depth - back_t - 0.06
    for i in range(seats):
        cw = inner / seats - 0.02
        x = -inner / 2 + i * (inner / seats) + cw / 2 + 0.01
        cushion("seat", (cw, seat_d, 0.15), (x, -0.02, top + 0.05), fabric)
        cushion(
            "back_cushion",
            (cw - 0.02, 0.16, 0.36),
            (x, depth / 2 - back_t - 0.06, top + 0.22),
            fabric,
            plump=0.8,
        )
    # Inset well under the plinth so no leg can surface through an arm.
    for obj in legs_at_corners("leg", (width, depth), 0.14, lift, "soft_black"):
        obj.name = "sofa_leg"


@piece("sofa-2seat", 160, 95)
def sofa_2seat() -> None:
    _sofa(1.60, 0.95, 2)


@piece("sofa-3seat", 220, 95)
def sofa_3seat() -> None:
    _sofa(2.20, 0.95, 3)


@piece("lounge-chair", 80, 80)
def lounge_chair() -> None:
    """A moulded shell chair on tapered wooden legs — curvature, not corners.

    The shell opens at the front *and* the top: a tub of back and side walls
    with a floor, which is what a shell chair is. Opening only the front gave a
    closed box with a cushion sealed inside it.
    """
    w, d, seat_z = 0.80, 0.80, 0.38
    shell("shell", (w, d, 0.46), (0, 0.03, seat_z + 0.23), "fabric_gray",
          thickness=0.045, open_faces=("front", "top"), bevel=0.14)
    cushion("seat", (w - 0.17, d - 0.24, 0.11), (0, -0.03, seat_z + 0.09), "fabric_gray")
    # Legs stop where the shell floor begins, so nothing passes through it.
    for i, (x, y) in enumerate(((-0.26, -0.26), (0.26, -0.26), (-0.26, 0.26), (0.26, 0.26))):
        leg(f"leg_{i}", 0.024, 0.015, seat_z + 0.02, (x, y), "oak")


@piece("barstool", 40, 40)
def barstool() -> None:
    cylinder("seat", 0.19, 0.07, (0, 0, 0.70), "leather_black", segments=24)
    cylinder("column", 0.028, 0.66, (0, 0, 0.34), "steel", segments=16)
    cylinder("base", 0.19, 0.025, (0, 0, 0.014), "steel", segments=24)
    rounded_tube("footrest", 0.014, 0.30, (0, 0, 0.22), "steel", axis="X", segments=10)


@piece("office-chair", 65, 65)
def office_chair() -> None:
    cushion("seat", (0.48, 0.46, 0.09), (0, 0, 0.47), "fabric_gray")
    # Backrest tilted back — a chair that sits perfectly upright looks wrong.
    box("back", (0.44, 0.07, 0.50), (0, 0.20, 0.78), "fabric_gray", bevel=0.05,
        rot=(-0.14, 0, 0))
    cylinder("column", 0.03, 0.34, (0, 0, 0.28), "soft_black", segments=14)
    # A five-star base. Each spoke is placed at its own mid-radius and rotated
    # about its length axis in one euler: (0, π/2, a) lays the cylinder along X
    # first and then swings it to the spoke's bearing. Rotating the object after
    # placement instead spins it about its own centre, which is why the first
    # attempt produced a 0.48 m base where the catalog wants 0.65 m.
    import math

    reach = 0.32
    for i in range(5):
        a = i * (2 * math.pi / 5)
        cylinder(
            f"spoke_{i}", 0.016, reach,
            (math.cos(a) * reach / 2, math.sin(a) * reach / 2, 0.055), "soft_black",
            segments=8, rot=(0, 1.5708, a),
        )
        cylinder(f"caster_{i}", 0.026, 0.02,
                 (math.cos(a) * reach, math.sin(a) * reach, 0.026), "soft_black",
                 segments=10, rot=(1.5708, 0, 0))


# ── Tables & desks ───────────────────────────────────────────────────────────


@piece("table-dining-6", 180, 90)
def table_dining_6() -> None:
    w, d, h = 1.80, 0.90, 0.75
    slab("top", (w, d, 0.038), (0, 0, h - 0.019), "oak", bevel=0.01)
    for obj in legs_at_corners("leg", (w, d), 0.11, h - 0.038, "oak",
                               top_radius=0.032, bottom_radius=0.022):
        obj.name = "table_leg"


@piece("table-side", 50, 50)
def table_side() -> None:
    cylinder("top", 0.25, 0.032, (0, 0, 0.50), "walnut", segments=32)
    cylinder("column", 0.028, 0.47, (0, 0, 0.24), "soft_black", segments=14)
    cylinder("foot", 0.17, 0.018, (0, 0, 0.01), "soft_black", segments=28)


@piece("desk-160", 160, 80)
def desk_160() -> None:
    w, d, h = 1.60, 0.80, 0.74
    slab("top", (w, d, 0.03), (0, 0, h - 0.015), "oak", bevel=0.008)
    # A modesty panel and flat side frames — the shape of a real desk, and it
    # gives the piece a readable silhouette from across the room.
    slab("modesty", (w - 0.24, 0.022, 0.28), (0, d / 2 - 0.06, h - 0.20), "oak")
    for sign in (-1, 1):
        slab("side", (0.032, d - 0.06, h - 0.03),
             (sign * (w / 2 - 0.05), 0, (h - 0.03) / 2), "soft_black")


# ── Storage ──────────────────────────────────────────────────────────────────


@piece("wardrobe-200", 200, 60)
def wardrobe_200() -> None:
    w, d, h = 2.00, 0.60, 2.10
    shell("carcass", (w, d, h - 0.06), (0, 0, 0.06 + (h - 0.06) / 2), "oak",
          thickness=0.02, open_faces=("front",))
    # Four doors with a shadow gap between them, and slim vertical handles.
    for i in range(4):
        dw = (w - 0.05) / 4
        x = -w / 2 + 0.025 + i * dw + dw / 2
        slab("door", (dw - 0.012, 0.02, h - 0.13), (x, -d / 2 + 0.01, 0.06 + (h - 0.06) / 2), "oak")
        rounded_tube("handle", 0.008, 0.22,
                     (x + dw / 2 - 0.05, -d / 2 - 0.005, 1.15), "steel",
                     axis="Z", segments=8)
    slab("plinth", (w - 0.06, d - 0.04, 0.06), (0, 0, 0.03), "soft_black")


@piece("bookshelf", 80, 30)
def bookshelf() -> None:
    w, d, h = 0.80, 0.30, 1.85
    shell("carcass", (w, d, h), (0, 0, h / 2), "oak", thickness=0.018, open_faces=("front",))
    for i in range(4):
        z = 0.36 + i * 0.36
        slab("shelf", (w - 0.036, d - 0.02, 0.018), (0, 0.005, z), "oak")


@piece("tv-sideboard", 200, 45)
def tv_sideboard() -> None:
    w, d, h = 2.00, 0.45, 0.46
    shell("carcass", (w, d, h - 0.1), (0, 0, 0.1 + (h - 0.1) / 2), "walnut",
          thickness=0.018, open_faces=("front",))
    for i in range(3):
        dw = (w - 0.04) / 3
        x = -w / 2 + 0.02 + i * dw + dw / 2
        slab("front", (dw - 0.012, 0.018, h - 0.14), (x, -d / 2 + 0.009, 0.1 + (h - 0.1) / 2), "walnut")
        rounded_tube("handle", 0.007, dw * 0.4, (x, -d / 2 - 0.004, h - 0.1), "steel",
                     axis="X", segments=8)
    for i, x in enumerate((-w / 2 + 0.12, w / 2 - 0.12)):
        for y in (-d / 2 + 0.08, d / 2 - 0.08):
            leg(f"leg_{i}_{y:.2f}", 0.018, 0.012, 0.10, (x, y), "soft_black")


@piece("dresser", 110, 45)
def dresser() -> None:
    w, d, h = 1.10, 0.45, 0.82
    shell("carcass", (w, d, h - 0.1), (0, 0, 0.1 + (h - 0.1) / 2), "oak",
          thickness=0.018, open_faces=("front",))
    for i in range(3):
        dh = (h - 0.16) / 3
        z = 0.13 + i * dh + dh / 2
        slab("drawer", (w - 0.05, 0.018, dh - 0.012), (0, -d / 2 + 0.009, z), "oak")
        rounded_tube("handle", 0.007, w * 0.32, (0, -d / 2 - 0.004, z), "steel",
                     axis="X", segments=8)
    for obj in legs_at_corners("leg", (w - 0.08, d - 0.08), 0.05, 0.10, "soft_black"):
        obj.name = "dresser_leg"


@piece("shoe-rack", 90, 30)
def shoe_rack() -> None:
    w, d, h = 0.90, 0.30, 0.62
    for sign in (-1, 1):
        slab("side", (0.02, d, h), (sign * (w / 2 - 0.01), 0, h / 2), "oak")
    for i in range(3):
        # Angled shelves, the way a real shoe rack holds a shoe.
        slab("shelf", (w - 0.04, d - 0.02, 0.016), (0, 0.01, 0.14 + i * 0.20), "oak",
             rot=(-0.22, 0, 0))


# ── Bedroom ──────────────────────────────────────────────────────────────────


def _bed(width: float, length: float, headboard: float = 0.95) -> None:
    lift, mattress_h = 0.10, 0.22
    frame_h = 0.20  # frame body above the legs
    frame_top = lift + frame_h
    box("frame", (width, length, frame_h), (0, 0, lift + frame_h / 2), "walnut", bevel=0.015)
    box("headboard", (width, 0.06, headboard - frame_top),
        (0, length / 2 - 0.03, frame_top + (headboard - frame_top) / 2), "walnut", bevel=0.03)
    cushion("mattress", (width - 0.06, length - 0.06, mattress_h),
            (0, 0, frame_top + mattress_h / 2), "linen", plump=0.5)
    # A duvet stopping short of the head, and pillows — the detail that makes a
    # bed read as made rather than as a slab.
    cushion("duvet", (width - 0.10, length * 0.62, 0.10),
            (0, -length * 0.16, frame_top + mattress_h + 0.045), "warm_white", plump=0.7)
    pillow_w = min(0.62, width / 2 - 0.05)
    for sign in ((-1, 1) if width > 1.1 else (0,)):
        cushion("pillow", (pillow_w, 0.36, 0.11),
                (sign * (width / 4 if width > 1.1 else 0), length / 2 - 0.30,
                 frame_top + mattress_h + 0.05), "warm_white", plump=0.9)
    for obj in legs_at_corners("leg", (width, length), 0.12, lift, "soft_black"):
        obj.name = "bed_leg"


@piece("bed-140", 140, 200)
def bed_140() -> None:
    _bed(1.40, 2.00)


@piece("bed-180", 185, 210)
def bed_180() -> None:
    _bed(1.85, 2.10)


# ── Kitchen ──────────────────────────────────────────────────────────────────


"""A white-goods body: steel carcass, recessed door(s), a bar handle."""


# How far a door front and its handle stand proud of the carcass. Budgeted out
# of the authored depth rather than added to it — a fridge that lists as 65 cm
# deep has to occupy 65 cm including its handle, or the plan lies about clearance.
_DOOR_T, _HANDLE_R = 0.018, 0.011
_FRONT = _DOOR_T + 2 * _HANDLE_R + 0.004


def _appliance(width: float, depth: float, height: float, door_split: int = 1) -> None:
    body_d = depth - _FRONT
    front = -depth / 2
    box("body", (width, body_d, height), (0, front + _FRONT + body_d / 2, height / 2),
        "warm_white", bevel=0.012)
    for i in range(door_split):
        dh = height / door_split
        z = i * dh + dh / 2
        slab("door", (width - 0.02, _DOOR_T, dh - 0.015),
             (0, front + _FRONT - _DOOR_T / 2, z), "steel")
        rounded_tube("handle", _HANDLE_R, width * 0.72,
                     (0, front + _HANDLE_R, z + dh / 2 - 0.09), "steel",
                     axis="X", segments=10)


@piece("fridge", 60, 65)
def fridge() -> None:
    _appliance(0.60, 0.65, 1.85, door_split=2)


@piece("oven", 60, 60)
def oven() -> None:
    # Same depth budget as the other white goods: glass, handle and knobs all
    # live inside the 60 cm the catalog promises.
    body_d = 0.60 - _FRONT
    box("body", (0.60, body_d, 0.60), (0, -0.30 + _FRONT + body_d / 2, 0.30),
        "soft_black", bevel=0.012)
    face = -0.30 + _FRONT
    slab("glass", (0.52, _DOOR_T, 0.38), (0, face - _DOOR_T / 2, 0.27), "glass_dark")
    rounded_tube("handle", 0.012, 0.52, (0, -0.30 + 0.012, 0.51), "steel",
                 axis="X", segments=10)
    for i, x in enumerate((-0.22, -0.08, 0.08, 0.22)):
        cylinder(f"knob_{i}", 0.022, 0.018, (x, face - 0.009, 0.565), "steel",
                 segments=12, rot=(1.5708, 0, 0))


@piece("dishwasher", 60, 60)
def dishwasher() -> None:
    _appliance(0.60, 0.60, 0.82, door_split=1)


@piece("washer", 60, 60)
def washer() -> None:
    box("body", (0.60, 0.60, 0.85), (0, 0, 0.425), "warm_white", bevel=0.012)
    # The porthole: a ring plus dark glass, the one feature that makes a washing
    # machine unmistakable at a glance. Both sit flush in the front face so the
    # body's own 60 cm stays the footprint.
    cylinder("porthole", 0.20, 0.02, (0, -0.295, 0.44), "steel", segments=28,
             rot=(1.5708, 0, 0))
    cylinder("glass", 0.155, 0.016, (0, -0.299, 0.44), "glass_dark", segments=28,
             rot=(1.5708, 0, 0))
    slab("panel", (0.56, 0.018, 0.09), (0, -0.294, 0.78), "steel")


# ── Bath ─────────────────────────────────────────────────────────────────────


@piece("bathtub", 170, 80)
def bathtub() -> None:
    w, d, h = 1.70, 0.80, 0.56
    # Solidified open-top box: an actual basin with wall thickness, which a
    # stack of panels cannot express.
    shell("tub", (w, d, h), (0, 0, h / 2), "ceramic", thickness=0.05,
          open_faces=(), bevel=0.09)
    import bmesh

    obj = bpy.data.objects["tub"]
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    rounded_tube("spout", 0.018, 0.14, (0, d / 2 - 0.08, h + 0.06), "steel",
                 axis="Y", segments=10)


@piece("toilet", 40, 70)
def toilet() -> None:
    # Laid out back-to-front across the catalog's 70 cm: cistern against the
    # wall at +Y, bowl and seat projecting toward the room at -Y.
    box("cistern", (0.38, 0.18, 0.54), (0, 0.26, 0.27), "ceramic", bevel=0.03)
    cylinder("bowl", 0.185, 0.34, (0, -0.06, 0.22), "ceramic", segments=24)
    cushion("seat", (0.38, 0.50, 0.04), (0, -0.10, 0.41), "warm_white", plump=0.4)
    cylinder("foot", 0.13, 0.10, (0, -0.02, 0.05), "ceramic", segments=20)


@piece("sink-bath", 60, 50)
def sink_bath() -> None:
    box("counter", (0.60, 0.50, 0.10), (0, 0, 0.85), "ceramic", bevel=0.02)
    shell("basin", (0.42, 0.34, 0.14), (0, -0.01, 0.83), "ceramic",
          thickness=0.02, open_faces=(), bevel=0.05)
    rounded_tube("tap", 0.015, 0.22, (0, 0.18, 0.99), "steel", axis="Z", segments=10)
    rounded_tube("spout", 0.013, 0.14, (0, 0.12, 1.09), "steel", axis="Y", segments=10)
    box("pedestal", (0.52, 0.44, 0.80), (0, 0.02, 0.40), "warm_white", bevel=0.012)
