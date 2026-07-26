/**
 * Image Blaster 3D — multi-format export.
 *
 * Wraps the three.js example exporters behind one uniform async API.
 * Browser-only (the exporters rasterise textures through canvas), so this
 * module is imported lazily by the UI layer and never by unit tests.
 */

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import type { ExportFormat } from './formats'

export type { ExportFormat } from './formats'

export interface ExportResult {
  blob: Blob
  filename: string
}

/** Sanitise a user-facing name into a safe file stem. */
function fileStem(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 60)
  return stem || 'omega-asset'
}

/**
 * Export `object` (a Mesh, or a Points cloud for GLB) to the requested
 * format. The object is wrapped in a fresh scene so exporter-side scene
 * traversal never touches the live preview graph.
 */
export async function exportMesh(
  object: THREE.Object3D,
  format: ExportFormat,
  name: string,
): Promise<ExportResult> {
  const scene = new THREE.Scene()
  const clone = object.clone()
  clone.position.set(0, 0, 0)
  clone.rotation.set(0, 0, 0)
  scene.add(clone)
  const stem = fileStem(name)

  switch (format) {
    case 'glb': {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        new GLTFExporter().parse(
          scene,
          (result) => resolve(result as ArrayBuffer),
          (err) => reject(err),
          { binary: true },
        )
      })
      return { blob: new Blob([buffer], { type: 'model/gltf-binary' }), filename: `${stem}.glb` }
    }
    case 'obj': {
      const text = new OBJExporter().parse(scene)
      return { blob: new Blob([text], { type: 'text/plain' }), filename: `${stem}.obj` }
    }
    case 'ply': {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const result = new PLYExporter().parse(scene, (res) => resolve(res as unknown as ArrayBuffer), { binary: true })
        if (result === null) reject(new Error('PLY-Export fehlgeschlagen'))
      })
      return { blob: new Blob([buffer], { type: 'application/octet-stream' }), filename: `${stem}.ply` }
    }
    case 'stl': {
      const data = new STLExporter().parse(scene, { binary: true }) as unknown as BlobPart
      return { blob: new Blob([data], { type: 'model/stl' }), filename: `${stem}.stl` }
    }
    case 'usdz': {
      const data = await new USDZExporter().parseAsync(scene)
      return { blob: new Blob([data as unknown as BlobPart], { type: 'model/vnd.usdz+zip' }), filename: `${stem}.usdz` }
    }
  }
}
