import type { PlanDocument, DeviceCatalogEntry, DeviceCategory } from '@/types'

/**
 * energy.ts — the renderer-neutral **energy-estimate domain**.
 *
 * Turns a plan's placed devices into a running-cost picture: connected load,
 * an always-on standby baseline, monthly/yearly kWh, € and CO₂. Pure — it takes
 * the catalog via an injected `entryOf` lookup (no data import), so it is unit
 * testable with fixtures and reused by every surface that wants the numbers.
 *
 * The model is deliberately a *planning estimate*, not a meter: each device's
 * nameplate `power` (W) is multiplied by a typical daily on-time for its
 * category. Sensors, hubs, cameras and locks run around the clock; lights and
 * media run a handful of hours; blinds and switches barely sip. Callers can
 * override the price, the CO₂ factor and the per-category hours.
 */

export interface EnergyOptions {
  /** Resolve a placed device's catalog entry (power + category live there). */
  entryOf: (deviceId: string) => DeviceCatalogEntry | undefined
  /** Electricity price, €/kWh. Default 0.35 (German household average). */
  pricePerKwh?: number
  /** Grid CO₂ intensity, kg per kWh. Default 0.38 (German mix). */
  co2PerKwh?: number
  /** Override the per-category daily on-hours model. */
  dutyHours?: Partial<Record<DeviceCategory, number>>
}

/** Typical *active* hours per day by device category — a planning estimate. */
export const DEFAULT_DUTY_HOURS: Record<DeviceCategory, number> = {
  light: 5, switch: 0.1, sensor: 24, climate: 10, camera: 24, lock: 24,
  speaker: 3, tv: 4, blind: 0.2, outlet: 6, hub: 24, appliance: 1.5,
  alarm: 24, irrigation: 0.5, other: 2,
}

/** Categories that draw power around the clock (standby baseline). */
const ALWAYS_ON: ReadonlySet<DeviceCategory> = new Set(['hub', 'sensor', 'camera', 'lock', 'alarm'])

const DAYS_PER_MONTH = 30.44
const DAYS_PER_YEAR = 365

export interface EnergyLine {
  category: DeviceCategory
  label: string
  count: number
  /** Summed nameplate watts of this category. */
  watts: number
  kwhPerMonth: number
  costPerMonth: number
}

export interface EnergyReport {
  deviceCount: number
  /** Devices that carry a power rating (the ones that count toward load). */
  poweredCount: number
  /** Nameplate sum if everything ran at once (W). */
  connectedWatts: number
  /** Always-on baseline (hubs/sensors/cameras/locks/alarms), W. */
  standbyWatts: number
  kwhPerDay: number
  kwhPerMonth: number
  kwhPerYear: number
  costPerMonth: number
  costPerYear: number
  co2PerYearKg: number
  pricePerKwh: number
  byCategory: EnergyLine[]
}

const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  light: 'Beleuchtung', switch: 'Schalter', sensor: 'Sensoren', climate: 'Klima/Heizung',
  camera: 'Kameras', lock: 'Schlösser', speaker: 'Lautsprecher', tv: 'TV/Media',
  blind: 'Beschattung', outlet: 'Steckdosen', hub: 'Hubs/Bridges', appliance: 'Geräte',
  alarm: 'Alarm', irrigation: 'Bewässerung', other: 'Sonstiges',
}

/** Estimate a plan's energy consumption and running cost. */
export function estimateEnergy(doc: PlanDocument, opts: EnergyOptions): EnergyReport {
  const price = opts.pricePerKwh ?? 0.35
  const co2 = opts.co2PerKwh ?? 0.38
  const duty = { ...DEFAULT_DUTY_HOURS, ...opts.dutyHours }

  const agg = new Map<DeviceCategory, { count: number; watts: number; kwhPerDay: number }>()
  let deviceCount = 0, poweredCount = 0, connectedWatts = 0, standbyWatts = 0, kwhPerDay = 0

  for (const floor of doc.floors) {
    for (const placed of floor.devices) {
      deviceCount++
      const entry = opts.entryOf(placed.deviceId)
      if (!entry) continue
      const cat = entry.category
      const watts = entry.power ?? 0
      const hours = duty[cat] ?? 0
      const dayKwh = (watts * hours) / 1000
      if (watts > 0) { poweredCount++; connectedWatts += watts }
      if (watts > 0 && ALWAYS_ON.has(cat)) standbyWatts += watts
      kwhPerDay += dayKwh
      const a = agg.get(cat) ?? { count: 0, watts: 0, kwhPerDay: 0 }
      a.count++; a.watts += watts; a.kwhPerDay += dayKwh
      agg.set(cat, a)
    }
  }

  const kwhPerMonth = kwhPerDay * DAYS_PER_MONTH
  const kwhPerYear = kwhPerDay * DAYS_PER_YEAR

  const byCategory: EnergyLine[] = [...agg.entries()]
    .map(([category, a]) => ({
      category,
      label: CATEGORY_LABEL[category],
      count: a.count,
      watts: a.watts,
      kwhPerMonth: a.kwhPerDay * DAYS_PER_MONTH,
      costPerMonth: a.kwhPerDay * DAYS_PER_MONTH * price,
    }))
    .sort((x, y) => y.kwhPerMonth - x.kwhPerMonth)

  return {
    deviceCount,
    poweredCount,
    connectedWatts,
    standbyWatts,
    kwhPerDay,
    kwhPerMonth,
    kwhPerYear,
    costPerMonth: kwhPerMonth * price,
    costPerYear: kwhPerYear * price,
    co2PerYearKg: kwhPerYear * co2,
    pricePerKwh: price,
    byCategory,
  }
}
