import { findCapability, type Device } from '@/domain'
import { kelvinToHex } from '@/lib/lighting'
import type { Room, Wall, Point } from '@/types'
import { deriveRoomLiveState, type RoomLiveState } from '@/twin/binding'

/**
 * LiveFloorplan — the live Digital Twin painted onto the plan's own geometry.
 *
 * Read-only SVG using the real room polygons + walls + extent, tinted per room
 * by the aggregated live state of its bound devices (light glow, temperature,
 * motion, energy, lock). Device markers are tappable to command the owning
 * connector. The aggregation (`deriveRoomLiveState`) is renderer-neutral, so the
 * 3D view can paint the identical data later.
 */

const PAD = 30

const centroid = (pts: Point[]): Point => {
  const n = pts.length || 1
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
}
const bbox = (pts: Point[]) => ({
  minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
})

function summaryLine(s: RoomLiveState): string {
  const parts: string[] = []
  if (s.lightTotal > 0) parts.push(`Licht ${s.lightsOn}/${s.lightTotal}${s.brightness !== undefined ? ` · ${s.brightness}%` : ''}`)
  if (s.temperature !== undefined) parts.push(`${s.temperature} °C`)
  if (s.humidity !== undefined) parts.push(`${s.humidity}%`)
  if (s.energyW !== undefined) parts.push(`${s.energyW} W`)
  if (s.hasLock) parts.push(s.locked ? 'verriegelt' : 'offen')
  if (s.motion) parts.push('Bewegung')
  return parts.join('  ·  ')
}

function markerColor(d: Device): string {
  const onoff = findCapability(d.capabilities, 'OnOff')
  const lock = findCapability(d.capabilities, 'Lock')
  const motion = findCapability(d.capabilities, 'Motion')
  const ct = findCapability(d.capabilities, 'ColorTemperature')
  if (d.category === 'light') return onoff && !onoff.on ? '#3a3f47' : ct ? kelvinToHex(ct.kelvin) : '#ffd9a0'
  if (lock) return lock.locked ? '#C7A24E' : '#e0a23c'
  if (motion) return motion.detected ? '#C7A24E' : '#3a3f47'
  return '#7a828c'
}

const isWritable = (d: Device) =>
  findCapability(d.capabilities, 'OnOff')?.access === 'readWrite' ||
  findCapability(d.capabilities, 'Lock')?.access === 'readWrite'

export function LiveFloorplan({
  rooms, walls, extent, byRoom, onCommand,
}: {
  rooms: Room[]
  walls: Wall[]
  extent: { width: number; height: number }
  byRoom: Map<string, Device[]>
  onCommand: (d: Device) => void
}) {
  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${extent.width + 2 * PAD} ${extent.height + 2 * PAD}`}
      className="w-full"
      style={{ maxHeight: '70vh', background: 'linear-gradient(180deg, #121113 0%, #0A0A0B 100%)', borderRadius: 14, border: '1px solid var(--border)' }}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <filter id="mk-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#000000" floodOpacity="0.55" />
        </filter>
        {rooms.map((room) => {
          const glowColor = deriveRoomLiveState(byRoom.get(room.id) ?? []).glow ?? '#ffd9a0'
          return (
            <radialGradient key={room.id} id={`glow-${room.id}`} cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor={glowColor} stopOpacity={0.62} />
              <stop offset="52%" stopColor={glowColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={glowColor} stopOpacity={0} />
            </radialGradient>
          )
        })}
      </defs>

      {/* Floors + spatial light */}
      {rooms.map((room) => {
        if (room.polygon.length < 3) return null
        const live = deriveRoomLiveState(byRoom.get(room.id) ?? [])
        const pts = room.polygon.map((p) => `${p.x},${p.y}`).join(' ')
        const glowScale = live.glow ? Math.min(1, 0.45 + (live.brightness ?? 60) / 100 * 0.55) : 0
        return (
          <g key={room.id}>
            <polygon points={pts} fill="#0F151D" stroke="rgba(255,255,255,0.05)" strokeWidth={1.25} />
            <polygon
              points={pts}
              fill={`url(#glow-${room.id})`}
              stroke="none"
              className={glowScale > 0 ? 'twin-bloom' : undefined}
              style={{ opacity: glowScale, transition: 'opacity var(--dur-4) var(--ease-out-expo)' }}
            />
          </g>
        )
      })}

      {/* Walls — layered for crisp, premium materiality */}
      {walls.map((w) => {
        const width = Math.max(3.5, w.thickness * 0.55)
        return (
          <g key={w.id}>
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#070A0F" strokeWidth={width + 1.5} strokeLinecap="round" />
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#2b313b" strokeWidth={width} strokeLinecap="round" />
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="rgba(255,255,255,0.06)" strokeWidth={Math.max(1, width * 0.28)} strokeLinecap="round" />
          </g>
        )
      })}

      {/* Labels + device markers (top layer, above walls) */}
      {rooms.map((room) => {
        if (room.polygon.length < 3) return null
        const devices = byRoom.get(room.id) ?? []
        const live = deriveRoomLiveState(devices)
        const c = centroid(room.polygon)
        const box = bbox(room.polygon)
        const summary = summaryLine(live)
        const markerW = Math.min(box.maxX - box.minX - 40, devices.length * 32)
        const startX = c.x - markerW / 2 + 16
        return (
          <g key={room.id}>
            {live.motion && (
              <circle cx={box.maxX - 24} cy={box.minY + 24} r={6} fill="#C7A24E">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="r" values="5;7;5" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}
            <text x={c.x} y={box.minY + 32} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--fg-strong)" style={{ letterSpacing: '0.01em' }}>{room.name}</text>
            {summary && (
              <text x={c.x} y={box.minY + 53} textAnchor="middle" fontSize={11.5} fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>{summary}</text>
            )}
            {devices.map((d, i) => {
              const writable = isWritable(d)
              const col = markerColor(d)
              const lit = col !== '#3a3f47' && col !== '#7a828c'
              return (
                <g key={d.id} transform={`translate(${startX + i * 32}, ${c.y + 22})`} style={{ cursor: writable ? 'pointer' : 'default' }} onClick={() => writable && onCommand(d)}>
                  {lit && <circle r={18} fill={col} opacity={0.12} className="twin-bloom" />}
                  {lit && <circle r={12} fill={col} opacity={0.2} />}
                  <circle r={10} fill={col} stroke="var(--bg)" strokeWidth={2} filter="url(#mk-shadow)" style={{ transition: 'fill var(--dur-3) var(--ease-out-quart)' }} />
                  <circle r={3.2} cx={-2.4} cy={-2.4} fill="#ffffff" opacity={0.28} />
                  <title>{d.name}{writable ? ' — tippen zum Schalten' : ''}</title>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
