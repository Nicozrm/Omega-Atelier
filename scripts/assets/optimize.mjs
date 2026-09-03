/**
 * optimize.mjs — turn a source glTF/GLB into something a browser can actually
 * afford to load, without visibly degrading it.
 *
 * ## Why this exists
 *
 * Photoreal assets are not the hard part; *shipping* them is. The six models
 * this project started with weighed 7.8 MB, of which 6.3 MB was texture data —
 * six 1024² maps per model, stored uncompressed. That is fine for six models
 * and impossible for the ~100 the furniture catalogue needs: a naive scale-up
 * lands around 130 MB, and every one of those textures also expands to full
 * RGBA in VRAM.
 *
 * So every asset goes through here before it reaches `public/models/`.
 *
 * ## What it does, and why in this order
 *
 *  1. `dedup`    — source assets routinely carry the same mesh or texture
 *                  several times over. Removing duplicates first means every
 *                  later (expensive) step runs once per unique resource.
 *  2. `flatten`  — bakes the node hierarchy's transforms down, which is what
 *                  makes `join` legal.
 *  3. `join`     — merges meshes that share a material. This is the draw-call
 *                  win: a chair modelled as 40 separate parts becomes 2-3.
 *  4. `weld`     — merges vertices that are identical within a tolerance, so
 *                  the index buffer does real work.
 *  5. `simplify` — only when a triangle budget is given. Off by default:
 *                  silhouette damage is far more visible than a few thousand
 *                  triangles cost.
 *  6. `prune`    — drops whatever the previous steps orphaned.
 *  7. textures   — resize to a budget, then WebP. This is the big one.
 *  8. `draco`    — geometry compression, last, because it makes the mesh data
 *                  opaque to every step above.
 *
 * ## Format choices
 *
 * **WebP**, not KTX2. KTX2/Basis would be the better answer — it stays
 * compressed in VRAM, which matters more than file size once a scene holds
 * dozens of models — but it needs the KTX-Software encoder, which is not
 * obtainable in this environment. WebP is a real win on transfer size and is
 * supported natively by three's GLTFLoader (`EXT_texture_webp`). If a KTX2
 * encoder ever becomes available, this is the one step to swap.
 *
 * **Draco**, not meshopt: three ships a Draco decoder we can self-host, which
 * keeps the offline-first guarantee (see `public/draco/`).
 *
 * ## Usage
 *
 *   node scripts/assets/optimize.mjs <in.glb…> --out public/models
 *   node scripts/assets/optimize.mjs in.glb --out dist --max-texture 512
 *   node scripts/assets/optimize.mjs in.glb --out dist --triangle-budget 8000
 *
 * Prints a before/after table; a step that would fail is reported and skipped
 * rather than taking the whole batch down.
 */

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions'
import {
  dedup, flatten, join, weld, prune, simplify, textureCompress,
} from '@gltf-transform/functions'
import { inspect } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join as joinPath, resolve } from 'node:path'

/** Largest texture edge we ship. 1024 is already generous for furniture that is
 *  rarely more than a few hundred pixels tall on screen. */
const DEFAULT_MAX_TEXTURE = 1024

function parseArgs(argv) {
  const files = []
  const opts = { out: 'public/models', maxTexture: DEFAULT_MAX_TEXTURE, triangleBudget: 0, quality: 80 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--max-texture') opts.maxTexture = Number(argv[++i])
    else if (a === '--triangle-budget') opts.triangleBudget = Number(argv[++i])
    else if (a === '--quality') opts.quality = Number(argv[++i])
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`)
    else files.push(a)
  }
  if (files.length === 0) throw new Error('No input files. Usage: optimize.mjs <in.glb…> --out <dir>')
  return { files, opts }
}

function stats(document, bytes) {
  const report = inspect(document)
  return {
    bytes,
    triangles: report.meshes.properties.reduce((sum, m) => sum + (m.glPrimitives || 0), 0),
    drawCalls: report.meshes.properties.reduce((sum, m) => sum + (m.meshPrimitives || 0), 0),
    textureBytes: report.textures.properties.reduce((sum, t) => sum + (t.size || 0), 0),
  }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2))
  mkdirSync(opts.out, { recursive: true })

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })

  await MeshoptSimplifier.ready
  const manifest = []

  for (const file of files) {
    const name = basename(file)
    const document = await io.read(file)
    const before = stats(document, statSync(file).size)

    const steps = [
      dedup(),
      flatten(),
      join(),
      weld(),
      ...(opts.triangleBudget > 0
        ? [simplify({ simplifier: MeshoptSimplifier, ratio: 0.0, error: 0.001 })]
        : []),
      prune({ keepAttributes: false, keepLeaves: false }),
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [opts.maxTexture, opts.maxTexture],
        quality: opts.quality,
      }),
    ]

    try {
      await document.transform(...steps)
    } catch (error) {
      console.error(`  ! ${name}: transform failed — ${error.message}`)
      continue
    }

    // Draco last: it replaces the mesh data with an opaque compressed buffer.
    document.createExtension(KHRDracoMeshCompression)
      .setRequired(true)
      .setEncoderOptions({
        method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
        encodeSpeed: 5,
        decodeSpeed: 5,
      })

    const outPath = joinPath(opts.out, name)
    const glb = await io.writeBinary(document)
    writeFileSync(outPath, glb)

    const after = stats(document, statSync(outPath).size)
    const saved = (1 - after.bytes / before.bytes) * 100
    console.log(
      name.padEnd(22),
      `${mb(before.bytes)} → ${mb(after.bytes)}`.padEnd(24),
      `(-${saved.toFixed(0)}%)`.padEnd(8),
      `tex ${mb(before.textureBytes)} → ${mb(after.textureBytes)}`.padEnd(26),
      `draws ${before.drawCalls} → ${after.drawCalls}`,
    )
    manifest.push({ file: name, ...after, savedPercent: Number(saved.toFixed(1)) })
  }

  const totalBefore = manifest.length
  if (totalBefore > 0) {
    const bytes = manifest.reduce((s, m) => s + m.bytes, 0)
    const tris = manifest.reduce((s, m) => s + m.triangles, 0)
    console.log('-'.repeat(100))
    console.log(`${manifest.length} assets · ${mb(bytes)} · ${tris.toLocaleString()} triangles`)
    writeFileSync(
      resolve(opts.out, 'manifest.json'),
      `${JSON.stringify({ generated: new Date().toISOString(), assets: manifest }, null, 2)}\n`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
