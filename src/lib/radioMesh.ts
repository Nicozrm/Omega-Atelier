/**
 * radioMesh.ts — the smart home's invisible nervous system, made visible.
 *
 * Builds the radio topology of a floor: hubs (bridges, TVs, smart displays)
 * form the backbone, every other device links to the nearest hub that speaks
 * one of its protocols. The renderer draws the links as glowing arcs and
 * animates packets along them — this module owns the pure parts: topology,
 * protocol colours, and the quadratic-arc math the packets travel on.
 */

import type { PlacedDevice, Point } from '@/types'

/** The protocol families we visualise, in display-priority order. */
export type RadioProtocol = 'zigbee' | 'thread' | 'matter' | 'wifi' | 'wired' | 'bt'

/** Priority when a device speaks several protocols (mesh first — prettier and
 *  closer to how the device actually joins the network). */
const FAMILY_PRIORITY: RadioProtocol[] = ['zigbee', 'thread', 'matter', 'wifi', 'bt', 'wired']

/** Brand-tuned protocol colours (dark canvas, additive glow). */
export const PROTOCOL_COLORS: Record<RadioProtocol, string> = {
  zigbee: '#E6CC86', // gold — the Hue/Aqara mesh
  thread: '#2EE59D', // green
  matter: '#C9A6FF', // violet
  wifi:   '#7EC8E3', // sky
  bt:     '#5F8FB4', // muted blue
  wired:  '#8B8478', // slate
}

/** Pick the protocol family a device is visualised with. */
export function protocolFamily(protocols: string[] | undefined): RadioProtocol {
  if (protocols) {
    for (const fam of FAMILY_PRIORITY) {
      if (protocols.includes(fam)) return fam
    }
  }
  return 'wifi'
}

export interface RadioLink {
  /** Placed-device ids. */
  fromId: string
  toId: string
  from: Point
  to: Point
  protocol: RadioProtocol
  /** true for the hub↔hub backbone. */
  backbone: boolean
}

export interface MeshDeviceInfo {
  category: string
  protocols?: string[]
}

const dist2 = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

/**
 * Build the visible topology: each non-hub device links to the nearest hub
 * sharing one of its protocols (else simply the nearest hub); hubs chain to
 * their nearest fellow hub as the backbone. No hubs → no links.
 */
export function buildMesh(
  devices: PlacedDevice[],
  lookup: (deviceId: string) => MeshDeviceInfo | undefined,
): RadioLink[] {
  const hubs = devices.filter((d) => lookup(d.deviceId)?.category === 'hub')
  if (hubs.length === 0) return []
  const links: RadioLink[] = []

  for (const d of devices) {
    const info = lookup(d.deviceId)
    if (!info || info.category === 'hub') continue
    const fam = protocolFamily(info.protocols)
    const compatible = hubs.filter((h) => {
      const hp = lookup(h.deviceId)?.protocols
      return !hp || hp.includes(fam) || fam === 'wifi' || fam === 'bt'
    })
    const pool = compatible.length ? compatible : hubs
    let best = pool[0]
    for (const h of pool) if (dist2(d.position, h.position) < dist2(d.position, best.position)) best = h
    links.push({ fromId: d.id, toId: best.id, from: d.position, to: best.position, protocol: fam, backbone: false })
  }

  // Hub backbone: each hub to its nearest other hub (deduplicated).
  const seen = new Set<string>()
  for (const h of hubs) {
    let best: PlacedDevice | null = null
    for (const o of hubs) {
      if (o.id === h.id) continue
      if (!best || dist2(h.position, o.position) < dist2(h.position, best.position)) best = o
    }
    if (!best) continue
    const key = [h.id, best.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ fromId: h.id, toId: best.id, from: h.position, to: best.position, protocol: 'wired', backbone: true })
  }

  return links
}

/**
 * Point at parameter t (0…1) on the link's arc — a quadratic bezier whose
 * control point sits `bulge` × length perpendicular to the chord's midpoint.
 * The same curve the renderer strokes, so packets ride exactly on the line.
 */
export function arcPoint(from: Point, to: Point, t: number, bulge = 0.12): Point {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const cx = mx - (dy / len) * len * bulge
  const cy = my + (dx / len) * len * bulge
  const u = 1 - t
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  }
}
