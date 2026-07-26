/**
 * voiceCommands.ts — natural-language → Digital-Twin commands.
 *
 * The brain behind the in-app voice control ("Alexa/Siri"-style): it turns a
 * spoken German (or simple English) phrase into concrete `DeviceCommand`s
 * against the live devices, plus a spoken-back confirmation. Pure and
 * renderer-free — the Web Speech API lives in the UI, the *understanding*
 * lives here and is fully testable. No cloud, no vendor: the same neutral twin
 * every connector feeds.
 *
 * Supported intents: on/off (lights, plugs — per room, per device, or all),
 * cover up/down or to a percent, lock/unlock, vacuum start/pause/dock, an
 * absolute brightness set ("auf 40 %") and a relative one ("heller"/"dunkler"),
 * and colour-temperature warm/cool ("wärmer"/"kälter").
 */

import type { Device, DeviceCommand } from '@/domain'
import { findCapability } from '@/domain'

export interface VoiceResult {
  commands: DeviceCommand[]
  /** German confirmation to speak / show back. */
  reply: string
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim()

const roomOf = (d: Device): string | undefined => d.metadata?.room

/** Which capability keyword the phrase targets (light / plug / cover / …). */
function typeMatches(text: string, d: Device): boolean {
  const has = (k: string) => text.includes(k)
  if (has('licht') || has('lampe') || has('lampen') || has('lights') || has('beleuchtung')) return d.category === 'light'
  if (has('steckdose') || has('stecker') || has('plug')) return d.category === 'energy'
  if (has('rollo') || has('rolladen') || has('rollladen') || has('jalousie') || has('vorhang') || has('cover')) return d.category === 'cover'
  if (has('schloss') || has('tür') || has('tuer') || has('lock')) return d.category === 'lock'
  if (has('sauger') || has('roboter') || has('staubsauger') || has('vacuum')) return !!findCapability(d.capabilities, 'Vacuum')
  return false
}

const roomMatches = (text: string, d: Device): boolean => {
  const r = roomOf(d)
  return !!r && text.includes(norm(r))
}

/** All distinct room names present across the devices (for "welche Räume"). */
export function knownRooms(devices: Device[]): string[] {
  return [...new Set(devices.map(roomOf).filter((r): r is string => !!r))]
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * Parse one spoken phrase into twin commands + a reply, given the live devices.
 * Returns null when nothing actionable was understood.
 */
export function parseVoiceCommand(transcript: string, devices: Device[]): VoiceResult | null {
  const t = norm(transcript)
  if (!t) return null

  const all = /\balle[sn]?\b|gesamt|überall|komplett/.test(t)
  const anyType = /licht|lampe|lampen|lights|beleuchtung|steckdose|stecker|plug|rollo|roll?laden|jalousie|vorhang|cover|schloss|tür|tuer|lock|sauger|roboter|staubsauger|vacuum/.test(t)
  const anyRoom = devices.some((d) => roomMatches(t, d))

  // Pick the devices the phrase addresses.
  const target = (predicate: (d: Device) => boolean): Device[] => devices.filter(predicate)
  const scoped = (base: (d: Device) => boolean): Device[] => {
    if (all && !anyRoom && !anyType) return target(base)
    return target((d) => base(d) && (!anyRoom || roomMatches(t, d)) && (!anyType || typeMatches(t, d)))
  }

  // ── Vacuum ───────────────────────────────────────────────────────────
  if (/sauger|staubsauger|saugroboter|roboter|vacuum/.test(t)) {
    const vac = devices.find((d) => findCapability(d.capabilities, 'Vacuum'))
    if (vac) {
      if (/stopp|stop|pause|anhalten|halt/.test(t)) return { commands: [{ deviceId: vac.id, capability: 'Vacuum', payload: { activity: 'idle' } }], reply: 'Saugroboter pausiert.' }
      if (/station|dock|hause|heim|zurück|laden/.test(t)) return { commands: [{ deviceId: vac.id, capability: 'Vacuum', payload: { activity: 'returning' } }], reply: 'Saugroboter kehrt zur Station zurück.' }
      if (/saug|reinig|start|los|putz|wisch/.test(t)) return { commands: [{ deviceId: vac.id, capability: 'Vacuum', payload: { activity: 'cleaning' } }], reply: 'Saugroboter gestartet.' }
    }
  }

  // ── Unlock / lock ── unlock first: "aufschließen" contains "schließ", so
  //    the lock branch would otherwise swallow it. ────────────────────────
  if (/entriegel|aufschließ|aufschliess|aufsperr|entsperr|entriegle/.test(t) || (/schloss|tür|tuer|lock/.test(t) && /\bauf\b|öffn/.test(t))) {
    const locks = scoped((d) => !!findCapability(d.capabilities, 'Lock'))
    if (locks.length) return { commands: locks.map((d) => ({ deviceId: d.id, capability: 'Lock' as const, payload: { locked: false } })), reply: `${plural(locks.length, 'Schloss entriegelt', 'Schlösser entriegelt')}.` }
  }
  if (/verriegel|abschließ|abschliess|zusperr|sperr|verschließ|verriegle/.test(t) || (/schloss|tür|tuer|lock/.test(t) && /\bzu\b|schließ|schliess/.test(t))) {
    const locks = scoped((d) => !!findCapability(d.capabilities, 'Lock'))
    if (locks.length) return { commands: locks.map((d) => ({ deviceId: d.id, capability: 'Lock' as const, payload: { locked: true } })), reply: `${plural(locks.length, 'Schloss verriegelt', 'Schlösser verriegelt')}.` }
  }

  // ── Covers (rollo/jalousie) ───────────────────────────────────────────
  if (/rollo|roll?laden|jalousie|vorhang|cover/.test(t)) {
    const covers = scoped((d) => !!findCapability(d.capabilities, 'Position'))
    if (covers.length) {
      // "Rollo auf 50 prozent" — a specific position, not just fully up/down.
      const cpm = t.match(/(\d{1,3})\s*(prozent|%)/)
      if (cpm) {
        const percent = Math.max(0, Math.min(100, parseInt(cpm[1], 10)))
        return {
          commands: covers.map((d) => ({ deviceId: d.id, capability: 'Position' as const, payload: { percent } })),
          reply: `${plural(covers.length, 'Rollo', 'Rollos')} auf ${percent}%.`,
        }
      }
      const down = /\bzu\b|runter|herunter|schließ|schliess|dunkel|ab\b/.test(t)
      const pct = down ? 0 : 100
      return {
        commands: covers.map((d) => ({ deviceId: d.id, capability: 'Position' as const, payload: { percent: pct } })),
        reply: `${plural(covers.length, 'Rollo', 'Rollos')} ${down ? 'geschlossen' : 'geöffnet'}.`,
      }
    }
  }

  // ── Brightness set ("… auf 40 prozent") ──────────────────────────────
  const pctMatch = t.match(/(\d{1,3})\s*(prozent|%)/)
  if (pctMatch && /licht|lampe|hell|dimm/.test(t)) {
    const percent = Math.max(0, Math.min(100, parseInt(pctMatch[1], 10)))
    const lights = scoped((d) => !!findCapability(d.capabilities, 'Brightness'))
    if (lights.length) return { commands: lights.map((d) => ({ deviceId: d.id, capability: 'Brightness' as const, payload: { percent } })), reply: `${plural(lights.length, 'Licht', 'Lichter')} auf ${percent}%.` }
  }

  // ── Relative brightness ("heller" / "dunkler") — step from current ────
  if (!pctMatch && /heller|dunkler|abdunkeln|aufhellen|dimm\w*\s*(hoch|runter|rauf|höher|hoeher|niedriger)/.test(t)) {
    const up = /heller|aufhellen|\bhoch\b|rauf|höher|hoeher/.test(t)
    const lights = scoped((d) => !!findCapability(d.capabilities, 'Brightness'))
    if (lights.length) {
      const step = 25
      return {
        commands: lights.map((d) => {
          const cur = findCapability(d.capabilities, 'Brightness')?.percent ?? 50
          const percent = Math.max(0, Math.min(100, up ? cur + step : cur - step))
          return { deviceId: d.id, capability: 'Brightness' as const, payload: { percent } }
        }),
        reply: `${plural(lights.length, 'Licht', 'Lichter')} ${up ? 'heller' : 'dunkler'}.`,
      }
    }
  }

  // ── Colour temperature ("wärmer" / "kälter" / "warmweiß" / "kaltweiß") ─
  if (/wärmer|waermer|kälter|kaelter|warmwei|kaltwei|gemütlich|gemuetlich/.test(t)) {
    const warm = /wärmer|waermer|warmwei|gemütlich|gemuetlich/.test(t)
    const lights = scoped((d) => !!findCapability(d.capabilities, 'ColorTemperature'))
    if (lights.length) {
      const stepK = 800
      return {
        commands: lights.map((d) => {
          const c = findCapability(d.capabilities, 'ColorTemperature')
          const cur = c?.kelvin ?? 3000
          const kelvin = warm
            ? Math.max(c?.minKelvin ?? 2200, cur - stepK)
            : Math.min(c?.maxKelvin ?? 6500, cur + stepK)
          return { deviceId: d.id, capability: 'ColorTemperature' as const, payload: { kelvin } }
        }),
        reply: `${plural(lights.length, 'Licht', 'Lichter')} ${warm ? 'wärmer' : 'kälter'}.`,
      }
    }
  }

  // ── On / off (lights + plugs) ─────────────────────────────────────────
  const wantsOff = /\baus\b|ausschalten|ausmachen|abschalten|aus machen|off\b/.test(t)
  const wantsOn = !wantsOff && /\ban\b|\bein\b|einschalten|anmachen|anschalten|an machen|on\b|licht an/.test(t)
  if (wantsOn || wantsOff) {
    const onoff = scoped((d) => !!findCapability(d.capabilities, 'OnOff'))
    if (onoff.length) {
      return {
        commands: onoff.map((d) => ({ deviceId: d.id, capability: 'OnOff' as const, payload: { on: wantsOn } })),
        reply: `${plural(onoff.length, 'Gerät', 'Geräte')} ${wantsOn ? 'eingeschaltet' : 'ausgeschaltet'}.`,
      }
    }
  }

  return null
}
