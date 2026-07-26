/**
 * Export dialog — supports multiple output formats:
 *  - JSON (OMEGA Manifest)
 *  - CSV (flat device list)
 *  - PNG (canvas snapshot)
 *  - Apple Shortcuts JSON (per mode)
 *  - Home Assistant YAML (automations + scenes per mode)
 *  - glTF (minimal 3D extrusion) — placeholder stub
 */

import { useState } from 'react'
import { FileJson, FileSpreadsheet, Image as ImageIcon, Apple, Cog, Box } from 'lucide-react'
import { Dialog } from '@/ui'
import { usePlanStore } from '@/store/usePlanStore'
import { downloadBlob } from '@/lib/utils'
import { DEVICES } from '@/data/devices'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

interface Props { open: boolean; onClose: () => void }

export function ExportDialog({ open, onClose }: Props) {
  const doc = usePlanStore((s) => s.doc)
  const [busy, setBusy] = useState<string | null>(null)
  if (!open || !doc) return null

  const run = async (kind: string, fn: () => void | Promise<void>) => {
    setBusy(kind)
    try { await fn() } finally { setBusy(null) }
  }

  // ---------------- Formats ----------------
  const exportJSON = () => {
    const json = JSON.stringify(doc, null, 2)
    downloadBlob(new Blob([json], { type: 'application/json' }), `${doc.title}.omega.json`)
  }

  const exportCSV = () => {
    const rows: string[] = ['floor,device,brand,ecosystem,category,x_cm,y_cm,rotation']
    for (const f of doc.floors) {
      for (const d of f.devices) {
        const e = DEVICE_MAP[d.deviceId]
        rows.push(
          [f.name, e?.name ?? d.deviceId, e?.brand ?? '', e?.ecosystem ?? '', e?.category ?? '',
            Math.round(d.position.x), Math.round(d.position.y), d.rotation ?? 0,
          ].map(csvCell).join(','),
        )
      }
    }
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `${doc.title}.devices.csv`)
  }

  const exportPNG = () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${doc.title}.png`)
    }, 'image/png')
  }

  const exportAppleShortcuts = () => {
    // Each mode exports as a minimal JSON understood by the user as an import recipe.
    const bundles = doc.modes.map((m) => ({
      mode: m.key,
      name: m.name,
      description: m.description,
      actions: doc.floors.flatMap((f) =>
        f.devices.map((d) => {
          const entry = DEVICE_MAP[d.deviceId]
          return {
            device: entry?.name ?? d.deviceId,
            ecosystem: entry?.ecosystem,
            intent: defaultIntentForMode(m.key, entry?.category ?? 'other'),
          }
        }),
      ),
    }))
    const json = JSON.stringify({ plan: doc.title, shortcuts: bundles }, null, 2)
    downloadBlob(new Blob([json], { type: 'application/json' }), `${doc.title}.shortcuts.json`)
  }

  const exportHA = () => {
    const lines: string[] = [`# Home Assistant scenes generated from ${doc.title}`, '']
    for (const m of doc.modes) {
      lines.push(`scene:`)
      lines.push(`  - name: "Omega ${m.name}"`)
      lines.push(`    entities:`)
      for (const f of doc.floors) {
        for (const d of f.devices) {
          const entry = DEVICE_MAP[d.deviceId]
          if (!entry) continue
          const ent = `${haDomain(entry.category)}.${(entry.id).replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
          const state = defaultHAStateForMode(m.key, entry.category)
          lines.push(`      ${ent}: ${state}`)
        }
      }
      lines.push('')
    }
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/yaml' }), `${doc.title}.scenes.yaml`)
  }

  const exportGLTF = () => {
    // Minimal placeholder: exports a JSON descriptor instead of full glTF binary.
    const doc3d = {
      asset: { version: '2.0', generator: 'OMEGA Atelier 2.0' },
      floors: doc.floors.map((f) => ({
        name: f.name,
        extent: f.extent,
        walls: f.walls.map((w) => ({ a: w.a, b: w.b, thickness: w.thickness })),
        devices: f.devices.map((d) => ({ id: d.deviceId, position: d.position })),
        furniture: f.furniture.map((fu) => ({ id: fu.furnitureId, position: fu.position, size: fu.size })),
      })),
    }
    downloadBlob(
      new Blob([JSON.stringify(doc3d, null, 2)], { type: 'model/gltf+json' }),
      `${doc.title}.gltf.json`,
    )
  }

  const formats = [
    { key: 'json',     icon: FileJson,        title: 'OMEGA Manifest (JSON)', desc: 'Kompletter Plan als JSON.', run: exportJSON },
    { key: 'csv',      icon: FileSpreadsheet, title: 'Geräteliste (CSV)',      desc: 'Alle Geräte flach als CSV.', run: exportCSV },
    { key: 'png',      icon: ImageIcon,       title: 'Grundriss (PNG)',        desc: 'Canvas als Bild.', run: exportPNG },
    { key: 'shortcut', icon: Apple,           title: 'Apple Shortcuts',        desc: 'Pro Modus ein Rezept (JSON).', run: exportAppleShortcuts },
    { key: 'ha',       icon: Cog,             title: 'Home Assistant (YAML)',  desc: 'Scenes aus den 9 Modi.', run: exportHA },
    { key: 'gltf',     icon: Box,             title: 'glTF (3D-Export)',       desc: 'Beta – als JSON-Deskriptor.', run: exportGLTF },
  ]

  return (
    <Dialog open={open} onClose={onClose} title="Exportieren" size="md">
      <div className="grid gap-2">
        {formats.map((f) => {
          const Icon = f.icon
          return (
            <button
              key={f.key}
              disabled={busy !== null}
              onClick={() => run(f.key, f.run)}
              className="flex items-start gap-3 rounded-md border border-[color:var(--border)] p-3 text-left transition hover:border-[color:var(--accent)] hover:bg-[rgba(199,162,78,0.07)]"
            >
              <Icon size={20} className="mt-0.5 text-[color:var(--accent)]" />
              <div className="flex-1">
                <div className="text-sm font-medium">{f.title}</div>
                <div className="text-xs text-[color:var(--muted)]">{f.desc}</div>
              </div>
              {busy === f.key && <span className="animate-pulse text-xs text-[color:var(--accent)]">…</span>}
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

// ---------------- helpers ----------------
function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function haDomain(cat: string) {
  switch (cat) {
    case 'light': return 'light'
    case 'switch': case 'outlet': return 'switch'
    case 'blind': return 'cover'
    case 'climate': return 'climate'
    case 'sensor': return 'binary_sensor'
    case 'camera': return 'camera'
    case 'lock': return 'lock'
    case 'speaker': return 'media_player'
    case 'tv': return 'media_player'
    case 'alarm': return 'alarm_control_panel'
    default: return 'switch'
  }
}

function defaultIntentForMode(mode: string, cat: string): string {
  if (mode === 'night')  return cat === 'light' ? 'off' : cat === 'lock' ? 'lock' : 'off'
  if (mode === 'away')   return cat === 'lock' ? 'lock' : 'off'
  if (mode === 'alarm')  return cat === 'alarm' ? 'arm' : cat === 'camera' ? 'record' : 'on'
  if (mode === 'film')   return cat === 'light' ? 'dim' : cat === 'blind' ? 'close' : 'on'
  if (mode === 'party')  return 'on'
  if (mode === 'morning')return cat === 'blind' ? 'open' : 'on'
  return 'on'
}

function defaultHAStateForMode(mode: string, cat: string): string {
  const intent = defaultIntentForMode(mode, cat)
  if (intent === 'off') return 'off'
  if (intent === 'on') return 'on'
  if (intent === 'dim') return 'on'
  if (intent === 'lock') return 'locked'
  if (intent === 'open') return 'open'
  if (intent === 'close') return 'closed'
  if (intent === 'arm') return 'armed_home'
  if (intent === 'record') return 'recording'
  return 'on'
}
