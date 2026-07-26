# OMEGA Atelier 2.0 — Architektur-Richtlinien

> **Verbindliche Arbeitsgrundlage.** Jede Änderung erfolgt auf dem *aktuellen*
> Stand dieser Architektur. Es wird **nicht** rekursiv nach alten Varianten,
> Legacy-Code oder historischen Implementierungen gesucht. Ältere Ansätze sind
> nicht mehr maßgeblich — die hier beschriebenen Entry-Points und
> Kernkomponenten sind die einzige gültige Referenz.

OMEGA Atelier 2.0 ist ein Smart-Home-Planungstool: interaktiver 2D-Grundriss-
Editor, photorealistische 3D-Visualisierung und ein herstellerneutraler
Digital-Twin, der reale Ökosysteme (Home Assistant, MQTT, Matter …) anbindet.

**Stack:** React 18 · TypeScript · Vite · Zustand · React-Router · Three.js
(`@react-three/fiber` + `drei` + `postprocessing`) · Tailwind (v4) · Supabase
(Auth · Postgres · Realtime) · Vitest.

---

## 1. Entry-Points (in Ladereihenfolge)

| Datei | Rolle |
| --- | --- |
| `index.html` | HTML-Shell, lädt `/src/main.tsx` als ESM-Modul. |
| `src/main.tsx` | Bootstrap: `installChunkRecovery()`, `<ErrorBoundary>` → `<App/>` in React StrictMode. |
| `src/App.tsx` | **Router-Wurzel.** Definiert alle Routen, initialisiert Auth (`ensureAuthInit`), mountet globale Overlays (`AmbientScene`, `ToastViewport`, `CommandPalette`, `KeyboardHelp`). |

### Routen (`App.tsx`)

| Pfad | Seite (lazy) | Schutz |
| --- | --- | --- |
| `/`, `/start` | `StartScreen` *(eager)* | öffentlich |
| `/login` | `pages/Login` | öffentlich |
| `/plans` | `pages/Plans` | `AuthGate` |
| `/plan/:id` | `pages/Editor` | `AuthGate` |
| `/dashboard` | `pages/Dashboard` | `AuthGate` |
| `/settings` | `pages/Settings` | `AuthGate` |
| `*` | → `/dashboard` | — |

Alle Seiten außer `StartScreen` sind `React.lazy`-Chunks (Code-Splitting). Der
schwere Editor + Canvas + 3D landet damit nicht im Initial-Bundle.

---

## 2. Kernkomponenten

| Komponente | Pfad | Verantwortung |
| --- | --- | --- |
| **StartScreen** | `components/ui/StartScreen.tsx` | Landing-/Hero-Screen, „Resume/Demo/Blank“-Einstieg. Custom-Assets, keine Stock-Icons im Hero. |
| **Dashboard** | `pages/Dashboard.tsx` | Geräte-/Modus-Übersicht, bettet die 3D-View (lazy) ein. |
| **Editor** | `pages/Editor.tsx` | Editor-Shell: Topbar, Toolbar, FloorTabs, Panels, Workspace-Rails; verbindet Store, Hotkeys und Realtime. |
| **Canvas** | `components/editor/Canvas.tsx` | 2D-Grundriss-Editor. **Reines HTML5-Canvas mit eigener `requestAnimationFrame`-Renderschleife**, entkoppelt vom React-Render. Weltkoordinaten in **cm**; Viewport hält `zoom` (px/cm) + Offset. Maus in `ref`, nicht `state`. |
| **ThreeDView** | `components/3d/ThreeDView.tsx` | 3D-Visualisierung (R3F). ACES-Tonemap, PBR-Materialien, Post-Processing (tier-gegated). Datei ist bewusst `@ts-nocheck` wegen R3F-JSX-Typen. |
| **usePlanStore** | `store/usePlanStore.ts` | **Single Source of Truth** des Editors (siehe §4). |

---

## 3. Verzeichnis-Schichten

Von innen (rein/neutral) nach außen (UI/IO). **Abhängigkeiten zeigen immer nach
innen** — die Domain kennt weder React noch Supabase noch Three.js.

```
src/
├── types/            Zentrale Typen (types/index.ts) — alle Domänenobjekte.
├── domain/           Hersteller-/renderer-/connector-NEUTRALER Kern des Twins:
│                     capabilities · device · connector · runtime. Reine Daten
│                     & Logik, keine IO. Wird NIE von Integrationen verändert.
├── twin/             Digital-Twin-Laufzeit: binding · reflection · scenes ·
│                     twinManager. Bindet Plan-Geräte an Connector-Entities.
├── connectors/       Konkrete Ökosystem-Anbindungen, bauen auf domain/ auf:
│                     homeAssistant/ · mqtt/ (je transport + mapping + connector,
│                     inkl. simulierter Transport für Tests/Offline).
├── store/            Zustand-Stores: usePlanStore (Plan/Undo/Cloud),
│                     useAuthStore (Supabase-Auth), useUIStore (Theme/Panels/
│                     Toasts/viewMode 2d|3d|twin).
├── hooks/            useHotkeys · useRealtimePlan (Live-Cursor + Doc-Sync).
├── lib/              Reine Utilities & Engines: materials · lighting · solar ·
│                     environment · modeState · planSchema (coerce/parse) ·
│                     supabase · chunkRecovery · utils …
├── data/             Statische Kataloge: devices · furniture · materials ·
│                     templates · demoPlan.
├── pages/            Route-Level-Komponenten (Dashboard/Editor/Plans/Login/Settings).
├── components/       Feature-Komponenten, gruppiert nach Bereich:
│                     3d/ · editor/ · auth/ · connectors/ · devices/ · export/ ·
│                     layout/ · library/ · modes/ · plans/ · twin/ · ui/
├── features/         Feature-Composites (features/workspace: Rail/Inspector/Library).
├── ui/               Design-System-Primitive: Button · Card · Dialog · Panel …
├── design-system/    Tokens (design-system/tokens.ts).
├── styles/           Globales CSS (styles/index.css).
└── test/             Test-Setup.
```

**Regel:** `domain/` und `lib/` bleiben frei von React/IO. Neue Ökosysteme
kommen als weiterer Ordner unter `connectors/` hinzu und bauen ausschließlich
auf `domain/`-Verträgen auf — der Kern wird dafür nicht angefasst.

---

## 4. Zustandsverwaltung

Drei getrennte Zustand-Stores; UI-Zustand verschmutzt nie die Undo-Historie.

- **`usePlanStore`** — das Plandokument (`PlanDocument`) plus transienter
  Editor-Zustand (`tool`, `selection`, `viewport`, Hover).
  - **Immutable Snapshots** für Undo/Redo (`past`/`future`, `UNDO_LIMIT = 80`).
  - Alle Mutationen laufen über `updateDoc(mut, { history })` → klont via
    `structuredClone`, stempelt `updatedAt` + `clientId`, pusht in History.
  - **Persistenz zweigleisig:** debounced `localStorage` (Offline-Fallback,
    `LOCAL_KEY`) **und** Supabase-Cloud (`saveToCloud` mit optimistischem
    Locking über `docVersion`; Konflikt → `{ conflict, remoteVersion }`).
  - Eingehende/lokale Daten werden über `planSchema` (`coercePlan`/`parsePlanJSON`)
    validiert & migriert — nie ungeprüft übernommen.
- **`useAuthStore`** — Supabase-Session/User, OAuth (Google/Apple) + Passwort.
- **`useUIStore`** — Theme, offene Panels, Toasts, `viewMode` (`2d|3d|twin`).

**Konvention:** Immer selektiv subscriben (`usePlanStore(s => s.doc)`), nie den
ganzen Store ziehen — verhindert unnötige Re-Renders.

---

## 5. Realtime & Kollaboration

`hooks/useRealtimePlan.ts` öffnet pro geöffnetem Plan zwei Supabase-Kanäle:

1. **Postgres-Changes** auf der `plans`-Zeile → eingehende Doc-Updates anderer.
2. **Broadcast** (`plan:cursor:<id>`) für Live-Cursor + Presence.

Konfliktauflösung: Jedes `PlanDocument` trägt eine `clientId` (pro Tab, siehe
`getSessionClientId()`). Echos eigener Writes werden verworfen; fremde Änderungen
werden bei lokal-inaktivem Nutzer still übernommen, sonst per Toast angeboten.

---

## 6. Konventionen für Änderungen

1. **Nur aktueller Stand.** Beginne bei der aktuellen Projektstruktur, öffne nur
   die für die Aufgabe relevanten Dateien. Keine Suche nach Legacy-Varianten.
2. **Import-Alias `@/`** = `src/` (siehe `tsconfig.json`). Keine langen
   relativen Pfade.
3. **Einheiten:** Grundriss-Weltkoordinaten in **Zentimetern**. Viewport-Zoom =
   Pixel pro cm.
4. **Neue Domänenobjekte** zuerst in `types/index.ts` typisieren, dann verwenden.
5. **Persistenz-sicher:** Neue Doc-Felder in `planSchema` (`coercePlan`)
   berücksichtigen, damit alte gespeicherte Pläne weiter laden.
6. **State-Trennung wahren:** UI-Transientes → `useUIStore`; alles, was Teil des
   Plans ist und Undo/Redo unterliegt → `usePlanStore.updateDoc`.
7. **Neue Ökosysteme** → neuer Ordner in `connectors/` auf Basis von `domain/`;
   Kern (`domain/`) bleibt unberührt. Simulierten Transport für Tests mitliefern.
8. **Code-Splitting** beibehalten: schwere/selten genutzte Views (Editor, 3D,
   Export-Dialog) bleiben `React.lazy`.
9. **Tests:** Vitest, Tests liegen neben der Quelle (`*.test.ts[x]`). Kern-Logik
   (`domain/`, `twin/`, `lib/`, Store) ist getestet — dort Tests mitführen.

---

## 7. Omega AI Home Composer

Ein zweiter Einstiegspunkt zum Erstellen eines Projekts: aus einem Tap auf eine
Satellitenkarte entsteht in Sekunden ein realistischer, vollständig editierbarer
Digital Twin. **Offline-first & deterministisch** — kein Netz, keine ML-Laufzeit:
jedes Ergebnis wird aus einem Seed abgeleitet, der aus der getippten
Geo-Koordinate gehasht wird (gleicher Ort → gleicher Twin, voll testbar).

**Pipeline** (`src/lib/composer/`, rein — kein React/IO, jedes Modul austauschbar):

```
MapProvider → SatelliteImage → PropertyDetector → BuildingDetector
→ RoofDetector → VegetationDetector → TerrainDetector → ConfidenceEngine
→ SceneBuilder → ProjectGenerator → PlanDocument
```

| Modul | Datei | Rolle |
| --- | --- | --- |
| `rng` · `geo` · `world` | `rng.ts` · `geo.ts` · `world.ts` | Seeded PRNG, Geodäsie + Offline-Geocoder, deterministisches Parzellen-Raster. |
| `MapProvider` | `mapProvider.ts` | Swappable Kartenquelle; `OfflineMapProvider` als Default. |
| Detektoren | `propertyDetector.ts` … `vegetationDetector.ts` | Grundstück · Gebäude (Garage/Anbau/Wintergarten/Carport/Balkon/Terrasse) · Dach · Gelände (Hang/Einfahrt/Treppen) · Vegetation (Bäume/Hecken/Rasen/Pool). |
| `MapAnalysisEngine` | `analysisEngine.ts` | Orchestriert die Pipeline: async, abbrechbar (`AbortSignal`), Fortschritts-Events. |
| `ConfidenceEngine` | `confidenceEngine.ts` | Confidence-Score pro Objekt (Innenwände bewusst niedrig). |
| `SceneBuilder` · `ProjectGenerator` | `sceneBuilder.ts` · `projectGenerator.ts` | metrische Szene → cm-Draft (plausibler Grundriss) → valides `PlanDocument`. |

**Store:** `store/useComposerStore.ts` (`AnalysisStore`) — Wizard-Schritt, Suche/
GPS, Karten-View/Pin/Polygon, abbrechbare Analyse mit Retry. Getrennt von
`usePlanStore`; der fertige Plan wird via `loadDocument` übergeben.

**UI:** `components/composer/` — `ComposerWizard` (4 Schritte, global gemountet
wie der Insights-Dialog), `MapComposer` + `MapCanvas` (Offline-Aerial, Pan/Zoom/
Pin), `AnalysisStage` (Cinematic: goldener Scan, Partikel, Checkliste). Einstieg
über den Button **„AI Home Composer"** auf der Plans-Seite.

---

## 8. Build & Qualität

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Vite-Dev-Server. |
| `npm run build` | `tsc -b` + `vite build`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint (max. 0 Warnungen). |
| `npm test` | Vitest (einmalig). |

Umgebungsvariablen (Supabase u. a.): siehe `.env.example`. Ohne Supabase-Config
läuft die App im Offline-/Demo-Modus (`supabaseReady === false`).
