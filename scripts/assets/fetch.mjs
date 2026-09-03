/**
 * fetch.mjs — download CC0 source assets from Poly Haven.
 *
 * Sources are not committed: they are large, and they are freely
 * re-downloadable. This script is what keeps `scripts/assets/build.mjs`
 * reproducible from a fresh clone without carrying tens of megabytes of
 * originals in git history.
 *
 * Only Poly Haven (polyhaven.com) is supported, and deliberately so — every
 * asset there is CC0, so anything this script pulls can be redistributed in the
 * built app. Adding a source that is not CC0 or otherwise licensed for
 * redistribution is a licensing decision, not a scripting one.
 *
 * ## Usage
 *
 *   node scripts/assets/fetch.mjs sofa_02:sofa-3seat side_table_01:table-side
 *   node scripts/assets/fetch.mjs --all          # everything in SOURCES below
 *   node scripts/assets/fetch.mjs --all --res 2k
 *
 * `<polyhaven-slug>:<local-name>` writes `assets-src/<local-name>/`, containing
 * the glTF and its textures. `build.mjs` picks it up from there.
 *
 * 1k textures by default: the optimiser resizes to 1024 anyway, so pulling 4k
 * only means downloading data to throw away.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const API = 'https://api.polyhaven.com'
const SOURCE_DIR = 'assets-src'

/**
 * Curated `polyhaven-slug: local-name` pairs.
 *
 * Curated by eye, not by name — and then re-checked against the measured result.
 *
 * Poly Haven's furniture library leans heavily antique, rustic and industrial:
 * carved sofas, gothic chairs, distressed cabinets, CRT televisions. Most of it
 * would look worse in a modern smart-home plan than the procedural mesh it
 * replaced, so roughly two thirds of the obvious name matches were rejected.
 *
 * Three more were dropped only after building them, because the mismatch was in
 * the dimensions rather than the look: a round table came out 80 cm across in a
 * 140x80 four-seater slot, an anglepoise lamp is not the dome table lamp the
 * catalogue names, and what reads as a "drawer cabinet" is a 173 cm tall unit —
 * a shelf, not the 110x45 Kommode it was first mapped to.
 */
export const SOURCES = {
  mid_century_lounge_chair: 'lounge-chair',
  modern_wooden_cabinet: 'sideboard',
  steel_frame_shelves_01: 'bookshelf',
  drawer_cabinet: 'shelf-wide',
  metal_office_desk: 'desk',
  side_table_01: 'table-side',
  modern_ceiling_lamp_01: 'pendant-lamp',
  metal_stool_01: 'barstool',
  outdoor_table_chair_set_01: 'outdoor-table',
  ornate_mirror_01: 'mirror',
  potted_plant_02: 'plant-large',
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return Buffer.byteLength(Buffer.from([]))
}

async function fetchAsset(slug, name, resolution) {
  const target = join(SOURCE_DIR, name)
  const files = await getJson(`${API}/files/${slug}`)
  const gltf = files.gltf
  if (!gltf) throw new Error(`${slug}: no glTF variant published`)

  // Fall back to whatever resolution exists if the requested one does not.
  const res = gltf[resolution] ?? gltf[Object.keys(gltf)[0]]
  const entry = res.gltf ?? res
  if (!entry?.url) throw new Error(`${slug}: no glTF url`)

  await download(entry.url, join(target, `${name}.gltf`))
  const includes = entry.include ?? {}
  for (const [relative, file] of Object.entries(includes)) {
    await download(file.url, join(target, relative))
  }
  console.log(`  ${slug} → ${SOURCE_DIR}/${name}/ (${Object.keys(includes).length + 1} files)`)
}

async function main() {
  const argv = process.argv.slice(2)
  let resolution = '1k'
  const pairs = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--res') resolution = argv[++i]
    else if (argv[i] === '--all') pairs.push(...Object.entries(SOURCES))
    else if (argv[i].includes(':')) {
      const [slug, name] = argv[i].split(':')
      pairs.push([slug, name])
    } else throw new Error(`Expected <slug>:<name> or --all, got ${argv[i]}`)
  }
  if (pairs.length === 0) throw new Error('Nothing to fetch. Pass <slug>:<name> pairs or --all.')

  console.log(`Fetching ${pairs.length} CC0 assets from Poly Haven at ${resolution}…`)
  const failed = []
  for (const [slug, name] of pairs) {
    if (existsSync(join(SOURCE_DIR, name, `${name}.gltf`))) {
      console.log(`  ${slug} → already present, skipping`)
      continue
    }
    try {
      await fetchAsset(slug, name, resolution)
    } catch (error) {
      failed.push(`${slug}: ${error.message}`)
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} failed:\n  ${failed.join('\n  ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
