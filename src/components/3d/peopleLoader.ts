import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

let _gltf: GLTF | null = null;
let _loading: Promise<void> | null = null;

export function getPeopleGltf(): GLTF | null {
  return _gltf
}

export function loadPeopleGltf(baseUrl = import.meta.env.BASE_URL || '/'): Promise<void> {
  if (_gltf) return Promise.resolve()
  if (_loading) return _loading
  const url = `${baseUrl}models/people.glb`
  _loading = new Promise((resolve) => {
    const loader = new GLTFLoader()
    loader.load(url, (g) => {
      _gltf = g
      resolve()
    }, undefined, () => {
      // ignore errors: asset optional, fall back to procedural figures
      console.warn('People GLB not found or failed to load:', url)
      resolve()
    })
  })
  return _loading
}
