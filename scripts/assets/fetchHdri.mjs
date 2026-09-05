/**
 * fetchHdri.mjs — download and build the captured sky maps.
 *
 * Sources are CC0 from ambientCG. Like the model pipeline, the multi-megabyte
 * originals are not committed: this script re-fetches them, and
 * `scripts/assets/hdri.py` (Blender) downsamples each to a 512×256 Radiance HDR
 * and measures where its sun is.
 *
 * The measurement is the point. An HDRI has its sun baked in at whatever
 * bearing it was shot from, while the app computes a real solar position and
 * casts shadows from it; without knowing where the captured sun is, the two
 * disagree and the scene is lit from one side and shadowed from the other.
 * The numbers land in `src/lib/render/hdriSky.ts`.
 *
 * ## Usage
 *
 *   node scripts/assets/fetchHdri.mjs            # build all four
 *   node scripts/assets/fetchHdri.mjs day night
 *
 * ## Why these four
 *
 * Chosen by eye from tonemapped previews, then kept because each is a *pure sky
 * dome* — no ground. The app draws its own terrain and neighbourhood, so a map
 * with a photographed field in it would put a second, contradictory ground
 * under the house.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const STAGING = '.hdri-build'
const OUT_DIR = 'public/hdri'

/** local name → ambientCG asset id. */
export const SKIES = {
  day: 'DaySkyHDRI067B',
  overcast: 'DaySkyHDRI068B',
  evening: 'EveningSkyHDRI046B',
  night: 'NightSkyHDRI008',
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function build(name, asset) {
  mkdirSync(STAGING, { recursive: true })
  const zip = join(STAGING, `${asset}.zip`)
  if (!existsSync(zip)) {
    await download(`https://ambientcg.com/get?file=${asset}_1K.zip`, zip)
  }
  // Unzip via Python: no archive tool is guaranteed on a build machine, and
  // Python is already a dependency of this pipeline through Blender.
  const exr = execFileSync('python3', ['-c', `
import zipfile, sys, os
z = zipfile.ZipFile(${JSON.stringify(zip)})
name = [f for f in z.namelist() if f.endswith('_HDR.exr')][0]
z.extract(name, ${JSON.stringify(STAGING)})
print(os.path.join(${JSON.stringify(STAGING)}, name))
`]).toString().trim()

  mkdirSync(OUT_DIR, { recursive: true })
  execFileSync('python3', [
    'scripts/assets/hdri.py', exr,
    '--out', join(OUT_DIR, `${name}.hdr`),
    '--report', join(STAGING, `${name}.json`),
  ], { stdio: ['ignore', 'ignore', 'inherit'] })

  return JSON.parse(readFileSync(join(STAGING, `${name}.json`), 'utf8'))
}

async function main() {
  const only = process.argv.slice(2)
  const wanted = Object.entries(SKIES).filter(([name]) => only.length === 0 || only.includes(name))
  const measured = {}
  for (const [name, asset] of wanted) {
    measured[name] = { source: asset, ...(await build(name, asset)) }
  }

  console.log('\nMeasured — copy into HDRI_SKIES in src/lib/render/hdriSky.ts:\n')
  for (const [name, m] of Object.entries(measured)) {
    console.log(`  ${name}: { file: '${name}', source: '${m.source}', ` +
      `sunAzimuth: ${m.sunAzimuth}, concentration: ${m.concentration}, ` +
      `meanLuminance: ${m.meanLuminance} },`)
  }
  rmSync(STAGING, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
