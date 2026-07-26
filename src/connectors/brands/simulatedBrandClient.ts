/**
 * simulatedBrandClient.ts — in-memory brand backends.
 *
 * One simulator, five seeded fleets that mirror the REAL hardware in the demo
 * flat (Govee strips/lamps, SwitchBot Bot/Hub/Meter, Smart-Life plugs, Echo
 * speakers, the Lockin G30). Commands mutate state; a slow drift tick keeps
 * sensors alive. The same `createBrandConnector` given a real client talks to
 * the actual cloud — this simulator makes every brand demoable offline.
 */

import type { Capability, Device, DeviceCommand, DeviceUpdate, Unsubscribe } from '@/domain'
import type { BrandClient } from './brandConnector'

type Seed = Omit<Device, 'connectorId' | 'health'> & { health?: Device['health'] }

const on = (v = true): Capability => ({ kind: 'OnOff', access: 'readWrite', on: v })
const bri = (percent: number): Capability => ({ kind: 'Brightness', access: 'readWrite', percent })
const col = (hex: string): Capability => ({ kind: 'Color', access: 'readWrite', hex })
const ct = (kelvin: number): Capability => ({ kind: 'ColorTemperature', access: 'readWrite', kelvin, minKelvin: 2000, maxKelvin: 6500 })
const temp = (celsius: number): Capability => ({ kind: 'Temperature', access: 'read', celsius })
const hum = (percent: number): Capability => ({ kind: 'Humidity', access: 'read', percent })
const energy = (watts: number): Capability => ({ kind: 'Energy', access: 'read', watts })
const lock = (locked = true): Capability => ({ kind: 'Lock', access: 'readWrite', locked })

export const BRAND_FLEETS: Record<'govee' | 'switchbot' | 'tuya' | 'alexa' | 'lockin', Seed[]> = {
  govee: [
    { id: 'govee.strip.sofa', name: 'RGBIC Strip Pro · Sofa', category: 'light', capabilities: [on(), bri(62), col('#ff8a3a')], metadata: { model: 'H619A' } },
    { id: 'govee.strip.bad', name: 'RGBIC Strip · Bad-Spiegel', category: 'light', capabilities: [on(), bri(45), col('#5a4bff')], metadata: { model: 'H6172' } },
    { id: 'govee.lamp.flur', name: 'Tischlampe · Schuhbank', category: 'light', capabilities: [on(), bri(40), col('#ff4a2a'), ct(2700)], metadata: { model: 'H6058' } },
    { id: 'govee.string.moos', name: 'String Lights · Mooswand', category: 'light', capabilities: [on(), bri(45), col('#ffcf82')], metadata: { model: 'H70C1' } },
  ],
  switchbot: [
    { id: 'switchbot.bot.tuer', name: 'Bot · Türöffner', category: 'other', capabilities: [on(false)], battery: { percent: 88 }, metadata: { model: 'Bot S1' } },
    { id: 'switchbot.hub.wohnen', name: 'Hub 2 · Wohnzimmer', category: 'hub', capabilities: [temp(22.4), hum(47)], metadata: { model: 'Hub 2' } },
    { id: 'switchbot.meter.schlaf', name: 'Meter · Schlafzimmer', category: 'sensor', capabilities: [temp(20.1), hum(52)], battery: { percent: 73 }, metadata: { model: 'MeterTH' } },
  ],
  tuya: [
    { id: 'tuya.plug.aquarium', name: 'Smart-Life Steckdose · Aquarium', category: 'energy', capabilities: [on(), energy(18)], metadata: { model: 'WLAN 16A' } },
    { id: 'tuya.plug.kaffee', name: 'Smart-Life Steckdose · Kaffee', category: 'energy', capabilities: [on(false), energy(0)], metadata: { model: 'WLAN 16A' } },
  ],
  alexa: [
    { id: 'alexa.echo.kueche', name: 'Echo Dot (5. Gen) · Küche', category: 'speaker', capabilities: [on()], metadata: { model: 'Echo Dot 5' } },
    { id: 'alexa.echo.schlaf', name: 'Echo Dot (5. Gen) · Schlafzimmer', category: 'speaker', capabilities: [on()], metadata: { model: 'Echo Dot 5' } },
  ],
  lockin: [
    { id: 'lockin.g30.haustuer', name: 'Lockin G30 · Wohnungstür', category: 'lock', capabilities: [lock(true)], battery: { percent: 91 }, metadata: { model: 'G30' } },
  ],
}

export interface SimulatedBrandOptions {
  /** Autonomous drift tick in ms. 0 disables (deterministic tests). */
  liveMs?: number
}

export function createSimulatedBrandClient(
  fleet: Seed[],
  opts: SimulatedBrandOptions = {},
): BrandClient {
  const liveMs = opts.liveMs ?? 4000
  const devices = new Map<string, Device>(
    fleet.map((s) => [s.id, {
      ...s,
      connectorId: 'sim',
      capabilities: s.capabilities.map((c) => ({ ...c })),
      health: s.health ?? { reachability: 'online', lastSeen: new Date().toISOString() },
    }]),
  )
  let rotation = 0

  return {
    list: () => Promise.resolve([...devices.values()].map((d) => ({ ...d, capabilities: d.capabilities.map((c) => ({ ...c })) }))),

    control: (cmd: DeviceCommand) => {
      const d = devices.get(cmd.deviceId)
      if (!d) return Promise.reject(new Error(`Unbekanntes Gerät: ${cmd.deviceId}`))
      d.capabilities = d.capabilities.map((c) => {
        if (c.kind !== cmd.capability) return c
        switch (c.kind) {
          case 'OnOff': return { ...c, on: Boolean(cmd.payload.on) }
          case 'Brightness': return { ...c, percent: Number(cmd.payload.percent) }
          case 'Color': return { ...c, hex: String(cmd.payload.hex) }
          case 'ColorTemperature': return { ...c, kelvin: Number(cmd.payload.kelvin) }
          case 'Lock': return { ...c, locked: Boolean(cmd.payload.locked) }
          default: return c
        }
      })
      d.health.lastSeen = new Date().toISOString()
      return Promise.resolve()
    },

    subscribe: (onUpdate: (u: DeviceUpdate) => void): Unsubscribe => {
      if (!liveMs) return () => {}
      const timer = setInterval(() => {
        // Drift one sensor-ish value per tick so the twin visibly lives.
        const all = [...devices.values()]
        const d = all[rotation++ % all.length]
        d.capabilities = d.capabilities.map((c) => {
          if (c.kind === 'Temperature') return { ...c, celsius: Math.round((c.celsius + (Math.random() - 0.5) * 0.4) * 10) / 10 }
          if (c.kind === 'Humidity') return { ...c, percent: Math.min(70, Math.max(30, Math.round(c.percent + (Math.random() - 0.5) * 2))) }
          if (c.kind === 'Energy') return { ...c, watts: Math.max(0, Math.round(c.watts + (Math.random() - 0.5) * 4)) }
          return c
        })
        d.health.lastSeen = new Date().toISOString()
        onUpdate({ deviceId: d.id, capabilities: d.capabilities.map((c) => ({ ...c })), health: { ...d.health } })
      }, liveMs)
      return () => clearInterval(timer)
    },
  }
}
