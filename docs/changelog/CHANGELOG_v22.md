# OMEGA Atelier 2.0 — v22 Changelog

UX-Pass: Fünf Quality-of-Life-Verbesserungen für den Editor-Alltag.

## 1. Keyboard-Shortcut-Overlay

Neue Komponente `KeyboardHelp` — wird global gemountet, öffnet sich beim
Drücken von **`?`** (oder Klick auf das Help-Icon in der Topbar).

- 4 Gruppen: Tools / Bearbeiten / Ansicht / 3D-View
- Jede Tastenkombination als gestylte `<kbd>` mit Inset-Highlight
- Animation: backdrop blur fade-in + spring-scale für das Panel
- Dismissable via Esc, Klick außerhalb, oder erneutes `?`
- Skipped wenn Fokus in Input/Textarea liegt

## 2. Right-Click Kontextmenü

Rechtsklick auf ein Gerät, Möbel oder Wand öffnet ein kompaktes Menü:

- **Drehen +15° / −15° / +90°** mit Hotkey-Hints (R, ⇧R)
- **Löschen** mit Danger-Style-Highlight + ⌫ Hotkey
- Backdrop schließt das Menü beim Klicken außerhalb
- Animation: spring scale-in
- Position folgt der Maus

## 3. Toast-Restyle

`Toast.tsx` komplett überarbeitet:

- Statt Generic-Border ein farbiger **Side-Stripe** links (Gradient mit
  Status-Farbe)
- 1px-Inset + Mehrlagiger Drop-Shadow + Status-Color-Glow als 0px-Box-Shadow
- Spring-In-Animation
- Bessere Typografie (leading-tight Title, leading-relaxed Description)
- Close-Button mit Hover-Surface-Feedback

## 4. Device-Library Polish

- Ergebnis-Header zeigt "X Ergebnisse" plus eine **Reset-Button** wenn
  Filter aktiv sind
- Geräte-Buttons: hover -translateY-0.5, Selection mit dezentem Glow-Schatten
- **Empty State** statt karger "Keine Geräte gefunden"-Zeile:
  - 56×56 dashed-circle mit Search-Icon
  - "Nichts gefunden" Headline
  - Hilfreicher Sub-Text "Versuche andere Suchbegriffe oder setze die
    Filter zurück"

## 5. Help-Button in der Topbar

`HelpCircle`-Button neben dem Theme-Toggle, dispatched ein `?`-Keydown-Event
um das Overlay zu öffnen. Auf Mobile ausgeblendet (Touch-User haben keine
Tastatur). Tooltip "Tastenkürzel anzeigen (?)".

## ⚙️ Verifikation
- typecheck → 0 Fehler
- vite build → erfolgreich
