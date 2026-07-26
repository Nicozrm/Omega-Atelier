# Next Sprint — Empfehlung: v44 · Einfache Automationen (Trigger → Szene)

> Status: **Vorschlag zur Freigabe.** Noch nicht implementiert.
> Projektstand: v43 (Connectorübergreifende Szenen).

## Warum dieser Schritt
Beide jüngsten Strategie-Analysen (v42 `CHANGELOG_3D_LIVE_REFLECTION.md`,
v43 `CHANGELOG_CROSS_CONNECTOR_SCENES.md`) empfehlen **dasselbe**: nach „Szenen
manuell anwenden" folgt „Szenen **autonom** auslösen". Das macht den Digital Twin
von *steuerbar* zu *selbsttätig*.

## Code-Grundlage verifiziert (alle Bausteine existieren bereits)
| Baustein | Quelle | Rolle in v44 |
|---|---|---|
| `OMEGA_MODES[].trigger` (`time {from,to}`, `presence`, `manual`) | `src/lib/constants.ts` | **Trigger-Metadaten** — schon definiert je Modus |
| `deriveEnvironment().phase` / `elevation` | `src/lib/environment.ts` | **Sonnenstand-Trigger** |
| Raum-`motion.detected` | `src/twin/binding.ts` | **Bewegungs-Trigger** |
| `totalEnergyW(devices)` | `src/twin/scenes.ts` | energie-bewusste Bedingung |
| `sceneCommands(devices, mode, env)` | `src/twin/scenes.ts` | **Aktion** (vorhanden) |
| `twinManager.applyScene(scene, cmds)` | `src/twin/twinManager.ts` | **Fan-out über Connectoren** (vorhanden) |

→ v44 ist eine **dünne, additive App-Layer-Engine**, die Trigger auswertet und die
**bereits existierende** Szenen-Anwendung aufruft. **Kein Core-Eingriff**
(`src/domain/` bleibt unverändert), **keine Duplizierung** der Mode-/Befehlslogik.

## Vorgeschlagener Umfang
1. **Reine Auswerte-Logik** (`src/twin/automation.ts`, renderer-/three-frei, unit-getestet):
   - `Automation` = `{ id, enabled, trigger, sceneMode }`.
   - `triggerMatches(trigger, ctx)` mit `ctx = { now, env, motionByRoom, presence }`.
   - Trigger-Typen aus vorhandenen Quellen: `time` (Fenster aus `OMEGA_MODES`),
     `phase`/Sonnenstand, `motion` (Raum), `presence`.
   - `dueAutomations(automations, ctx, lastFired)` mit Entprellung (kein Dauerfeuer).
2. **Engine-Anbindung**: in `ConnectorManager` (oder kleiner Hook) den Live-Tick nutzen,
   um `dueAutomations` → `applyScene(mode, sceneCommands(...))` zu fahren.
3. **UI**: schmale Automations-Liste (an-/abschaltbar, „Auslöser → Modus"),
   konsistent mit der bestehenden Szenen-Leiste und Design-Tokens.
4. **Persistenz (minimal, optional)**: Automationen über bestehende UI-Store-Persistenz
   (`useUIStore`) statt Plan-Schema-Migration — hält das Risiko niedrig.

## Risiko & Aufwand
- **Risiko: niedrig.** Trigger-Auswertung ist reine Funktion; Aktion existiert bereits.
- **Bundle:** Engine-Logik klein; UI im bestehenden Lazy-`ConnectorManager`-Chunk →
  **Initial-Bundle soll konstant bleiben** (Ziel: byte-nahe Parität, wie v42/v43).

## Definition of Done
TS ✓ · ESLint 0/0 ✓ · neue Unit-Tests für `triggerMatches`/`dueAutomations` ✓ ·
`src/domain/` unverändert (grep) ✓ · Build grün ✓ · Initial-Bundle ~konstant ✓ ·
sichtbarer Mehrwert (eine Szene löst autonom über mehrere Connectoren aus) ✓.

## Alternative (später, nicht jetzt)
**Persistente Gerätebindung** (Live-Gerät ↔ platziertes Plan-Gerät) — höhere
räumliche Treue, aber Persistenz-Migration + Eingriff ins gemiedene Editor-Canvas =
höheres Risiko, **keine neue Fähigkeit**. Sinnvoll erst, nachdem die Wohnung
handlungsfähig (automatisiert) ist.
