// ══════════════════════════════════════════════════════════════════════════
//  vendor-relay — CORS-Relay für die Hersteller-Clouds.
//
//  Leitet Anfragen 1:1 weiter und ergänzt die CORS-Header, die die
//  Hersteller-APIs nicht senden. Speichert NICHTS und fügt KEINE Zugangsdaten
//  hinzu — die eigenen Header des Browsers gehen unverändert durch.
//
//  ── Wer das Relay braucht ────────────────────────────────────────────────
//  Nicht alle. Am Live-Endpunkt gemessen:
//
//    SwitchBot   OPTIONS → 404 "no Route matched"   · kein allow-origin
//    Govee       OPTIONS → 200                      · allow-origin gesetzt
//
//  SwitchBot ist damit aus dem Browser grundsätzlich nicht erreichbar, und ein
//  reiner API-Key ändert daran nichts: jede Anfrage trägt `Authorization`, das
//  ist kein CORS-safelisted Header, also gibt es immer einen Preflight — und
//  der scheitert. Blockiert wird der Header, nicht die Signatur.
//  Für Govee ist das Relay optional; für SwitchBot und Tuya Pflicht.
//
//  ── Deployment ───────────────────────────────────────────────────────────
//      supabase functions deploy vendor-relay --no-verify-jwt
//
//  `--no-verify-jwt` ist nicht optional. Ohne das Flag verlangt Supabase einen
//  gültigen Supabase-JWT und antwortet auf JEDE Anfrage mit 401, bevor sie den
//  Hersteller erreicht — im Browser sichtbar nur als „Load failed", also genau
//  das Symptom, das man ohne Relay auch hätte. Dasselbe steht in config.toml
//  unter [functions.vendor-relay], damit ein Deploy über die CLI es nicht
//  vergessen kann.
//
//  Die Function ist bewusst öffentlich: sie trägt keine eigenen Rechte. Wer sie
//  aufruft, muss seine eigenen Hersteller-Zugangsdaten mitschicken, und ohne
//  die bekommt er vom Hersteller nichts.
//
//  ── App ──────────────────────────────────────────────────────────────────
//      Relay-URL = https://<project-ref>.supabase.co/functions/v1/vendor-relay
//
//  Routen:  /vendor-relay/govee/...     → https://openapi.api.govee.com/...
//           /vendor-relay/switchbot/... → https://api.switch-bot.com/...
//           /vendor-relay/health        → Selbsttest, ohne Zugangsdaten
// ══════════════════════════════════════════════════════════════════════════

const UPSTREAM: Record<string, string> = {
  govee: 'https://openapi.api.govee.com',
  switchbot: 'https://api.switch-bot.com',
  'tuya-eu': 'https://openapi.tuyaeu.com',
  'tuya-us': 'https://openapi.tuyaus.com',
  'tuya-cn': 'https://openapi.tuyacn.com',
  'tuya-in': 'https://openapi.tuyain.com',
}

// Nur die Header, die die Hersteller-APIs wirklich benutzen: Govee-Key,
// SwitchBots HMAC-Satz und Tuyas signierte Anfrage-Header.
const ALLOWED_HEADERS = [
  'govee-api-key', 'authorization', 'sign', 't', 'nonce', 'content-type',
  'client_id', 'access_token', 'sign_method',
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(','),
  'Access-Control-Max-Age': '86400',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(req.url)
  // Pfad hinter dem Function-Namen: /vendor-relay/<vendor>/<rest…>
  const parts = url.pathname.split('/').filter(Boolean)
  const fnIdx = parts.indexOf('vendor-relay')
  const vendor = parts[fnIdx + 1]

  /*
   * Selbsttest ohne Zugangsdaten.
   *
   * Der Grund dafür ist Diagnose: schlägt eine Relay-Anfrage fehl, kann das an
   * der URL liegen, am fehlenden --no-verify-jwt, an falschen Hersteller-Keys
   * oder daran, dass der Hersteller selbst nein sagt. Diese Route trennt die
   * ersten beiden Fälle von den letzten beiden — sie ist im Browser direkt
   * aufrufbar, und wer JSON sieht, weiss: Relay steht, Fehler liegt weiter
   * hinten.
   */
  if (vendor === 'health' || vendor === undefined) {
    return json({
      ok: true,
      service: 'vendor-relay',
      vendors: Object.keys(UPSTREAM),
      hint: 'Relay-URL in der App: der Teil bis einschliesslich /vendor-relay',
      time: new Date().toISOString(),
    })
  }

  const upstream = UPSTREAM[vendor]
  if (!upstream) {
    return json({ error: 'unknown vendor', vendor, known: Object.keys(UPSTREAM) }, 404)
  }

  const rest = '/' + parts.slice(fnIdx + 2).join('/')
  const headers = new Headers()
  for (const h of ALLOWED_HEADERS) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }

  let res: Response
  try {
    res = await fetch(upstream + rest + url.search, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    })
  } catch (e) {
    // Der Hersteller war nicht erreichbar — das ist etwas anderes als ein
    // abgelehnter Aufruf, und der Unterschied gehört in die Antwort.
    return json({ error: 'upstream unreachable', vendor, detail: String(e) }, 502)
  }

  // Body als Bytes durchreichen statt als Text: die Hersteller-APIs liefern
  // JSON, aber ein Snapshot oder ein Bild wäre über `res.text()` zerstört.
  return new Response(res.body, {
    status: res.status,
    headers: {
      ...cors,
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  })
})
