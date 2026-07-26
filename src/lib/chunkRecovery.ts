/**
 * chunkRecovery — survive stale lazy-chunk loads after a redeploy.
 *
 * The app is a PWA with hashed code-split route chunks. After a new deploy the
 * service worker cleans outdated precaches; an already-open client that then
 * navigates to a route whose OLD chunk hash was purged gets a failed dynamic
 * import — and, with nothing catching it, a blank/black screen. This installs
 * the canonical recovery: on a chunk/preload failure, reload once (guarded so
 * it can never loop) to pull the fresh index + chunks.
 */

const KEY = 'omega:chunk-reload-at'
const WINDOW_MS = 20_000

/** True when an error looks like a failed dynamic import / chunk / css load. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').toLowerCase()
  if (!msg) return false
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('failed to fetch dynamically') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('module script failed')
  )
}

/**
 * Reload once to recover from a stale precached chunk. Guarded via
 * sessionStorage so a genuinely-broken load (e.g. offline) can't loop.
 * Returns true if a reload was triggered.
 */
export function recoverFromStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? '0')
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* sessionStorage unavailable — fall through and still reload once */
  }
  window.location.reload()
  return true
}

/** Install global listeners for chunk/preload failures. Call once at startup. */
export function installChunkRecovery(): void {
  // Vite dispatches this precise event when a modulepreload / dynamic import fails.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    recoverFromStaleChunk()
  })
  // Belt-and-suspenders: React.lazy rejections surface here on some engines.
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkLoadError(e.reason)) recoverFromStaleChunk()
  })
}
