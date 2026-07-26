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

  // ── v56 — Katalog-Ausbau: reale Geräte über alle Ökosysteme ──────────
  // Philips Hue (Bridge-gebunden)
  { id: 'hue-play-bar',           name: 'Hue Play Lightbar (Doppelpack)', brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee'],          price: 130, power: 12, requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','film','night','relax','party'] },
  { id: 'hue-go-2',               name: 'Hue Go tragbare Leuchte',        brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee','bt'],     price: 90,  power: 6,  requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','film','night','relax','party'] },
  { id: 'hue-signe-floor',        name: 'Hue Signe Gradient Stehleuchte', brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee'],          price: 300, power: 29, requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','morning','film','night','relax','party'] },
  { id: 'hue-iris',               name: 'Hue Iris Tischleuchte',          brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee'],          price: 90,  power: 10, requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','film','night','relax','party'] },
  { id: 'hue-ambiance-ceiling',   name: 'Hue Enrave Deckenleuchte',       brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee'],          price: 180, power: 33, requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','morning','day-office','film','night','relax'] },
  { id: 'hue-filament-e27',       name: 'Hue Filament E27',               brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee','bt'],     price: 30,  power: 7,  requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','morning','film','night','relax','party'] },
  { id: 'hue-lily-outdoor',       name: 'Hue Lily Outdoor Spot (3er)',    brand: 'Philips',  ecosystem: 'philips-hue',   category: 'light',   protocol: ['zigbee'],          price: 280, power: 24, requires: ['hue-bridge'], icon: 'Lightbulb', modeTags: ['auto','night','relax','party','away'] },
  { id: 'hue-tap-dial',           name: 'Hue Tap Dial Switch',            brand: 'Philips',  ecosystem: 'philips-hue',   category: 'switch',  protocol: ['zigbee'],          price: 50,             requires: ['hue-bridge'], icon: 'CircleDot', modeTags: ['auto','morning','film','night','relax','party'] },
  { id: 'hue-wall-module',        name: 'Hue Wandschalter-Modul',         brand: 'Philips',  ecosystem: 'philips-hue',   category: 'switch',  protocol: ['zigbee'],          price: 40,             requires: ['hue-bridge'], icon: 'CircleDot', modeTags: ['auto','morning','night','relax'] },

  // Aqara
  { id: 'aqara-temp-humid',       name: 'Aqara Temp-/Feuchtesensor',      brand: 'Aqara',    ecosystem: 'aqara',         category: 'sensor',  protocol: ['zigbee'],          price: 19,             icon: 'Thermometer', modeTags: ['auto','morning','away'] },
  { id: 'aqara-water-leak',       name: 'Aqara Wassermelder',             brand: 'Aqara',    ecosystem: 'aqara',         category: 'sensor',  protocol: ['zigbee'],          price: 22,             icon: 'Droplet', modeTags: ['auto','away','alarm'] },
  { id: 'aqara-cube-t1',          name: 'Aqara Cube T1 Pro',              brand: 'Aqara',    ecosystem: 'aqara',         category: 'switch',  protocol: ['zigbee'],          price: 25,             icon: 'CircleDot', modeTags: ['auto','film','night','relax','party'] },
  { id: 'aqara-roller-e1',        name: 'Aqara Rollo-Antrieb E1',         brand: 'Aqara',    ecosystem: 'aqara',         category: 'blind',   protocol: ['zigbee'],          price: 79,             icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'aqara-u100-lock',        name: 'Aqara Smart Lock U100',          brand: 'Aqara',    ecosystem: 'aqara',         category: 'lock',    protocol: ['bt','thread','matter'], price: 189,      icon: 'Lock', modeTags: ['auto','away','alarm','night'] },
  { id: 'aqara-g3-cam',           name: 'Aqara Camera Hub G3',            brand: 'Aqara',    ecosystem: 'aqara',         category: 'camera',  protocol: ['wifi'],            price: 109, power: 5,  icon: 'Cctv', modeTags: ['away','alarm'] },
  { id: 'aqara-smart-plug-eu',    name: 'Aqara Smart Plug EU',            brand: 'Aqara',    ecosystem: 'aqara',         category: 'outlet',  protocol: ['zigbee'],          price: 25,  power: 1,  icon: 'Plug', modeTags: ['auto','away'] },

  // Shelly
  { id: 'shelly-plus-1',          name: 'Shelly Plus 1',                  brand: 'Shelly',   ecosystem: 'shelly',        category: 'switch',  protocol: ['wifi','bt'],       price: 18,  power: 1,  icon: 'CircleDot', modeTags: ['auto','morning','night','relax'] },
  { id: 'shelly-plus-i4',         name: 'Shelly Plus i4 Szenentaster',    brand: 'Shelly',   ecosystem: 'shelly',        category: 'switch',  protocol: ['wifi'],            price: 16,             icon: 'CircleDot', modeTags: ['auto','morning','night','relax','party'] },
  { id: 'shelly-ht-g3',           name: 'Shelly H&T Gen3',                brand: 'Shelly',   ecosystem: 'shelly',        category: 'sensor',  protocol: ['wifi','bt'],       price: 29,             icon: 'Thermometer', modeTags: ['auto','morning','away'] },
  { id: 'shelly-plus-plug-s',     name: 'Shelly Plus Plug S',             brand: 'Shelly',   ecosystem: 'shelly',        category: 'outlet',  protocol: ['wifi'],            price: 19,  power: 1,  icon: 'Plug', modeTags: ['auto','away'] },
  { id: 'shelly-motion-2',        name: 'Shelly Motion 2',                brand: 'Shelly',   ecosystem: 'shelly',        category: 'sensor',  protocol: ['wifi'],            price: 30,             icon: 'Radar', modeTags: ['auto','morning','night','away','alarm'] },
  { id: 'shelly-plus-rgbw',       name: 'Shelly Plus RGBW PM',            brand: 'Shelly',   ecosystem: 'shelly',        category: 'light',   protocol: ['wifi'],            price: 25,  power: 4,  icon: 'Zap', modeTags: ['auto','film','night','relax','party'] },
  { id: 'shelly-2pm-cover',       name: 'Shelly Plus 2PM Rollladen',      brand: 'Shelly',   ecosystem: 'shelly',        category: 'blind',   protocol: ['wifi'],            price: 26,             icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },

  // Eve
  { id: 'eve-aqua',               name: 'Eve Aqua Bewässerung',           brand: 'Eve',      ecosystem: 'eve',           category: 'irrigation', protocol: ['thread','matter'], price: 99,          icon: 'Droplet', modeTags: ['auto','away'] },
  { id: 'eve-room',               name: 'Eve Room Luftqualität',          brand: 'Eve',      ecosystem: 'eve',           category: 'sensor',  protocol: ['thread','matter'], price: 99,             icon: 'Gauge', modeTags: ['auto','morning','day-office'] },
  { id: 'eve-water-guard',        name: 'Eve Water Guard',                brand: 'Eve',      ecosystem: 'eve',           category: 'sensor',  protocol: ['thread','matter'], price: 89,             icon: 'Droplet', modeTags: ['auto','away','alarm'] },
  { id: 'eve-weather',            name: 'Eve Weather',                    brand: 'Eve',      ecosystem: 'eve',           category: 'sensor',  protocol: ['thread','matter'], price: 69,             icon: 'Gauge', modeTags: ['auto','morning'] },
  { id: 'eve-motionblinds',       name: 'Eve MotionBlinds',               brand: 'Eve',      ecosystem: 'eve',           category: 'blind',   protocol: ['thread','matter'], price: 329,            icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },

  // IKEA Dirigera
  { id: 'ikea-rodret',            name: 'Rodret Dimmer/Schalter',         brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'switch',  protocol: ['zigbee','matter'], price: 6,              icon: 'CircleDot', modeTags: ['auto','morning','night','relax'] },
  { id: 'ikea-parasoll',          name: 'Parasoll Tür-/Fenstersensor',    brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'sensor',  protocol: ['zigbee','matter'], price: 8,              icon: 'DoorOpen', modeTags: ['auto','away','alarm'] },
  { id: 'ikea-badring',           name: 'Badring Wassermelder',           brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'sensor',  protocol: ['zigbee'],          price: 10,             icon: 'Droplet', modeTags: ['auto','away','alarm'] },
  { id: 'ikea-starkvind',         name: 'Starkvind Luftreiniger',         brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'appliance', protocol: ['zigbee'],        price: 129, power: 25, icon: 'Wind', modeTags: ['auto','day-office','night','away'] },
  { id: 'ikea-fyrtur',            name: 'Fyrtur Rollo',                   brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'blind',   protocol: ['zigbee'],          price: 129,            icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'ikea-symfonisk-2',       name: 'Symfonisk Regal-Lautsprecher',   brand: 'IKEA',     ecosystem: 'sonos',         category: 'speaker', protocol: ['wifi'],            price: 119, power: 12, icon: 'Speaker', modeTags: ['auto','morning','film','relax','party'] },
  { id: 'ikea-inspelning-plug',   name: 'Inspelning Zwischenstecker',     brand: 'IKEA',     ecosystem: 'ikea-dirigera', category: 'outlet',  protocol: ['zigbee','matter'], price: 12,  power: 1,  icon: 'Plug', modeTags: ['auto','away'] },

  // Sonos
  { id: 'sonos-era-100',          name: 'Sonos Era 100',                  brand: 'Sonos',    ecosystem: 'sonos',         category: 'speaker', protocol: ['wifi','bt'],       price: 279, power: 20, icon: 'Speaker', modeTags: ['auto','morning','film','relax','party'] },
  { id: 'sonos-beam-2',           name: 'Sonos Beam (Gen 2)',             brand: 'Sonos',    ecosystem: 'sonos',         category: 'speaker', protocol: ['wifi'],            price: 499, power: 28, icon: 'Speaker', modeTags: ['auto','film','party'] },
  { id: 'sonos-roam-2',           name: 'Sonos Roam 2',                   brand: 'Sonos',    ecosystem: 'sonos',         category: 'speaker', protocol: ['wifi','bt'],       price: 199, power: 8,  icon: 'Speaker', modeTags: ['auto','relax','party'] },
  { id: 'sonos-sub-4',            name: 'Sonos Sub (Gen 4)',              brand: 'Sonos',    ecosystem: 'sonos',         category: 'speaker', protocol: ['wifi'],            price: 899, power: 40, icon: 'Speaker', modeTags: ['auto','film','party'] },

  // Tado / Netatmo (Klima)
  { id: 'tado-x-thermostat',      name: 'Tado° X Thermostat',             brand: 'tado',     ecosystem: 'tado',          category: 'climate', protocol: ['thread','matter'], price: 130, power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'tado-x-valve',           name: 'Tado° X Heizkörper-Thermostat',  brand: 'tado',     ecosystem: 'tado',          category: 'climate', protocol: ['thread','matter'], price: 90,  power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'netatmo-thermostat',     name: 'Netatmo Smartes Thermostat',     brand: 'Netatmo',  ecosystem: 'netatmo',       category: 'climate', protocol: ['wifi'],            price: 179, power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'netatmo-outdoor-cam',    name: 'Netatmo Präsenz Außenkamera',    brand: 'Netatmo',  ecosystem: 'netatmo',       category: 'camera',  protocol: ['wifi'],            price: 299, power: 9,  icon: 'Cctv', modeTags: ['away','alarm'] },

  // Bosch Smart Home
  { id: 'bosch-controller-2',     name: 'Bosch Smart Home Controller II', brand: 'Bosch',    ecosystem: 'bosch-sh',      category: 'hub',     protocol: ['zigbee','thread','wired'], price: 129, power: 4, icon: 'Router', modeTags: ['auto'] },
  { id: 'bosch-radiator-2',       name: 'Bosch Heizkörper-Thermostat II', brand: 'Bosch',    ecosystem: 'bosch-sh',      category: 'climate', protocol: ['zigbee'],          price: 60,  power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'bosch-door-window-2',    name: 'Bosch Tür-/Fensterkontakt II',   brand: 'Bosch',    ecosystem: 'bosch-sh',      category: 'sensor',  protocol: ['zigbee'],          price: 35,             icon: 'DoorOpen', modeTags: ['auto','away','alarm'] },
  { id: 'bosch-plug-compact',     name: 'Bosch Zwischenstecker compact',  brand: 'Bosch',    ecosystem: 'bosch-sh',      category: 'outlet',  protocol: ['zigbee'],          price: 40,  power: 1,  icon: 'Plug', modeTags: ['auto','away'] },
  { id: 'bosch-eyes-outdoor',     name: 'Bosch Eyes Außenkamera',         brand: 'Bosch',    ecosystem: 'bosch-sh',      category: 'camera',  protocol: ['wifi'],            price: 199, power: 8,  icon: 'Cctv', modeTags: ['away','alarm'] },

  // Nuki / SwitchBot (Schließen)
  { id: 'nuki-lock-4',            name: 'Nuki Smart Lock (4. Gen)',       brand: 'Nuki',     ecosystem: 'nuki',          category: 'lock',    protocol: ['bt','wifi','thread','matter'], price: 179, icon: 'Lock', modeTags: ['auto','away','alarm','night'] },
  { id: 'nuki-opener',            name: 'Nuki Opener (Türsummer)',        brand: 'Nuki',     ecosystem: 'nuki',          category: 'lock',    protocol: ['bt','wifi'],       price: 99,             icon: 'Lock', modeTags: ['auto','away'] },
  { id: 'switchbot-meter',        name: 'SwitchBot Thermo-Hygrometer',    brand: 'SwitchBot',ecosystem: 'switchbot',     category: 'sensor',  protocol: ['bt'],              price: 15,             icon: 'Thermometer', modeTags: ['auto','morning'] },

  // Govee
  { id: 'govee-neon-rope-2',      name: 'Govee Neon Rope Light 2',        brand: 'Govee',    ecosystem: 'govee',         category: 'light',   protocol: ['wifi','bt'],       price: 80,  power: 24, icon: 'Zap', modeTags: ['auto','film','night','relax','party'] },
  { id: 'govee-lyra-lamp',        name: 'Govee Lyra Stehleuchte',         brand: 'Govee',    ecosystem: 'govee',         category: 'light',   protocol: ['wifi','bt'],       price: 100, power: 15, icon: 'Lightbulb', modeTags: ['auto','film','night','relax','party'] },
  { id: 'govee-tv-backlight-3',   name: 'Govee TV-Backlight 3 Lite',      brand: 'Govee',    ecosystem: 'govee',         category: 'light',   protocol: ['wifi','bt'],       price: 60,  power: 12, icon: 'Zap', modeTags: ['auto','film','night','relax','party'] },
  { id: 'govee-outdoor-string-2', name: 'Govee Outdoor String Light 2',   brand: 'Govee',    ecosystem: 'govee',         category: 'light',   protocol: ['wifi','bt'],       price: 90,  power: 15, icon: 'Zap', modeTags: ['auto','night','relax','party','away'] },
  { id: 'govee-hexa-panel',       name: 'Govee Glide Hexa Pro Panels',    brand: 'Govee',    ecosystem: 'govee',         category: 'light',   protocol: ['wifi','bt'],       price: 200, power: 30, icon: 'Zap', modeTags: ['auto','film','night','relax','party'] },

  // Google Home / Alexa
  { id: 'google-nest-hub-max',    name: 'Nest Hub Max',                   brand: 'Google',   ecosystem: 'google-home',   category: 'hub',     protocol: ['wifi','thread'],   price: 229, power: 12, icon: 'Router', modeTags: ['auto','morning','film','relax'] },
  { id: 'google-nest-protect',    name: 'Nest Protect (Rauch/CO)',        brand: 'Google',   ecosystem: 'google-home',   category: 'sensor',  protocol: ['wifi'],            price: 119, power: 1,  icon: 'Flame', modeTags: ['auto','away','alarm'] },
  { id: 'google-nest-thermostat', name: 'Nest Thermostat',                brand: 'Google',   ecosystem: 'google-home',   category: 'climate', protocol: ['wifi','thread'],   price: 130, power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'google-nest-doorbell',   name: 'Nest Doorbell (batt.)',          brand: 'Google',   ecosystem: 'google-home',   category: 'camera',  protocol: ['wifi'],            price: 189, power: 4,  icon: 'Cctv', modeTags: ['away','alarm'] },
  { id: 'google-chromecast-tv',   name: 'Chromecast mit Google TV 4K',    brand: 'Google',   ecosystem: 'google-home',   category: 'tv',      protocol: ['wifi'],            price: 69,  power: 5,  icon: 'Tv', modeTags: ['auto','film','party'] },
  { id: 'alexa-echo-show-8',      name: 'Echo Show 8',                    brand: 'Amazon',   ecosystem: 'alexa',         category: 'hub',     protocol: ['wifi','zigbee','matter'], price: 150, power: 10, icon: 'Router', modeTags: ['auto','morning','film','relax'] },
  { id: 'alexa-echo-pop',         name: 'Echo Pop',                       brand: 'Amazon',   ecosystem: 'alexa',         category: 'speaker', protocol: ['wifi','bt'],       price: 55,  power: 5,  icon: 'Speaker', modeTags: ['auto','morning','relax','party'] },
  { id: 'alexa-echo-hub',         name: 'Echo Hub (Wandpanel)',           brand: 'Amazon',   ecosystem: 'alexa',         category: 'hub',     protocol: ['wifi','zigbee','thread','matter'], price: 190, power: 6, icon: 'Router', modeTags: ['auto'] },

  // Lutron / Fibaro / SmartThings / Fritz / Loxone
  { id: 'lutron-serena-shade',    name: 'Lutron Serena Rollo',            brand: 'Lutron',   ecosystem: 'lutron',        category: 'blind',   protocol: ['wired'],           price: 380,            icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'lutron-caseta-hub',      name: 'Lutron Caséta Smart Hub',        brand: 'Lutron',   ecosystem: 'lutron',        category: 'hub',     protocol: ['wired','wifi'],    price: 90,  power: 3,  icon: 'Router', modeTags: ['auto'] },
  { id: 'fibaro-flood',           name: 'Fibaro Flood Sensor',            brand: 'Fibaro',   ecosystem: 'fibaro',        category: 'sensor',  protocol: ['z-wave'],          price: 60,             icon: 'Droplet', modeTags: ['auto','away','alarm'] },
  { id: 'fibaro-roller-3',        name: 'Fibaro Roller Shutter 3',        brand: 'Fibaro',   ecosystem: 'fibaro',        category: 'blind',   protocol: ['z-wave'],          price: 60,             icon: 'Blinds', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'smartthings-multi',      name: 'SmartThings Multipurpose Sensor',brand: 'Samsung',  ecosystem: 'samsung-smartthings', category: 'sensor', protocol: ['zigbee'],    price: 25,             icon: 'DoorOpen', modeTags: ['auto','away','alarm'] },
  { id: 'fritz-dect-301',         name: 'FRITZ!DECT 301 Heizkörper',      brand: 'AVM',      ecosystem: 'fritzbox',      category: 'climate', protocol: ['wired'],           price: 55,  power: 2,  icon: 'Thermometer', modeTags: ['auto','morning','day-office','night','away'] },
  { id: 'fritz-dect-500',         name: 'FRITZ!DECT 500 Lampe',           brand: 'AVM',      ecosystem: 'fritzbox',      category: 'light',   protocol: ['wired'],           price: 20,  power: 9,  icon: 'Lightbulb', modeTags: ['auto','morning','film','night','relax'] },
  { id: 'loxone-touch',           name: 'Loxone Touch Taster',            brand: 'Loxone',   ecosystem: 'loxone',        category: 'switch',  protocol: ['wired'],           price: 130,            icon: 'CircleDot', modeTags: ['auto','morning','night','relax'] },

  // Smart Life / Tuya / Custom
  { id: 'smartlife-bulb-rgb',     name: 'Smart Life RGBCCT Lampe',        brand: 'Smart Life',ecosystem: 'smart-life',   category: 'light',   protocol: ['wifi'],            price: 10,  power: 9,  icon: 'Lightbulb', modeTags: ['auto','morning','film','night','relax','party'] },
  { id: 'smartlife-ir-hub',       name: 'Smart Life IR-Universalhub',     brand: 'Smart Life',ecosystem: 'smart-life',   category: 'hub',     protocol: ['wifi'],            price: 20,  power: 1,  icon: 'Router', modeTags: ['auto'] },
  { id: 'smartlife-water-valve',  name: 'Smart Life Bewässerungsventil',  brand: 'Smart Life',ecosystem: 'smart-life',   category: 'irrigation', protocol: ['wifi','zigbee'], price: 35,          icon: 'Droplet', modeTags: ['auto','away'] },
  { id: 'tuya-siren',             name: 'Tuya Alarm-Sirene',              brand: 'Tuya',     ecosystem: 'tuya',          category: 'alarm',   protocol: ['wifi','zigbee'],   price: 25,  power: 2,  icon: 'Siren', modeTags: ['away','alarm'] },
  { id: 'lg-oled-c4',             name: 'LG OLED evo C4 (webOS)',         brand: 'LG',       ecosystem: 'custom',        category: 'tv',      protocol: ['wifi','wired'],    price: 1500, power: 120, icon: 'Tv', modeTags: ['auto','film','party'] },
  { id: 'samsung-the-frame',      name: 'Samsung The Frame (Tizen)',      brand: 'Samsung',  ecosystem: 'custom',        category: 'tv',      protocol: ['wifi','wired'],    price: 1300, power: 110, icon: 'Tv', modeTags: ['auto','film','party'] },
]
