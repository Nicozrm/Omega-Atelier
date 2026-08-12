"""
materials.py — the shared PBR palette for generated furniture.

The colours are the app's own material tokens (``src/lib/materialSlots.ts``)
plus the neutrals the procedural meshes already use, so a Blender-authored
piece sits in the same room as a procedural one without reading as a different
art style. Everything is untextured on purpose: these assets ship inside the
repo and are loaded on a phone, so a solid Principled BSDF costs a few hundred
bytes where an image would cost hundreds of kilobytes. Surface interest comes
from geometry — bevels catching the light — not from maps.
"""

from __future__ import annotations

import bpy

# name -> (hex, roughness, metallic)
PALETTE: dict[str, tuple[str, float, float]] = {
    # Upholstery — matches UPHOLSTERY_SLOTS
    "fabric_beige": ("#cdb992", 0.94, 0.0),
    "fabric_gray": ("#9b9b96", 0.94, 0.0),
    "fabric_blue": ("#5a7da0", 0.94, 0.0),
    "leather_black": ("#2a2724", 0.62, 0.0),
    # Wood — matches WOOD_SLOTS
    "oak": ("#bb8a59", 0.66, 0.0),
    "walnut": ("#7a4d2d", 0.58, 0.0),
    # Neutrals used by the procedural meshes
    "soft_black": ("#22242a", 0.48, 0.35),
    "warm_white": ("#ece7df", 0.55, 0.0),
    "ceramic": ("#f4f2ee", 0.22, 0.0),
    "steel": ("#b9bcc0", 0.32, 0.85),
    "glass_dark": ("#31353c", 0.15, 0.25),
    "linen": ("#ded6c6", 0.96, 0.0),
    "slate": ("#5c6068", 0.7, 0.0),
}


def _srgb_to_linear(c: float) -> float:
    """glTF stores base colour linearly; the palette is authored in sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(value: str) -> tuple[float, float, float, float]:
    h = value.lstrip("#")
    rgb = tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (*(_srgb_to_linear(c) for c in rgb), 1.0)


def material(name: str) -> bpy.types.Material:
    """Fetch (or create once) one palette material.

    Reused by name across every object in a build, which is what keeps a joined
    piece down to a handful of glTF primitives instead of one per part.
    """
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing

    if name not in PALETTE:
        raise KeyError(f"unknown palette material: {name}")
    hex_value, roughness, metallic = PALETTE[name]

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(hex_value)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat
