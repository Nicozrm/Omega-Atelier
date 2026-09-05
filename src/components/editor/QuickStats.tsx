/**
 * QuickStats — the reference's at-a-glance list for the active plan:
 * Fläche · Räume · Geräte · Lichter · Verbrauch heute · Status.
 *
 * Aggregates across ALL floors. Area comes from the room polygons
 * (shoelace), falling back to the floor extent when a floor has no rooms.
 */

import { useMemo } from 'react'
import { usePlanStore } from '@/store/usePlanStore'
import { DEVICES } from '@/data/devices'
import type { Point } from '@/types'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

function polygonAreaCm2(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

export function QuickStats() {
  const doc = usePlanStore((s) => s.doc)

  const stats = useMemo(() => {
    if (!doc) return null
    let nDev = 0, nRooms = 0, nLights = 0, totalW = 0, areaCm2 = 0
    for (const f of doc.floors) {
      nDev += f.devices.length
      nRooms += f.rooms.length
      const roomArea = f.rooms.reduce((s, r) => s + (r.polygon.length >= 3 ? polygonAreaCm2(r.polygon) : 0), 0)
      areaCm2 += roomArea > 0 ? roomArea : f.extent.width * f.extent.height
      for (const d of f.devices) {
        const e = DEVICE_MAP[d.deviceId]
        if (!e) continue
        if (e.category === 'light') nLights++
        if (e.power) totalW += e.power
      }
    }
    const kwh = ((totalW * 15) / 1000).toFixed(1).replace('.', ',')
    return {
      rows: [
        { label: 'Fläche',           value: `${(areaCm2 / 10000).toFixed(1).replace('.', ',')} m²` },
        { label: 'Räume',            value: String(nRooms) },
        { label: 'Geräte',           value: String(nDev) },
        { label: 'Lichter',          value: String(nLights) },
        { label: 'Verbrauch heute',  value: `${kwh} kWh` },
      ],
      online: nDev,
    }
  }, [doc])

  if (!stats) return null

  /*
   * A boxed table with a rule under every row is how a spreadsheet presents
   * six numbers. Six label/value pairs need neither the box nor the rules —
   * the alignment already pairs them, and the panel around it is the box.
   */
  return (
    <dl className="stat-list">
      {stats.rows.map((r) => (
        <div key={r.label} className="stat-row">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
      <div className="stat-row">
        <dt>Status</dt>
        <dd className="text-[color:var(--color-omega-success)]">Alle online</dd>
      </div>
    </dl>
  )
}
