import type { OmegaMode } from '@/types'

/**
 * The nine canonical OMEGA modes.
 * Each carries a required-categories list used by the readiness score.
 */
export const OMEGA_MODES: OmegaMode[] = [
  {
    key: 'auto',
    name: 'Automatik',
    description: 'Adaptive Szene je nach Zeit, Präsenz und Sensorlage.',
    icon: 'Zap',
    accent: '#C7A24E',
    trigger: { manual: true, presence: 'any' },
    requiredCategories: ['light', 'sensor'],
  },
  {
    key: 'morning',
    name: 'Morgen',
    description: 'Sanfter Start in den Tag – Jalousien hoch, Licht warm, Kaffee an.',
    icon: 'Sunrise',
    accent: '#5BD6C0',
    trigger: { manual: true, time: { from: '06:00', to: '09:00' } },
    requiredCategories: ['light', 'blind', 'appliance'],
  },
  {
    key: 'day-office',
    name: 'Tag / Büro',
    description: 'Helles, neutrales Licht, fokussierte Umgebung.',
    icon: 'Sun',
    accent: '#E8C879',
    trigger: { manual: true, time: { from: '09:00', to: '18:00' } },
    requiredCategories: ['light', 'blind', 'climate'],
  },
  {
    key: 'film',
    name: 'Film',
    description: 'Dunkle Ambientbeleuchtung, TV an, Sound auf Referenzlautstärke.',
    icon: 'Clapperboard',
    accent: '#8A7BFF',
    trigger: { manual: true },
    requiredCategories: ['light', 'tv', 'speaker', 'blind'],
  },
  {
    key: 'night',
    name: 'Nacht',
    description: 'Alles leise, Notlicht, Tür verriegelt, Klima heruntergefahren.',
    icon: 'Moon',
    accent: '#9A7B36',
    trigger: { manual: true, time: { from: '22:30', to: '05:30' } },
    requiredCategories: ['light', 'lock', 'climate', 'sensor'],
  },
  {
    key: 'relax',
    name: 'Entspannung',
    description: 'Warmes Licht, ruhige Musik, Klima wohlig.',
    icon: 'Coffee',
    accent: '#5BB8FF',
    trigger: { manual: true },
    requiredCategories: ['light', 'speaker', 'climate'],
  },
  {
    key: 'away',
    name: 'Abwesenheit',
    description: 'Alles aus, Eco, Sicherheit aktiv, Anwesenheits-Simulation optional.',
    icon: 'LogOut',
    accent: '#8B8478',
    trigger: { manual: true, presence: 'away' },
    requiredCategories: ['lock', 'camera', 'sensor', 'alarm'],
  },
  {
    key: 'party',
    name: 'Party',
    description: 'Farbiges Licht, Sound auf laut, Türen entriegelt für Gäste.',
    icon: 'PartyPopper',
    accent: '#C46BFF',
    trigger: { manual: true },
    requiredCategories: ['light', 'speaker'],
  },
  {
    key: 'alarm',
    name: 'Alarm',
    description: 'Alles an, Sirenen, Kameras aufzeichnen, Benachrichtigung.',
    icon: 'AlertTriangle',
    accent: '#FF4D4D',
    trigger: { manual: true },
    requiredCategories: ['alarm', 'camera', 'lock', 'sensor', 'light'],
  },
]

export const DEFAULT_FLOOR_EXTENT = { width: 2000, height: 1500 } // 20m × 15m in cm
export const DEFAULT_GRID = 50 // cm
export const DEFAULT_SNAP = 10 // cm

export const TOOL_HOTKEYS: Record<string, string> = {
  v: 'select',
  w: 'wall',
  o: 'door',
  e: 'window',
  r: 'terrace',
  d: 'device',
  f: 'furniture',
  t: 'label',
  m: 'measure',
  ' ': 'pan',
}

/** 25 categorized tags used in filters. */
export const DEVICE_ECOSYSTEM_LABELS: Record<string, string> = {
  'apple-home': 'Apple Home',
  'google-home': 'Google Home',
  alexa: 'Alexa',
  'home-assistant': 'Home Assistant',
  matter: 'Matter',
  'philips-hue': 'Philips Hue',
  'ikea-dirigera': 'IKEA Dirigera',
  aqara: 'Aqara',
  shelly: 'Shelly',
  sonos: 'Sonos',
  eve: 'Eve',
  'hue-sync': 'Hue Sync',
  'samsung-smartthings': 'SmartThings',
  lutron: 'Lutron',
  nuki: 'Nuki',
  tado: 'tado°',
  'bosch-sh': 'Bosch Smart Home',
  netatmo: 'Netatmo',
  fritzbox: 'FRITZ!Box',
  homey: 'Homey',
  fibaro: 'Fibaro',
  loxone: 'Loxone',
  kindermatte: 'Kindermatte',
  'hue-secure': 'Hue Secure',
  // v16 — additional ecosystems
  switchbot: 'SwitchBot',
  lockin: 'Lockin',
  govee: 'Govee',
  'smart-life': 'Smart Life',
  tuya: 'Tuya',
  osaio: 'Osaio',
  arenti: 'Arenti',
  custom: 'Custom',
}

export const CATEGORY_LABELS: Record<string, string> = {
  light: 'Licht',
  switch: 'Schalter',
  sensor: 'Sensor',
  climate: 'Klima',
  camera: 'Kamera',
  lock: 'Schloss',
  speaker: 'Audio',
  tv: 'TV',
  blind: 'Rollo',
  outlet: 'Steckdose',
  hub: 'Hub',
  appliance: 'Haushalt',
  alarm: 'Alarm',
  irrigation: 'Bewässerung',
  other: 'Sonstiges',
}
