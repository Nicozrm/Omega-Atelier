/**
 * Image Blaster 3D — public pipeline surface.
 *
 * Pure stages (analysis, segmentation, depth, mesh, maps) are re-exported
 * here; the browser-only exporters live in `./exporters` and are imported
 * lazily by the UI so they never enter the test bundle.
 */

export * from './types'
export * from './formats'
export { analyseImage, luminance, saturation, luminanceField, edgeDensity, dominantColors } from './analysis'
export { estimateDepth, segmentMask, normalize, edgeAwareSmooth, sampleField, downsample } from './depth'
export { normalMapFromDepth, roughnessMapFromImage, fieldToPixels } from './normals'
export {
  buildReliefMesh,
  buildExtrudeMesh,
  buildBillboardMesh,
  extractContour,
  simplifyContour,
  triangulatePolygon,
  polygonArea,
  computeVertexNormals,
} from './mesh'
export type { Contour } from './mesh'
export { buildPointCloud, pointCloudToPLY } from './pointcloud'
export type { PointCloudData } from './pointcloud'
export { normalizeSettings } from './settingsSchema'
export { polygonCentroid, polygonArea2D, largestRoom, wallArtPlacement, floorObjectPlacement, nextWallPlacement } from './placement'
export type { Placement } from './placement'
