import { OmegaMark } from '@/components/layout/OmegaMark'

/**
 * RouteFallback — shown while a lazily-loaded route chunk is fetched.
 *
 * Full-viewport, void-backed, with the brand glyph gently pulsing and a thin
 * indeterminate progress bar. Intentionally tiny + dependency-free so it ships
 * in the initial bundle (it must render before any route chunk arrives).
 */
export function RouteFallback() {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color:var(--bg)]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-5">
        <div className="animate-pulse-soft">
          <OmegaMark size={56} />
        </div>
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-[color:var(--surface-2)]">
          <div className="route-fallback-bar h-full w-1/3 rounded-full bg-[color:var(--accent)]" />
        </div>
        <span className="sr-only">Wird geladen …</span>
      </div>
    </div>
  )
}
