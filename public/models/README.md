# Local GLB models (`public/models/`)

Real, optimised glTF assets that replace the procedural placeholder meshes — one
id at a time. Offline-first: files are served locally, never from a CDN.

**These files are build output.** Do not hand-edit them, and do not drop a raw
download in here: an unprocessed asset is typically 5-10× too large and lands at
whatever size and orientation its author chose. Run it through the pipeline.

## Building

```bash
node scripts/assets/fetch.mjs --all     # download CC0 sources → assets-src/
node scripts/assets/build.mjs           # normalise + optimise → public/models/
```

`build.mjs` also regenerates `src/assets/modelSizes.ts`, which is how the runtime
knows how big each asset is. Commit that file with the models.

### The two stages

| Stage | Tool | Job |
|---|---|---|
| `normalize.py` | Blender (headless, `pip install bpy`) | orient · centre · seat on floor · fit to the catalogue footprint |
| `optimize.mjs` | gltf-transform | dedup · join · WebP · Draco |

Blender does the part that needs real geometry handling; gltf-transform does the
part that needs glTF-native compression. Neither does the other's job.

Measured on the first six assets: **7.79 MB → 1.31 MB (−83 %)** with the triangle
count untouched, because the whole saving is in textures — they arrived as
uncompressed 1024² maps. Draw calls fell too (the desk went from 9 to 1).

## Adding a model

1. Add a `polyhaven-slug: local-name` pair to `SOURCES` in `scripts/assets/fetch.mjs`.
2. Map the local name to one or more catalogue ids in `src/assets/modelRegistry.ts`.
3. Run the two commands above.

Several ids may share one file — each instance is fitted to its own footprint at
runtime, so the three plant ids need one asset between them, not three.

For anything **mounted rather than standing**, set `anchor` in the registry
(`'ceiling'` for a pendant, `'wall'` for a mirror). The pipeline seats every
asset on the floor, which is right for furniture and wrong for those.

## Rules

- **Licence:** only commit models you may redistribute — your own files or CC0
  (e.g. Poly Haven). Do **not** commit branded/3rd-party models without a
  redistribution licence.
- **Budget:** the GLTF loader and the Draco decoder are only bundled once at
  least one model is registered; each model itself is lazy-loaded per id.
- A missing or broken file falls back to the procedural mesh automatically.

## A caveat on coverage

The catalogue has 97 furniture types and 172 devices; 21 ids are covered here.
That is not a matter of running the pipeline more times. Poly Haven's furniture
library — the only CC0 source used — leans heavily antique, rustic and
industrial: carved sofas, gothic chairs, distressed cabinets, CRT televisions.
Roughly two thirds of the obvious name matches were rejected because they would
look *worse* in a modern smart-home plan than the procedural mesh they replaced.

Covering the rest of the catalogue at this quality needs a licensed modern
interior asset library, not more scripting.

## Bundled assets (all CC0 — Poly Haven, polyhaven.com)

| File | Source asset | Used by |
|---|---|---|
| `armchair` | modern_arm_chair_01 | armchair |
| `lounge-chair` | mid_century_lounge_chair | lounge-chair |
| `chair-dining` | dining_chair_02 | chair-dining |
| `barstool` | metal_stool_01 | barstool |
| `table-coffee` | modern_coffee_table_01 | table-coffee |
| `table-side` | side_table_01 | table-side |
| `outdoor-table` | outdoor_table_chair_set_01 | outdoor-table |
| `desk` | metal_office_desk | desk-office, desk-160, desk-180 |
| `nightstand` | painted_wooden_nightstand | nightstand |
| `bookshelf` | steel_frame_shelves_01 | bookshelf |
| `shelf-wide` | drawer_cabinet | bookshelf-wide |
| `sideboard` | modern_wooden_cabinet | tv-sideboard, tv-stand |
| `pendant-lamp` | modern_ceiling_lamp_01 | pendant-lamp |
| `plant` | potted_plant_04 | plant, plant-tall |
| `plant-large` | potted_plant_02 | plant-large |
| `vase-floor` | ceramic_vase_01 | vase-floor |
| `mirror` | ornate_mirror_01 | mirror |
