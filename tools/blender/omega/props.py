"""
props.py — street furniture and vehicles.

## What is worth building, and what is not

The neighbourhood draws its street furniture from boxes and cylinders. Four of
those carry real visual weight and appear in modest numbers, so a built model
pays for itself:

    lamp-post   two per street segment, and the tallest thing at the kerb
    bench       at bus stops and in parks, always seen from close by
    litter-bin  beside benches and stops
    car         on driveways and at the kerb — the box-slab was the worst of them

Fences are deliberately **not** here, for the same reason the hedge was dropped:
a boundary is drawn from five boxes per segment, and a panel model repeated along
every plot line would multiply that across the whole estate for a detail nobody
looks at. The cheap version is the right version there.

Same conventions as the rest of the pipeline: metres, Z up, front at -Y, base at
Z = 0, origin centred on the footprint.

## Materials are roles, not colours

Each mesh is named for the *role* it plays — body, glass, tyre, metal, dark —
because the scene assigns the actual materials: a parked car takes its colour
from the instance, and street furniture is tinted by daylight. See
`propMaterialRole` on the app side.
"""

from __future__ import annotations

import math
from typing import Callable

import bpy

from .materials import material
from .shapes import box, cylinder, leg, rounded_tube, slab

PROPS: dict[str, tuple[Callable[[], None], tuple[float, float, float]]] = {}


def prop(name: str, size: tuple[float, float, float]):
    """Register a builder with the size (x, y, z in metres) it is authored at."""
    def wrap(fn: Callable[[], None]) -> Callable[[], None]:
        PROPS[name] = (fn, size)
        return fn
    return wrap


@prop("lamp-post", (0.26, 1.11, 4.13))
def lamp_post() -> None:
    """A street column with a swan-neck arm and a shallow luminaire.

    The arm is what makes a street lamp read as one: a straight pole with a lump
    on top is a bollard. It reaches over the carriageway, which is also why the
    placement alternates sides — and why the arm has to obey this module's
    front-at-−Y convention like everything else. It used to reach along +X,
    which the exporter turns into glTF +X while every other prop's front lands
    on +Z; the placement code would then have needed a quarter turn for this one
    asset, and the next prop would have got it wrong.
    """
    cylinder("base", 0.13, 0.12, (0.0, 0.0, 0.06), "soft_black", segments=10)
    leg("column", 0.05, 0.085, 3.7, (0.0, 0.0), "soft_black", segments=10)

    # Swan neck: three short tubes stepping over, cheaper than a real curve and
    # indistinguishable at street scale. Rotated about X, so the cylinder's own
    # +Z axis tips toward −Y and the neck leans out over the road.
    for i, (dy, dz, pitch) in enumerate(((0.12, 3.82, 0.55), (0.34, 3.98, 0.95), (0.6, 4.06, 1.35))):
        cylinder(f"arm{i}", 0.038, 0.30, (0.0, -dy, dz), "soft_black", segments=8,
                 rot=(pitch, 0.0, 0.0))

    box("head", (0.24, 0.42, 0.07), (0.0, -0.78, 4.03), "soft_black", bevel=0.03)
    box("lens", (0.18, 0.34, 0.035), (0.0, -0.78, 3.99), "lamp_lens", bevel=0.012)


@prop("bench", (1.70, 0.61, 0.94))
def bench() -> None:
    """A park bench: slatted seat and back on two cast ends.

    The slats are the point. A bench modelled as two solid boards is a plinth;
    the gaps are what the eye reads, and they cost four extra boxes.
    """
    for sign in (-1, 1):
        x = sign * 0.78
        # Cast end: a foot, an upright and the seat bearer.
        box(f"foot{sign}", (0.07, 0.52, 0.07), (x, 0.0, 0.035), "soft_black", bevel=0.02, segments=1)
        box(f"leg{sign}", (0.06, 0.07, 0.42), (x, -0.1, 0.21), "soft_black", bevel=0.02, segments=1)
        # The raked back upright. It has to run from the seat bearer up past the
        # *top* slat: at 0.78 long it stopped at z ≈ 0.77 and the highest slat
        # sat at 0.87, floating behind the frame with nothing holding it.
        box(f"prop{sign}", (0.06, 0.07, 0.60), (x, 0.257, 0.645), "soft_black", bevel=0.02,
            segments=1, rot=(0.22, 0.0, 0.0))
        box(f"bearer{sign}", (0.06, 0.5, 0.06), (x, 0.0, 0.43), "soft_black", bevel=0.02, segments=1)

    # One bevel segment on the slats. Seven slats at the default two segments
    # cost more than the rest of the bench put together and hit the decimate cap.
    for i in range(4):
        y = -0.2 + i * 0.135
        slab(f"seat{i}", (1.7, 0.11, 0.035), (0.0, y, 0.47), "oak", bevel=0.008, segments=1)
    for i in range(3):
        # Backrest, raked back the way a bench you would sit on is.
        z = 0.6 + i * 0.135
        slab(f"back{i}", (1.7, 0.035, 0.11), (0.0, 0.22 + i * 0.03, z), "oak", bevel=0.008,
             segments=1, rot=(0.22, 0.0, 0.0))


@prop("litter-bin", (0.44, 0.45, 0.99))
def litter_bin() -> None:
    """A post-mounted street bin with a domed lid and an open throat."""
    leg("post", 0.035, 0.045, 0.58, (0.0, 0.0), "soft_black", segments=8)
    cylinder("body", 0.21, 0.52, (0.0, 0.0, 0.68), "soft_black", segments=14)
    # The rim and the lid: without them a bin is a cylinder on a stick.
    cylinder("rim", 0.225, 0.04, (0.0, 0.0, 0.93), "steel", segments=14)
    cylinder("lid", 0.2, 0.06, (0.0, 0.0, 0.96), "steel", segments=14)
    rounded_tube("hoop", 0.014, 0.3, (0.0, -0.2, 0.75), "steel", axis="X", segments=6)


@prop("car", (1.86, 4.44, 1.47))
def car() -> None:
    """A saloon.

    Modelled as the two masses a car actually reads as — a lower body and a
    tapered greenhouse set back on it — rather than the flat slab with a box on
    top the procedural version uses. The taper is most of the difference: a
    cabin the same width as the body looks like a van.
    """
    # Lower body, generously bevelled so the shoulders catch light.
    box("body", (1.84, 4.3, 0.62), (0.0, 0.0, 0.62), "car_body", bevel=0.16, segments=2)
    # Sills tuck under, which is what stops it reading as a brick.
    box("sill", (1.7, 3.9, 0.2), (0.0, 0.0, 0.3), "car_dark", bevel=0.07, segments=1)

    # Greenhouse: narrower, shorter, set back, and raked.
    box("cabin", (1.6, 2.25, 0.5), (0.0, -0.18, 1.16), "car_body", bevel=0.2, segments=2)
    box("glass", (1.63, 2.05, 0.4), (0.0, -0.18, 1.18), "car_glass", bevel=0.16, segments=2)

    box("bumper_f", (1.78, 0.16, 0.28), (0.0, -2.14, 0.5), "car_dark", bevel=0.06, segments=1)
    box("bumper_r", (1.78, 0.16, 0.28), (0.0, 2.14, 0.5), "car_dark", bevel=0.06, segments=1)
    for sign in (-1, 1):
        box(f"light_f{sign}", (0.38, 0.08, 0.13), (sign * 0.6, -2.13, 0.74), "steel", bevel=0.03, segments=1)
        box(f"light_r{sign}", (0.34, 0.08, 0.12), (sign * 0.62, 2.13, 0.76), "steel", bevel=0.03, segments=1)

    for i, (wx, wy) in enumerate(((-0.82, -1.32), (0.82, -1.32), (-0.82, 1.32), (0.82, 1.32))):
        # Tyre and hub, laid on their side.
        cylinder(f"tyre{i}", 0.33, 0.19, (wx, wy, 0.33), "car_dark", segments=12,
                 rot=(0.0, math.pi / 2, 0.0))
        cylinder(f"hub{i}", 0.19, 0.2, (wx, wy, 0.33), "steel", segments=10,
                 rot=(0.0, math.pi / 2, 0.0))
        # Arch lip, so the wheel sits in the body rather than beside it.
        cylinder(f"arch{i}", 0.42, 0.05, (wx, wy, 0.36), "car_dark", segments=10,
                 rot=(0.0, math.pi / 2, 0.0))
    _ = material  # palette entries are resolved by the shape helpers
