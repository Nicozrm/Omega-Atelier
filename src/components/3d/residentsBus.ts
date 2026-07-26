/**
 * Tiny framework-free signal shared between the virtual-residents controller
 * (writer) and the wall/door renderer (reader). Keyed by wall id → desired door
 * open amount in [0..1]. Kept out of React/Zustand on purpose: it is written and
 * read every animation frame, so it must not trigger renders. When no resident
 * layer is mounted the map is empty and every door reads 0 (closed).
 */
export const RESIDENT_DOORS = new Map<string, number>()

/** Clear all door targets (called when the residents layer unmounts so no door
 *  is left frozen open). */
export function clearResidentDoors(): void {
  RESIDENT_DOORS.clear()
}
