/**
 * Image Blaster 3D — point-cloud generation & PLY writing.
 *
 * The 'points' geometry mode renders the depth field as a colored point
 * cloud (scan / gaussian-splatting look). Both the builder and the binary
 * PLY writer are pure and three.js-free, mirroring the mesh module.
 *
 * Coordinate convention matches `mesh.ts`: XY plane facing +Z, longer image
 * edge spans 1 world unit, +Y is image-up.
 */

import { sampleField } from './depth'
import type { MeshSettings, PixelGrid, ScalarField } from './types'

export interface PointCloudData {
  /** xyz triplets. */
  positions: Float32Array
  /** rgb triplets in [0,1]. */
  colors: Float32Array
  count: number
}

/**
 * Sample the depth field on a regular grid and color each point from the
 * image. Fully transparent pixels (alpha < 128) are dropped so cutout
 * sources produce a clean silhouette cloud.
 */
export function buildPointCloud(
  depth: ScalarField,
  img: PixelGrid,
  settings: MeshSettings,
): PointCloudData {
  const longer = Math.max(img.width, img.height) || 1
  const w = img.width / longer
  const h = img.height / longer
  const longSegs = Math.max(16, Math.min(320, Math.round(settings.resolution * 1.25)))
  const nx = Math.max(4, Math.round(longSegs * w))
  const ny = Math.max(4, Math.round(longSegs * h))

  const positions: number[] = []
  const colors: number[] = []
  for (let gy = 0; gy < ny; gy++) {
    const v = ny > 1 ? gy / (ny - 1) : 0
    for (let gx = 0; gx < nx; gx++) {
      const u = nx > 1 ? gx / (nx - 1) : 0
      const px = Math.min(img.width - 1, Math.round(u * (img.width - 1)))
      const py = Math.min(img.height - 1, Math.round(v * (img.height - 1)))
      const o = (py * img.width + px) * 4
      if (img.data[o + 3] < 128) continue
      positions.push(
        (u - 0.5) * w,
        (0.5 - v) * h,
        sampleField(depth, u, v) * settings.depthScale,
      )
      colors.push(img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255)
    }
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  }
}

/**
 * Serialize a point cloud as binary-little-endian PLY 1.0
 * (x/y/z float32 + red/green/blue uchar) — the interchange format every
 * scan tool (CloudCompare, MeshLab, Blender) reads.
 */
export function pointCloudToPLY(cloud: PointCloudData): ArrayBuffer {
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    'comment OMEGA Atelier — Image Blaster 3D\n' +
    `element vertex ${cloud.count}\n` +
    'property float x\n' +
    'property float y\n' +
    'property float z\n' +
    'property uchar red\n' +
    'property uchar green\n' +
    'property uchar blue\n' +
    'end_header\n'
  const headerBytes = new TextEncoder().encode(header)
  const stride = 3 * 4 + 3 // 3 float32 + 3 uchar
  const buffer = new ArrayBuffer(headerBytes.length + cloud.count * stride)
  new Uint8Array(buffer).set(headerBytes, 0)
  const view = new DataView(buffer, headerBytes.length)
  for (let i = 0; i < cloud.count; i++) {
    const off = i * stride
    view.setFloat32(off, cloud.positions[i * 3], true)
    view.setFloat32(off + 4, cloud.positions[i * 3 + 1], true)
    view.setFloat32(off + 8, cloud.positions[i * 3 + 2], true)
    view.setUint8(off + 12, Math.round(cloud.colors[i * 3] * 255))
    view.setUint8(off + 13, Math.round(cloud.colors[i * 3 + 1] * 255))
    view.setUint8(off + 14, Math.round(cloud.colors[i * 3 + 2] * 255))
  }
  return buffer
}
