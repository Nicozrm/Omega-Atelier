import { describe, it, expect } from 'vitest'
import {
  analyseImage,
  dominantColors,
  estimateDepth,
  segmentMask,
  downsample,
  sampleField,
  normalMapFromDepth,
  fieldToPixels,
  buildReliefMesh,
  buildExtrudeMesh,
  buildBillboardMesh,
  buildPointCloud,
  pointCloudToPLY,
  extractContour,
  simplifyContour,
  triangulatePolygon,
  polygonArea,
  DEFAULT_SETTINGS,
  type PixelGrid,
  type ScalarField,
} from './index'

/** Build a PixelGrid from a painter callback (r,g,b,a per pixel). */
function grid(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): PixelGrid {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y)
      const o = (y * width + x) * 4
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a
    }
  }
  return { data, width, height }
}

function field(width: number, height: number, fn: (x: number, y: number) => number): ScalarField {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y)
  return { data, width, height }
}

const white: [number, number, number, number] = [255, 255, 255, 255]
const black: [number, number, number, number] = [0, 0, 0, 255]
const clear: [number, number, number, number] = [0, 0, 0, 0]

describe('analysis', () => {
  it('measures mean luminance and contrast of a half-black/half-white image', () => {
    const img = grid(20, 20, (x) => (x < 10 ? black : white))
    const a = analyseImage(img)
    expect(a.luminanceMean).toBeCloseTo(0.5, 1)
    expect(a.contrast).toBeGreaterThan(0.4)
    expect(a.saturationMean).toBeCloseTo(0, 5)
    expect(a.transparentRatio).toBe(0)
    expect(a.suggestedMode).toBe('relief')
    expect(a.suggestedSegment).toBe('luminance')
  })

  it('suggests extrusion + alpha segmentation for transparent images', () => {
    const img = grid(20, 20, (x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? white : clear))
    const a = analyseImage(img)
    expect(a.transparentRatio).toBeGreaterThan(0.02)
    expect(a.suggestedMode).toBe('extrude')
    expect(a.suggestedSegment).toBe('alpha')
  })

  it('extracts the dominant color of a solid image', () => {
    const img = grid(16, 16, () => [255, 0, 0, 255])
    expect(dominantColors(img, 1)[0]).toBe('#ff0000')
  })
})

describe('depth estimation', () => {
  it('normalizes output to [0,1] and maps bright→near', () => {
    const img = grid(24, 24, (x) => (x < 12 ? black : white))
    const d = estimateDepth(img, { ...DEFAULT_SETTINGS.depth, smoothing: 0, verticalWeight: 0, saturationWeight: 0 })
    let min = Infinity
    let max = -Infinity
    for (const v of d.data) { min = Math.min(min, v); max = Math.max(max, v) }
    expect(min).toBe(0)
    expect(max).toBe(1)
    expect(d.data[12 * 24 + 2]).toBeLessThan(d.data[12 * 24 + 20]) // dark side is farther
  })

  it('invert flips near and far', () => {
    const img = grid(24, 24, (x) => (x < 12 ? black : white))
    const base = { ...DEFAULT_SETTINGS.depth, smoothing: 0, verticalWeight: 0, saturationWeight: 0 }
    const d1 = estimateDepth(img, base)
    const d2 = estimateDepth(img, { ...base, invert: true })
    expect(d2.data[10]).toBeCloseTo(1 - d1.data[10], 5)
  })

  it('settles a constant image at 0.5', () => {
    const img = grid(8, 8, () => [128, 128, 128, 255])
    const d = estimateDepth(img, { ...DEFAULT_SETTINGS.depth, smoothing: 0, verticalWeight: 0 })
    for (const v of d.data) expect(v).toBeCloseTo(0.5, 5)
  })
})

describe('segmentation', () => {
  it('reads the alpha channel', () => {
    const img = grid(10, 10, (x) => (x < 5 ? white : clear))
    const m = segmentMask(img, 'alpha', 0.5)
    expect(m.data[0]).toBe(1)
    expect(m.data[9]).toBe(0)
  })
})

describe('sampling & downsampling', () => {
  it('bilinearly interpolates between grid values', () => {
    const f = field(2, 1, (x) => x) // 0 … 1 across one row
    expect(sampleField(f, 0.5, 0)).toBeCloseTo(0.5, 5)
  })

  it('downsamples to the requested max edge', () => {
    const img = grid(64, 32, () => white)
    const small = downsample(img, 16)
    expect(Math.max(small.width, small.height)).toBe(16)
    expect(small.height).toBe(8)
    expect(small.data[0]).toBe(255)
  })
})

describe('maps', () => {
  it('emits a flat (128,128,255) normal map for constant depth', () => {
    const d = field(8, 8, () => 0.5)
    const n = normalMapFromDepth(d, 1)
    expect(n.data[0]).toBe(128)
    expect(n.data[1]).toBe(128)
    expect(n.data[2]).toBe(255)
  })

  it('renders a scalar field to grayscale pixels', () => {
    const p = fieldToPixels(field(2, 1, (x) => x))
    expect(p.data[0]).toBe(0)
    expect(p.data[4]).toBe(255)
  })
})

describe('relief mesh', () => {
  const depth = field(32, 16, (x) => x / 31)

  it('builds a valid indexed grid with in-range UVs', () => {
    const mesh = buildReliefMesh(depth, { ...DEFAULT_SETTINGS.mesh, resolution: 32, solidBack: false })
    const vertCount = mesh.positions.length / 3
    expect(mesh.normals.length).toBe(mesh.positions.length)
    expect(mesh.uvs.length / 2).toBe(vertCount)
    for (const i of mesh.indices) expect(i).toBeLessThan(vertCount)
    for (let i = 0; i < mesh.uvs.length; i++) {
      expect(mesh.uvs[i]).toBeGreaterThanOrEqual(0)
      expect(mesh.uvs[i]).toBeLessThanOrEqual(1)
    }
  })

  it('respects the depth scale on Z', () => {
    const mesh = buildReliefMesh(depth, { ...DEFAULT_SETTINGS.mesh, resolution: 32, depthScale: 0.4, solidBack: false })
    let zMax = 0
    for (let i = 2; i < mesh.positions.length; i += 3) zMax = Math.max(zMax, mesh.positions[i])
    expect(zMax).toBeCloseTo(0.4, 1)
  })

  it('solidBack doubles vertices and adds skirt + back triangles', () => {
    const open = buildReliefMesh(depth, { ...DEFAULT_SETTINGS.mesh, resolution: 24, solidBack: false })
    const solid = buildReliefMesh(depth, { ...DEFAULT_SETTINGS.mesh, resolution: 24, solidBack: true })
    expect(solid.positions.length).toBe(open.positions.length * 2)
    expect(solid.indices.length).toBeGreaterThan(open.indices.length * 2)
  })
})

describe('silhouette & extrusion', () => {
  const square = field(20, 20, (x, y) => (x >= 5 && x <= 14 && y >= 5 && y <= 14 ? 1 : 0))

  it('traces a closed contour around a filled square', () => {
    const c = extractContour(square, 0.5)
    expect(c).not.toBeNull()
    expect(Math.abs(polygonArea(c as NonNullable<typeof c>))).toBeGreaterThan(0.05)
  })

  it('returns null for an empty mask', () => {
    expect(extractContour(field(10, 10, () => 0), 0.5)).toBeNull()
  })

  it('RDP simplification reduces collinear points', () => {
    const c = extractContour(square, 0.5) as NonNullable<ReturnType<typeof extractContour>>
    const s = simplifyContour(c, 0.02)
    expect(s.length).toBeLessThan(c.length)
    expect(s.length).toBeGreaterThanOrEqual(3)
  })

  it('ear-clips a square into two triangles', () => {
    const tris = triangulatePolygon([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(tris.length).toBe(6)
  })

  it('ear-clips a concave polygon fully', () => {
    // L-shape: 6 vertices → 4 triangles
    const tris = triangulatePolygon([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])
    expect(tris.length).toBe(12)
  })

  it('extrudes the square into a welded prism', () => {
    const mesh = buildExtrudeMesh(square, { ...DEFAULT_SETTINGS.mesh, mode: 'extrude', thickness: 0.2 })
    expect(mesh).not.toBeNull()
    const m = mesh as NonNullable<typeof mesh>
    const vertCount = m.positions.length / 3
    expect(vertCount % 2).toBe(0) // front + back rings
    for (const i of m.indices) expect(i).toBeLessThan(vertCount)
    // Prism spans ±thickness/2 on Z
    let zMin = Infinity
    let zMax = -Infinity
    for (let i = 2; i < m.positions.length; i += 3) {
      zMin = Math.min(zMin, m.positions[i])
      zMax = Math.max(zMax, m.positions[i])
    }
    expect(zMax - zMin).toBeCloseTo(0.2, 5)
  })

  it('returns null when no component survives thresholding', () => {
    expect(buildExtrudeMesh(field(12, 12, () => 0.2), { ...DEFAULT_SETTINGS.mesh, mode: 'extrude' })).toBeNull()
  })
})

describe('point cloud', () => {
  const depth = field(24, 24, (x) => x / 23)

  it('samples a colored grid and respects depth scale', () => {
    const img = grid(24, 24, () => [200, 100, 50, 255])
    const cloud = buildPointCloud(depth, img, { ...DEFAULT_SETTINGS.mesh, resolution: 32, depthScale: 0.3 })
    expect(cloud.count).toBeGreaterThan(100)
    expect(cloud.positions.length).toBe(cloud.count * 3)
    expect(cloud.colors.length).toBe(cloud.count * 3)
    expect(cloud.colors[0]).toBeCloseTo(200 / 255, 2)
    let zMax = 0
    for (let i = 2; i < cloud.positions.length; i += 3) zMax = Math.max(zMax, cloud.positions[i])
    expect(zMax).toBeLessThanOrEqual(0.3 + 1e-6)
    expect(zMax).toBeGreaterThan(0.2)
  })

  it('drops fully transparent pixels', () => {
    const img = grid(24, 24, (x) => (x < 12 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    const opaque = buildPointCloud(depth, grid(24, 24, () => white), { ...DEFAULT_SETTINGS.mesh, resolution: 32 })
    const cutout = buildPointCloud(depth, img, { ...DEFAULT_SETTINGS.mesh, resolution: 32 })
    expect(cutout.count).toBeLessThan(opaque.count * 0.65)
    expect(cutout.count).toBeGreaterThan(0)
  })

  it('serializes to a valid binary PLY', () => {
    const img = grid(8, 8, () => [10, 20, 30, 255])
    const cloud = buildPointCloud(depth, img, { ...DEFAULT_SETTINGS.mesh, resolution: 24 })
    const buf = pointCloudToPLY(cloud)
    const text = new TextDecoder().decode(buf.slice(0, 300))
    expect(text.startsWith('ply\nformat binary_little_endian 1.0\n')).toBe(true)
    expect(text).toContain(`element vertex ${cloud.count}`)
    const headerChars = text.slice(0, text.indexOf('end_header\n') + 'end_header\n'.length)
    const headerBytes = new TextEncoder().encode(headerChars).length // header contains multibyte "—"
    expect(buf.byteLength).toBe(headerBytes + cloud.count * 15) // 3×f32 + 3×u8
  })
})

describe('billboard mesh', () => {
  it('is a single aspect-correct quad', () => {
    const mesh = buildBillboardMesh(200, 100)
    expect(mesh.positions.length / 3).toBe(4)
    expect(mesh.indices.length).toBe(6)
    // longer edge normalized to 1
    let xMax = 0
    for (let i = 0; i < mesh.positions.length; i += 3) xMax = Math.max(xMax, Math.abs(mesh.positions[i]))
    expect(xMax).toBeCloseTo(0.5, 5)
  })
})
