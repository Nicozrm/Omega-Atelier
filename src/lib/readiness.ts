/**
 * Mode-readiness scoring.
 *
 * Given a mode's required device categories and the devices currently placed
 * on a plan, compute how well the plan covers that mode. Two independent
 * signals are combined and the stronger one wins:
 *
 *  1. **Category coverage** — does *any* placed device of the required
 *     category exist? (broad, structural)
 *  2. **Mode-tag coverage** — do placed devices that *explicitly declare*
 *     support for this mode (`DeviceCatalogEntry.modeTags`) cover the
 *     required categories? (precise, intent-aware)
 *
 * This logic previously lived inside `ModesPanel`. It is extracted here so it
 * is pure, reusable and unit-testable, with the device catalogue injected as a
 * lookup function rather than a hard import (keeps the module dependency-free
 * and trivial to test).
 */

import type { DeviceCategory, ModeKey, PlacedDevice } from '@/types'

/** Minimal catalogue shape needed for scoring. */
export interface DeviceLookupEntry {
  category: DeviceCategory
  modeTags?: ModeKey[]
}

/** Resolve a placed device's catalogue entry, or `undefined` if unknown. */
export type DeviceLookup = (deviceId: string) => DeviceLookupEntry | undefined

export interface ReadinessResult {
  /** 0–100, rounded. 100 when nothing is required. */
  score: number
  /** Required categories not yet covered. */
  missing: DeviceCategory[]
}

export interface ModeReadiness extends ReadinessResult {
  /** The mode-tag score drove the displayed result (≥ category score). */
  byModeTags: boolean
  /** Mode-tag score strictly exceeded the category score (drives the dot). */
  tagsDominant: boolean
}

/** Mode shape consumed by the scorer (subset of `OmegaMode`). */
export interface ScorableMode {
  key: ModeKey
  requiredCategories: DeviceCategory[]
}

const full: ReadinessResult = { score: 100, missing: [] }

function score(required: DeviceCategory[], covered: Set<DeviceCategory>): ReadinessResult {
  if (required.length === 0) return { ...full }
  const missing = required.filter((c) => !covered.has(c))
  const hit = required.length - missing.length
  return { score: Math.round((hit / required.length) * 100), missing }
}

/** Category coverage: required categories present among placed devices. */
export function readinessByCategory(
  required: DeviceCategory[],
  presentCategories: Set<DeviceCategory>,
): ReadinessResult {
  return score(required, presentCategories)
}

/** Mode-tag coverage: required categories covered by devices that explicitly
 *  declare support for `modeKey`. */
export function readinessByModeTags(
  modeKey: ModeKey,
  required: DeviceCategory[],
  placed: PlacedDevice[],
  lookup: DeviceLookup,
): ReadinessResult {
  if (required.length === 0) return { ...full }
  const covered = new Set<DeviceCategory>()
  for (const dev of placed) {
    const entry = lookup(dev.deviceId)
    if (entry?.modeTags?.includes(modeKey)) covered.add(entry.category)
  }
  return score(required, covered)
}

/** Combined readiness for a single mode — the higher of the two signals. */
export function modeReadiness(
  mode: ScorableMode,
  placed: PlacedDevice[],
  lookup: DeviceLookup,
): ModeReadiness {
  const present = new Set<DeviceCategory>()
  for (const dev of placed) {
    const entry = lookup(dev.deviceId)
    if (entry) present.add(entry.category)
  }

  const cat = readinessByCategory(mode.requiredCategories, present)
  const tags = readinessByModeTags(mode.key, mode.requiredCategories, placed, lookup)

  const byModeTags = tags.score >= cat.score
  const winner = byModeTags ? tags : cat
  return {
    ...winner,
    byModeTags,
    tagsDominant: tags.score > cat.score,
  }
}
