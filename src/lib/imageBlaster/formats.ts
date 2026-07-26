/**
 * Image Blaster 3D — export format metadata.
 *
 * Deliberately three.js-free: the studio UI imports this statically for the
 * format list, while the heavy exporter implementations (`./exporters`) stay
 * behind a dynamic import and only load on first export.
 */

export type ExportFormat = 'glb' | 'obj' | 'ply' | 'stl' | 'usdz'

export const EXPORT_FORMATS: Array<{
  format: ExportFormat
  label: string
  hint: string
  /** Whether the format can carry a point cloud (points mode). */
  supportsPoints: boolean
}> = [
  { format: 'glb', label: 'GLB', hint: 'glTF binär — Blender, Unity, Web', supportsPoints: true },
  { format: 'usdz', label: 'USDZ', hint: 'Apple AR Quick Look (iPhone/iPad)', supportsPoints: false },
  { format: 'obj', label: 'OBJ', hint: 'Universell — jedes 3D-Tool', supportsPoints: false },
  { format: 'ply', label: 'PLY', hint: 'Punktwolken & Scan-Workflows', supportsPoints: true },
  { format: 'stl', label: 'STL', hint: '3D-Druck (Geometrie ohne Textur)', supportsPoints: false },
]
