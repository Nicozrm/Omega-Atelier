/**
 * Image Blaster 3D — persistent asset library (localStorage).
 *
 * Stores the *recipe* of an asset — source image (≤512px data-URL) plus the
 * full settings snapshot — not the generated geometry: the pipeline is
 * deterministic, so reloading an entry reproduces the asset exactly while
 * staying within localStorage quotas.
 */

import type { BlasterSettings } from '@/lib/imageBlaster'

export interface LibraryEntry {
  id: string
  name: string
  /** ISO timestamp. */
  savedAt: string
  /** PNG (alpha sources) or JPEG data-URL, longer edge ≤ 512px. */
  image: string
  settings: BlasterSettings
}

const KEY = 'omega.blaster.library'
/** Hard cap — 12 × ~150 kB stays well inside the 5 MB localStorage quota. */
export const LIBRARY_MAX_ENTRIES = 12

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is LibraryEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as LibraryEntry).id === 'string' &&
        typeof (e as LibraryEntry).image === 'string' &&
        typeof (e as LibraryEntry).settings === 'object',
    )
  } catch {
    return []
  }
}

/**
 * Prepend `entry`, trimming to the max count. Returns the new list, or
 * `null` when persisting failed even after evicting the oldest entries
 * (quota exhausted).
 */
export function saveToLibrary(entry: LibraryEntry): LibraryEntry[] | null {
  let next = [entry, ...loadLibrary().filter((e) => e.id !== entry.id)].slice(0, LIBRARY_MAX_ENTRIES)
  while (next.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    } catch {
      next = next.slice(0, -1) // evict oldest and retry
    }
  }
  return null
}

export function removeFromLibrary(id: string): LibraryEntry[] {
  const next = loadLibrary().filter((e) => e.id !== id)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* keep in-memory result */ }
  return next
}
