/**
 * goveeClient.ts — real Govee Developer-API client (OpenAPI v1).
 *
 * Talks to https://openapi.api.govee.com with the user's API key. Browsers are
 * CORS-blocked against Govee's cloud, so the base URL is overridable with a
 * relay (see supabase/functions/vendor-relay + docs/CONNECTOR_SETUP.md); the
 * client itself is transport-honest either way. Maps Govee capability
 * instances (powerSwitch / brightness / colorRgb / colorTemperatureK) onto the
 * neutral domain capabilities.
 */

import type { Capability, Device, DeviceCommand } from '@/domain'
import type { BrandClient } from './brandConnector'

const GOVEE_BASE = 'https://openapi.api.govee.com'

interface GoveeDevice {
  device: string
  sku: string
  deviceName: string
  capabilities?: Array<{ type: string; instance: string }>
}

export interface GoveeClientOptions {
  apiKey: string
  /** Relay/base override (CORS). Default: Govee cloud directly. */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export function hexToRgbInt(hex: string): number {
  const h = hex.replace('#', '')
  return parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
}

export function goveeCapsFor(d: GoveeDevice): Capability[] {
  const inst = new Set((d.capabilities ?? []).map((c) => c.instance))
  const caps: Capability[] = []
  if (inst.has('powerSwitch') || inst.size === 0) caps.push({ kind: 'OnOff', access: 'readWrite', on: false })
  if (inst.has('brightness')) caps.push({ kind: 'Brightness', access: 'readWrite', percent: 100 })
  if (inst.has('colorRgb')) caps.push({ kind: 'Color', access: 'readWrite', hex: '#ffffff' })
  if (inst.has('colorTemperatureK')) caps.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin: 4000, minKelvin: 2000, maxKelvin: 9000 })
  return caps
}

/** Map a neutral command onto Govee's control payload (exported for tests). */
export function goveeControlBody(cmd: DeviceCommand, sku: string, device: string): Record<string, unknown> {
  const cap =
    cmd.capability === 'OnOff' ? { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: cmd.payload.on ? 1 : 0 }
    : cmd.capability === 'Brightness' ? { type: 'devices.capabilities.range', instance: 'brightness', value: Number(cmd.payload.percent) }
    : cmd.capability === 'Color' ? { type: 'devices.capabilities.color_setting', instance: 'colorRgb', value: hexToRgbInt(String(cmd.payload.hex)) }
    : cmd.capability === 'ColorTemperature' ? { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', value: Number(cmd.payload.kelvin) }
    : null
  if (!cap) throw new Error(`Govee unterstützt Capability ${cmd.capability} nicht`)
  return { requestId: crypto.randomUUID(), payload: { sku, device, capability: cap } }
}

export function createGoveeClient(opts: GoveeClientOptions): BrandClient {
  const base = (opts.baseUrl?.replace(/\/+$/, '') || GOVEE_BASE)
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)
  const headers = { 'Govee-API-Key': opts.apiKey, 'Content-Type': 'application/json' }
  // device id → sku, needed for control calls.
  const skuOf = new Map<string, string>()

  const list = async (): Promise<Device[]> => {
    const res = await doFetch(`${base}/router/api/v1/user/devices`, { headers })
    if (!res.ok) throw new Error(`Govee-API ${res.status} — API-Key/Relay prüfen`)
    const json = (await res.json()) as { data?: GoveeDevice[] }
    return (json.data ?? []).map((d) => {
      skuOf.set(d.device, d.sku)
      return {
        id: d.device,
        connectorId: 'govee',
        name: d.deviceName || d.sku,
        category: 'light' as const,
        capabilities: goveeCapsFor(d),
        metadata: { model: d.sku },
        health: { reachability: 'online' as const, lastSeen: new Date().toISOString() },
      }
    })
  }

  return {
    list,
    probe: async () => { await list() },
    control: async (cmd) => {
      const sku = skuOf.get(cmd.deviceId) ?? 'unknown'
      const res = await doFetch(`${base}/router/api/v1/device/control`, {
        method: 'POST', headers, body: JSON.stringify(goveeControlBody(cmd, sku, cmd.deviceId)),
      })
      if (!res.ok) throw new Error(`Govee-Steuerung fehlgeschlagen (${res.status})`)
    },
  }
}
