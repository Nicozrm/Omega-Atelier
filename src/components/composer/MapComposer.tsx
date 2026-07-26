import { Plus, Minus, Navigation, Crosshair, PenLine, Trash2, Sparkles, MapPin, Satellite } from 'lucide-react'
import { useComposerStore } from '@/store/useComposerStore'
import { formatGeo } from '@/lib/composer'
import { defaultMapProvider } from '@/lib/composer/mapProvider'
import { esriProvider, esriTileUrl } from '@/lib/composer/onlineProvider'
import { MapCanvas } from './MapCanvas'

const MIN_ZOOM = 15
const MAX_ZOOM = 20

/**
 * MapComposer — wizard step 2. Frames the {@link MapCanvas} with the map
 * controls (zoom, recentre, GPS, parcel-draw) and the analyse action. Tapping a
 * spot drops the pin that the analysis engine turns into the twin.
 */
export function MapComposer() {
  const view = useComposerStore((s) => s.view)
  const pin = useComposerStore((s) => s.pin)
  const polygon = useComposerStore((s) => s.polygon)
  const drawing = useComposerStore((s) => s.drawingPolygon)
  const locating = useComposerStore((s) => s.locating)

  const setView = useComposerStore((s) => s.setView)
  const setPin = useComposerStore((s) => s.setPin)
  const addPolygonPoint = useComposerStore((s) => s.addPolygonPoint)
  const toggleDraw = useComposerStore((s) => s.toggleDrawPolygon)
  const clearPolygon = useComposerStore((s) => s.clearPolygon)
  const locateMe = useComposerStore((s) => s.locateMe)
  const startAnalysis = useComposerStore((s) => s.startAnalysis)
  const setStep = useComposerStore((s) => s.setStep)
  const provider = useComposerStore((s) => s.provider)
  const setProvider = useComposerStore((s) => s.setProvider)
  const satellite = provider.online

  if (!view) return null

  const zoom = (dir: 1 | -1) =>
    setView({ ...view, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + dir)) })
  const recenter = () => pin && setView({ ...view, center: pin })

  const ctrlBtn =
    'flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--glass-bg)] text-[color:var(--fg)] backdrop-blur-md transition-colors hover:border-[color:var(--border-accent)]'

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)]">
        <MapCanvas
          view={view}
          pin={pin}
          polygon={polygon}
          drawingPolygon={drawing}
          onViewChange={setView}
          onTap={setPin}
          onAddPolygonPoint={addPolygonPoint}
          className="h-full w-full"
          imagery={satellite ? { tileUrl: esriTileUrl } : null}
        />

        {/* Imagery attribution — required while real tiles are shown */}
        {satellite && (
          <div className="pointer-events-none absolute bottom-12 right-3 rounded-full bg-black/45 px-2.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">
            {provider.attribution}
          </div>
        )}

        {/* Hint */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-3 py-1.5 text-xs text-[color:var(--fg)] backdrop-blur-md">
          <Crosshair size={13} className="text-[color:var(--accent-bright)]" />
          {drawing ? 'Ecken deines Grundstücks antippen' : 'Tippe exakt auf dein Grundstück'}
        </div>

        {/* Controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <button className={ctrlBtn} onClick={() => zoom(1)} aria-label="Vergrößern" disabled={view.zoom >= MAX_ZOOM}>
            <Plus size={16} />
          </button>
          <button className={ctrlBtn} onClick={() => zoom(-1)} aria-label="Verkleinern" disabled={view.zoom <= MIN_ZOOM}>
            <Minus size={16} />
          </button>
          <button className={ctrlBtn} onClick={recenter} aria-label="Auf Pin zentrieren" disabled={!pin}>
            <Crosshair size={16} />
          </button>
          <button
            className={ctrlBtn}
            onClick={() => void locateMe()}
            aria-label="Aktueller Standort"
            disabled={locating}
          >
            <Navigation size={15} className={locating ? 'animate-pulse text-[color:var(--accent-bright)]' : undefined} />
          </button>
          <button
            className={ctrlBtn}
            onClick={() => setProvider(satellite ? defaultMapProvider : esriProvider)}
            aria-label={satellite ? 'Offline-Karte' : 'Echte Satellitenansicht'}
            title={satellite ? 'Zur Offline-Karte wechseln' : 'Echte Satellitenansicht (Esri)'}
          >
            <Satellite size={15} className={satellite ? 'text-[color:var(--accent-bright)]' : undefined} />
          </button>
        </div>

        {/* Bottom overlay: coordinate + polygon tools */}
        <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-3 py-1.5 text-xs text-[color:var(--muted)] backdrop-blur-md">
            <MapPin size={12} className="text-[color:var(--accent-bright)]" />
            {pin ? formatGeo(pin) : formatGeo(view.center)}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleDraw}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs backdrop-blur-md transition-colors ${
                drawing
                  ? 'border-[color:var(--border-accent)] bg-[rgba(199,162,78,0.14)] text-[color:var(--fg)]'
                  : 'border-[color:var(--border)] bg-[color:var(--glass-bg)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'
              }`}
            >
              <PenLine size={12} /> Polygon {drawing ? 'aktiv' : 'zeichnen'}
            </button>
            {polygon.length > 0 && (
              <button
                onClick={clearPolygon}
                className="flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-3 py-1.5 text-xs text-[color:var(--muted)] backdrop-blur-md hover:text-[color:var(--fg)]"
              >
                <Trash2 size={12} /> {polygon.length}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setStep(1)} className="btn btn-ghost btn-sm">Standort ändern</button>
        <button
          onClick={() => void startAnalysis()}
          disabled={!pin}
          className="btn btn-primary"
          title={pin ? 'Grundstück analysieren' : 'Tippe zuerst auf dein Grundstück'}
        >
          <Sparkles size={15} /> Grundstück analysieren
        </button>
      </div>
    </div>
  )
}
