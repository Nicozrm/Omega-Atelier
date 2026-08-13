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

## Baking outdoor textures

`bake.py` is the second half of the pipeline: it bakes the outdoor material
library — roof tiles, klinker, facade render, lawn, asphalt, block paving,
gravel — to tileable PBR images in `public/textures/outdoor/`.

```bash
blender --background --python tools/blender/bake.py -- --only lawn
python3 tools/blender/bake.py --list
```

Four passes per surface: `diff` (DIFFUSE with only the colour pass, so no light
is baked in), `nor` (tangent-space NORMAL from the graph's own bump), `rough`
(straight off the BSDF input) and `bump` (the height field, routed through an
Emission shader and baked as EMIT — Cycles has no height bake, and the app's
outdoor materials drive `bumpMap`).

### Seamless by construction

Blender's noise is 3D and does not tile on a plane. The graphs map the UV square
onto a **flat torus**

```
(cos 2πu, sin 2πu, cos 2πv)   with W = sin 2πv
```

and sample *4D* noise there, so opposite edges land on the same point and the
result is periodic by construction — no offset-and-blend band, no mirrored half.
`scale` therefore counts **features across one tile**; the helpers divide by 2π
so the number means what it looks like.

Brick-based surfaces tile natively — but **`rows` must be even**. Running bond
shifts every other course by half a brick, so with an odd count the top edge
carries the opposite parity to the bottom edge and the bond breaks at the wrap.

### The bake checks itself

Every pass is measured before it is written:

- **Seam ratio** — the step across the wrap against the 99th percentile of
  interior steps. A tiling texture scores below 1; the odd-row bug scored 5.03.
  Recorded per map in `textures.json` and asserted by
  `src/lib/outdoorTextures.test.ts`.
- **Constant maps are not written at all.** A 512² JPEG of one number costs
  bandwidth and a texture unit to say what a scalar says; the value goes in the
  manifest and the app sets it directly. Lawn and gravel roughness are two.

### How it reaches the screen

`src/lib/proceduralTextures.ts` consults the baked library before drawing. Each
surface is built once, cached module-wide and cloned per use, so replacing *what
one surface is* upgrades the plan's own house, the generated neighbourhood and
the cadastre buildings at once, without a call site changing. Until the images
arrive the canvas drawing stands, which keeps the first frame immediate and the
app working offline with no files at all.

## Vegetation

`plants.py` builds the trees in `public/models/env/`:

```bash
blender --background --python tools/blender/plants.py -- --only tree-birch
python3 tools/blender/plants.py --list
```

The procedural trees in the neighbourhood are cone stacks and canopy blobs on a
plain six-sided cylinder. The canopies were already irregular; the *trunks* were
not, and a tree with no branch structure reads as a lollipop. These add a tapered
stem that runs up **into** the crown and limbs that end **inside** it — the first
attempt stopped both short and left the canopy hovering over an umbrella frame.

The budget shapes everything: a neighbourhood plants hundreds and `Static` merges
them, so a triangle here is paid a few hundred times over. 124–368 triangles
each, 32 KB for the set. The main crown gets subdivision 2 because it carries the
silhouette; the satellites that break its outline stay at 1.

### Two heights, one ratio

The world model scales a tree by a factor where 1 means "the procedural tree of
this kind at its natural size", and those natural sizes differ per kind. So the
registry records both the model's authored height and the procedural height it
stands in for, and renders at their ratio. Getting this wrong would silently
rescale every tree in the scene, which is why `plantRegistry.test.ts` pins it.

Kinds with no model — olive, palm — keep their procedural form. That is a
supported outcome, not a gap.

### Only geometry comes from the file

The neighbourhood tints foliage by season and daylight: snow, autumn, dusk. A
clone keeping the file's baked greens would sit at high summer through a
snowstorm, so `PlantModelImpl` reassigns every mesh the scene's own foliage and
bark materials. Geometry is shared by reference across clones, so a street of
trees costs little beyond its nodes.

### Manifests are pruned, not just merged

All three builders drop records for assets that no longer exist. Merging alone
let a removed builder keep its manifest entry forever, and the app's conformance
test then hunted for a file nothing builds — which is exactly what happened when
`shrub` was dropped.
