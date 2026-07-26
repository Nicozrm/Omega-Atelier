/**
 * vacuumMap.ts — a believable robot LiDAR map for the simulated fleet.
 *
 * A real Tuya robot delivers its laser map as a binary blob in device
 * telemetry; the simulator stands in for the device, so it produces the same
 * thing here — an L-shaped apartment occupancy grid (walls + scanned floor)
 * with a serpentine coverage path, encoded to the *exact* Tuya-format bytes the
 * real decoder (`src/twin/robotMap.ts`) parses. That keeps the whole pipeline
 * honest: bytes in the real format → the same `decodeTuyaMap` → render.
 */

import {
  encodeTuyaMap, CELL_UNKNOWN, CELL_WALL, CELL_FLOOR,
  type RobotMap, type RobotMapPoint,
} from '@/twin/robotMap'

/** Build the demo apartment map once and cache its encoded blob. */
let _blob: string | undefined

export function demoVacuumMapBlob(): string {
  if (_blob) return _blob
  _blob = encodeTuyaMap(buildDemoMap())
  return _blob
}

function buildDemoMap(): RobotMap {
  const w = 120, h = 84 // pixels
  const res = 5 // cm/px → 6.0 m × 4.2 m
  const cells = new Uint8Array(w * h).fill(CELL_UNKNOWN)

  // An L-shaped floor: main room + a smaller wing cut from the bottom-right.
  const inMain = (x: number, y: number) => x >= 4 && x < w - 4 && y >= 4 && y < h - 4
  const inNotch = (x: number, y: number) => x >= w - 40 && y >= h - 34
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inMain(x, y) && !inNotch(x, y)) cells[y * w + x] = CELL_FLOOR
    }
  }
  // Wall ring: any floor cell touching non-floor becomes a wall (scanned edge).
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === CELL_FLOOR
  const wallSet: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isFloor(x, y)) continue
      if (!isFloor(x - 1, y) || !isFloor(x + 1, y) || !isFloor(x, y - 1) || !isFloor(x, y + 1)) wallSet.push(y * w + x)
    }
  }
  for (const i of wallSet) cells[i] = CELL_WALL

  const origin: RobotMapPoint = { x: -300, y: -210 } // centre the map on ~(0,0)
  const cm = (px: number, py: number): RobotMapPoint => ({ x: origin.x + px * res, y: origin.y + py * res })

  // Serpentine coverage path through the floor lanes.
  const path: RobotMapPoint[] = []
  let dir = 1
  for (let y = 8; y < h - 8; y += 4) {
    const xs: number[] = []
    for (let x = 6; x < w - 6; x++) if (cells[y * w + x] === CELL_FLOOR) xs.push(x)
    if (xs.length < 2) continue
    const a = xs[0], b = xs[xs.length - 1]
    if (dir > 0) { path.push(cm(a, y), cm(b, y)) } else { path.push(cm(b, y), cm(a, y)) }
    dir = -dir
  }

  const charger: RobotMapPoint = cm(10, 10)
  return { width: w, height: h, resolutionCm: res, origin, charger, cells, path }
}
