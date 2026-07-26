/**
 * floorStack.ts — the geometry of the **exploded multi-storey view**.
 *
 * Pure, renderer-neutral: given a building's floors and which one is active, it
 * decides where each storey sits on the vertical axis so the whole house can be
 * read at a glance — the active floor anchored at 0, the others floated above
 * and sunk below by their storey gap. No THREE, no React; the 3D view consumes
 * the result, and it is trivially testable on its own.
 */

export interface StackLevel {
  id: string
  index: number
  /** Vertical offset in world metres — 0 for the active floor. */
  yOffset: number
  active: boolean
}

export interface FloorRef {
  id: string
  /** Storey number: 0 = ground, positive up, negative below grade. */
  index: number
}

/**
 * Lay the floors out along the vertical axis for an exploded view.
 *
 * The active floor is the anchor (offset 0); every other storey is displaced by
 * `gap` metres per index step, so basements drop below and upper floors rise
 * above in storey order. Result is sorted bottom-to-top and always contains
 * exactly one active level (falling back to index 0 as the anchor if the id
 * isn't found).
 */
export function computeFloorStack(floors: ReadonlyArray<FloorRef>, activeFloorId: string, gap: number): StackLevel[] {
  const anchor = floors.find((f) => f.id === activeFloorId)
  const anchorIndex = anchor ? anchor.index : 0
  return [...floors]
    .sort((a, b) => a.index - b.index)
    .map((f) => ({
      id: f.id,
      index: f.index,
      yOffset: (f.index - anchorIndex) * gap,
      active: f.id === activeFloorId,
    }))
}

/** Total vertical span (metres) the stack occupies — for framing the camera. */
export function stackSpan(levels: ReadonlyArray<StackLevel>): number {
  if (levels.length === 0) return 0
  const ys = levels.map((l) => l.yOffset)
  return Math.max(...ys) - Math.min(...ys)
}
