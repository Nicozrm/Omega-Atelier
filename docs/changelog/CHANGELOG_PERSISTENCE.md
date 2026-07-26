# CHANGELOG — Meilenstein: Persistenz-Robustheit & Schema-Migration

> Bewertet nach Phase-2-Protokoll (P0–P4). Schließt den letzten verbliebenen
> **P0-Datenverlust-Pfad** und legt die versionierte Daten-Grundlage (P1) für
> alle künftigen Schema-Änderungen.

## Problem (P0 — Datenverlust / inkonsistente Zustände)

Pläne betraten die App über **drei untrusted Grenzen**, von denen zwei
ungeschützt waren:

1. **localStorage** (`loadLocalPlan`): `if (parsed.schemaVersion !== 2) return
   null` — verwarf die vom Nutzer erstellte Arbeit **kommentarlos** bei jeder
   Versions-Abweichung. Keine Migration, keine Struktur-Validierung. Sobald
   `schemaVersion` je auf 3 steigt, wären **alle** lokalen Pläne weg.
2. **Cloud** (`Editor`, `PlanRow.doc`): `loadDocument(row.doc, true)` — **ohne
   jede Prüfung**. Ein beschädigtes/inkompatibles Dokument floss direkt in den
   Store und konnte den Editor weiß-screenen (inkonsistenter Zustand).
3. **Realtime** (`useRealtimePlan`): Broadcast-Payloads anderer Clients wurden
   ebenfalls ungeprüft übernommen.

## Lösung

**Neues Modul `src/lib/planSchema.ts`** — ein einziges, gehärtetes Tor, das
alle drei Grenzen nutzen. Abhängigkeitsarm (kein three.js), damit es auf jedem
Ladepfad sitzen kann.

`coercePlan(raw: unknown): PlanDocument | null`:
1. **lehnt Nicht-Objekte ab** (null, Primitive, Arrays),
2. **migriert** ältere Schema-Versionen vorwärts durch eine registrierte
   Migrations-Kette (`MIGRATIONS`, erweiterbar für künftiges v2→v3),
3. **validiert + repariert** rettbare Dokumente: fehlende Arrays → `[]`,
   fehlende `settings`-Felder → Defaults, baumelnde `activeFloorId` → erster
   Floor, ungültige `activeModeKey` → `'auto'`, strukturell kaputte
   Wände/Geräte/Möbel/Labels werden herausgefiltert, fehlende IDs generiert,
4. gibt einen **sauberen `PlanDocument`** zurück — `null` nur, wenn das
   Dokument wirklich unrettbar ist (kein einziger valider Floor).

Grundprinzip: **nie still verwerfen, Rettbares reparieren, nur echten Müll
ablehnen.** Unbekannte-aber-harmlose Felder bleiben erhalten (Forward-Compat).

`parsePlanJSON(raw)` kapselt JSON-Parsing + Coercion, wirft nie.

## Integration (alle drei Grenzen)

- `loadLocalPlan` → `parsePlanJSON(localStorage…)` (migriert/validiert statt
  zu verwerfen).
- `Editor` Cloud-Load → `coercePlan(row.doc)`; bei `null` klare Fehlermeldung
  („Plan ist beschädigt oder hat ein inkompatibles Format") statt White-Screen.
- `useRealtimePlan` → `coercePlan(row.doc)` an der Quelle; fehlerhafte
  Remote-Payloads werden ignoriert (schützt Konflikt- und Silent-Apply-Pfad).

## Tests (P1)

**`src/lib/planSchema.test.ts` — 20 Tests**, alle grün. Abgedeckt:
Müll-Ablehnung (null/Primitive/Array/leere Floors), Pass-Through valider Docs,
Forward-Compat (unbekannte Felder bleiben), Migration (fehlende Version / v1 /
neuere Version), strukturelle Reparatur (fehlende Arrays, generierte IDs,
gefilterte kaputte Items, baumelnde `activeFloorId`, ungültiger Mode,
partielle Settings, fehlende Modes/Timestamps, kaputtes Extent) sowie
`parsePlanJSON` (invalides JSON, serialisierte valide/Legacy-Pläne).

**Coverage `planSchema.ts`: ~95 % Statements, 96 % Branch, 100 % Funktionen.**
Gesamt-Testsuite jetzt **88 Tests**.

## Validierung (Phase 5)

`npm run lint` 0/0 · `npm run typecheck` sauber · `npm run test` 88/88 ·
`npm run build` grün. (ESLint-Regel `no-unused-vars` um `ignoreRestSiblings`
ergänzt — idiomatisches „Key-weglassen via Rest"-Muster.)

## Entscheidungsmatrix-Abgleich

Architektur ✓ (Validierung an der Grenze, Vertrauen intern) ·
Wiederverwendbarkeit ✓ (ein Tor für alle Pfade) · Tech-Schuld ↓↓ (zwei
ungeschützte Grenzen + ein Datenverlust-Pfad beseitigt) · skalierbar ✓
(Migrations-Framework für jedes künftige Schema) · Design-System ✓ (unberührt)
· wartbar ✓ · testbar ✓✓ (95 % Coverage) · performant ✓ (reine Funktionen,
kein three.js) · **sicher ✓✓** (kein Datenverlust, kein Crash durch fremde
Daten) · größter Nutzen ✓.
