import type { PlanDocument, DeviceCatalogEntry, DeviceCategory, Ecosystem } from '@/types'

/**
 * costEstimate.ts — the renderer-neutral **hardware-cost domain**.
 *
 * Adds up what a planned smart home actually costs to buy: total device
 * investment, grouped by ecosystem and by category, plus an item list (one row
 * per device model with quantity × unit price). Pure — the catalog arrives via
 * an injected `entryOf` lookup, so it is unit testable and reusable. Also ships
 * a CSV serialiser for the "shopping list" export.
 */

export interface CostOptions {
  entryOf: (deviceId: string) => DeviceCatalogEntry | undefined
}

export interface CostGroup {
  key: string
  label: string
  count: number
  total: number
}

export interface CostItem {
  deviceId: string
  name: string
  brand: string
  count: number
  unit: number
  total: number
}

export interface CostReport {
  deviceCount: number
  /** Devices that carry a catalog price (the ones summed). */
  pricedCount: number
  totalEur: number
  byEcosystem: CostGroup[]
  byCategory: CostGroup[]
  items: CostItem[]
}

const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  light: 'Beleuchtung', switch: 'Schalter', sensor: 'Sensoren', climate: 'Klima/Heizung',
  camera: 'Kameras', lock: 'Schlösser', speaker: 'Lautsprecher', tv: 'TV/Media',
  blind: 'Beschattung', outlet: 'Steckdosen', hub: 'Hubs/Bridges', appliance: 'Geräte',
  alarm: 'Alarm', irrigation: 'Bewässerung', other: 'Sonstiges',
}

const ECOSYSTEM_LABEL: Partial<Record<Ecosystem, string>> = {
  'apple-home': 'Apple Home', 'google-home': 'Google Home', 'alexa': 'Amazon Alexa',
  'home-assistant': 'Home Assistant', 'matter': 'Matter', 'philips-hue': 'Philips Hue',
  'ikea-dirigera': 'IKEA Dirigera', 'aqara': 'Aqara', 'shelly': 'Shelly', 'sonos': 'Sonos',
  'eve': 'Eve', 'samsung-smartthings': 'SmartThings', 'lutron': 'Lutron', 'nuki': 'Nuki',
  'tado': 'tado°', 'bosch-sh': 'Bosch Smart Home', 'netatmo': 'Netatmo', 'fritzbox': 'FRITZ!',
  'homey': 'Homey', 'fibaro': 'Fibaro', 'loxone': 'Loxone', 'switchbot': 'SwitchBot',
  'govee': 'Govee', 'tuya': 'Tuya', 'smart-life': 'Smart Life', 'osaio': 'Osaio',
  'arenti': 'Arenti', 'lockin': 'Lockin', 'custom': 'Sonstige',
}

function labelEcosystem(e: Ecosystem): string {
  return ECOSYSTEM_LABEL[e] ?? e
}

function toGroups<T extends string>(m: Map<T, { count: number; total: number }>, label: (k: T) => string): CostGroup[] {
  return [...m.entries()]
    .map(([key, v]) => ({ key, label: label(key), count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total)
}

/** Sum a plan's device hardware cost, grouped and itemised. */
export function estimateCost(doc: PlanDocument, opts: CostOptions): CostReport {
  const byEco = new Map<Ecosystem, { count: number; total: number }>()
  const byCat = new Map<DeviceCategory, { count: number; total: number }>()
  const itemMap = new Map<string, CostItem>()
  let deviceCount = 0, pricedCount = 0, totalEur = 0

  for (const floor of doc.floors) {
    for (const placed of floor.devices) {
      deviceCount++
      const entry = opts.entryOf(placed.deviceId)
      if (!entry) continue
      const price = entry.price ?? 0
      if (price > 0) pricedCount++
      totalEur += price

      const e = byEco.get(entry.ecosystem) ?? { count: 0, total: 0 }
      e.count++; e.total += price; byEco.set(entry.ecosystem, e)

      const c = byCat.get(entry.category) ?? { count: 0, total: 0 }
      c.count++; c.total += price; byCat.set(entry.category, c)

      const it = itemMap.get(entry.id) ?? { deviceId: entry.id, name: entry.name, brand: entry.brand, count: 0, unit: price, total: 0 }
      it.count++; it.total += price; itemMap.set(entry.id, it)
    }
  }

  const items = [...itemMap.values()].sort((a, b) => b.total - a.total)

  return {
    deviceCount,
    pricedCount,
    totalEur,
    byEcosystem: toGroups(byEco, labelEcosystem),
    byCategory: toGroups(byCat, (k) => CATEGORY_LABEL[k]),
    items,
  }
}

/** Serialise the item list to CSV (a smart-home shopping list). */
export function costReportToCsv(report: CostReport): string {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  const rows = [
    ['Anzahl', 'Gerät', 'Marke', 'Einzelpreis (€)', 'Summe (€)'],
    ...report.items.map((i) => [String(i.count), esc(i.name), esc(i.brand), i.unit.toFixed(2), i.total.toFixed(2)]),
    ['', '', '', 'Gesamt', report.totalEur.toFixed(2)],
  ]
  return rows.map((r) => r.join(',')).join('\n')
}
