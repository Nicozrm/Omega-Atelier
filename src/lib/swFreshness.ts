/**
 * swFreshness — make every device converge to the newest deploy fast.
 *
 * Long-open tabs and installed PWAs only check for a new service worker on
 * cold navigations, so a phone that keeps the app around can sit on an old
 * build for days. Two nudges fix that:
 *  1. Ask the SW registration to check for updates periodically and whenever
 *     the app returns to the foreground (visibilitychange).
 *  2. When a new SW takes control (skipWaiting + clientsClaim), reload ONCE so
 *     the running page swaps to the fresh bundle immediately — guarded so a
 *     flapping controller can never loop the page.
 */

const CHECK_EVERY_MS = 5 * 60_000

export function installSwFreshness(): void {
  if (!('serviceWorker' in navigator)) return

  const check = () => {
    void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => { /* offline — retry later */ })
  }
  window.setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })

  // Only swap on a hand-over from a previous controller (an update) — the
  // very first claim after initial registration must NOT reload the page.
  let hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return }
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}
