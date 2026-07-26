/**
 * Omega AI Home Composer — public domain surface.
 *
 * A modular, offline-first, deterministic pipeline that turns a tap on a
 * satellite map into a fully-editable Omega Digital Twin:
 *
 *   MapProvider → SatelliteImage → PropertyDetector → BuildingDetector
 *   → RoofDetector → VegetationDetector → TerrainDetector → ConfidenceEngine
 *   → SceneBuilder → ProjectGenerator → PlanDocument
 *
 * Every stage is a swappable module; the engine merges caller overrides over the
 * default pipeline. Nothing here depends on React, three.js or the network.
 */

export * from './types'
export * from './rng'
export * from './geo'
export * from './world'
export * from './mapProvider'
export * from './layout'
export * from './propertyDetector'
export * from './buildingDetector'
export * from './roofDetector'
export * from './terrainDetector'
export * from './vegetationDetector'
export * from './confidenceEngine'
export * from './analysisEngine'
export * from './sceneBuilder'
export * from './projectGenerator'
export * from './compose'
