# Deployment

## Live-Hosting: GitHub Pages (Actions)
Jeder Sprint wird nach grünen Gates automatisch live deployt (Definition-of-Done).

**Workflow:** `.github/workflows/deploy-pages.yml`
- Trigger: Push auf `main`/`master`/`claude/omega-atelier-master-tpjpnj` + `workflow_dispatch`.
- Baut mit Pages-Sub-Pfad (`GITHUB_PAGES_BASE` aus `configure-pages` → `/<repo>/`),
  legt `404.html` (SPA/PWA Deep-Link-Fallback) an, lädt `dist` als Pages-Artefakt hoch,
  deployt via offizielle `actions/deploy-pages`.
- Nutzt den eingebauten `GITHUB_TOKEN` (kein externes Secret).

**Einmalige Voraussetzung (Repo-Settings):** Settings → Pages → *Build and deployment* →
Source = **GitHub Actions**. Der Workflow versucht dies via `configure-pages` (enablement)
automatisch; falls die Organisation das blockt, einmal manuell setzen.

## Base-Pfad-Strategie (ein Code, zwei Hosts)
`vite.config.ts` liest `process.env.GITHUB_PAGES_BASE`:
- **GitHub Pages:** `/<repo>/` (Projekt-Site-Unterpfad) — Assets, Manifest-`start_url`/`scope`
  und Router-`basename` (`import.meta.env.BASE_URL`) ziehen automatisch mit.
- **Lokal:** unbesetzt → `/` (Root).

GitHub Pages ist der einzige Host; die frühere Vercel-Konfiguration ist entfernt.

## Live-URL
`https://<owner>.github.io/<repo>/` → für dieses Repo:
`https://nicozrmn.github.io/OmegaAtelier/`

## Verifikation nach Deploy
HTTP 200 auf Live-URL · Entry-JS + Assets laden (kein 404) · Manifest/PWA erreichbar.
