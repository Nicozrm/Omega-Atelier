/**
 * Contract test — EVERY ecosystem in the catalog must be a fully functional
 * Connector: connect/health lifecycle, discovery of a valid neutral fleet,
 * command execution with linked effects, live telemetry, clean teardown.
 */
import { describe, expect, it, vi } from 'vitest'
import { findCapability } from '@/domain'
import type { ConnectorHealth } from '@/domain'
import { ECOSYSTEM_SPECS, createEcosystemConnector } from './index'

describe('ecosystem catalog', () => {
  it('covers the full device-library ecosystem list', () => {
    expect(ECOSYSTEM_SPECS.length).toBeGreaterThanOrEqual(29)
  })

  it('spec ids, labels and colors are unique and well-formed', () => {
    const ids = ECOSYSTEM_SPECS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of ECOSYSTEM_SPECS) {
      expect(s.id).toMatch(/^eco-[a-z0-9-]+$/)
      expect(s.label.length).toBeGreaterThan(1)
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.fleet.length).toBeGreaterThan(0)
    }
  })

  it('fleet devices carry at least one capability and unique keys per spec', () => {
    for (const s of ECOSYSTEM_SPECS) {
      const keys = s.fleet.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const f of s.fleet) expect(f.caps.length).toBeGreaterThan(0)
    }
  })
})

describe.each(ECOSYSTEM_SPECS.map((s) => [s.label, s] as const))('connector contract — %s', (_label, spec) => {
  it('runs the full lifecycle: connect → discover → command → telemetry → disconnect', async () => {
    vi.useFakeTimers()
    try {
      const c = createEcosystemConnector(spec, { liveMs: 50 })
      const statuses: ConnectorHealth['status'][] = []
      c.onStatus?.((h) => statuses.push(h.status))

      expect(c.health().status).toBe('disconnected')
      const connecting = c.connect()
      await vi.runOnlyPendingTimersAsync()
      await connecting
      expect(c.health().status).toBe('connected')
      expect(statuses).toContain('connecting')

      const devices = await c.discover()
      expect(devices.length).toBe(spec.fleet.length)
      for (const d of devices) {
        expect(d.connectorId).toBe(spec.id)
        expect(d.health.reachability).toBe('online')
        expect(d.capabilities.length).toBeGreaterThan(0)
      }

      const updates: string[] = []
      c.subscribe((u) => updates.push(u.deviceId))

      // Commands act on state, with linked effects (OnOff ⇒ load follows).
      const switchable = devices.find((d) => findCapability(d.capabilities, 'OnOff'))
      if (switchable) {
        const before = findCapability(switchable.capabilities, 'OnOff')!.on
        await c.publish({ deviceId: switchable.id, capability: 'OnOff', payload: { on: !before } })
        const after = findCapability(switchable.capabilities, 'OnOff')!
        expect(after.on).toBe(!before)
        const energy = findCapability(switchable.capabilities, 'Energy')
        if (energy) expect(energy.watts === 0).toBe(!after.on)
        expect(updates).toContain(switchable.id)
      }

      // Live telemetry: the simulation loop pushes updates on its own.
      const seen = updates.length
      await vi.advanceTimersByTimeAsync(50 * spec.fleet.length * 6)
      expect(updates.length).toBeGreaterThan(seen)

      await c.disconnect()
      expect(c.health().status).toBe('disconnected')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('command semantics', () => {
  it('Brightness > 0 switches a light on; 0 switches it off', async () => {
    const spec = ECOSYSTEM_SPECS.find((s) => s.id === 'eco-philips-hue')!
    const c = createEcosystemConnector(spec, { liveMs: 60_000 })
    await c.connect()
    const [bulb] = (await c.discover()).filter((d) => findCapability(d.capabilities, 'Brightness'))
    await c.publish({ deviceId: bulb.id, capability: 'Brightness', payload: { percent: 0 } })
    expect(findCapability(bulb.capabilities, 'OnOff')!.on).toBe(false)
    await c.publish({ deviceId: bulb.id, capability: 'Brightness', payload: { percent: 55 } })
    expect(findCapability(bulb.capabilities, 'OnOff')!.on).toBe(true)
    expect(findCapability(bulb.capabilities, 'Brightness')!.percent).toBe(55)
    await c.disconnect()
  })

  it('locks toggle and unknown devices are ignored safely', async () => {
    const spec = ECOSYSTEM_SPECS.find((s) => s.id === 'eco-nuki')!
    const c = createEcosystemConnector(spec, { liveMs: 60_000 })
    await c.connect()
    const [door] = await c.discover()
    await c.publish({ deviceId: door.id, capability: 'Lock', payload: { locked: false } })
    expect(findCapability(door.capabilities, 'Lock')!.locked).toBe(false)
    await expect(c.publish({ deviceId: 'ghost', capability: 'OnOff', payload: { on: true } })).resolves.toBeUndefined()
    await c.disconnect()
  })
})
