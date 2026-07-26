/**
 * Mode-state generator.
 *
 * Given a device category and a mode, return the sensible default
 * state values (brightness/temperature/locked/...) that this device
 * should adopt when the mode is activated.
 *
 * The output gets stored on `PlacedDevice.modeState[modeKey]` so the
 * editor (and any downstream automation export) can reproduce the
 * intended scene.
 */

import type { ModeKey, DeviceCategory } from '@/types'

export type DeviceState = Record<string, string | number | boolean>

/* ─────────── Per-mode defaults per category ─────────── */

const LIGHT_STATES: Record<ModeKey, DeviceState> = {
  auto:         { on: true,  brightness: 70, kelvin: 3000 },
  morning:      { on: true,  brightness: 60, kelvin: 2700 },
  'day-office': { on: true,  brightness: 90, kelvin: 5000 },
  film:         { on: true,  brightness: 15, kelvin: 2200 },
  night:        { on: false, brightness:  0 },
  relax:        { on: true,  brightness: 35, kelvin: 2400 },
  away:         { on: false, brightness:  0 },
  party:        { on: true,  brightness: 80, kelvin: 2700 },
  alarm:        { on: true,  brightness: 100, kelvin: 6500 },
}

const BLIND_STATES: Record<ModeKey, DeviceState> = {
  auto:         { position: 50 },
  morning:      { position: 100 },
  'day-office': { position: 75 },
  film:         { position: 0 },
  night:        { position: 0 },
  relax:        { position: 30 },
  away:         { position: 50 },
  party:        { position: 50 },
  alarm:        { position: 100 },
}

const CLIMATE_STATES: Record<ModeKey, DeviceState> = {
  auto:         { target_temp: 21 },
  morning:      { target_temp: 22 },
  'day-office': { target_temp: 21 },
  film:         { target_temp: 22 },
  night:        { target_temp: 18 },
  relax:        { target_temp: 22 },
  away:         { target_temp: 17 },
  party:        { target_temp: 21 },
  alarm:        { target_temp: 21 },
}

const LOCK_STATES: Record<ModeKey, DeviceState> = {
  auto:    { locked: false },
  morning: { locked: false },
  'day-office': { locked: true },
  film:    { locked: true },
  night:   { locked: true },
  relax:   { locked: false },
  away:    { locked: true },
  party:   { locked: false },
  alarm:   { locked: true },
}

const SPEAKER_STATES: Record<ModeKey, DeviceState> = {
  auto:         { volume: 30 },
  morning:      { volume: 20, source: 'radio' },
  'day-office': { volume: 25, source: 'focus' },
  film:         { volume: 70, source: 'tv' },
  night:        { volume: 0 },
  relax:        { volume: 40, source: 'jazz' },
  away:         { volume: 0 },
  party:        { volume: 85, source: 'party' },
  alarm:        { volume: 100, source: 'siren' },
}

const CAMERA_STATES: Record<ModeKey, DeviceState> = {
  auto:         { recording: false },
  morning:      { recording: false },
  'day-office': { recording: false },
  film:         { recording: false },
  night:        { recording: true },
  relax:        { recording: false },
  away:         { recording: true },
  party:        { recording: false },
  alarm:        { recording: true },
}

const ALARM_STATES: Record<ModeKey, DeviceState> = {
  auto:         { armed: false, sounding: false },
  morning:      { armed: false, sounding: false },
  'day-office': { armed: false, sounding: false },
  film:         { armed: false, sounding: false },
  night:        { armed: true,  sounding: false },
  relax:        { armed: false, sounding: false },
  away:         { armed: true,  sounding: false },
  party:        { armed: false, sounding: false },
  alarm:        { armed: true,  sounding: true  },
}

const TV_STATES: Record<ModeKey, DeviceState> = {
  auto:         { on: false },
  morning:      { on: false },
  'day-office': { on: false },
  film:         { on: true,  source: 'streaming' },
  night:        { on: false },
  relax:        { on: false },
  away:         { on: false },
  party:        { on: true,  source: 'visualizer' },
  alarm:        { on: true,  source: 'cameras' },
}

const SWITCH_STATES: Record<ModeKey, DeviceState> = {
  auto:         { on: true },
  morning:      { on: true },
  'day-office': { on: true },
  film:         { on: false },
  night:        { on: false },
  relax:        { on: true },
  away:         { on: false },
  party:        { on: true },
  alarm:        { on: true },
}

const OUTLET_STATES = SWITCH_STATES
const APPLIANCE_STATES = SWITCH_STATES
const IRRIGATION_STATES: Record<ModeKey, DeviceState> = {
  auto:    { running: false },
  morning: { running: true },
  'day-office': { running: false },
  film:    { running: false },
  night:   { running: false },
  relax:   { running: false },
  away:    { running: true },
  party:   { running: false },
  alarm:   { running: false },
}

/* Sensors and hubs are always passive — no scene state. */
const PASSIVE_STATES: Record<ModeKey, DeviceState> = {
  auto: {}, morning: {}, 'day-office': {}, film: {}, night: {},
  relax: {}, away: {}, party: {}, alarm: {},
}

/** Map category → mode-state table. */
const TABLE: Record<DeviceCategory, Record<ModeKey, DeviceState>> = {
  light:      LIGHT_STATES,
  switch:     SWITCH_STATES,
  outlet:     OUTLET_STATES,
  blind:      BLIND_STATES,
  climate:    CLIMATE_STATES,
  lock:       LOCK_STATES,
  speaker:    SPEAKER_STATES,
  camera:     CAMERA_STATES,
  alarm:      ALARM_STATES,
  tv:         TV_STATES,
  appliance:  APPLIANCE_STATES,
  irrigation: IRRIGATION_STATES,
  sensor:     PASSIVE_STATES,
  hub:        PASSIVE_STATES,
  other:      PASSIVE_STATES,
}

/** Resolve the desired state for one (category, mode) combination. */
export function modeStateFor(category: DeviceCategory, mode: ModeKey): DeviceState {
  return TABLE[category]?.[mode] ?? {}
}

/** Human-readable summary line for a state object — used in PropertyPanel. */
export function formatModeState(s: DeviceState | undefined): string {
  if (!s || Object.keys(s).length === 0) return '—'
  return Object.entries(s)
    .map(([k, v]) => {
      if (typeof v === 'boolean') return `${k}: ${v ? 'an' : 'aus'}`
      if (k === 'brightness' || k === 'position' || k === 'volume') return `${k} ${v}%`
      if (k === 'kelvin') return `${v} K`
      if (k === 'target_temp') return `${v}°C`
      return `${k}: ${v}`
    })
    .join(' · ')
}
