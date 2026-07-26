import type { PlanDocument, DeviceCatalogEntry, Ecosystem } from '@/types'

/**
 * ecosystemAudit.ts — the renderer-neutral **ecosystem-readiness domain**.
 *
 * Answers "will this smart home actually run?" from the placed devices alone:
 * which ecosystems are in play, whether each Zigbee/Z-Wave ecosystem has its
 * required hub/bridge, whether Thread devices have a border router, how many
 * single points of failure there are and whether the setup has sprawled across
 * too many islands. Pure — catalog via injected `entryOf` — so it is unit
 * testable and shared by every surface. Findings are advisory, ranked by severity.
 */

export interface AuditOptions {
  entryOf: (deviceId: string) => DeviceCatalogEntry | undefined
}

export type AuditSeverity = 'error' | 'warning' | 'info'

export interface AuditFinding {
  severity: AuditSeverity
  title: string
  detail: string
}

export interface EcosystemLine {
  ecosystem: Ecosystem
  label: string
  count: number
  hubCount: number
}

export interface AuditReport {
  deviceCount: number
  ecosystemCount: number
  ecosystems: EcosystemLine[]
  protocolMix: { protocol: string; count: number }[]
  matterCount: number
  findings: AuditFinding[]
}

const ECOSYSTEM_LABEL: Partial<Record<Ecosystem, string>> = {
  'apple-home': 'Apple Home', 'google-home': 'Google Home', 'alexa': 'Amazon Alexa',
  'home-assistant': 'Home Assistant', 'matter': 'Matter', 'philips-hue': 'Philips Hue',
  'ikea-dirigera': 'IKEA Dirigera', 'aqara': 'Aqara', 'shelly': 'Shelly', 'sonos': 'Sonos',
  'eve': 'Eve', 'samsung-smartthings': 'SmartThings', 'lutron': 'Lutron', 'nuki': 'Nuki',
  'tado': 'tado°', 'bosch-sh': 'Bosch Smart Home', 'netatmo': 'Netatmo', 'fritzbox': 'FRITZ!',
  'homey': 'Homey', 'fibaro': 'Fibaro', 'loxone': 'Loxone', 'switchbot': 'SwitchBot',
  'govee': 'Govee', 'tuya': 'Tuya', 'smart-life': 'Smart Life', 'osaio': 'Osaio',
  'arenti': 'Arenti', 'lockin': 'Lockin', 'custom': 'Sonstige',
}
const labelEco = (e: Ecosystem) => ECOSYSTEM_LABEL[e] ?? e

/** Protocols that cannot reach a phone/cloud without a bridge of their own. */
const BRIDGE_BOUND = new Set(['zigbee', 'z-wave'])

interface EcoAgg { count: number; hubCount: number; needsBridge: boolean; hasThread: boolean }

/** Audit a plan's device mix for hubs, bridges, border routers and sprawl. */
export function auditEcosystems(doc: PlanDocument, opts: AuditOptions): AuditReport {
  const eco = new Map<Ecosystem, EcoAgg>()
  const proto = new Map<string, number>()
  let deviceCount = 0, matterCount = 0
  let threadRouters = 0, threadDevices = 0

  for (const floor of doc.floors) {
    for (const placed of floor.devices) {
      const entry = opts.entryOf(placed.deviceId)
      if (!entry) continue
      deviceCount++
      const a = eco.get(entry.ecosystem) ?? { count: 0, hubCount: 0, needsBridge: false, hasThread: false }
      a.count++
      if (entry.category === 'hub') a.hubCount++
      const protos = entry.protocol ?? []
      for (const p of protos) proto.set(p, (proto.get(p) ?? 0) + 1)
      if (protos.some((p) => BRIDGE_BOUND.has(p)) && entry.category !== 'hub') a.needsBridge = true
      if (protos.includes('matter')) matterCount++
      if (protos.includes('thread')) {
        threadDevices++
        a.hasThread = true
        // Hubs/speakers that speak Thread double as border routers.
        if (entry.category === 'hub' || entry.category === 'speaker') threadRouters++
      }
      eco.set(entry.ecosystem, a)
    }
  }

  const ecosystems: EcosystemLine[] = [...eco.entries()]
    .map(([e, a]) => ({ ecosystem: e, label: labelEco(e), count: a.count, hubCount: a.hubCount }))
    .sort((x, y) => y.count - x.count)

  const protocolMix = [...proto.entries()]
    .map(([protocol, count]) => ({ protocol, count }))
    .sort((a, b) => b.count - a.count)

  const findings: AuditFinding[] = []

  // Missing bridge per Zigbee/Z-Wave ecosystem.
  for (const [e, a] of eco.entries()) {
    if (a.needsBridge && a.hubCount === 0) {
      findings.push({
        severity: 'error',
        title: `Bridge fehlt: ${labelEco(e)}`,
        detail: `${a.count} Gerät(e) nutzen Zigbee/Z-Wave, aber es ist kein ${labelEco(e)}-Hub im Plan. Ohne Bridge sind sie nicht erreichbar.`,
      })
    }
  }

  // Thread devices without a border router.
  if (threadDevices > 0 && threadRouters === 0) {
    findings.push({
      severity: 'warning',
      title: 'Thread-Border-Router empfohlen',
      detail: `${threadDevices} Thread-Gerät(e) im Plan, aber kein Border-Router (z. B. Apple TV, HomePod, Dirigera). Ohne Router bleibt Thread instabil.`,
    })
  }

  // Single point of failure: one hub carrying a large ecosystem.
  for (const [e, a] of eco.entries()) {
    if (a.hubCount === 1 && a.count >= 8) {
      findings.push({
        severity: 'warning',
        title: `Single Point of Failure: ${labelEco(e)}`,
        detail: `${a.count} Geräte hängen an einem einzigen ${labelEco(e)}-Hub. Fällt er aus, ist das ganze Ökosystem offline.`,
      })
    }
  }

  // Sprawl — many islands without a unifying platform.
  const unifiers: Ecosystem[] = ['home-assistant', 'matter', 'apple-home', 'google-home', 'alexa', 'homey']
  const hasUnifier = ecosystems.some((l) => unifiers.includes(l.ecosystem)) || matterCount > 0
  if (eco.size >= 5 && !hasUnifier) {
    findings.push({
      severity: 'info',
      title: 'Viele Ökosysteme',
      detail: `${eco.size} getrennte Ökosysteme ohne gemeinsame Zentrale. Home Assistant oder Matter bündelt sie unter einer Oberfläche.`,
    })
  }

  // Positive signal: Matter coverage.
  if (matterCount > 0) {
    findings.push({
      severity: 'info',
      title: 'Matter-fähig',
      detail: `${matterCount} Gerät(e) sprechen Matter — herstellerübergreifend und zukunftssicher.`,
    })
  }

  const order: Record<AuditSeverity, number> = { error: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { deviceCount, ecosystemCount: eco.size, ecosystems, protocolMix, matterCount, findings }
}
