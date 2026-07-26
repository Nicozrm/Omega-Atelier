/**
 * Image Blaster 3D — stage 4: mesh generation.
 *
 * Three strategies, all emitting raw {@link MeshData} buffers (three.js-free,
 * unit-testable):
 *
 *  - relief:    displaced height-field plaque from the depth map, optionally
 *               closed with a back plate + skirt so exports are solid.
 *  - extrude:   silhouette extraction (flood-fill largest component →
 *               Moore-neighbour boundary trace → RDP simplification →
 *               ear-clipping triangulation) extruded to a prism.
 *  - billboard: single textured quad (alpha-cutout handled by the material).
 *
 * Convention: the mesh lies in the XY plane facing +Z; the longer image edge
 * spans exactly 1 world unit; +Y is image-up.
 */

import { sampleField } from './depth'
import type { MeshData, MeshSettings, ScalarField } from './types'

/** Aspect-correct plane extents: longer edge = 1. */
function planeExtents(width: number, height: number): { w: number; h: number } {
  const longer = Math.max(width, height) || 1
  return { w: width / longer, h: height / longer }
}

/** Smooth vertex normals by area-weighted face-normal accumulation. */
export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    for (const v of [a, b, c]) {
      normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
    if (len > 1e-10) {
      normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len
    } else {
      normals[i + 2] = 1
    }
  }
  return normals
}

// ────────────────────────────────────────────────────────────────────
// Relief
// ────────────────────────────────────────────────────────────────────

export function buildReliefMesh(depth: ScalarField, settings: MeshSettings): MeshData {
  const { w, h } = planeExtents(depth.width, depth.height)
  const longSegs = Math.max(8, Math.min(256, Math.round(settings.resolution)))
  const segX = Math.max(2, Math.round(longSegs * w))
  const segY = Math.max(2, Math.round(longSegs * h))
  const cols = segX + 1
  const rows = segY + 1
  const frontCount = cols * rows

  const solid = settings.solidBack
  // Solid plaque: front grid + 4 back corners + duplicated border ring for the
  // skirt would complicate indexing; instead reuse front-border XY at z=0 by
  // appending a full back grid ring only where needed. Simplest robust layout:
  // front grid + back grid (flat, coarse would do, but reuse grid for uniform
  // UVs and clean skirt welding via shared ordering).
  const backCount = solid ? frontCount : 0
  const total = frontCount + backCount

  const positions = new Float32Array(total * 3)
  const uvs = new Float32Array(total * 2)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / segX
      const v = y / segY // image-space v: 0 = top row
      const i = y * cols + x
      const px = (u - 0.5) * w
      const py = (0.5 - v) * h
      const pz = sampleField(depth, u, v) * settings.depthScale
      positions[i * 3] = px
      positions[i * 3 + 1] = py
      positions[i * 3 + 2] = pz
      // Textures are created with flipY=false, so uv.v runs top-down like
      // image rows — this keeps in-app rendering and glTF/USDZ exports aligned.
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
      if (solid) {
        const j = frontCount + i
        positions[j * 3] = px
        positions[j * 3 + 1] = py
        positions[j * 3 + 2] = 0
        uvs[j * 2] = u
        uvs[j * 2 + 1] = v
      }
    }
  }

  const quadCount = segX * segY
  const frontTris = quadCount * 2
  const backTris = solid ? quadCount * 2 : 0
  const skirtTris = solid ? (segX * 2 + segY * 2) * 2 : 0
  const indices = new Uint32Array((frontTris + backTris + skirtTris) * 3)
  let k = 0

  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const a = y * cols + x
      const b = a + 1
      const c = a + cols
      const d = c + 1
      // front faces +Z (counter-clockwise when viewed from +Z)
      indices[k++] = a; indices[k++] = c; indices[k++] = b
      indices[k++] = b; indices[k++] = c; indices[k++] = d
      if (solid) {
        const a2 = frontCount + a
        const b2 = frontCount + b
        const c2 = frontCount + c
        const d2 = frontCount + d
        // back faces -Z → reversed winding
        indices[k++] = a2; indices[k++] = b2; indices[k++] = c2
        indices[k++] = b2; indices[k++] = d2; indices[k++] = c2
      }
    }
  }

  if (solid) {
    // Skirt: connect front border ring to back border ring.
    const edge = (f0: number, f1: number) => {
      const b0 = frontCount + f0
      const b1 = frontCount + f1
      indices[k++] = f0; indices[k++] = b0; indices[k++] = f1
      indices[k++] = f1; indices[k++] = b0; indices[k++] = b1
    }
    for (let x = 0; x < segX; x++) edge(x + 1, x) // top row (image top)
    for (let x = 0; x < segX; x++) edge(segY * cols + x, segY * cols + x + 1) // bottom row
    for (let y = 0; y < segY; y++) edge(y * cols, (y + 1) * cols) // left column
    for (let y = 0; y < segY; y++) edge((y + 1) * cols + segX, y * cols + segX) // right column
  }

  return { positions, uvs, indices, normals: computeVertexNormals(positions, indices) }
}

// ────────────────────────────────────────────────────────────────────
// Silhouette extraction
// ────────────────────────────────────────────────────────────────────

export type Contour = Array<[number, number]>

/**
 * Boundary polygon (normalized image coords, u right / v down) of the largest
 * connected mask component. Returns `null` when the mask is empty.
 */
export function extractContour(mask: ScalarField, threshold = 0.5): Contour | null {
  const { data, width, height } = mask
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] >= threshold

  // 1. Largest connected component via BFS labelling.
  const label = new Int32Array(width * height).fill(-1)
  let bestLabel = -1
  let bestSize = 0
  let nextLabel = 0
  const queue: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start] < threshold) continue
    let size = 0
    queue.length = 0
    queue.push(start)
    label[start] = nextLabel
    while (queue.length) {
      const i = queue.pop() as number
      size++
      const x = i % width
      const y = (i / width) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx2 = x + dx
        const ny2 = y + dy
        if (nx2 < 0 || ny2 < 0 || nx2 >= width || ny2 >= height) continue
        const j = ny2 * width + nx2
        if (label[j] === -1 && data[j] >= threshold) {
          label[j] = nextLabel
          queue.push(j)
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = nextLabel }
    nextLabel++
  }
  if (bestLabel === -1 || bestSize < 4) return null

  const inComp = (x: number, y: number) =>
    filled(x, y) && label[y * width + x] === bestLabel

  // 2. Find the topmost-leftmost boundary pixel of that component.
  let sx = -1
  let sy = -1
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inComp(x, y)) { sx = x; sy = y; break outer }
    }
  }

  // 3. Moore-neighbour boundary tracing (Jacob's stopping criterion).
  const dirs: Array<[number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ]
  const contour: Contour = []
  let cx = sx
  let cy = sy
  let dir = 6 // came from above
  const maxSteps = width * height * 4
  for (let step = 0; step < maxSteps; step++) {
    contour.push([cx / Math.max(1, width - 1), cy / Math.max(1, height - 1)])
    let found = false
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8 // start looking backwards-left of travel
      const nx2 = cx + dirs[d][0]
      const ny2 = cy + dirs[d][1]
      if (inComp(nx2, ny2)) {
        cx = nx2; cy = ny2; dir = d
        found = true
        break
      }
    }
    if (!found) break // isolated pixel
    if (cx === sx && cy === sy && contour.length > 2) break
  }
  return contour.length >= 3 ? contour : null
}

/** Ramer–Douglas–Peucker polyline simplification (closed polygon). */
export function simplifyContour(points: Contour, epsilon: number): Contour {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number]
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-12
    let maxDist = 0
    let maxIdx = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len
      if (d > maxDist) { maxDist = d; maxIdx = i }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1
      stack.push([a, maxIdx], [maxIdx, b])
    }
  }
  const out: Contour = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out.length >= 3 ? out : points
}

/** Signed polygon area (positive = counter-clockwise). */
export function polygonArea(points: Contour): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

/** Ear-clipping triangulation. Expects a simple polygon; returns vertex index triples. */
export function triangulatePolygon(points: Contour): number[] {
  const n = points.length
  if (n < 3) return []
  // Work on a CCW copy of the index list.
  const idx: number[] = []
  const ccw = polygonArea(points) > 0
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i)

  const cross = (a: number, b: number, c: number) => {
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const [cx, cy] = points[c]
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  }
  const inTriangle = (p: number, a: number, b: number, c: number) => {
    const d1 = cross(a, b, p)
    const d2 = cross(b, c, p)
    const d3 = cross(c, a, p)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
  }

  const triangles: number[] = []
  let guard = 0
  while (idx.length > 3 && guard < 20000) {
    guard++
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]
      const b = idx[i]
      const c = idx[(i + 1) % idx.length]
      if (cross(a, b, c) <= 1e-12) continue // reflex or degenerate
      let contains = false
      for (const p of idx) {
        if (p === a || p === b || p === c) continue
        if (inTriangle(p, a, b, c)) { contains = true; break }
      }
      if (contains) continue
      triangles.push(a, b, c)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break // degenerate leftovers — bail with what we have
  }
  if (idx.length === 3) triangles.push(idx[0], idx[1], idx[2])
  return triangles
}

// ────────────────────────────────────────────────────────────────────
// Extrusion
// ────────────────────────────────────────────────────────────────────

export function buildExtrudeMesh(mask: ScalarField, settings: MeshSettings): MeshData | null {
  const raw = extractContour(mask, 0.5)
  if (!raw) return null
  const contour = simplifyContour(raw, 1.2 / Math.max(mask.width, mask.height))
  const tris = triangulatePolygon(contour)
  if (tris.length === 0) return null

  const { w, h } = planeExtents(mask.width, mask.height)
  const half = Math.max(0.005, settings.thickness) / 2
  const n = contour.length

  // Layout: [0..n) front ring, [n..2n) back ring — caps and walls share them.
  // Sharing rings keeps the mesh welded (watertight) at silhouette edges;
  // normal smoothing rounds the rim slightly, which reads well for cutouts.
  const positions = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  for (let i = 0; i < n; i++) {
    const [u, v] = contour[i]
    const px = (u - 0.5) * w
    const py = (0.5 - v) * h
    positions[i * 3] = px
    positions[i * 3 + 1] = py
    positions[i * 3 + 2] = half
    positions[(n + i) * 3] = px
    positions[(n + i) * 3 + 1] = py
    positions[(n + i) * 3 + 2] = -half
    uvs[i * 2] = u
    uvs[i * 2 + 1] = v // flipY=false texture convention (see relief)
    uvs[(n + i) * 2] = u
    uvs[(n + i) * 2 + 1] = v
  }

  const capTris = tris.length / 3
  const indices = new Uint32Array((capTris * 2 + n * 2) * 3)
  let k = 0
  // Front cap: triangulation is CCW in (u,v) space where v points DOWN, which
  // flips to CW in world space (y up) → reverse for a +Z-facing cap.
  for (let t = 0; t < tris.length; t += 3) {
    indices[k++] = tris[t + 2]; indices[k++] = tris[t + 1]; indices[k++] = tris[t]
  }
  // Back cap: original winding faces -Z.
  for (let t = 0; t < tris.length; t += 3) {
    indices[k++] = n + tris[t]; indices[k++] = n + tris[t + 1]; indices[k++] = n + tris[t + 2]
  }
  // Side walls.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices[k++] = i; indices[k++] = n + i; indices[k++] = j
    indices[k++] = j; indices[k++] = n + i; indices[k++] = n + j
  }

  return { positions, uvs, indices, normals: computeVertexNormals(positions, indices) }
}

// ────────────────────────────────────────────────────────────────────
// Billboard
// ────────────────────────────────────────────────────────────────────

export function buildBillboardMesh(width: number, height: number): MeshData {
  const { w, h } = planeExtents(width, height)
  const positions = new Float32Array([
    -w / 2, -h / 2, 0,
    w / 2, -h / 2, 0,
    w / 2, h / 2, 0,
    -w / 2, h / 2, 0,
  ])
  // flipY=false: v=1 is the image bottom row → bottom-left vertex gets (0,1).
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
  return { positions, uvs, indices, normals: computeVertexNormals(positions, indices) }
}
