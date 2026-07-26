/**
 * capabilities.ts — the Capability Model.
 *
 * A device is described by *what it can do*, never by who made it. Capabilities
 * are the single, manufacturer-neutral vocabulary of device function: new device
 * types arise from *combinations* of capabilities — never from inheritance and
 * never from a vendor-specific class. Pure data + pure helpers only: no UI, no
 * renderer, no connector, no manufacturer name, no network technology.
 */

export type CapabilityKind =
  | 'OnOff'
  | 'Brightness'
  | 'ColorTemperature'
  | 'Color'
  | 'Lock'
  | 'Position'
  | 'Temperature'
  | 'Humidity'
  | 'Motion'
  | 'Energy'
  | 'Camera'
  | 'Vacuum'

/** Whether a capability can be commanded, or is read-only telemetry. */
export type CapabilityAccess = 'read' | 'readWrite'

interface CapabilityBase {
  readonly kind: CapabilityKind
  readonly access: CapabilityAccess
}

/** Binary power. */
export interface OnOffCapability extends CapabilityBase {
  kind: 'OnOff'
  access: 'readWrite'
  on: boolean
}
/** Dimming, 0–100 %. */
export interface BrightnessCapability extends CapabilityBase {
  kind: 'Brightness'
  access: 'readWrite'
  percent: number
}
/** White colour temperature in Kelvin. */
export interface ColorTemperatureCapability extends CapabilityBase {
  kind: 'ColorTemperature'
  access: 'readWrite'
  kelvin: number
  minKelvin: number
  maxKelvin: number
}
/** Full colour as a hex string. */
export interface ColorCapability extends CapabilityBase {
  kind: 'Color'
  access: 'readWrite'
  hex: string
}
/** A lockable mechanism. */
export interface LockCapability extends CapabilityBase {
  kind: 'Lock'
  access: 'readWrite'
  locked: boolean
}
/** A 0–100 % position (blinds, valves, dock progress …). */
export interface PositionCapability extends CapabilityBase {
  kind: 'Position'
  access: 'readWrite'
  percent: number
}
/** Temperature reading, °C. */
export interface TemperatureCapability extends CapabilityBase {
  kind: 'Temperature'
  access: 'read'
  celsius: number
}
/** Relative humidity, %. */
export interface HumidityCapability extends CapabilityBase {
  kind: 'Humidity'
  access: 'read'
  percent: number
}
/** Motion / presence. */
export interface MotionCapability extends CapabilityBase {
  kind: 'Motion'
  access: 'read'
  detected: boolean
}
/** Power / energy metering. */
export interface EnergyCapability extends CapabilityBase {
  kind: 'Energy'
  access: 'read'
  watts: number
  kwhToday?: number
}
/** A video stream source. */
export interface CameraCapability extends CapabilityBase {
  kind: 'Camera'
  access: 'read'
  streaming: boolean
}
/** A cleaning-robot activity. */
export interface VacuumCapability extends CapabilityBase {
  kind: 'Vacuum'
  access: 'readWrite'
  activity: 'idle' | 'cleaning' | 'returning' | 'docked'
}

export type Capability =
  | OnOffCapability
  | BrightnessCapability
  | ColorTemperatureCapability
  | ColorCapability
  | LockCapability
  | PositionCapability
  | TemperatureCapability
  | HumidityCapability
  | MotionCapability
  | EnergyCapability
  | CameraCapability
  | VacuumCapability

/** Typed lookup: capability kind → its concrete interface. */
export interface CapabilityByKind {
  OnOff: OnOffCapability
  Brightness: BrightnessCapability
  ColorTemperature: ColorTemperatureCapability
  Color: ColorCapability
  Lock: LockCapability
  Position: PositionCapability
  Temperature: TemperatureCapability
  Humidity: HumidityCapability
  Motion: MotionCapability
  Energy: EnergyCapability
  Camera: CameraCapability
  Vacuum: VacuumCapability
}

/** All capability kinds, in a stable presentation order. */
export const CAPABILITY_KINDS: CapabilityKind[] = [
  'OnOff', 'Brightness', 'ColorTemperature', 'Color', 'Lock', 'Position',
  'Temperature', 'Humidity', 'Motion', 'Energy', 'Camera', 'Vacuum',
]

/** Typed capability lookup within a capability list. */
export function findCapability<K extends CapabilityKind>(
  caps: Capability[],
  kind: K,
): CapabilityByKind[K] | undefined {
  return caps.find((c) => c.kind === kind) as CapabilityByKind[K] | undefined
}

export function hasCapability(caps: Capability[], kind: CapabilityKind): boolean {
  return caps.some((c) => c.kind === kind)
}

export function isWritable(c: Capability): boolean {
  return c.access === 'readWrite'
}
