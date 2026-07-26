# CHANGELOG — Meilenstein: Cloud-Stabilität & Sync-Test-Härtung

> Phase 2 (Produktreife) · **P1**. Erster Sprint unter der erweiterten Regel:
> **technisches Fundament + sichtbares Produkt-/UX-Element parallel.**
> Gemessen an der strategischen Leitlinie — insbesondere **Offline First** und
> **Quality First**.

---

## Strang A — Technisches Fundament: Cloud-Sync gehärtet & getestet

### Problem (P1, grenzt an P0-Datenverlust)
Der Supabase-Sync-Pfad des Stores (`saveToCloud` / `reloadFromCloud`) war
komplett **ungetestet** — der größte verbleibende datenkritische Logik-Block.
Zusätzlich deckte die Analyse eine konkrete Lücke auf: **`reloadFromCloud`
umging `coercePlan`** und schrieb die Remote-Payload ungeprüft in den State,
während alle anderen Cloud-Lade-Pfade (Editor-Initial-Load, Realtime) bereits
validierten.

### Lösung
- **`reloadFromCloud` gehärtet:** Remote-`doc` läuft jetzt durch `coercePlan`;
  ungültige Payloads werden abgewiesen (`return false`) statt den lokalen Zustand
  zu zerstören. Damit validieren **alle drei** Cloud-Lade-Pfade einheitlich.
- **Persistente Fehlersichtbarkeit:** neues Store-Feld `lastSyncError`
  (gesetzt bei Sync-Fehler, gelöscht bei Start/Erfolg/Cloud-Load). Fehler sind
  nun dauerhaft sichtbar statt nur als flüchtiger Toast.
- **Sync-Konsistenz bei Cloud-Load:** `loadDocument(..., fromCloud=true)` stempelt
  `lastSavedAt` — ein frisch geladener Plan gilt korrekt als *synchronisiert*,
  nicht als „ungespeichert".

### Tests
- `src/store/usePlanStore.cloudSync.test.ts` — **12 Tests** gegen einen
  gemockten Supabase-Client (chainable Query-Builder via `vi.hoisted`/`vi.mock`):
  - `saveToCloud`: kein Doc → null; Supabase nicht konfiguriert → null; nicht
    angemeldet → null + Fehler; **Insert** (neuer Plan, Version 1, markiert
    gespeichert); Insert-Fehler → null + Fehler; **Update** (Version inkrementiert,
    kein Konflikt); **Konflikt** (Remote neuer → Konflikt-Deskriptor, nicht als
    gespeichert markiert); Versions-Lese-Fehler → null + Fehler.
  - `reloadFromCloud`: valider Payload → ersetzt Doc + leert Historie; **invalider
    Payload → abgewiesen, lokaler Zustand unangetastet** (coercePlan-Härtung);
    Lese-Fehler → false; nicht konfiguriert → false.

---

## Strang B — Sichtbares Feature: Sync-Status-Indikator

### Was
Ein kompakter, stets sichtbarer **Sync-Status** in der Topbar ersetzt die
bisherige minimale Zwei-Zustands-Anzeige. Er kommuniziert klar, **wo der Plan
lebt** und ob lokale Änderungen gesichert sind:

| Zustand | Anzeige |
|---|---|
| `local-only` | ⊘ **Nur lokal** — kein Cloud-Backend / nicht angemeldet (Offline-First-Zustand) |
| `saving` | ↑ **Speichert …** |
| `saved` | ✓ **Gespeichert vor X** (mit exaktem Zeitstempel im Tooltip) |
| `dirty` | ☁ **Nicht gespeichert** — lokale Änderungen noch nicht in der Cloud |
| `error` | △ **Sync-Fehler** (Fehlermeldung im Tooltip) |

Das macht das **Offline-First-Prinzip greifbar**: Nutzer sehen sofort, dass die
App ohne Backend voll funktioniert und ihre Arbeit lokal sicher ist — und werden
gewarnt, wenn ein Cloud-Sync fehlschlägt.

### Architektur
- **`src/lib/syncStatus.ts`** — reine, React-/Supabase-freie Funktion
  `deriveSyncStatus()` mit klar definierter Zustands-Präzedenz. Vollständig
  isoliert testbar.
- **`src/components/layout/SyncStatus.tsx`** — dünne Präsentationsschicht, die
  die Ableitung auf markenkonforme Icons/Farben/Tooltips abbildet.

### Tests
- `src/lib/syncStatus.test.ts` — **9 Tests**: alle fünf Zustände, Präzedenz
  (saving > local-only > error > dirty > saved), Dirty-Kanten (nie synchronisiert,
  fehlendes/unparsbares `updatedAt`, Edit neuer als letzter Sync).

---

## Validierung (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build erfolgreich | ✅ |
| TypeScript fehlerfrei | ✅ |
| ESLint 0/0 | ✅ |
| Tests erfolgreich | ✅ **119** (vorher 98; +21) |
| Dokumentation aktualisiert | ✅ (dieses Dokument) |
| Architektur geprüft | ✅ (reine Logik von UI/Netz entkoppelt) |
| Keine Regressionen | ✅ (Laufzeit-Verifikation Topbar + Dialoge) |
| Performance ≥ vorher | ✅ (Initial-Bundle 97 KB, unverändert) |
| Erweiterbarkeit | ✅ (Sync-Logik testbar von Supabase getrennt — Vorarbeit für Connector-First) |

## Leitlinien-Abgleich

**Offline First ✓✓** (lokal-only explizit kommuniziert, Cloud bleibt optional) ·
**Quality First ✓✓** (letzter datenkritischer Pfad unter Test, Validierungslücke
geschlossen, keine undokumentierte Schuld) · **Digital Twin First ✓** (Vertrauen
in den Zustand des digitalen Hauses) · **Connector First ✓** (Sync-Logik von
Supabase entkoppelt getestet — erleichtert spätere Connector-Abstraktion) ·
**technische Exzellenz + sichtbarer Produktfortschritt parallel ✓✓**.
