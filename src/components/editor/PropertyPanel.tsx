import { useState } from 'react'
import {
  Trash2, RotateCcw, Info, Ruler, MousePointer, Type, Sparkles,
  ChevronDown, Eye, EyeOff, AlignStartVertical, AlignCenterVertical,
  AlignEndVertical, FlipHorizontal2,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { DEVICE_ECOSYSTEM_LABELS, CATEGORY_LABELS, OMEGA_MODES } from '@/lib/constants'
import { formatLength } from '@/lib/utils'
import { formatModeState } from '@/lib/modeState'
import { UPHOLSTERY_SLOTS, WOOD_SLOTS } from '@/lib/materialSlots'
import { FurnitureThumb } from '@/components/library/FurnitureLibrary'
import { materialsForSurface, resolveFloorMaterial } from '@/lib/materials'
import type { Point, Room } from '@/types'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))
const FURN_MAP = Object.fromEntries(FURNITURE.map((f) => [f.id, f] as const))

/** DCC-style axis tints for transform fields (reference: X red, Y green, Z blue). */
const AXIS_TONE: Record<string, string> = {
  x: '#F16A6A',
  y: '#3ECF8E',
  z: '#5AA7FF',
  accent: 'var(--accent-bright)',
}

/**
 * Compact editable numeric field for the transform grid (premium-inspector
 * feel like the reference). Commits on blur / Enter so dragging the plan and
 * typing here stay independent. `tone` colours the axis letter like a DCC
 * inspector (x/y/z/accent).
 */
function NumField({ label, value, unit, tone, onCommit }: {
  label: string; value: number; unit?: string; tone?: keyof typeof AXIS_TONE; onCommit: (v: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(Math.round(value * 10) / 10)
  const commit = () => {
    if (text === null) return
    const v = parseFloat(text.replace(',', '.'))
    if (Number.isFinite(v)) onCommit(v)
    setText(null)
  }
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 focus-within:border-[color:var(--accent)]">
      <span
        className="w-3 shrink-0 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: tone ? AXIS_TONE[tone] : 'var(--muted)' }}
      >{label}</span>
      <input
        type="text" inputMode="decimal" value={shown}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setText(null) }}
        className="w-full bg-transparent text-right font-mono text-xs text-[color:var(--fg)] outline-none"
      />
      {unit && <span className="text-[10px] text-[color:var(--muted)] shrink-0">{unit}</span>}
    </label>
  )
}

/**
 * Collapsible inspector section — the reference's stacked EIGENSCHAFTEN
 * layout: uppercase header with a chevron, content below, open by default.
 */
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)]/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
      >
        {title}
        <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  )
}

/** Label/value row for the Info tab. */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[color:var(--muted)]">{label}</dt>
      <dd className="text-right font-mono text-[color:var(--fg)]">{value}</dd>
    </>
  )
}

/** Euclidean distance between two points in cm. */
function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

export function PropertyPanel() {
  const selection = usePlanStore((s) => s.selection)
  const doc = usePlanStore((s) => s.doc)
  const tool = usePlanStore((s) => s.tool)
  const deleteSelection = usePlanStore((s) => s.deleteSelection)
  const rotateSelection = usePlanStore((s) => s.rotateSelection)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  const floor = doc?.floors.find((f) => f.id === doc.activeFloorId)

  if (!selection.type || selection.ids.length === 0 || !floor) {
    return (
      <div className="surface p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">
          <Info size={12} /> Eigenschaften
        </div>
        {tool === 'measure' ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2 text-sm text-[color:var(--accent)]">
              <Ruler size={14} /> Messwerkzeug aktiv
            </div>
            <p className="text-xs text-[color:var(--muted)]">
              Klicke zwei Punkte auf dem Grundriss. Distanz erscheint live über
              der Linie. Esc bricht ab, ein dritter Klick startet eine neue Messung.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center text-center gap-2">
            <div className="w-10 h-10 rounded-full bg-[color:var(--surface-2)] flex items-center justify-center">
              <MousePointer size={18} className="text-[color:var(--muted)]" />
            </div>
            <p className="text-sm text-[color:var(--muted)]">
              Wähle ein Objekt aus, um Details zu sehen.
            </p>
          </div>
        )}
      </div>
    )
  }

  const patchFurniture = (id: string, fn: (it: NonNullable<typeof floor>['furniture'][number]) => void) => {
    updateDoc((d) => {
      const fl = d.floors.find((flr) => flr.id === d.activeFloorId)
      const item = fl?.furniture.find((it) => it.id === id)
      if (item) fn(item)
    })
  }

  const patchDevice = (id: string, fn: (it: NonNullable<typeof floor>['devices'][number]) => void) => {
    updateDoc((d) => {
      const fl = d.floors.find((flr) => flr.id === d.activeFloorId)
      const item = fl?.devices.find((it) => it.id === id)
      if (item) fn(item)
    })
  }

  const renderDeviceInfo = () => {
    const items = floor.devices.filter((d) => selection.ids.includes(d.id))
    return items.map((d) => {
      const entry = DEVICE_MAP[d.deviceId]
      const activeMode = doc?.activeModeKey
      const stateForActive = activeMode ? d.modeState?.[activeMode] : undefined
      const allModes = d.modeState ? Object.keys(d.modeState) : []
      return (
        <div key={d.id} className="space-y-1.5 border-b border-[color:var(--border)] pb-2 last:border-0">
          <div className="font-display text-base">{entry?.name ?? 'Gerät'}</div>
          <div className="flex flex-wrap gap-1 text-xs text-[color:var(--muted)]">
            <span className="chip">{DEVICE_ECOSYSTEM_LABELS[entry?.ecosystem ?? 'custom']}</span>
            <span className="chip">{CATEGORY_LABELS[entry?.category ?? 'other']}</span>
            {entry?.price && <span className="chip">€ {entry.price}</span>}
            {entry?.power && <span className="chip">{entry.power} W</span>}
          </div>
          {/* Editable transform — Position / Rotation */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Transform</div>
            <div className="grid grid-cols-2 gap-1">
              <NumField label="X" tone="x" value={d.position.x} unit="cm" onCommit={(v) => patchDevice(d.id, (it) => { it.position.x = v })} />
              <NumField label="Y" tone="y" value={d.position.y} unit="cm" onCommit={(v) => patchDevice(d.id, (it) => { it.position.y = v })} />
              <NumField label="↻" tone="accent" value={d.rotation ?? 0} unit="°" onCommit={(v) => patchDevice(d.id, (it) => { it.rotation = ((v % 360) + 360) % 360 })} />
            </div>
          </div>
          {/* Mode state for the active mode */}
          {activeMode && stateForActive && (
            <div className="rounded-md border border-[color:var(--border)] p-2 mt-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--accent)] mb-1">
                <Sparkles size={10} />
                {OMEGA_MODES.find((m) => m.key === activeMode)?.name ?? activeMode}
              </div>
              <div className="font-mono text-[11px] text-[color:var(--fg)]">
                {formatModeState(stateForActive)}
              </div>
            </div>
          )}
          {/* All configured modes summary */}
          {allModes.length > 0 && (
            <div className="text-[10px] text-[color:var(--muted)]">
              Konfiguriert für {allModes.length} Modus{allModes.length === 1 ? '' : 'se'}: {allModes.join(', ')}
            </div>
          )}
        </div>
      )
    })
  }

  const renderFurnitureInfo = () => {
    const items = floor.furniture.filter((f) => selection.ids.includes(f.id))
    return items.map((f) => {
      const entry = FURN_MAP[f.furnitureId]
      const [w, h] = f.size ?? entry?.size ?? [60, 60]
      const rot = f.rotation ?? 0
      // Decide which slot catalog applies based on furniture id.
      const isSofa     = /^sofa|^armchair|^stool|^bench/i.test(f.furnitureId)
      const isWooden   = /^bed|^table|^wardrobe|^sideboard|^nightstand|^dresser|^shoe|^chair|^desk|^shelf|^bookshelf|^bookcase|^tv|^kitchen|^cabinet|^crib|^highboard|^lowboard/i.test(f.furnitureId)
      const slots = isSofa ? UPHOLSTERY_SLOTS
                  : isWooden ? WOOD_SLOTS
                  : null
      const currentKey = f.materialKey ?? (isSofa ? 'fabricBeige' : isWooden ? 'walnut' : null)
      // Bounding box of the item's room (fallback: floor extent) for AUSRICHTEN.
      const room = floor.rooms.find((rm) => rm.id === f.roomId)
      const bounds = room && room.polygon.length >= 3
        ? {
            minX: Math.min(...room.polygon.map((p) => p.x)),
            maxX: Math.max(...room.polygon.map((p) => p.x)),
          }
        : { minX: 0, maxX: floor.extent.width }
      const alignX = (mode: 'start' | 'center' | 'end') => {
        patchFurniture(f.id, (it) => {
          if (mode === 'start')  it.position.x = bounds.minX + w / 2 + 10
          if (mode === 'center') it.position.x = (bounds.minX + bounds.maxX) / 2
          if (mode === 'end')    it.position.x = bounds.maxX - w / 2 - 10
        })
      }
      return (
        <div key={f.id} className="space-y-1.5 border-b border-[color:var(--border)] pb-2 last:border-0">
          {/* Item header — thumbnail + name + dimensions (reference layout) */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted)]">
              <FurnitureThumb category={entry?.category ?? 'other'} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-display text-base leading-tight">{f.label || (entry?.name ?? 'Möbel')}</div>
              <div className="font-mono text-[10px] text-[color:var(--muted)]">{Math.round(w)} × {Math.round(h)} cm</div>
            </div>
          </div>

          <Section title="Transformation">
            <div className="grid grid-cols-2 gap-1">
              <NumField label="X" tone="x" value={f.position.x} unit="cm" onCommit={(v) => patchFurniture(f.id, (it) => { it.position.x = v })} />
              <NumField label="Y" tone="y" value={f.position.y} unit="cm" onCommit={(v) => patchFurniture(f.id, (it) => { it.position.y = v })} />
              <NumField label="B" value={w} unit="cm" onCommit={(v) => patchFurniture(f.id, (it) => { it.size = [Math.max(10, v), (it.size ?? [w, h])[1]] })} />
              <NumField label="T" value={h} unit="cm" onCommit={(v) => patchFurniture(f.id, (it) => { it.size = [(it.size ?? [w, h])[0], Math.max(10, v)] })} />
              <NumField label="↻" tone="accent" value={rot} unit="°" onCommit={(v) => patchFurniture(f.id, (it) => { it.rotation = ((v % 360) + 360) % 360 })} />
            </div>
          </Section>

          <Section title="Ausrichten">
            <div className="flex gap-1">
              <button className="btn btn-ghost btn-sm flex-1 justify-center" onClick={() => alignX('start')} title="Links im Raum">
                <AlignStartVertical size={14} />
              </button>
              <button className="btn btn-ghost btn-sm flex-1 justify-center" onClick={() => alignX('center')} title="Mittig im Raum">
                <AlignCenterVertical size={14} />
              </button>
              <button className="btn btn-ghost btn-sm flex-1 justify-center" onClick={() => alignX('end')} title="Rechts im Raum">
                <AlignEndVertical size={14} />
              </button>
              <button
                className="btn btn-ghost btn-sm flex-1 justify-center"
                onClick={() => patchFurniture(f.id, (it) => { it.rotation = (((it.rotation ?? 0) + 180) % 360) })}
                title="180° drehen"
              >
                <FlipHorizontal2 size={14} />
              </button>
            </div>
          </Section>

          {slots && (
            <Section title="Oberfläche">
              <div className="flex gap-1.5 items-center">
                {slots.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => patchFurniture(f.id, (it) => { it.materialKey = s.key })}
                    className={`w-7 h-7 rounded-md border-2 transition-all ${
                      currentKey === s.key
                        ? 'border-[color:var(--accent)] scale-110 shadow-[0_2px_10px_rgba(199,162,78,0.35)]'
                        : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'
                    }`}
                    style={{ background: s.swatch }}
                    title={s.label}
                  />
                ))}
              </div>
              <div className="mt-1 text-[10px] text-[color:var(--muted)]">{isSofa ? 'Stoff' : 'Holz'}</div>
            </Section>
          )}

          <Section title="Optionen" defaultOpen={false}>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Eigener Name</span>
              <input
                className="input mt-1 !py-1 text-xs"
                value={f.label ?? ''}
                placeholder={entry?.name ?? 'Möbel'}
                onChange={(e) => patchFurniture(f.id, (it) => { it.label = e.target.value || undefined })}
              />
            </label>
            <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              <InfoRow label="Größe" value={`${formatLength(w)} × ${formatLength(h)}`} />
              {entry?.category && <InfoRow label="Kategorie" value={CATEGORY_LABELS[entry.category] ?? entry.category} />}
              <InfoRow label="Raum" value={room?.name ?? '—'} />
            </dl>
          </Section>

          <Section title="Sichtbarkeit">
            <button
              onClick={() => patchFurniture(f.id, (it) => { it.hidden = it.hidden ? undefined : true })}
              className={`btn btn-sm w-full justify-center ${f.hidden ? 'btn-outline' : 'btn-ghost'}`}
            >
              {f.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              {f.hidden ? 'Ausgeblendet — einblenden' : 'Sichtbar in 2D & 3D'}
            </button>
          </Section>
        </div>
      )
    })
  }

  const renderWallInfo = () => {
    const items = floor.walls.filter((w) => selection.ids.includes(w.id))
    const setSubtype = (id: string, subtype: 'wall' | 'door' | 'window') => {
      updateDoc((d) => {
        const fl = d.floors.find((flr) => flr.id === d.activeFloorId)
        if (!fl) return
        const wall = fl.walls.find((w) => w.id === id)
        if (!wall) return
        wall.subtype = subtype
        if (subtype === 'door') {
          if (!wall.openingWidth) wall.openingWidth = 90
        } else if (subtype === 'window') {
          if (!wall.openingWidth)  wall.openingWidth  = 120
          if (!wall.openingHeight) wall.openingHeight = 100
          if (wall.openingSill === undefined) wall.openingSill = 90
        }
      })
    }
    return items.map((w) => {
      const length = dist(w.a, w.b)
      const subtype = w.subtype ?? 'wall'
      const types: Array<{ key: 'wall' | 'door' | 'window'; label: string }> = [
        { key: 'wall',   label: 'Wand' },
        { key: 'door',   label: 'Tür' },
        { key: 'window', label: 'Fenster' },
      ]
      return (
        <div key={w.id} className="space-y-2 border-b border-[color:var(--border)] pb-2 last:border-0">
          <div className="font-display text-base">{subtype === 'door' ? 'Tür' : subtype === 'window' ? 'Fenster' : 'Wand'}</div>
          <div className="flex flex-wrap gap-1 text-xs text-[color:var(--muted)]">
            <span className="chip">Länge {formatLength(length)}</span>
            <span className="chip">Dicke {formatLength(w.thickness)}</span>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Typ</div>
            <div className="flex gap-1">
              {types.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSubtype(w.id, t.key)}
                  className={`btn btn-sm flex-1 justify-center ${subtype === t.key ? 'btn-outline' : 'btn-ghost'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    })
  }

  const renderRoomInfo = () => {
    const items = floor.rooms.filter((rm) => selection.ids.includes(rm.id))
    const patch = (id: string, fn: (rm: Room) => void) => {
      updateDoc((d) => {
        const fl = d.floors.find((flr) => flr.id === d.activeFloorId)
        if (!fl) return
        const rm = fl.rooms.find((x) => x.id === id)
        if (rm) fn(rm)
      })
    }
    const floorMaterials = materialsForSurface('floor')
    return items.map((rm) => {
      const isOutdoor = rm.zoneType === 'outdoor'
      const activeFloor = resolveFloorMaterial(rm)
      return (
        <div key={rm.id} className="space-y-2.5 border-b border-[color:var(--border)] pb-2 last:border-0">
          <div className="font-display text-base">{rm.name || (isOutdoor ? 'Terrasse' : 'Raum')}</div>

          {/* Zone toggle */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Zone</div>
            <div className="flex gap-1">
              <button
                onClick={() => patch(rm.id, (r) => { r.zoneType = 'indoor' })}
                className={`btn btn-sm flex-1 justify-center ${!isOutdoor ? 'btn-outline' : 'btn-ghost'}`}
              >Innen</button>
              <button
                onClick={() => patch(rm.id, (r) => { r.zoneType = 'outdoor'; if (!r.floorMaterialId) r.floorMaterialId = 'floor-slate' })}
                className={`btn btn-sm flex-1 justify-center ${isOutdoor ? 'btn-outline' : 'btn-ghost'}`}
              >Terrasse</button>
            </div>
          </div>

          {/* Floor material */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Bodenmaterial</div>
            <div className="flex flex-wrap gap-1.5">
              {floorMaterials.map((m) => (
                <button
                  key={m.id}
                  onClick={() => patch(rm.id, (r) => { r.floorMaterialId = m.id })}
                  title={m.name}
                  className={`w-7 h-7 rounded-md border-2 transition-all ${activeFloor.id === m.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: m.color }}
                />
              ))}
            </div>
            <div className="text-[11px] text-[color:var(--muted)]">{activeFloor.name}</div>
          </div>

          {/* Wall + ceiling — every surface of every room is individually stylable. */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Wandmaterial</div>
            <div className="flex flex-wrap gap-1.5">
              {materialsForSurface('wall').map((m) => (
                <button
                  key={m.id}
                  onClick={() => patch(rm.id, (r) => { r.wallMaterialId = m.id })}
                  title={m.name}
                  className={`w-7 h-7 rounded-md border-2 transition-all ${(rm.wallMaterialId ?? 'wall-plaster') === m.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: m.color }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Decke</div>
            <div className="flex flex-wrap gap-1.5">
              {materialsForSurface('ceiling').map((m) => (
                <button
                  key={m.id}
                  onClick={() => patch(rm.id, (r) => { r.ceilingMaterialId = m.id })}
                  title={m.name}
                  className={`w-7 h-7 rounded-md border-2 transition-all ${(rm.ceilingMaterialId ?? 'ceiling-white') === m.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: m.color }}
                />
              ))}
            </div>
          </div>

          {/* Rename */}
          <input
            value={rm.name}
            onChange={(e) => patch(rm.id, (r) => { r.name = e.target.value })}
            placeholder="Raumname"
            className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 text-sm"
          />
        </div>
      )
    })
  }

  const renderLabelInfo = () => {
    const items = floor.labels.filter((l) => selection.ids.includes(l.id))
    return items.map((l) => (
      <div key={l.id} className="space-y-2 border-b border-[color:var(--border)] pb-2 last:border-0">
        <div className="flex items-center gap-2">
          <Type size={14} className="text-[color:var(--accent)]" />
          <span className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Beschriftung</span>
        </div>
        <input
          className="input text-sm"
          value={l.text}
          onChange={(e) =>
            updateDoc((d) => {
              const fl = d.floors.find((x) => x.id === d.activeFloorId)
              const lab = fl?.labels.find((x) => x.id === l.id)
              if (lab) lab.text = e.target.value
            }, { history: false })
          }
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-[color:var(--muted)] w-12">Größe</span>
          <input
            type="range"
            min={10}
            max={48}
            value={l.size ?? 14}
            onChange={(e) =>
              updateDoc((d) => {
                const fl = d.floors.find((x) => x.id === d.activeFloorId)
                const lab = fl?.labels.find((x) => x.id === l.id)
                if (lab) lab.size = Number(e.target.value)
              }, { history: false })
            }
            className="flex-1"
          />
          <span className="font-mono text-xs text-[color:var(--muted)] w-8 text-right">{l.size ?? 14}</span>
        </div>
        <div className="font-mono text-xs text-[color:var(--muted)]">
          {formatLength(l.position.x)} · {formatLength(l.position.y)}
        </div>
      </div>
    ))
  }

  return (
    <div className="surface p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">
          <Info size={12} /> Eigenschaften
        </div>
        <span className="chip">{selection.ids.length} ausgewählt</span>
      </div>

      <div className="space-y-2 text-sm">
        {selection.type === 'device' && renderDeviceInfo()}
        {selection.type === 'furniture' && renderFurnitureInfo()}
        {selection.type === 'wall' && renderWallInfo()}
        {selection.type === 'room' && renderRoomInfo()}
        {selection.type === 'label' && renderLabelInfo()}
      </div>

      <div className="space-y-2 pt-2">
        {(selection.type === 'device' || selection.type === 'furniture') && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
              Rotation
            </div>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost btn-sm flex-1 justify-center"
                onClick={() => rotateSelection(-90)}
                title="-90°"
              >
                <RotateCcw size={14} /> 90
              </button>
              <button
                className="btn btn-ghost btn-sm flex-1 justify-center"
                onClick={() => rotateSelection(-15)}
                title="-15°"
              >
                −15
              </button>
              <button
                className="btn btn-ghost btn-sm flex-1 justify-center"
                onClick={() => rotateSelection(15)}
                title="+15°"
              >
                +15
              </button>
              <button
                className="btn btn-ghost btn-sm flex-1 justify-center"
                onClick={() => rotateSelection(90)}
                title="+90°"
              >
                90 <RotateCcw size={14} className="-scale-x-100" />
              </button>
            </div>
            <div className="text-[10px] text-[color:var(--muted)]/80">
              Tastenkürzel: <span className="font-mono">R</span> = +15°,
              <span className="font-mono"> Shift+R</span> = −15°
            </div>
          </div>
        )}
        <button className="btn btn-danger btn-sm w-full" onClick={deleteSelection}>
          <Trash2 size={14} /> Löschen
        </button>
      </div>
    </div>
  )
}
