/**
 * scenes.ts — turning an OMEGA mode into live commands across connectors.
 *
 * No mode behaviour is duplicated here: the per-mode/category target states come
 * straight from `modeStateFor` (the same table the editor + 3D lighting already
 * use). This module is thin glue:
 *   1. a domain→plan category alias (the twin's `Device.category` is the smaller
 *      domain set; `modeStateFor` is keyed by the richer plan category),
 *   2. a `DeviceState`→capability-command mapping (on→OnOff, brightness→Brightness,
 *      kelvin→ColorTemperature, position→Position, locked→Lock), emitted only for
 *      capabilities the device actually has and that are writable,
 *   3. a sun-adaptive light target for the 'auto' scene, derived from the shared
 *      `EnvironmentState` (so 'auto' follows the live sun instead of a static row).
 *
 * Applying the resulting commands reuses the runtime's connectorId routing, so a
 * single scene fans out to Home Assistant and MQTT devices at once.
 */

import { findCapability, type Device, type DeviceCommand } from '@/domain'
import type { DeviceCategory as TwinCategory } from '@/domain'
import { modeStateFor, type DeviceState } from '@/lib/modeState'
import type { ModeKey, DeviceCategory as PlanCategory } from '@/types'
import type { EnvironmentState } from '@/lib/environment'

/** Alias only — carries no behaviour; maps the twin category to the plan category. */
export const TWIN_TO_PLAN: Record<TwinCategory, PlanCategory> = {
  light: 'light',
  lock: 'lock',
  sensor: 'sensor',
  climate: 'climate',
  camera: 'camera',
  cover: 'blind',
  energy: 'switch',
  appliance: 'appliance',
  speaker: 'speaker',
  hub: 'hub',
  other: 'other',
}

/** 'auto' light target from the live sun: off in daylight, warm + dim after dark. */
export function sunAdaptiveLight(env: EnvironmentState): DeviceState {
  switch (env.phase) {
    case 'day': return { on: false, brightness: 0 }
    case 'goldenHour': return { on: true, brightness: 35, kelvin: 2700 }
    case 'dawn':
    case 'dusk': return { on: true, brightness: 50, kelvin: 2600 }
    case 'night': return { on: true, brightness: 25, kelvin: 2400 }
  }
}

/** Commands to bring one live device into the given scene. */
export function sceneCommandsForDevice(device: Device, mode: ModeKey, env?: EnvironmentState): DeviceCommand[] {
  const target: DeviceState = mode === 'auto' && device.category === 'light' && env
    ? sunAdaptiveLight(env)
    : modeStateFor(TWIN_TO_PLAN[device.category], mode)

  const cmds: DeviceCommand[] = []
  const onoff = findCapability(device.capabilities, 'OnOff')
  if (onoff?.access === 'readWrite' && typeof target.on === 'boolean')
    cmds.push({ deviceId: device.id, capability: 'OnOff', payload: { on: target.on } })
  const brightness = findCapability(device.capabilities, 'Brightness')
  if (brightness?.access === 'readWrite' && typeof target.brightness === 'number')
    cmds.push({ deviceId: device.id, capability: 'Brightness', payload: { percent: target.brightness } })
  const colorTemp = findCapability(device.capabilities, 'ColorTemperature')
  if (colorTemp?.access === 'readWrite' && typeof target.kelvin === 'number')
    cmds.push({ deviceId: device.id, capability: 'ColorTemperature', payload: { kelvin: target.kelvin } })
  const position = findCapability(device.capabilities, 'Position')
  if (position?.access === 'readWrite' && typeof target.position === 'number')
    cmds.push({ deviceId: device.id, capability: 'Position', payload: { percent: target.position } })
  const lock = findCapability(device.capabilities, 'Lock')
  if (lock?.access === 'readWrite' && typeof target.locked === 'boolean')
    cmds.push({ deviceId: device.id, capability: 'Lock', payload: { locked: target.locked } })
  return cmds
}

/** All commands for a scene across every device (fans out to all connectors). */
export function sceneCommands(devices: Device[], mode: ModeKey, env?: EnvironmentState): DeviceCommand[] {
  return devices.flatMap((d) => sceneCommandsForDevice(d, mode, env))
}

/** Live total power draw across the twin — the figure a scene visibly moves. */
export function totalEnergyW(devices: Device[]): number {
  let sum = 0
  for (const d of devices) {
    const e = findCapability(d.capabilities, 'Energy')
    if (e) sum += e.watts
  }
  return sum
}
