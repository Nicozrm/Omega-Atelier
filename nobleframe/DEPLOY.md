# NobleFrame — Deploy (Cloudflare Pages)

Statische Seite + OMEGA-OS-Showcase unter `/showcase/omega-os/`.

## Deploy
```
npx wrangler pages deploy .
```
`functions/` (Egregore-KI-Proxy für OMEGA OS) wird automatisch mitdeployed.

## Secret (für OMEGA-OS-KI „Egregore")
Pages-Projekt > Settings > Environment variables > **ANTHROPIC_API_KEY** (Secret).
Ohne Schlüssel bootet OMEGA OS vollständig; nur die KI-Antworten bleiben aus.

Lokal testen:
```
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars
npx wrangler pages dev .
```

## Struktur
- `*.html` — NobleFrame-Seiten (Root)
- `cinematic-engine.js` — Canvas-2D-Engine für die Scroll-Sequenz der Startseite (ohne Abhängigkeiten, ohne WebGL → läuft zuverlässig auch auf mobilem Safari; Fallback: statischer Hero ohne JS oder bei `prefers-reduced-motion`)
- `showcase/omega-os/` — gebautes OMEGA OS (index.html, bundle.js, icons, SW, manifest)
- `functions/api/egregore.js` — serverseitiger KI-Proxy (`POST /api/egregore`)
- `_headers`, `wrangler.toml` — Cloudflare-Pages-Konfiguration

Hinweis: Der Service-Worker-Cache wurde für die Cinematic-Startseite auf
`nobleframe-v5` erhöht — Bestandsbesucher erhalten die neue Index damit
automatisch beim nächsten Besuch.
