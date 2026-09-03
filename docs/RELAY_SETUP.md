# Supabase-Relay einrichten

Alles, was für das CORS-Relay nötig ist, an einer Stelle.

## Brauche ich das überhaupt?

Nicht für jeden Connector. Am Live-Endpunkt gemessen:

| Cloud | OPTIONS-Preflight | `access-control-allow-origin` | Relay |
|---|---|---|---|
| **Govee** | `200` | gesetzt | optional |
| **SwitchBot** | `404 no Route matched` | fehlt auf jeder Antwort | **Pflicht** |
| **Tuya** | – | fehlt | **Pflicht** |

Ein reiner API-Key hilft bei SwitchBot nicht: jede Anfrage trägt
`Authorization`, das ist kein CORS-safelisted Header, also gibt es *immer*
einen Preflight — und der scheitert. Blockiert wird der Header, nicht die
Signatur.

## Die Dateien

Drei, mehr nicht. Alle liegen bereits im Repo:

| Datei | Zweck |
|---|---|
| `supabase/functions/vendor-relay/index.ts` | Die Function selbst |
| `supabase/config.toml` → `[functions.vendor-relay]` | `verify_jwt = false` |
| `.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Die Relay-URL selbst wird **nicht** als Umgebungsvariable gesetzt — sie wird in
der App eingetragen (Digital Twin → Gerät verbinden → Hersteller-Clouds →
Relay-URL) und liegt im localStorage des Browsers.

## Einrichten

### 1. Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <dein-project-ref>
```

Den `project-ref` findest du in der Projekt-URL:
`https://supabase.com/dashboard/project/<project-ref>`.

### 2. Deployen

```bash
supabase functions deploy vendor-relay --no-verify-jwt
```

**`--no-verify-jwt` ist nicht optional.** Ohne das Flag verlangt Supabase einen
gültigen Supabase-JWT und antwortet auf jede Anfrage mit `401`, bevor sie den
Hersteller erreicht. Im Browser sieht man davon nur „Load failed" — also genau
das Symptom, das man ohne Relay auch hätte, was die Fehlersuche in die falsche
Richtung schickt.

Das ist kein Sicherheitsloch: die Function trägt keine eigenen Rechte und
speichert nichts. Wer sie aufruft, muss seine eigenen Hersteller-Zugangsdaten
mitschicken, und ohne die bekommt er vom Hersteller nichts.

`config.toml` enthält dieselbe Einstellung, damit ein Deploy über die CLI sie
nicht vergessen kann.

### 3. Prüfen, bevor du Zugangsdaten eingibst

Die Function hat eine Selbsttest-Route ohne Zugangsdaten. Im Browser öffnen:

```
https://<project-ref>.supabase.co/functions/v1/vendor-relay/health
```

Erwartete Antwort:

```json
{ "ok": true, "service": "vendor-relay", "vendors": ["govee", "switchbot", …] }
```

Das trennt die Fehlerquellen sauber:

| Was du siehst | Was es bedeutet |
|---|---|
| Das JSON oben | Relay steht. Ein späterer Fehler liegt bei den Zugangsdaten oder beim Hersteller. |
| `401 Invalid JWT` | Ohne `--no-verify-jwt` deployt. Schritt 2 wiederholen. |
| `404` | Falsche URL oder Function nicht deployt. |
| Nichts / Timeout | Projekt pausiert oder falscher `project-ref`. |

### 4. In der App eintragen

Digital Twin → **Gerät verbinden** → **Hersteller-Clouds**:

```
https://<project-ref>.supabase.co/functions/v1/vendor-relay
```

Ohne `/govee` oder `/switchbot` am Ende — das hängt die App selbst an.

## Zugangsdaten der Hersteller

| Cloud | Woher |
|---|---|
| **Govee** | Govee-Home-App → Profil → Über uns → API-Key beantragen (kommt per E-Mail) |
| **SwitchBot** | SwitchBot-App → Profil → Einstellungen → 10× auf „App-Version" tippen → Entwickleroptionen → Token **und** Secret |

Beide bleiben im localStorage dieses Browsers und gehen nur an das eigene
Relay und von dort an den Hersteller.

## Grenzen

Beide Clouds erlauben **10 000 Aufrufe pro Tag und Konto** und haben keinen
Push-Kanal. Die App fragt den Zustand deshalb alle 30 Sekunden ab — ein Aufruf
pro Gerät und Abfrage. Bei fünf Geräten sind das rund 14 400 Aufrufe am Tag,
verteilt auf die Geräte also gut im Rahmen; bei deutlich mehr Geräten wäre das
Intervall in `goveeClient.ts` / `switchbotClient.ts` (`POLL_MS`) anzuheben.
