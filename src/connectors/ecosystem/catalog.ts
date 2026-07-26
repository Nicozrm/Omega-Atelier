/**
 * catalog.ts — one spec per supported ecosystem.
 *
 * Every ecosystem OMEGA lists in its device library becomes a connectable
 * source for the Digital Twin. A spec is pure data: brand identity plus a
 * small, brand-typical device fleet expressed in the neutral capability
 * vocabulary. The generic `createEcosystemConnector` turns any spec into a
 * fully functional `Connector` (discover / subscribe / publish / health) —
 * the domain core is never touched, exactly as the connector contract demands.
 */

import type { Capability } from '@/domain'
import type { DeviceCategory } from '@/domain'

/* ── Capability seed shorthands (valid domain capabilities) ───────────── */
const onoff = (on = false): Capability => ({ kind: 'OnOff', access: 'readWrite', on })
const dim = (percent = 60): Capability => ({ kind: 'Brightness', access: 'readWrite', percent })
const ct = (kelvin = 2700): Capability => ({ kind: 'ColorTemperature', access: 'readWrite', kelvin, minKelvin: 2200, maxKelvin: 6500 })
const rgb = (hex = '#ffb066'): Capability => ({ kind: 'Color', access: 'readWrite', hex })
const lock = (locked = true): Capability => ({ kind: 'Lock', access: 'readWrite', locked })
const pos = (percent = 100): Capability => ({ kind: 'Position', access: 'readWrite', percent })
const temp = (celsius = 21.5): Capability => ({ kind: 'Temperature', access: 'read', celsius })
const hum = (percent = 45): Capability => ({ kind: 'Humidity', access: 'read', percent })
const motion = (): Capability => ({ kind: 'Motion', access: 'read', detected: false })
const energy = (watts = 0): Capability => ({ kind: 'Energy', access: 'read', watts })
const camera = (): Capability => ({ kind: 'Camera', access: 'read', streaming: true })
const vacuum = (): Capability => ({ kind: 'Vacuum', access: 'readWrite', activity: 'docked' })

export type EcosystemIcon =
  | 'bulb' | 'lock' | 'speaker' | 'camera' | 'hub' | 'thermo' | 'plug'
  | 'sensor' | 'blind' | 'vacuum'

export interface FleetDevice {
  /** Stable per-spec key — becomes part of the device id. */
  key: string
  name: string
  category: DeviceCategory
  caps: Capability[]
  /** Battery-powered devices report a level; mains devices omit it. */
  battery?: number
}

export interface EcosystemSpec {
  /** Connector id (unique across the app). */
  id: string
  label: string
  /** Short source badge, e.g. "Hue". */
  short: string
  /** Brand accent for badges/cards. */
  color: string
  icon: EcosystemIcon
  fleet: FleetDevice[]
}

const spec = (
  id: string, label: string, short: string, color: string,
  icon: EcosystemIcon, fleet: FleetDevice[],
): EcosystemSpec => ({ id: `eco-${id}`, label, short, color, icon, fleet })

const d = (key: string, name: string, category: DeviceCategory, caps: Capability[], battery?: number): FleetDevice =>
  battery === undefined ? { key, name, category, caps } : { key, name, category, caps, battery }

/**
 * Every ecosystem from the device library, each with a believable mini-fleet.
 * (Home Assistant and MQTT have dedicated, transport-real connectors and are
 * intentionally not duplicated here.)
 */
export const ECOSYSTEM_SPECS: EcosystemSpec[] = [
  spec('philips-hue', 'Philips Hue', 'Hue', '#7d59c4', 'bulb', [
    d('bulb-wz', 'Hue Bulb Wohnzimmer', 'light', [onoff(true), dim(70), ct(2700), rgb('#ffd9a0'), energy(9)]),
    d('strip-tv', 'Hue Lightstrip TV', 'light', [onoff(true), dim(45), rgb('#7d59c4'), energy(12)]),
    d('go', 'Hue Go', 'light', [onoff(), dim(30), rgb('#ffb066'), energy(6)], 78),
    d('motion-flur', 'Hue Motion Flur', 'sensor', [motion(), temp(21.2)], 91),
  ]),
  spec('ikea-dirigera', 'IKEA DIRIGERA', 'IKEA', '#0058a3', 'bulb', [
    d('tradfri-decke', 'TRÅDFRI Deckenlampe', 'light', [onoff(true), dim(80), ct(3000), energy(11)]),
    d('fyrtur', 'FYRTUR Rollo', 'cover', [pos(100)], 84),
    d('vindstyrka', 'VINDSTYRKA Sensor', 'sensor', [temp(22.1), hum(44)]),
  ]),
  spec('aqara', 'Aqara', 'Aqara', '#6cc04a', 'sensor', [
    d('door-haustuer', 'Tür-Kontakt Haustür', 'sensor', [motion()], 96),
    d('temp-schlaf', 'Temp/Feuchte Schlafzimmer', 'sensor', [temp(19.8), hum(52)], 88),
    d('fp2', 'Presence FP2', 'sensor', [motion()]),
  ]),
  spec('shelly', 'Shelly', 'Shelly', '#3aa3e3', 'plug', [
    d('plug-tv', 'Plug S TV-Board', 'energy', [onoff(true), energy(84)]),
    d('1pm-decke', '1PM Mini Deckenlicht', 'light', [onoff(false), energy(0)]),
    d('em-haus', 'Pro 3EM Hausanschluss', 'energy', [energy(412)]),
  ]),
  spec('sonos', 'Sonos', 'Sonos', '#111111', 'speaker', [
    d('era-wz', 'Era 300 Wohnzimmer', 'speaker', [onoff(true), energy(14)]),
    d('one-kueche', 'One SL Küche', 'speaker', [onoff(false), energy(3)]),
    d('arc-tv', 'Arc Soundbar', 'speaker', [onoff(true), energy(22)]),
  ]),
  spec('eve', 'Eve', 'Eve', '#7a4dcf', 'sensor', [
    d('energy-buero', 'Eve Energy Büro', 'energy', [onoff(true), energy(65)]),
    d('door-terrasse', 'Eve Door Terrasse', 'sensor', [motion()], 82),
    d('thermo-bad', 'Eve Thermo Bad', 'climate', [temp(22.4), pos(35)], 74),
  ]),
  spec('hue-sync', 'Hue Sync', 'Sync', '#4b3ba5', 'hub', [
    d('syncbox', 'Sync Box TV', 'hub', [onoff(true), energy(7)]),
    d('gradient-tv', 'Gradient Strip TV', 'light', [onoff(true), dim(55), rgb('#4b3ba5'), energy(15)]),
  ]),
  spec('samsung-smartthings', 'SmartThings', 'SmartThings', '#15bfff', 'hub', [
    d('station', 'SmartThings Station', 'hub', [energy(4)]),
    d('plug-flur', 'Smart Plug Flur', 'energy', [onoff(false), energy(0)]),
    d('multi-fenster', 'Multipurpose Fenster', 'sensor', [motion(), temp(20.6)], 90),
  ]),
  spec('lutron', 'Lutron', 'Lutron', '#c8a24b', 'bulb', [
    d('caseta-ess', 'Caséta Dimmer Esszimmer', 'light', [onoff(true), dim(65), energy(8)]),
    d('serena-sz', 'Serena Shade Schlafzimmer', 'cover', [pos(80)], 87),
  ]),
  spec('nuki', 'Nuki', 'Nuki', '#e6332a', 'lock', [
    d('lock-haustuer', 'Smart Lock 4 Haustür', 'lock', [lock(true)], 68),
    d('opener', 'Opener Gegensprech', 'lock', [lock(true)]),
  ]),
  spec('tado', 'tado°', 'tado', '#ffa600', 'thermo', [
    d('trv-wz', 'Heizkörper-Thermostat WZ', 'climate', [temp(21.6), pos(40)], 71),
    d('trv-sz', 'Heizkörper-Thermostat SZ', 'climate', [temp(19.2), pos(15)], 79),
    d('bridge', 'Internet Bridge', 'hub', [energy(2)]),
  ]),
  spec('bosch-sh', 'Bosch Smart Home', 'Bosch', '#ea0016', 'blind', [
    d('shutter-wz', 'Rollladensteuerung WZ', 'cover', [pos(100)]),
    d('twinguard', 'Twinguard Rauchmelder', 'sensor', [temp(21.9), hum(43)], 93),
    d('thermostat-bad', 'Raumthermostat Bad', 'climate', [temp(23.1), pos(55)], 85),
  ]),
  spec('netatmo', 'Netatmo', 'Netatmo', '#ff7900', 'thermo', [
    d('station-wz', 'Wetterstation Innenmodul', 'sensor', [temp(21.4), hum(46)]),
    d('outdoor', 'Außenmodul', 'sensor', [temp(9.8), hum(72)], 64),
    d('presence', 'Presence Außenkamera', 'camera', [camera(), motion()]),
  ]),
  spec('fritzbox', 'FRITZ!Box Smart Home', 'FRITZ!', '#e2001a', 'plug', [
    d('dect200-tv', 'DECT 200 TV', 'energy', [onoff(true), energy(96)]),
    d('dect301-sz', 'DECT 301 Heizkörper', 'climate', [temp(19.5), pos(20)], 76),
    d('dect440', 'DECT 440 Taster', 'sensor', [temp(21.0), hum(48)], 95),
  ]),
  spec('homey', 'Homey', 'Homey', '#00a8e2', 'hub', [
    d('pro', 'Homey Pro Hub', 'hub', [energy(6)]),
    d('bridge-licht', 'Bridge-Licht Flur', 'light', [onoff(false), dim(50), energy(0)]),
  ]),
  spec('fibaro', 'Fibaro', 'Fibaro', '#f8a13f', 'sensor', [
    d('flood-bad', 'Flood Sensor Bad', 'sensor', [motion(), temp(23.0)], 89),
    d('dimmer-ess', 'Dimmer 2 Esszimmer', 'light', [onoff(true), dim(75), energy(10)]),
  ]),
  spec('loxone', 'Loxone', 'Loxone', '#69c350', 'hub', [
    d('miniserver', 'Miniserver Gen 2', 'hub', [energy(9)]),
    d('touch-wz', 'Touch Pure WZ', 'sensor', [temp(21.7), hum(45)]),
    d('jalousie-sued', 'Jalousie Südfenster', 'cover', [pos(60)]),
  ]),
  spec('kindermatte', 'Kindermatte', 'Matte', '#58b6a0', 'sensor', [
    d('matte-kz', 'Sensor-Matte Kinderzimmer', 'sensor', [motion()], 81),
  ]),
  spec('hue-secure', 'Hue Secure', 'Secure', '#40348c', 'camera', [
    d('cam-eingang', 'Secure Cam Eingang', 'camera', [camera(), motion()]),
    d('contact-keller', 'Contact Sensor Keller', 'sensor', [motion()], 92),
  ]),
  spec('switchbot', 'SwitchBot', 'SwitchBot', '#d8323c', 'blind', [
    d('curtain-wz', 'Curtain 3 Wohnzimmer', 'cover', [pos(100)], 73),
    d('bot-kaffee', 'Bot Kaffeemaschine', 'appliance', [onoff(false), energy(0)], 86),
    d('meter-keller', 'Meter Pro Keller', 'sensor', [temp(17.9), hum(58)], 94),
  ]),
  spec('lockin', 'Lockin', 'Lockin', '#2f6bff', 'lock', [
    d('g30-haustuer', 'Smart Lock G30 Haustür', 'lock', [lock(true)], 77),
    d('veno', 'Video-Türklingel Veno', 'camera', [camera(), motion()], 69),
  ]),
  spec('govee', 'Govee', 'Govee', '#00c2ff', 'bulb', [
    d('strip-bett', 'LED Strip Bett', 'light', [onoff(true), dim(35), rgb('#8a2be2'), energy(9)]),
    d('curtain-fenster', 'Curtain Lights Fenster', 'light', [onoff(false), dim(60), rgb('#00c2ff'), energy(0)]),
    d('h5075', 'Thermo-Hygrometer', 'sensor', [temp(21.3), hum(47)], 88),
  ]),
  spec('smart-life', 'Smart Life', 'SmartLife', '#ff4800', 'plug', [
    d('plug-waschk', 'WLAN-Steckdose Waschküche', 'energy', [onoff(true), energy(320)]),
    d('ir-hub', 'IR-Universal-Hub', 'hub', [energy(2)]),
  ]),
  spec('tuya', 'Tuya', 'Tuya', '#ff5b00', 'plug', [
    d('robo-s8', 'Saug- & Wischroboter S8', 'appliance', [vacuum(), energy(0)], 84),
    d('zigbee-gw', 'Zigbee Gateway', 'hub', [energy(3)]),
    d('siren', 'Innensirene', 'sensor', [onoff(false), energy(0)]),
    d('pir-garage', 'PIR-Sensor Garage', 'sensor', [motion()], 83),
  ]),
  spec('osaio', 'Osaio', 'Osaio', '#12b5cb', 'camera', [
    d('cam-garten', 'Outdoor-Kamera Garten', 'camera', [camera(), motion()]),
  ]),
  spec('arenti', 'Arenti', 'Arenti', '#6f5df6', 'camera', [
    d('cam-kz', 'Indoor-Kamera Kinderzimmer', 'camera', [camera(), motion()]),
    d('doorbell', 'Video Doorbell', 'camera', [camera(), motion()], 71),
  ]),
  spec('apple-home', 'Apple Home', 'Apple', '#a2aaad', 'hub', [
    d('homepod-wz', 'HomePod Wohnzimmer', 'speaker', [onoff(true), energy(11)]),
    d('homepod-mini', 'HomePod mini Küche', 'speaker', [onoff(false), energy(2)]),
    d('appletv', 'Apple TV 4K', 'hub', [onoff(true), energy(4)]),
  ]),
  spec('google-home', 'Google Home', 'Google', '#4285f4', 'hub', [
    d('nest-hub', 'Nest Hub Max', 'hub', [onoff(true), energy(8)]),
    d('nest-mini', 'Nest Mini Bad', 'speaker', [onoff(false), energy(1)]),
    d('nest-protect', 'Nest Protect', 'sensor', [motion(), temp(21.8)], 90),
  ]),
  spec('alexa', 'Amazon Alexa', 'Alexa', '#00caff', 'speaker', [
    d('echo-wz', 'Echo Studio WZ', 'speaker', [onoff(true), energy(12)]),
    d('echo-dot', 'Echo Dot Schlafzimmer', 'speaker', [onoff(false), energy(2)]),
    d('echo-show', 'Echo Show 8 Küche', 'hub', [onoff(true), energy(7)]),
  ]),
  spec('matter', 'Matter', 'Matter', '#5bc0a8', 'hub', [
    d('bulb-flur', 'Matter Bulb Flur', 'light', [onoff(false), dim(50), ct(3000), energy(0)]),
    d('plug-router', 'Matter Plug Router', 'energy', [onoff(true), energy(18)]),
    d('contact-wc', 'Matter Contact WC', 'sensor', [motion()], 97),
    d('robo-wz', 'Matter Saugroboter', 'appliance', [vacuum(), energy(4)]),
  ]),
]
