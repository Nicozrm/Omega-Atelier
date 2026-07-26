import { describe, it, expect } from 'vitest'
import { TwinManager } from './twinManager'
import { createHomeAssistantConnector, SimulatedHaTransport } from '@/connectors/homeAssistant'
import { createMqttConnector, SimulatedMqttBroker } from '@/connectors/mqtt'
import { findCapability } from '@/domain'
import { sceneCommands } from './scenes'

const flush = () => new Promise((r) => setTimeout(r, 0))

const haDescriptor = {
  label: 'Home Assistant', kind: 'home-assistant',
  make: () => createHomeAssistantConnector({ transport: new SimulatedHaTransport({ liveMs: 0 }) }),
}
const mqttDescriptor = {
  label: 'MQTT', kind: 'mqtt',
  make: () => createMqttConnector({ transport: new SimulatedMqttBroker({ liveMs: 0 }) }),
}

describe('TwinManager — one twin, multiple connectors', () => {
  it('runs HA + MQTT in a single runtime, grouped by room, with isolated routing and removal', async () => {
    const m = new TwinManager()
    await m.addConnector(haDescriptor)
    await m.addConnector(mqttDescriptor)
    await flush()

    const v = m.view()
    expect(v.sessions.length).toBe(2)
    expect(v.sessions.every((s) => s.health.status === 'connected')).toBe(true)

    // Both sources coexist in ONE device set, no id collision.
    expect(v.devices.some((d) => d.connectorId === 'home-assistant')).toBe(true)
    expect(v.devices.some((d) => d.connectorId === 'mqtt')).toBe(true)
    expect(v.devices.length).toBeGreaterThanOrEqual(14)
    const ids = v.devices.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length) // unique ids across connectors

    // Room metadata present from both connectors → apartment grouping works.
    const wohnzimmer = v.devices.filter((d) => d.metadata?.room === 'Wohnzimmer')
    expect(wohnzimmer.some((d) => d.connectorId === 'home-assistant')).toBe(true)
    expect(wohnzimmer.some((d) => d.connectorId === 'mqtt')).toBe(true)

    // Command routes to the MQTT-owned device…
    await m.command({ deviceId: 'steckdose-tv', capability: 'OnOff', payload: { on: false } })
    await flush()
    expect(findCapability(m.view().devices.find((d) => d.id === 'steckdose-tv')!.capabilities, 'OnOff')).toMatchObject({ on: false })

    // …and to the HA-owned device, independently.
    await m.command({ deviceId: 'switch.steckdose_tv', capability: 'OnOff', payload: { on: false } })
    await flush()
    expect(findCapability(m.view().devices.find((d) => d.id === 'switch.steckdose_tv')!.capabilities, 'OnOff')).toMatchObject({ on: false })

    // Removing one connector leaves the other fully intact.
    await m.removeConnector('mqtt')
    const after = m.view()
    expect(after.sessions.length).toBe(1)
    expect(after.devices.some((d) => d.connectorId === 'mqtt')).toBe(false)
    expect(after.devices.some((d) => d.connectorId === 'home-assistant')).toBe(true)
  })

  it('stores manual room overrides in the view', async () => {
    const m = new TwinManager()
    await m.addConnector(haDescriptor)
    await flush()
    m.setBinding('camera.eingang', 'r4')
    expect(m.view().bindings['camera.eingang']).toBe('r4')
    m.clearBinding('camera.eingang')
    expect(m.view().bindings['camera.eingang']).toBeUndefined()
  })

  it('applies a scene across both connectors via the runtime', async () => {
    const m = new TwinManager()
    await m.addConnector(haDescriptor)
    await m.addConnector(mqttDescriptor)
    await flush()

    const cmds = sceneCommands(m.view().devices, 'film')
    await m.applyScene('film', cmds)
    await flush()

    const after = m.view()
    expect(after.activeScene).toBe('film')
    // HA light dimmed to Film's 15 %…
    const haLight = after.devices.find((d) => d.id === 'light.wohnzimmer_decke')!
    expect(findCapability(haLight.capabilities, 'Brightness')).toMatchObject({ percent: 15 })
    // …and the MQTT cover closed to 0 — one scene, two connectors.
    const mqttCover = after.devices.find((d) => d.id === 'rollo')!
    expect(findCapability(mqttCover.capabilities, 'Position')).toMatchObject({ percent: 0 })
  })
})
