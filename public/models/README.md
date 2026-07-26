# Local GLB models (`public/models/`)

Drop optimised **glTF/GLB** models here to replace procedural placeholders with
real assets — one id at a time. Offline-first: files are served locally, never
from a CDN.

## How to add a model
1. Optimise the GLB for WebGL (low poly, KTX2/Draco/meshopt where possible).
2. Save it here as `<id>.glb`, e.g. `sofa-3seat.glb` or `philips-hue-go.glb`
   (the `<id>` is the furniture/device id used in the app).
3. Register it in `src/assets/modelRegistry.ts`:
   ```ts
   export const MODELS = {
     'sofa-3seat': { file: 'sofa-3seat', scale: 1, offset: [0, 0, 0], rotationY: 0 },
   }
   ```
4. That id now renders the GLB (lazy-loaded); everything else stays procedural.
   A missing/broken file falls back to the procedural mesh automatically.

## Rules
- **Licence:** only commit models you may redistribute — your own files or CC0
  (e.g. Poly Haven). Do **not** commit branded/3rd-party models without a
  redistribution licence.
- **Scale:** model units are treated as metres; use `scale`/`offset` to fit.
- **Budget:** keep each asset small; watch bundle size and load time. The GLTF
  loader is only bundled once at least one model is registered.

## Bundled assets (all CC0 — Poly Haven, polyhaven.com)
| File | Source asset | Licence |
|---|---|---|
| `plant.glb` | potted_plant_04 | CC0 |
| `armchair.glb` | modern_arm_chair_01 | CC0 |
| `table-coffee.glb` | modern_coffee_table_01 | CC0 |
| `chair-dining.glb` | dining_chair_02 | CC0 |
| `nightstand.glb` | side_table_01 | CC0 |
| `vase-floor.glb` | ceramic_vase_04 | CC0 |

1k textures, packed to single GLBs via gltf-pipeline.

## Bundled PBR textures (`public/textures/`, all CC0 — Poly Haven)
| Files | Source asset | Licence |
|---|---|---|
| `floor/parquet_{diff,nor,rough}.jpg` | rectangular_parquet (1k) | CC0 |
| `wall/plaster_{diff,nor,rough}.jpg` | painted_plaster_wall (1k) | CC0 |
| `rug/carpet_{diff,nor,rough}.jpg` | ambientCG Carpet015 (1k, desaturiert) | CC0 |
| `fabric/linen_{diff,nor}.jpg` | ambientCG Fabric030 (1k, weiß normalisiert) | CC0 |
| `stone/marble_{diff,nor,rough}.jpg` | Poly Haven marble_01 (1k) | CC0 |
| `leather/leather_{diff,nor,rough}.jpg` | Poly Haven fabric_leather_02 (1k) | CC0 |
| `wood/oak_{diff,nor,rough}.jpg` | Poly Haven oak_veneer_01 (1k) | CC0 |
| `wood/walnut_{diff,nor,rough}.jpg` | Poly Haven rosewood_veneer1 (1k) | CC0 |
| `floor/laminate_{diff,nor,rough}.jpg` | Poly Haven laminate_floor_02 (1k) | CC0 |
| `floor/slate_{diff,nor,rough}.jpg` | Poly Haven slate_driveway (1k) | CC0 |
| `wall/concrete_{diff,nor,rough}.jpg` | Poly Haven concrete_wall_004 (1k) | CC0 |
