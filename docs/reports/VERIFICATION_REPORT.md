# Verifikationsbericht — Diff-Prüfung der Basis-Normalisierung (v53)

> Anlass: Der Diff (+24.662 / −2.292) wirkte für den Sprint ungewöhnlich groß.
> Auftrag: Ursache klären, fachliche vs. nur verschobene Änderungen trennen,
> unbeabsichtigte Änderungen ausschließen, Umfang rechtfertigen oder verkleinern.
> **Wichtig:** v44 (Automationen) ist **nicht** implementiert. Der gesamte Diff
> stammt ausschließlich aus der Basis-Normalisierung + 4 Doku-Dateien.

## 1. Warum ist der Diff so groß?
Es ist **kein Feature-Diff, sondern ein einmaliger Basis-Import.** Vorher lag im Git
nur ein **partieller flacher Datei-Dump** (~50 Dateien); das eigentliche v52-Projekt
(~170 Dateien inkl. Tests, Domain, Twin, Connectoren, UI-Primitives, Lockfile) lag
**nur in der ZIP**. Die Differenz zwischen „halber Dump" und „kanonisches Projekt"
ist zwangsläufig groß.

Exakte Zerlegung (Summen ergeben **genau** +24.662 / −2.292):

| Kategorie | + | − | Dateien | Anteil + |
|---|---|---|---|---|
| `package-lock.json` (maschinell, für `npm ci`/CI nötig) | 11.251 | 0 | 1 | **46 %** |
| Übrige **neue** v52-Dateien (nie im Repo gewesen) | 12.625 | 0 | 120 | 51 % |
| Renames flat→`src/` (Alt-Inhalt → v52-Inhalt) | 711 | 466 | 50 | 3 % |
| Modifiziert (README, index.html, package.json, tsconfig) | 75 | 18 | 4 | <1 % |
| Gelöschte alte Flat-Dateien | 0 | 1.808 | 7 | — |

→ **97 % der Einfügungen** sind Lockfile + bisher-nur-in-ZIP-Projektdateien. Beides
ist intrinsisch, nicht reduzierbar ohne ein nicht baubares Repo.

## 2. Welche Dateien wurden fachlich geändert?
**Keine.** Byte-Vergleich des HEAD-Baums gegen die kanonische v52-Extraktion:
> `diff -rq` → **jede** geteilte Datei ist **byte-identisch** zu v52.
Ich habe **null** eigene Code-Edits gemacht. Der Code-Inhalt ist v52, unverändert.

Die 4 „modifizierten" Dateien sind reine Konfig/Doku-Deltas gegenüber dem alten
Flat-Stand (README, `index.html`, `package.json`, `tsconfig.json`) — sie stammen
ebenfalls 1:1 aus v52.

## 3. Welche Dateien wurden nur verschoben/umorganisiert?
Die 50 Renames (z. B. `Canvas.tsx → src/components/editor/Canvas.tsx`). Inhaltlich
sind sie der v52-Stand; die kleinen Rename-Deltas (+711/−466) sind die Differenz
alter-Flat-Stand → neuerer v52-Stand, **keine** Formatierung.

## 4. Unbeabsichtigte Änderungen?
**Keine.** Belege:
- Byte-Identität zu v52 (oben).
- Einzige Repo-Extras über v52 hinaus: die 4 Sprint-Docs + dieser Bericht.
- `*.tsbuildinfo` sind **ignoriert** (`.gitignore`), nicht eingecheckt.
- **Keine** kosmetischen/Whitespace-/Formatierungsänderungen außerhalb bearbeiteter
  Dateien (ich habe keine Datei umformatiert — alles ist v52 verbatim).

## 5. Ist der Umfang nötig — oder kleiner machbar?
**Nicht sinnvoll kleiner.** Der Diff ist bereits der **minimale Patch**, um das Repo
zur einzigen baubaren, kanonischen Basis zu machen. Der einzige Hebel wäre die
Lockfile (46 %) — sie ist aber **erforderlich** für reproduzierbares `npm ci` und den
CI-Workflow (`.github/workflows/ci.yml`). Sie wegzulassen wäre eine Verschlechterung,
keine Reduktion. Da ich **keinen** eigenen Code geschrieben habe, existiert weder
Refactoring noch Feature-Creep, der sich kürzen ließe.

**Einordnung:** Künftige Feature-Sprints (z. B. v44) erzeugen kleine, additive Diffs.
Dieser einmalige Basis-Import ist die Voraussetzung dafür.

## Verifikations-Gates (frisch erneut ausgeführt)
| Gate | Befehl | Ergebnis |
|---|---|---|
| TypeScript | `tsc --noEmit -p tsconfig.json` | ✅ 0 Fehler |
| ESLint | `eslint . --max-warnings 0` | ✅ 0/0 |
| Tests | `vitest run` | ✅ 224/224 (26 Dateien) |
| Build | `tsc -b && vite build` | ✅ erfolgreich |
| **Bundle/Performance** | Build-Hashes | ✅ **byte-identisch** zur Baseline (`index-hm9z_Fs7.js`, `three-oJMYLS8S.js` gleiche Content-Hashes) → keine Regression |
| Desktop | `vite preview` HTTP-Smoke (Desktop-UA) | ✅ `/` 200, manifest 200, entry-JS 200 |
| Mobile | HTTP-Smoke (iPhone-UA) + Viewport-Meta | ✅ `/` 200; `width=device-width, viewport-fit=cover`; eigene `MobileNav`/`MobilePlacement` bauen mit |

## Ehrliche Bewertung / Grenzen
- **Kein** visueller Browser-Test mit Playwright: ist **keine** Projektabhängigkeit;
  Installation würde `package-lock.json` ändern (genau die unnötige Änderung, die zu
  vermeiden ist). Zudem rendert headless-WebGL (Swiftshader) die 3D-Szene nicht —
  projektweit dokumentierte Umgebungsgrenze. Verifikation daher auf HTTP-Serving +
  responsivem Shell + bauenden Mobile-Komponenten begründet, nicht auf Screenshots.
- Bundle-Größe `three` (897 kB) ist **by-design lazy** (nur 3D-View) — unverändert.

## Fazit
Der finale Diff ist **angemessen und minimal-für-seinen-Zweck**: ein einmaliger,
verbatim Basis-Import von v52 (97 % Lockfile + bisher nur in ZIP vorhandene Dateien),
**ohne** eigene Code-, Format- oder Refactoring-Änderungen, vollständig grün verifiziert.
