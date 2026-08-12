# Blender asset pipeline (`tools/blender/`)

Generates the furniture GLBs in `public/models/` from Python. Nothing here runs
during `npm run build` — assets are generated deliberately and committed, so the
app never needs Blender.

## Run it

Two ways, because the repo is worked on from both:

```bash
# with a local Blender install (4.2+ / 5.x)
blender --background --python tools/blender/build.py -- --only sofa-3seat

# with the headless Blender Python module
pip install bpy
python3 tools/blender/build.py
```

```
--only a,b,c   build just these ids          --list   show every known id
--out DIR      write elsewhere than public/models
```

Review what came out — geometry nobody looked at is geometry nobody can vouch
for:

```bash
python3 tools/blender/preview.py --only sofa-3seat,lounge-chair --out /tmp/prev
```

## Why generate instead of model by hand

The app already draws every piece from `RoundedBox` compositions, and they are
carefully made. What a box composition cannot do is the thing that makes
furniture read as furniture: a bevel catching a highlight along an edge, a
cushion that bulges, a leg that tapers, a shell whose corners round in all three
axes at once. Those are modelling operations — bevel, subdivision, solidify —
and that is what Blender is here for.

The second half is draw calls. A procedural sofa is ~20 meshes; a generated one
is a single joined object with one glTF primitive per material, typically two or
three. All 22 assets together weigh **~750 KB** — one textured CC0 armchair from
Poly Haven is 2.7 MB on its own, because these carry no textures at all. The
surface interest is geometry, and geometry compresses.

Everything here is original geometry built from primitives, so there is no
third-party licence attached to any of it.

## Conventions the app depends on

| | |
|---|---|
| Units | metres |
| Up axis | Blender **Z** (the exporter converts to glTF's Y-up) |
| Front | faces Blender **-Y**, which the exporter maps to glTF **+Z** |
| Origin | centred on the footprint, floor at Z = 0 |
| Footprint | the piece's catalog size in `src/data/furniture.ts` |

`finish()` enforces the last three rather than trusting them: it re-centres,
re-seats, joins, welds, decimates anything over budget, and measures what it
actually produced. `build.py` then warns when a piece drifts more than 4 cm from
its catalog footprint — that check caught six pieces on the first run, including
five carcasses that had grown by their own wall thickness because Blender's
Solidify defaults to growing outward.

## The manifest is the contract

Every build writes `manifest.json`: triangles, materials, measured footprint and
file size per asset. It is committed, and `src/assets/modelRegistry.test.ts`
reads it to assert that

- every built asset is registered in `src/assets/modelRegistry.ts`,
- each registry `nominal` matches the footprint the build measured,
- each footprint matches the app's furniture catalog,
- nothing exceeds the size / triangle / material budget.

That is what stops the registry, the assets and the catalog from drifting apart
silently — the failure mode being a model that still loads and is quietly
stretched into the wrong proportions.

## Adding a piece

1. Write a builder in `omega/pieces.py`, decorated with its id and catalog size:

   ```python
   @piece("bench-hall", 120, 40)
   def bench_hall() -> None:
       slab("seat", (1.20, 0.40, 0.04), (0, 0, 0.45), "oak")
       for obj in legs_at_corners("leg", (1.20, 0.40), 0.08, 0.45, "soft_black"):
           obj.name = "bench_leg"
   ```
2. `python3 tools/blender/build.py --only bench-hall`
3. Look at it: `python3 tools/blender/preview.py --only bench-hall`
4. Copy the manifest's `nominal` into `MODELS` in `src/assets/modelRegistry.ts`.
5. `npm test` — the conformance tests fail loudly if any of the four disagree.

The shared vocabulary lives in `omega/shapes.py` (`box`, `slab`, `cushion`,
`shell`, `leg`, `cylinder`, `rounded_tube`) and the palette in
`omega/materials.py`, which mirrors the app's own material tokens so a generated
piece sits in the same room as a procedural one without reading as a different
art style.
