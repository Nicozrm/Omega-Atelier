# CHANGELOG — Meilenstein: Test- & Qualitäts-Foundation

> Bewertet nach Phase-2-Protokoll (P0–P4). Dieser Meilenstein adressiert
> ausstehende **P0**-Punkte (Typprüfung/Architektur) und legt die
> **Qualitäts-Grundlage** (Tests/CI), die laut Protokoll Abschlusskriterium
> *jedes* weiteren Meilensteins ist.

## P0 — Kritisch (behoben)

**Typprüfung ganzer Dateien war deaktiviert.** Zwei `@ts-nocheck`-Direktiven
(ThreeDView, MobileNav) schalteten die Typsicherheit komplett ab — die
gefährlichste Art versteckter Tech-Schuld.

- `MobileNav`: `@ts-nocheck` + `any`-Casts entfernt. Der Store ist sauber
  typisiert; die Casts waren überflüssig.
- `ThreeDView`: `@ts-nocheck` durch eine kanonische **R3F-v8-JSX-Typaugmentation**
  (`src/types/three-jsx.d.ts`, `IntrinsicElements extends ThreeElements`)
  ersetzt. Die nun aktive Typprüfung deckte **7 latente Bugs** auf:
  `rotation` wurde auf **Geometrien** gesetzt (wo R3F sie wirkungslos
  verwirft) statt auf das `<mesh>`. Folge: Türgriffe, Kameralinsen-Scheiben,
  Ringe und Klingel-Elemente standen falsch orientiert. **Alle 7 korrigiert**
  (Rotation aufs Mesh verschoben → korrekte Ausrichtung).
- Weiterer latenter Bug: `floorMat()` erhielt `FloorVariant | undefined`
  (Outdoor-Räume ohne `floorVariant`) — Signatur ehrlich auf `| undefined`
  geweitet (der `default`-Zweig liefert Parkett, verhaltensgleich).

**6 Lint-Errors → 0.** `@ts-ignore`→`@ts-expect-error` (bzw. entfernt, da
unnötig), `no-extra-semi`, zwei ungenutzte `eslint-disable`-Direktiven.

**Defekte Werkzeugkette.** Das `typecheck`-Script (`tsc -b --noEmit`)
kollidierte mit Composite-Projekten (TS6310) und lief faktisch nie durch →
auf `tsc --noEmit -p tsconfig.json` korrigiert. Testdateien sind aus dem
Produktions-Build/-Typecheck ausgeschlossen.

**Lint gesamt: von 6 Errors + 36 Warnings auf 0/0.** Sämtliche `any`s
domänentypisiert (interne 3D-Komponenten-Props, `.map`-Callbacks, Supabase-
Collaborator-Rows, Material-Keys), toter Code entfernt (`CAT_COLOR`-Map,
`getTouchLocalXY`, `cameraResetRef`, ungenutzte Selektoren/Imports).

## P1 — Qualitäts-Grundlage (neu)

**Test-Infrastruktur (Vitest 2.1).** `vitest.config.ts` (jsdom, globals,
`@`-Alias, v8-Coverage auf `src/lib` + `src/store`), `src/test/setup.ts`
(jest-dom-Matcher, Mock-Reset). Scripts: `test`, `test:watch`,
`test:coverage`.

**68 Unit-Tests, 5 Suiten, alle grün:**

| Suite | Abdeckung |
|---|---|
| `lib/utils.test.ts` | Geometrie (`pointInPolygon` inkl. konkav, `dist`, `snap`, `clamp`), Formatierung (`formatLength`, `timeAgo` DE mit Fake-Timern), `stableHue`, `debounce` |
| `lib/readiness.test.ts` | Readiness-Scoring (Kategorie / Mode-Tags / kombiniert) — **100 % Coverage** |
| `lib/modeState.test.ts` | Mode-Szenen über alle 15 Kategorien × 9 Modi, DE-Formatierung |
| `lib/constants.test.ts` | OMEGA_MODES-Integrität (9 Modi, eindeutige Keys, Hex-Akzente, valide Kategorien), Material-Slots |
| `store/usePlanStore.test.ts` | `loadDocument`, `addDevice`/`addWall`/`addRoom`, **Undo/Redo**, `updateDoc`-History-Flag, `applyMode` (stempelt `modeState`), `fitToView`, `setActiveMode` |

**Coverage Kernlogik:** readiness/constants/materialSlots 100 %, modeState
99 %, Branch-Coverage gesamt 91 %. (Cloud-Sync-Methoden im Store bewusst
offen — benötigen Netzwerk-Mocks, Folge-Meilenstein.)

**Phase-4-Refactor:** Readiness-Scoring aus `ModesPanel` in das pure,
entkoppelte Modul `src/lib/readiness.ts` extrahiert (Katalog als
`DeviceLookup` injiziert statt Hard-Import). Logik raus aus der View → DRY,
testbar, wiederverwendbar.

**CI-Pipeline** (`.github/workflows/ci.yml`): install → lint → typecheck →
test → build, bei jedem Push/PR.

## Validierung (Phase 5)

`npm run lint` 0/0 · `npm run typecheck` sauber · `npm run test` 68/68 ·
`npm run build` grün.

## Entscheidungsmatrix-Abgleich

Architektur ✓ (Typsicherheit wiederhergestellt, Logik aus Views extrahiert) ·
Wiederverwendbarkeit ✓ (readiness-Modul) · Tech-Schuld ↓↓ (beide `@ts-nocheck`
weg, 7 Bugs gefixt, Lint 0/0) · skalierbar ✓ (Test-Fundament für alle
Folge-Features) · Design-System ✓ (unberührt) · wartbar ✓ · testbar ✓✓ ·
performant ✓ (toter Code entfernt) · sicher ✓ · **größter Nutzen** ✓ (sichert
die gesamte bisherige Investition ab).
