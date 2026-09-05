# Deployment auf Vercel

GitHub Pages bleibt der bisherige Weg (`.github/workflows/deploy-pages.yml`).
`vercel.json` kommt dazu, weil die Kasse dort nicht ohne Weiteres funktioniert
— und weil zwei Vercel-Projekte bereits auf dieses Repository zeigen.

---

## Warum die Datei überhaupt nötig ist

**Ohne Rewrite ist jeder Deep-Link ein 404.** OMEGA Atelier ist eine
Single-Page-App: `/checkout`, `/plans`, `/plan/abc` existieren nur im Router,
nicht als Dateien. Ruft jemand `/checkout` direkt auf — aus einem Lesezeichen,
aus einer E-Mail, oder weil der Zahlungsanbieter dorthin zurückleitet —, sucht
Vercel eine Datei namens `checkout` und findet keine.

Genau dieser Fall trifft die Kasse härter als jede andere Seite: die
Rückkehr-URL nach der Zahlung ist `/checkout/done?order=…`. Ein 404 an dieser
Stelle heisst, dass der Kunde gezahlt hat und eine Fehlerseite sieht.

Der Rewrite schickt deshalb alles, was **kein** Dateiname ist, an
`index.html`:

```
/((?!assets/|.*\..*).*)  →  /index.html
```

Die Ausnahmen sind Absicht. `assets/` und alles mit einem Punkt im Namen
(`.js`, `.css`, `.glb`, `.png`, `manifest.webmanifest`, `sw.js`) bleiben echte
Dateien — sonst bekäme der Service Worker `index.html` als Antwort auf seine
eigene Datei zurück und die App liesse sich nie aktualisieren.

## Header

| Header | Warum |
| --- | --- |
| `Cache-Control: immutable` auf `/assets/*` | Vite hängt jedem Bundle einen Hash an. Der Inhalt unter einem Namen ändert sich damit nie — ein Jahr Cache ist hier korrekt, kein Risiko. |
| `X-Content-Type-Options: nosniff` | Der Browser soll den vom Server genannten Typ glauben und nicht raten. |
| `X-Frame-Options: DENY` | Die App darf in keinem fremden Rahmen laufen. Für eine Kasse ist das die Grundlage: eine eingebettete Seite kann mit einer unsichtbaren Ebene überlagert werden, und der Kunde bestätigt dann etwas anderes, als er sieht. |
| `Referrer-Policy: strict-origin-when-cross-origin` | Beim Sprung zum Zahlungsanbieter geht nur die Herkunft mit, nicht der volle Pfad samt Bestell-ID. |
| `Permissions-Policy` | Kamera, Mikrofon und Standort brauchen die Connectoren und der AI Composer — aber nur auf der eigenen Herkunft. Eingebettete Dritte bekommen nichts. |
| `Strict-Transport-Security` | Zwei Jahre HTTPS-Zwang. Gehört zu jeder Seite, auf der bezahlt wird. |

---

## Einrichtung

### 1 · Umgebungsvariablen

Im Vercel-Projekt unter **Settings → Environment Variables**:

```
VITE_SUPABASE_URL       = https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY  = eyJhbGciOi…
```

Beide gehören in den Browser und stehen anschliessend im Bundle — das ist
beabsichtigt und durch Row Level Security abgesichert. Der `service_role`-Key
darf **niemals** unter einem `VITE_`-Präfix stehen: alles mit diesem Präfix
wird in den Client kompiliert.

`GITHUB_PAGES_BASE` bleibt hier ungesetzt. Vercel liefert von der Wurzel aus,
und `vite.config.ts` fällt dann korrekt auf `/` zurück.

### 2 · Supabase-Weiterleitungen freigeben

Supabase Dashboard → **Authentication → URL Configuration** → *Redirect URLs*:

```
https://<projekt>.vercel.app/plans
https://<projekt>.vercel.app/checkout
https://<projekt>.vercel.app/checkout/done
```

Fehlt ein Eintrag, endet die Anmeldung in einer leeren Seite — Supabase leitet
dann auf die Site-URL statt auf das gewünschte Ziel.

Dieselben Hosts gehören in `supabase/config.toml` unter
`additional_redirect_urls`, damit die CLI dieselbe Konfiguration setzt.

### 3 · Checkout-Herkunft freigeben

Die Edge Function `billing-checkout` erlaubt CORS nur für bekannte Herkünfte
(kein `*`, weil sie mit der Service-Rolle arbeitet):

```
supabase secrets set CHECKOUT_ALLOWED_ORIGINS="https://<projekt>.vercel.app,https://omega-atelier.de"
```

### 4 · Vorschau-Deployments

Jeder Pull Request bekommt eine eigene URL. Zwei Dinge dazu:

- Die Vorschau-Hosts sind **nicht** in Supabase freigegeben, also funktioniert
  dort weder Login noch Checkout. Das ist gewollt: eine Vorschau, die echte
  Zahlungen auslösen kann, ist ein Unfall mit Ansage.
- Ohne `VITE_SUPABASE_*` läuft die App im Local-Only-Modus, und die Kasse zeigt
  ihren Demo-Hinweis. Genau dafür ist er da.

---

## Zwei Vercel-Projekte auf diesem Repository

Auf `Nicozrm/Omega-Atelier` zeigen **zwei** Vercel-Projekte:

| Projekt | Root-Verzeichnis | Zweck |
| --- | --- | --- |
| `omegaatelier` | Repo-Wurzel | die App — hierhin gehört alles aus diesem Dokument |
| `omega-atelier` | `docs/assets` | die vier Demo-GIFs der README |

Das zweite Projekt baut nichts: `docs/assets` enthält GIFs und keine
`package.json`. Damit Vercel das auch so behandelt, liegt dort eine eigene
`vercel.json` mit `outputDirectory: "."` — bei gesetztem Root-Verzeichnis ist
das die Datei, die dieses Projekt liest, und sie sagt „ausliefern, nicht
bauen".

Ohne sie greift die Wurzel-`vercel.json` mit ihrem `buildCommand`: die
Abhängigkeiten werden dann in `docs/assets` installiert (wo es keine gibt),
anschliessend läuft das Build-Skript der Wurzel — und scheitert mit
`tsc: command not found`. Genau so ist es beim ersten Deployment dieses
Projekts passiert.

> **Offen, für den Kontoinhaber:** Das Projekt `omega-atelier` deployt
> Feature-Branches mit `target: production` auf
> `omega-atelier-omegaatelier.vercel.app`. Ein Branch überschreibt dort also
> die Produktionsadresse — dieselbe Falle, gegen die `deploy-pages.yml` seit
> einem Vorfall eine harte Sperre hat. Entweder das Projekt auf
> Preview-Deployments umstellen oder, falls die GIFs keine eigene Domain
> brauchen, ganz löschen.

---

## Verhältnis zu GitHub Pages

Beide Ziele können parallel laufen. Unterschied:

| | GitHub Pages | Vercel |
| --- | --- | --- |
| Basispfad | `GITHUB_PAGES_BASE=/OmegaAtelier/` | `/` |
| Deep-Links | `404.html`-Trick des Workflows | Rewrite in `vercel.json` |
| Header | nicht konfigurierbar | siehe oben |

Für die Kasse ist Vercel der bessere Ort — nicht wegen der Geschwindigkeit,
sondern weil sich dort die Sicherheits-Header setzen lassen, die eine
Bezahlseite braucht.
