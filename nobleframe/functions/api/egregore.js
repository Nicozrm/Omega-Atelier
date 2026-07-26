// ============================================================================
// Cloudflare Pages Function — Egregore-Proxy für OMEGA OS.
// Hält den Anthropic-Schlüssel SERVERSEITIG. Der Browser ruft POST /api/egregore
// und sieht den Schlüssel nie. Läuft auf der Workers-Runtime.
//
// Secret setzen:  Pages-Projekt > Settings > Environment variables > Secret
//                 Name: ANTHROPIC_API_KEY
// Lokal testen:   echo "ANTHROPIC_API_KEY=sk-..." > .dev.vars && npx wrangler pages dev dist
// ============================================================================

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS_CAP = 2048;

// Nur Sonnet/Haiku zulassen — robust gegen Versions-Updates, blockt teures Opus.
const modelAllowed = (m) => !m || /^claude-(sonnet|haiku)-/.test(m);

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const host = new URL(request.url).host;

  // Origin-Allowlist: fremde Browser-Apps dürfen den Schlüssel nicht missbrauchen.
  if (origin && new URL(origin).host !== host) return json({ error: "forbidden_origin" }, 403, origin);

  if (!env.ANTHROPIC_API_KEY) return json({ error: "no-key", detail: "ANTHROPIC_API_KEY fehlt auf dem Pages-Projekt." }, 500, origin);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  if (!payload || !Array.isArray(payload.messages)) return json({ error: "bad_payload" }, 400, origin);
  if (!modelAllowed(payload.model)) return json({ error: "model_not_allowed" }, 400, origin);
  if (typeof payload.max_tokens === "number") payload.max_tokens = Math.min(payload.max_tokens, MAX_TOKENS_CAP);

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(payload),
    });
  } catch { return json({ error: "upstream_unreachable" }, 502, origin); }

  // Anthropic-Antwort 1:1 durchreichen — der Client verarbeitet data.content unverändert.
  const body = await upstream.text();
  return new Response(body, { status: upstream.status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
