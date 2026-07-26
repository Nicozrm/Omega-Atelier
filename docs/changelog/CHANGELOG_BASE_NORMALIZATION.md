# v53 — Projektbasis-Normalisierung

Das Repository wurde aus einem inkonsistenten Zustand (flacher Datei-Dump älterer
Stände **+** redundante `v52.zip`, zusammen eine nicht kompilierende „zweite Wahrheit")
auf **eine** kanonische Projektbasis gesetzt: der vollständige `src/`-Baum aus
`omega-atelier-mobile-placement v52` mit Tests, CI-Workflow und Lockfile.

## Begründung (verifiziert)
- Der flache Root war **nicht baubar** — `App.tsx` importiert `@/pages/…`,
  `@/components/…`, `@/store/…` (die `src/`-Struktur existierte nur im ZIP).
- Root-`package.json` wich vom ZIP ab (kein Vitest, älter).
- Zwei widersprüchliche Stände im Repo verstießen gegen „keine zweite Wahrheit".

## Änderungen
- Repo-Inhalt deterministisch == v52-Baum gesetzt (flache Duplikate entfernt,
  In-Repo-ZIP entfernt, kanonischer `src/`-Baum gelegt).
- `npm ci` → 717 Pakete (Lockfile synchron).

## Gates
| Gate | Ergebnis |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 Fehler |
| ESLint (`--max-warnings 0`) | ✅ 0/0 |
| Vitest | ✅ 224/224 (26 Dateien) |
| Build (`tsc -b && vite build`) | ✅ erfolgreich, PWA generiert |
| Lazy Loading | ✅ erhalten (three/supabase/router/Editor/3D je Lazy-Chunk) |

## Kein Code-Eingriff
Reine Repo-Hygiene — **keine** Quelländerung am v52-Stand. `src/domain/`,
Business-Logik und Bundle unverändert gegenüber v52.

## Abweichung
Keine In-Repo-Projekt-ZIP erzeugt (würde die entfernte Duplizierung wieder
einführen) — das Git-Repo ist nun die einzige Projektbasis. Details in
`SPRINT_REPORT.md`.

## Nächster Schritt
Siehe `NEXT_SPRINT.md` — Empfehlung **v44: Einfache Automationen (Trigger → Szene)**.
