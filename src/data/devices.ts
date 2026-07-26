import type { DeviceCatalogEntry } from '@/types'

/**
 * Device catalog. This is a curated, representative subset of the 324+ items
 * from the original OMEGA Atelier. It spans all 25 ecosystems so the UI can
 * demonstrate filtering/grouping immediately. Extend freely.
 */
export const DEVICES: DeviceCatalogEntry[] = [
  // Philips Hue ---------------------------------------------------------
  { id: 'hue-e27-white-color',  name: 'Hue E27 White & Color',       brand: 'Philips', ecosystem: 'philips-hue',   category: 'light',       protocol: ['zigbee','matter'], price: 59,  power: 9,  icon: 'Lightbulb',     modeTags: ['auto','morning','day-office','film','night','relax','party','alarm'] },
  { id: 'hue-gu10-white-color', name: 'Hue GU10 White & Color',      brand: 'Philips', ecosystem: 'philips-hue',   category: 'light',       protocol: ['zigbee'],          price: 49,  power: 5,  icon: 'Lightbulb',     modeTags: ['auto','morning','day-office','film','night','relax','party','alarm'] },
  { id: 'hue-lightstrip-plus',  name: 'Hue Lightstrip Plus 2m',      brand: 'Philips', ecosystem: 'philips-hue',   category: 'light',       protocol: ['zigbee'],          price: 89,  power: 20, icon: 'Zap',           modeTags: ['auto','morning','film','night','relax','party','alarm'] },
  { id: 'hue-bridge',           name: 'Hue Bridge',                  brand: 'Philips', ecosystem: 'philips-hue',   category: 'hub',         protocol: ['wired','wifi'],    price: 59,  power: 3,  icon: 'Router',        modeTags: ['auto'] },
  { id: 'hue-motion',           name: 'Hue Motion Sensor',           brand: 'Philips', ecosystem: 'philips-hue',   category: 'sensor',      protocol: ['zigbee'],          price: 44,                icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'hue-dimmer-v2',        name: 'Hue Dimmer Switch v2',        brand: 'Philips', ecosystem: 'philips-hue',   category: 'switch',      protocol: ['zigbee'],          price: 24,                icon: 'CircleDot',     modeTags: ['auto','morning','day-office','night','relax','party'] },
  { id: 'hue-secure-cam',       name: 'Hue Secure Wired Cam',        brand: 'Philips', ecosystem: 'hue-secure',    category: 'camera',      protocol: ['wifi'],            price: 199, power: 6,  icon: 'Cctv',          modeTags: ['away','alarm'] },

  // Apple Home / HomeKit ------------------------------------------------
  { id: 'apple-homepod',        name: 'HomePod (2. Gen)',            brand: 'Apple',   ecosystem: 'apple-home',    category: 'speaker',     protocol: ['wifi','thread','matter'], price: 349, power: 25, icon: 'Speaker', modeTags: ['auto','morning','film','relax','party'] },
  { id: 'apple-homepod-mini',   name: 'HomePod mini',                brand: 'Apple',   ecosystem: 'apple-home',    category: 'speaker',     protocol: ['wifi','thread'],          price: 109, power: 5,  icon: 'Speaker', modeTags: ['auto','morning','film','relax','party'] },
  { id: 'apple-tv-4k',          name: 'Apple TV 4K',                 brand: 'Apple',   ecosystem: 'apple-home',    category: 'hub',         protocol: ['wifi','thread','matter'], price: 169, power: 4,  icon: 'Tv',      modeTags: ['auto','film','party','relax'] },

  // Eve -----------------------------------------------------------------
  { id: 'eve-motion',           name: 'Eve Motion',                  brand: 'Eve',     ecosystem: 'eve',           category: 'sensor',      protocol: ['thread','matter'], price: 49,                icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'eve-door-window',      name: 'Eve Door & Window',           brand: 'Eve',     ecosystem: 'eve',           category: 'sensor',      protocol: ['thread','matter'], price: 39,                icon: 'DoorOpen',      modeTags: ['auto','away','alarm'] },
  { id: 'eve-energy',           name: 'Eve Energy',                  brand: 'Eve',     ecosystem: 'eve',           category: 'outlet',      protocol: ['thread','matter'], price: 49,                icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },
  { id: 'eve-thermo',           name: 'Eve Thermo',                  brand: 'Eve',     ecosystem: 'eve',           category: 'climate',     protocol: ['thread','matter'], price: 79,                icon: 'Thermometer',   modeTags: ['auto','morning','day-office','night','relax','away'] },

  // IKEA Dirigera -------------------------------------------------------
  { id: 'ikea-dirigera',        name: 'Dirigera Hub',                brand: 'IKEA',    ecosystem: 'ikea-dirigera', category: 'hub',         protocol: ['zigbee','wifi','matter'], price: 129, power: 4, icon: 'Router',        modeTags: ['auto'] },
  { id: 'ikea-tradfri-e27',     name: 'Tradfri E27 (9W)',            brand: 'IKEA',    ecosystem: 'ikea-dirigera', category: 'light',       protocol: ['zigbee','matter'],  price: 11,  power: 9, icon: 'Lightbulb',     modeTags: ['auto','morning','day-office','film','night','relax','party','alarm'] },
  { id: 'ikea-vallhorn',        name: 'Vallhorn Bewegungsmelder',    brand: 'IKEA',    ecosystem: 'ikea-dirigera', category: 'sensor',      protocol: ['zigbee','matter'],  price: 12,             icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'ikea-praktlysing',     name: 'Praktlysing Rollo',           brand: 'IKEA',    ecosystem: 'ikea-dirigera', category: 'blind',       protocol: ['zigbee'],           price: 139,            icon: 'Blinds',        modeTags: ['auto','morning','day-office','night','relax','away'] },

  // Aqara ---------------------------------------------------------------
  { id: 'aqara-m2-hub',         name: 'Aqara Hub M2',                brand: 'Aqara',   ecosystem: 'aqara',         category: 'hub',         protocol: ['zigbee','wifi'],    price: 69,  power: 3, icon: 'Router',        modeTags: ['auto'] },
  { id: 'aqara-fp2',            name: 'Aqara Presence FP2',          brand: 'Aqara',   ecosystem: 'aqara',         category: 'sensor',      protocol: ['wifi'],             price: 79,  power: 3, icon: 'Radar',         modeTags: ['auto','morning','day-office','night','away','alarm'] },
  { id: 'aqara-door-sensor',    name: 'Aqara Door Sensor P2',        brand: 'Aqara',   ecosystem: 'aqara',         category: 'sensor',      protocol: ['thread','matter'],  price: 24,             icon: 'DoorOpen',      modeTags: ['auto','away','alarm'] },

  // Shelly --------------------------------------------------------------
  { id: 'shelly-1pm-mini',      name: 'Shelly 1PM Mini Gen3',        brand: 'Shelly',  ecosystem: 'shelly',        category: 'switch',      protocol: ['wifi','matter'],    price: 19,             icon: 'ToggleRight',   modeTags: ['auto','morning','day-office','night','relax','party'] },
  { id: 'shelly-plus-2pm',      name: 'Shelly Plus 2PM',             brand: 'Shelly',  ecosystem: 'shelly',        category: 'blind',       protocol: ['wifi','matter'],    price: 35,             icon: 'Blinds',        modeTags: ['auto','morning','day-office','night','relax','away'] },
  { id: 'shelly-plug-s',        name: 'Shelly Plug S MTR',           brand: 'Shelly',  ecosystem: 'shelly',        category: 'outlet',      protocol: ['wifi','matter'],    price: 22,             icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },

  // Sonos ---------------------------------------------------------------
  { id: 'sonos-era-300',        name: 'Sonos Era 300',               brand: 'Sonos',   ecosystem: 'sonos',         category: 'speaker',     protocol: ['wifi','bt'],        price: 499, power: 40, icon: 'Speaker',       modeTags: ['auto','morning','film','relax','party'] },
  { id: 'sonos-arc-ultra',      name: 'Sonos Arc Ultra',             brand: 'Sonos',   ecosystem: 'sonos',         category: 'speaker',     protocol: ['wifi','wired'],     price: 999, power: 60, icon: 'Speaker',       modeTags: ['auto','film','relax','party'] },
  { id: 'sonos-sub-mini',       name: 'Sonos Sub Mini',              brand: 'Sonos',   ecosystem: 'sonos',         category: 'speaker',     protocol: ['wifi'],             price: 499, power: 50, icon: 'Speaker',       modeTags: ['auto','film','party','relax'] },

  // Nuki ----------------------------------------------------------------
  { id: 'nuki-smart-lock-4',    name: 'Nuki Smart Lock 4 Pro',       brand: 'Nuki',    ecosystem: 'nuki',          category: 'lock',        protocol: ['bt','wifi','matter'], price: 329,          icon: 'Lock',          modeTags: ['auto','night','away','alarm'] },
  { id: 'nuki-keypad-2',        name: 'Nuki Keypad 2.0',             brand: 'Nuki',    ecosystem: 'nuki',          category: 'lock',        protocol: ['bt'],               price: 159,            icon: 'KeyRound',      modeTags: ['auto','night','away','alarm'] },
  { id: 'welock-lock',          name: 'WeLock Touch41',              brand: 'WeLock',  ecosystem: 'tuya',          category: 'lock',        protocol: ['bt','wifi'],        price: 149,            icon: 'Lock',          modeTags: ['auto','night','away','alarm'] },

  // tado ----------------------------------------------------------------
  { id: 'tado-x-trv',           name: 'tado X Thermostat',           brand: 'tado',    ecosystem: 'tado',          category: 'climate',     protocol: ['thread','matter'],  price: 79,             icon: 'Thermometer',   modeTags: ['auto','morning','day-office','night','relax','away'] },
  { id: 'tado-x-bridge',        name: 'tado X Bridge',               brand: 'tado',    ecosystem: 'tado',          category: 'hub',         protocol: ['wifi','thread'],    price: 99,   power: 3, icon: 'Router',        modeTags: ['auto'] },

  // Lutron --------------------------------------------------------------
  { id: 'lutron-caseta-dimmer', name: 'Lutron Caseta Dimmer',        brand: 'Lutron',  ecosystem: 'lutron',        category: 'switch',      protocol: ['wired'],            price: 79,             icon: 'ToggleRight',   modeTags: ['auto','morning','day-office','night','relax','party'] },
  { id: 'lutron-pico',          name: 'Lutron Pico Remote',          brand: 'Lutron',  ecosystem: 'lutron',        category: 'switch',      protocol: ['wired'],            price: 29,             icon: 'CircleDot',     modeTags: ['auto','morning','day-office','night','relax','party'] },

  // Bosch Smart Home ----------------------------------------------------
  { id: 'bosch-sh-controller2', name: 'Smart Home Controller II',    brand: 'Bosch',   ecosystem: 'bosch-sh',      category: 'hub',         protocol: ['wifi','thread','matter'], price: 199, power: 5, icon: 'Router',        modeTags: ['auto'] },
  { id: 'bosch-motion',         name: 'Bewegungsmelder II',          brand: 'Bosch',   ecosystem: 'bosch-sh',      category: 'sensor',      protocol: ['thread'],            price: 69,             icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'bosch-twinguard',      name: 'Twinguard Rauchmelder',       brand: 'Bosch',   ecosystem: 'bosch-sh',      category: 'alarm',       protocol: ['thread'],            price: 119,            icon: 'AlertTriangle', modeTags: ['away','alarm'] },

  // Netatmo -------------------------------------------------------------
  { id: 'netatmo-weather',      name: 'Wetterstation',               brand: 'Netatmo', ecosystem: 'netatmo',       category: 'sensor',      protocol: ['wifi'],             price: 169, power: 1, icon: 'CloudSun',      modeTags: ['auto','morning','day-office','away'] },
  { id: 'netatmo-doorbell',     name: 'Smart Video Doorbell',        brand: 'Netatmo', ecosystem: 'netatmo',       category: 'camera',      protocol: ['wifi'],             price: 299, power: 4, icon: 'Cctv',          modeTags: ['away','alarm'] },

  // FRITZ!Box -----------------------------------------------------------
  { id: 'fritz-dect-200',       name: 'FRITZ!DECT 200',              brand: 'AVM',     ecosystem: 'fritzbox',      category: 'outlet',      protocol: ['wifi'],             price: 59,             icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },
  { id: 'fritz-dect-440',       name: 'FRITZ!DECT 440',              brand: 'AVM',     ecosystem: 'fritzbox',      category: 'switch',      protocol: ['wifi'],             price: 79,             icon: 'ToggleRight',   modeTags: ['auto','morning','day-office','night','relax','party'] },

  // Home Assistant / Matter / Generic -----------------------------------
  { id: 'ha-green',             name: 'Home Assistant Green',        brand: 'Nabu Casa', ecosystem: 'home-assistant', category: 'hub',       protocol: ['wifi','wired','thread','matter','zigbee'], price: 99, power: 5, icon: 'Server', modeTags: ['auto'] },
  { id: 'ha-sky-connect',       name: 'HA SkyConnect',               brand: 'Nabu Casa', ecosystem: 'home-assistant', category: 'hub',       protocol: ['thread','zigbee'],     price: 39,             icon: 'Router',        modeTags: ['auto'] },

  // Samsung SmartThings -------------------------------------------------
  { id: 'smartthings-station',  name: 'SmartThings Station',         brand: 'Samsung', ecosystem: 'samsung-smartthings', category: 'hub',    protocol: ['wifi','thread','matter'], price: 99, power: 8, icon: 'Router',        modeTags: ['auto'] },

  // Sonos-Sync / Hue Sync -----------------------------------------------
  { id: 'hue-sync-box',         name: 'Hue Play HDMI Sync Box',      brand: 'Philips', ecosystem: 'hue-sync',      category: 'tv',          protocol: ['wifi','wired'],     price: 249, power: 6,  icon: 'Tv',            modeTags: ['auto','film','party','relax'] },

  // Loxone --------------------------------------------------------------
  { id: 'loxone-miniserver',    name: 'Loxone Miniserver Gen 2',     brand: 'Loxone',  ecosystem: 'loxone',        category: 'hub',         protocol: ['wired'],            price: 799, power: 10, icon: 'Server',        modeTags: ['auto'] },

  // Fibaro --------------------------------------------------------------
  { id: 'fibaro-motion',        name: 'Fibaro Motion Sensor',        brand: 'Fibaro',  ecosystem: 'fibaro',        category: 'sensor',      protocol: ['z-wave'],           price: 69,             icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },

  // Homey ---------------------------------------------------------------
  { id: 'homey-pro',            name: 'Homey Pro',                   brand: 'Athom',   ecosystem: 'homey',         category: 'hub',         protocol: ['wifi','zigbee','z-wave','thread','matter','bt'], price: 399, power: 8, icon: 'Router', modeTags: ['auto'] },

  // Google --------------------------------------------------------------
  { id: 'google-nest-audio',    name: 'Nest Audio',                  brand: 'Google',  ecosystem: 'google-home',   category: 'speaker',     protocol: ['wifi','matter'],    price: 99,  power: 15, icon: 'Speaker',       modeTags: ['auto','morning','film','relax','party'] },
  { id: 'google-nest-hub-2',    name: 'Nest Hub (2. Gen)',           brand: 'Google',  ecosystem: 'google-home',   category: 'hub',         protocol: ['wifi','thread','matter'], price: 99, power: 6, icon: 'MonitorSmartphone', modeTags: ['auto','morning','day-office','film','relax'] },

  // Alexa ---------------------------------------------------------------
  { id: 'echo-dot-5',           name: 'Echo Dot (5. Gen)',           brand: 'Amazon',  ecosystem: 'alexa',         category: 'speaker',     protocol: ['wifi','bt'],        price: 59,  power: 12, icon: 'Speaker',       modeTags: ['auto','morning','film','relax','party'] },
  { id: 'echo-hub',             name: 'Echo Hub',                    brand: 'Amazon',  ecosystem: 'alexa',         category: 'hub',         protocol: ['wifi','zigbee','thread','matter'], price: 179, power: 8, icon: 'MonitorSmartphone', modeTags: ['auto','morning','day-office','film','relax'] },

  // Alarm & Irrigation --------------------------------------------------
  { id: 'generic-siren',        name: 'Alarm-Sirene 100dB',          brand: 'Generic', ecosystem: 'custom',        category: 'alarm',       protocol: ['wifi'],             price: 49,   power: 2, icon: 'AlertTriangle', modeTags: ['away','alarm'] },
  { id: 'gardena-irrigation',   name: 'Gardena Smart Water',         brand: 'Gardena', ecosystem: 'custom',        category: 'irrigation',  protocol: ['wifi'],             price: 129, power: 3, icon: 'Droplet',       modeTags: ['auto','away'] },

  // Appliances ----------------------------------------------------------
  { id: 'miele-xkm',            name: 'Miele XKM 3100 W',            brand: 'Miele',   ecosystem: 'custom',        category: 'appliance',   protocol: ['wifi'],             price: 89,             icon: 'ChefHat',       modeTags: ['auto'] },
  { id: 'bosch-home-connect',   name: 'Bosch Home Connect Modul',    brand: 'Bosch',   ecosystem: 'custom',        category: 'appliance',   protocol: ['wifi'],             price: 79,             icon: 'ChefHat',       modeTags: ['auto'] },

  // Kindermatte ---------------------------------------------------------
  { id: 'kindermatte-trigger',  name: 'Kindermatte Trittschalter',   brand: 'Emfit',   ecosystem: 'kindermatte',   category: 'sensor',      protocol: ['wifi'],             price: 179,            icon: 'Activity',      modeTags: ['auto','night','alarm'] },

  // ──────────────────────────────────────────────────────────────────────
  // v16 — Additional ecosystems
  // ──────────────────────────────────────────────────────────────────────

  // SwitchBot ----------------------------------------------------------
  { id: 'switchbot-bot',          name: 'SwitchBot Bot',                 brand: 'SwitchBot', ecosystem: 'switchbot', category: 'switch',      protocol: ['bt','wifi'],             price: 35,                icon: 'CircleDot',     modeTags: ['auto','morning','day-office','night'] },
  { id: 'switchbot-curtain-3',    name: 'SwitchBot Curtain 3',           brand: 'SwitchBot', ecosystem: 'switchbot', category: 'blind',       protocol: ['bt','wifi','matter'],    price: 99,                icon: 'Blinds',        modeTags: ['auto','morning','day-office','night','relax','away'] },
  { id: 'switchbot-lock-pro',     name: 'SwitchBot Lock Pro',            brand: 'SwitchBot', ecosystem: 'switchbot', category: 'lock',        protocol: ['bt','wifi','matter'],    price: 169,               icon: 'Lock',          modeTags: ['auto','night','away','alarm'] },
  { id: 'switchbot-keypad',       name: 'SwitchBot Keypad Touch',        brand: 'SwitchBot', ecosystem: 'switchbot', category: 'lock',        protocol: ['bt'],                    price: 79,                icon: 'KeyRound',      modeTags: ['auto','night','away','alarm'] },
  { id: 'switchbot-meter-plus',   name: 'SwitchBot Meter Plus',          brand: 'SwitchBot', ecosystem: 'switchbot', category: 'sensor',      protocol: ['bt','wifi'],             price: 29,                icon: 'Thermometer',   modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'switchbot-motion',       name: 'SwitchBot Motion Sensor',       brand: 'SwitchBot', ecosystem: 'switchbot', category: 'sensor',      protocol: ['bt'],                    price: 25,                icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'switchbot-contact',      name: 'SwitchBot Contact Sensor',      brand: 'SwitchBot', ecosystem: 'switchbot', category: 'sensor',      protocol: ['bt'],                    price: 22,                icon: 'DoorOpen',      modeTags: ['auto','away','alarm'] },
  { id: 'switchbot-hub-2',        name: 'SwitchBot Hub 2',               brand: 'SwitchBot', ecosystem: 'switchbot', category: 'hub',         protocol: ['wifi','bt','matter'],    price: 79,  power: 4,     icon: 'Router',        modeTags: ['auto'] },
  { id: 'switchbot-hub-mini',     name: 'SwitchBot Hub Mini',            brand: 'SwitchBot', ecosystem: 'switchbot', category: 'hub',         protocol: ['wifi','bt'],             price: 39,  power: 3,     icon: 'Router',        modeTags: ['auto'] },
  { id: 'switchbot-plug-mini',    name: 'SwitchBot Plug Mini',           brand: 'SwitchBot', ecosystem: 'switchbot', category: 'outlet',      protocol: ['wifi'],                  price: 17,                icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },
  { id: 'switchbot-strip-light',  name: 'SwitchBot LED Strip 5m',        brand: 'SwitchBot', ecosystem: 'switchbot', category: 'light',       protocol: ['wifi','bt'],             price: 35,  power: 24,    icon: 'Zap',           modeTags: ['auto','morning','film','night','relax','party','alarm'] },
  { id: 'switchbot-blind-tilt',   name: 'SwitchBot Blind Tilt',          brand: 'SwitchBot', ecosystem: 'switchbot', category: 'blind',       protocol: ['bt','wifi'],             price: 79,                icon: 'Blinds',        modeTags: ['auto','morning','day-office','night','relax','away'] },

  // Lockin G30 ----------------------------------------------------------
  { id: 'lockin-g30',             name: 'Lockin G30 Smart Lock',         brand: 'Lockin',    ecosystem: 'lockin',    category: 'lock',        protocol: ['bt','wifi'],             price: 199,               icon: 'Lock',          modeTags: ['auto','night','away','alarm'] },
  { id: 'lockin-g30-bridge',      name: 'Lockin G30 WiFi Bridge',        brand: 'Lockin',    ecosystem: 'lockin',    category: 'hub',         protocol: ['wifi','bt'],             price: 49,  power: 3,     icon: 'Router',        modeTags: ['auto'] },

  // Govee --------------------------------------------------------------
  { id: 'govee-rgbic-strip-pro',  name: 'Govee RGBIC Pro 5m',            brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 79,  power: 28,    icon: 'Zap',           modeTags: ['auto','morning','film','night','relax','party','alarm'] },
  { id: 'govee-glide-hexa',       name: 'Govee Glide Hexa Pro',          brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt','matter'],    price: 199, power: 24,    icon: 'Hexagon',       modeTags: ['auto','film','relax','party'] },
  { id: 'govee-floor-lamp',       name: 'Govee Floor Lamp Pro',          brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 199, power: 18,    icon: 'Lamp',          modeTags: ['auto','morning','day-office','film','night','relax','party'] },
  { id: 'govee-table-lamp',       name: 'Govee Table Lamp 2',            brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 79,  power: 9,     icon: 'Lamp',          modeTags: ['auto','morning','film','night','relax','party'] },
  { id: 'govee-bulb-rgbww',       name: 'Govee Smart Bulb E27 RGBWW',    brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt','matter'],    price: 19,  power: 9,     icon: 'Lightbulb',     modeTags: ['auto','morning','day-office','film','night','relax','party','alarm'] },
  { id: 'govee-permanent-outdoor',name: 'Govee Permanent Outdoor 30m',   brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 449, power: 60,    icon: 'Zap',           modeTags: ['auto','night','party','alarm'] },
  { id: 'govee-curtain-lights',   name: 'Govee Curtain Lights',          brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 199, power: 48,    icon: 'Sparkles',      modeTags: ['auto','film','relax','party'] },
  { id: 'govee-string-lights',    name: 'Govee Outdoor String Lights',   brand: 'Govee',     ecosystem: 'govee',     category: 'light',       protocol: ['wifi','bt'],             price: 99,  power: 12,    icon: 'Sparkles',      modeTags: ['auto','night','relax','party'] },

  // Smart Life ---------------------------------------------------------
  { id: 'smartlife-plug',         name: 'Smart Life WLAN-Steckdose 16A', brand: 'Smart Life', ecosystem: 'smart-life', category: 'outlet',     protocol: ['wifi'],                  price: 12,                icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },
  { id: 'smartlife-power-strip',  name: 'Smart Life 4-fach-Steckerleiste',brand: 'Smart Life', ecosystem: 'smart-life', category: 'outlet',     protocol: ['wifi'],                  price: 25,                icon: 'Plug',          modeTags: ['auto','morning','day-office','away','alarm'] },
  { id: 'smartlife-switch-1g',    name: 'Smart Life Wandschalter 1-fach',brand: 'Smart Life', ecosystem: 'smart-life', category: 'switch',     protocol: ['wifi'],                  price: 18,                icon: 'ToggleRight',   modeTags: ['auto','morning','day-office','night','relax','party'] },
  { id: 'smartlife-switch-2g',    name: 'Smart Life Wandschalter 2-fach',brand: 'Smart Life', ecosystem: 'smart-life', category: 'switch',     protocol: ['wifi'],                  price: 24,                icon: 'ToggleRight',   modeTags: ['auto','morning','day-office','night','relax','party'] },
  { id: 'smartlife-dimmer',       name: 'Smart Life Dimmer-Schalter',    brand: 'Smart Life', ecosystem: 'smart-life', category: 'switch',     protocol: ['wifi'],                  price: 22,                icon: 'CircleDot',     modeTags: ['auto','morning','film','night','relax','party'] },

  // Tuya / Smart+ -------------------------------------------------------
  { id: 'tuya-pir-motion',        name: 'Tuya PIR Bewegungssensor',      brand: 'Tuya',      ecosystem: 'tuya',      category: 'sensor',      protocol: ['wifi'],                  price: 14,                icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'tuya-mmwave',            name: 'Smart+ mmWave Präsenzsensor',   brand: 'Smart+',    ecosystem: 'tuya',      category: 'sensor',      protocol: ['wifi','zigbee'],         price: 39,  power: 2,     icon: 'Radar',         modeTags: ['auto','morning','day-office','night','away','alarm'] },
  { id: 'tuya-motion-zigbee',     name: 'Smart+ Zigbee Bewegungssensor', brand: 'Smart+',    ecosystem: 'tuya',      category: 'sensor',      protocol: ['zigbee'],                price: 12,                icon: 'Radar',         modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'tuya-door-window',       name: 'Tuya Tür-/Fenstersensor',       brand: 'Tuya',      ecosystem: 'tuya',      category: 'sensor',      protocol: ['wifi'],                  price: 11,                icon: 'DoorOpen',      modeTags: ['auto','away','alarm'] },

  // Osaio Cameras ------------------------------------------------------
  { id: 'osaio-indoor-2k',        name: 'Osaio Indoor Cam 2K',           brand: 'Osaio',     ecosystem: 'osaio',     category: 'camera',      protocol: ['wifi'],                  price: 39,  power: 4,     icon: 'Cctv',          modeTags: ['away','alarm'] },
  { id: 'osaio-outdoor-4mp',      name: 'Osaio Outdoor 4MP PTZ',         brand: 'Osaio',     ecosystem: 'osaio',     category: 'camera',      protocol: ['wifi'],                  price: 79,  power: 7,     icon: 'Cctv',          modeTags: ['away','alarm'] },
  { id: 'osaio-doorbell',         name: 'Osaio Video-Türklingel',        brand: 'Osaio',     ecosystem: 'osaio',     category: 'camera',      protocol: ['wifi'],                  price: 99,  power: 4,     icon: 'Cctv',          modeTags: ['away','alarm'] },

  // Arenti Cameras -----------------------------------------------------
  { id: 'arenti-go1',             name: 'Arenti GO1 4G/Akku',            brand: 'Arenti',    ecosystem: 'arenti',    category: 'camera',      protocol: ['wifi'],                  price: 119, power: 5,     icon: 'Cctv',          modeTags: ['away','alarm'] },
  { id: 'arenti-in1q',            name: 'Arenti IN1Q Indoor 4MP',        brand: 'Arenti',    ecosystem: 'arenti',    category: 'camera',      protocol: ['wifi'],                  price: 49,  power: 4,     icon: 'Cctv',          modeTags: ['away','alarm'] },
  { id: 'arenti-out6q',           name: 'Arenti OUT6Q Outdoor PTZ',      brand: 'Arenti',    ecosystem: 'arenti',    category: 'camera',      protocol: ['wifi'],                  price: 89,  power: 8,     icon: 'Cctv',          modeTags: ['away','alarm'] },
]
