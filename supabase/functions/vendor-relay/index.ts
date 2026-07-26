// vendor-relay — tiny CORS relay for the brand-cloud connectors.
//
// The Govee and SwitchBot APIs send no CORS headers, so a browser app cannot
// call them directly. This Supabase Edge Function forwards requests 1:1 and
// adds CORS for the app origin. It stores NOTHING and adds NO credentials —
// the browser sends the user's own API headers through untouched.
//
// Deploy:  supabase functions deploy vendor-relay --no-verify-jwt
// App:     Relay-URL = https://jaeufqmehslmqvzosrum.supabase.co/functions/v1/vendor-relay
//
// Routes:  /vendor-relay/govee/...     → https://openapi.api.govee.com/...
//          /vendor-relay/switchbot/... → https://api.switch-bot.com/...

const UPSTREAM: Record<string, string> = {
  govee: 'https://openapi.api.govee.com',
  switchbot: 'https://api.switch-bot.com',
  'tuya-eu': 'https://openapi.tuyaeu.com',
  'tuya-us': 'https://openapi.tuyaus.com',
  'tuya-cn': 'https://openapi.tuyacn.com',
  'tuya-in': 'https://openapi.tuyain.com',
}

// Only the headers the vendor APIs actually use may pass through (Govee key,
// SwitchBot HMAC set, and Tuya's signed-request headers).
const ALLOWED_HEADERS = [
  'govee-api-key', 'authorization', 'sign', 't', 'nonce', 'content-type',
  'client_id', 'access_token', 'sign_method',
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(','),
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const url = new URL(req.url)
  // Path after the function name: /vendor-relay/<vendor>/<rest…>
  const parts = url.pathname.split('/').filter(Boolean)
  const fnIdx = parts.indexOf('vendor-relay')
  const vendor = parts[fnIdx + 1]
  const upstream = UPSTREAM[vendor]
  if (!upstream) {
    return new Response(JSON.stringify({ error: 'unknown vendor' }), { status: 404, headers: { ...cors, 'content-type': 'application/json' } })
  }

  const rest = '/' + parts.slice(fnIdx + 2).join('/')
  const headers = new Headers()
  for (const h of ALLOWED_HEADERS) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }

  const res = await fetch(upstream + rest + url.search, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  })

  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'content-type': res.headers.get('content-type') ?? 'application/json' },
  })
})

