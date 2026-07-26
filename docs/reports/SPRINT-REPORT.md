# OMEGA Atelier — UI/UX & Photorealism Sprint · Abschlussbericht

Rolle: Senior Creative Director · UI/UX · Three.js Rendering Engineer
Scope-Regel eingehalten: **nur** Rendering/Design/UX geändert — keine Business-Logic,
kein State/Routing/Datenmodell/Persistenz/Supabase/Autosave/Export/Import/Plugins/
Connectoren/APIs berührt.
Verifikation nach dem Sprint: **699 Tests grün · TypeScript fehlerfrei · ESLint fehlerfrei · Production-Build sauber.**

Wichtige Randbedingung: Die 3D-Ausgabe ist in dieser Umgebung **headless nicht renderbar**.
Deshalb wurden ausschließlich Änderungen umgesetzt, die entweder (a) objektiv/mathematisch
korrekt sind oder (b) etablierte Three.js-Best-Practices mit klarem, gerichtetem Effekt — und
alle **reversibel**. Kein blindes „Nach-Gefühl"-Tuning von Werten, das ich nicht sehen kann.

---

## 1) Zusammenfassung aller Änderungen

Alle Änderungen liegen in `src/components/3d/ThreeDView.tsx` (+ diese Report-Datei).

1. **AgX-Tonemapping als Standard** (statt ACES). Physikalisch korrekter Highlight-
   Roll-off, der moderne ArchViz-Standard. Der bestehende **Foto-Look-Toggle** kehrt
   per Klick zu „Brillant" (ACES) zurück. Canvas-Init + `ToneMapController` +
   Default-State sind abgestimmt → kein Umschalt-Flash. Exposure AgX = 1.0.
2. **Sättigungs-Kompensation** im High-Tier-Post: `HueSaturation 0.05 → 0.08`
   (gleicht AgX-typische Entsättigung aus, ohne ACES zu übersättigen).
3. **Directional-Sonnenschatten:** Shadow-Map `2048 → 4096` (nur High-Tier).
4. **Schatten-Frustum an Plangröße gekoppelt** (`±(max(w,h)+4)` statt fix `±16`).
   Behebt **Schatten-Clipping bei großen Plänen** (z. B. Residenz 21 m, deren Modell
   vorher aus dem Schatten-Frustum ragte) und erhöht die Texel-Dichte bei kleinen Plänen.
5. **ContactShadows Auflösung `512 → 1024`** (nur High-Tier) → schärferer Bodenkontakt.
6. **Microinteraction:** Bau-Studio-Popover blendet mit `animate-scale-in` ein
   (reduced-motion-sicher).

Aus dem direkt vorangegangenen Durchgang (im selben ZIP enthalten, hier zur Vollständigkeit):
Anisotropes Filtering 8→16, `powerPreference: high-performance`, Bau-Studio
(4 Bauarten · 6 Steinfarben · 3 Dachformen · 5 Dachfarben), Etagen-Stack, echte
Esri-Satellitenansicht.

## 2) Vorher / Nachher

| Aspekt | Vorher | Nachher |
|---|---|---|
| Tonemapping | ACES, Exposure 0.95 | **AgX** default (Exposure 1.0), ACES per Toggle |
| Highlights | können nach Weiß/Cyan ausbrennen | sanfter, fotografischer Roll-off |
| Sonnenschatten-Auflösung | 2048² | **4096²** (High) |
| Schatten bei großen Plänen | Modell wird beschnitten (Bug) | vollständig abgedeckt |
| Schatten-Texel-Dichte (kleiner Plan) | fixes ±16-Frustum | an Plan gekoppelt → dichter |
| Bodenkontaktschatten | 512² | **1024²** (High) |
| Popover-Auftritt | hart | sanftes Scale-in |

## 3) Photorealismus-Gewinn: **6.5 / 10** (geschätzt)

Begründung: AgX ist der größte einzelne Realismus-Hebel (Highlight-Verhalten,
Farbtreue) und die Schatten sind sichtbar schärfer + korrekt gerahmt. Der Deckel bei
~6.5 statt höher liegt daran, dass die wirklich großen Sprünge (echtes HDRI-Environment,
Transmission-Glas mit IOR/Clearcoat, SSR, TAA, Instancing-gestützte Detaildichte)
**visuelle Iteration** brauchen, die hier headless nicht möglich war — bewusst nicht blind umgesetzt.

## 4) UX-Gewinn: **klein–mittel (≈ +1.5 / 10)**

Das UI-Fundament war bereits stark (konsistentes „Quiet-Luxury"-Designsystem,
`:focus-visible`, `prefers-reduced-motion` global vorhanden). Gewinn kommt aus dem
Popover-Microinteraction und daraus, dass der Foto-Look/Bau-Studio-Workflow konsistent
in die 3D-Leiste integriert ist. Bewusst **keine** kosmetischen Umbauten an bereits gutem UI
(Regel „keine unnötigen Änderungen").

## 5) Performance-Auswirkung

- `powerPreference: high-performance` → nutzt die dedizierte GPU. **+**
- 4096²-Shadow-Map + 1024²-ContactShadows: **nur High-Tier**, VRAM/Fill etwas höher;
  das adaptive DPR (`PerformanceMonitor`) fängt Einbrüche auf. Netto neutral bis leicht negativ
  auf sehr schwachen High-Tier-Geräten, unsichtbarer Qualitätsgewinn.
- Schatten-Frustum an Plangröße: bei kleinen Plänen **kleiner** = günstiger; bei großen
  korrekt statt kaputt.
- AgX vs. ACES: **gleich teuer** (analytische Kurve, keine LUT).
- Anti-Aliasing/Bloom/AO: unverändert.
Fazit: **keine spürbare Verschlechterung**, gezielter Qualitätsgewinn im High-Tier.

## 6) Offene Probleme

- Kein echtes HDRI-Environment — Reflexionen kommen aus einer prozeduralen Studio-PMREM
  (gut, aber nicht himmelskorrekt).
- Glas ist `MeshStandard/Physical` ohne echte Transmission/IOR → keine Refraktion.
- Kein SSR (Screen-Space-Reflections), kein TAA.
- Nachbarschaft/Bäume/Autos sind Einzel-Meshes (kein Instancing) → Draw-Call-Last.
- Directional-Shadow-Frustum ist am Ursprung zentriert, nicht am Plan-Center — abgedeckt,
  aber nicht optimal texel-effizient (bewusst sichere Variante ohne Target-Objekt-Verdrahtung).

## 7) Risiken

- **AgX-Default** ändert den Look aller Szenen. Voll reversibel (Toggle), aber der erste
  Eindruck könnte „anders" wirken. Mitigation: Toggle sichtbar, Doku klar.
- 4096-Shadows könnten auf Grenz-GPUs, die sich als „high" ausweisen, Frames kosten —
  adaptives DPR federt ab.
- Alle Render-Änderungen sind headless **nicht visuell verifiziert** (nur logisch/mathematisch).

## 8) Technische Schulden

- `ThreeDView.tsx` ist mit **`@ts-nocheck`** ~7k Zeilen groß → keine Typsicherheit im 3D-Teil;
  Refactoring in Teilkomponenten wäre wertvoll (aber Scope-fremd/riskant).
- Materialien werden vielfach ad-hoc pro Komponente erzeugt statt zentral geteilt → mehr
  Material-/Textur-Instanzen als nötig.
- Kein zentrales „Render-Quality"-Objekt; Tier wird über `document.documentElement.classList` gelesen.

## 9) Empfehlungen nächster Sprint (priorisiert)

1. **AgX visuell abnehmen** (Screenshots Tag/Abend) und Exposure/Sättigung final feinjustieren.
2. **Echtes HDRI** (z. B. `@react-three/drei <Environment preset=…>` oder eine gebackene
   Himmels-PMREM aus dem vorhandenen Sky-Modell) für natürliche Reflexionen.
3. **Transmission-Glas** (`MeshPhysicalMaterial` transmission/IOR/thickness) für Fenster —
   nur High-Tier, mit `<MeshTransmissionMaterial>` aus drei/drei-postprocessing budgetiert.
4. **Instancing** von Bäumen/Autos/Zäunen der Nachbarschaft → Draw-Calls drastisch runter,
   erlaubt mehr Detail bei gleicher Framerate.
5. **Shadow-Frustum am Plan-Center** (Target-Object3D) für maximale Texel-Ausbeute.
6. **TAA** statt/zusätzlich zu SMAA auf High-Tier (ruhigere Kanten, weniger Shimmer).
7. **Material-Registry**: geteilte PBR-Materialien + `envMapIntensity`-Politik.
8. **Contact-Hardening**: N8AO auf High-Tier `quality="high"` + Full-Res testen.
9. **Mobile-Pass**: 3D-Leiste auf Touch verdichten, Bau-Studio als Bottom-Sheet.
10. `ThreeDView.tsx` in Module splitten (Neighborhood/HouseShell/Scene/Post) — `@ts-nocheck` schrittweise entfernen.

## 10) Übergabe an das nächste Modell

**Kernentscheidungen dieses Sprints**
- AgX ist Default; Umschalten via `photoLook`-State + `ToneMapController` (setzt
  `gl.toneMapping` + einmaliges `material.needsUpdate`-Traversal). Nicht als globalen
  Zwang behandeln — der Toggle muss erhalten bleiben.
- Schatten: Map-Size & ContactShadows-Auflösung sind **tier-gated** (`readTier() === 'high'`).
  Frustum = `±(max(wM,hM)+4)`, ursprungszentriert.
- Post-Saturation 0.08 ist die AgX-Kompensation — bei ACES-Rückkehr nicht überdrehen.
- Bau-Studio-Domäne liegt rein & getestet in `src/lib/houseStyle.ts`; Geometrie in
  `HouseShell`. Neue Optionen → dort ergänzen, `houseStyle.test.ts` mitziehen.

**Nicht anfassen** (Scope-Grenze, vom Nutzer gesetzt): Business-Logic, State, Routing,
Datenmodell, Persistenz, Supabase, Autosave, Export/Import, Plugins, Smart-Home, Connectoren, APIs.

**Nächste 10 sinnvollsten Schritte** (in Reihenfolge):
1. Screenshots Tag+Abend mit Haus einholen → AgX-Exposure/Sättigung final.
2. `<Environment>`-HDRI (oder Sky-PMREM) einbauen, `environmentIntensity` je Phase kalibrieren.
3. Fenster-Glas auf `MeshPhysicalMaterial` (transmission 0.9, ior 1.5, thickness) — High-Tier.
4. Bäume/Autos der Nachbarschaft auf `InstancedMesh` umstellen (deterministische Transforms vorhanden).
5. Shadow-Target auf Plan-Center (Object3D + `<primitive>`), Frustum eng ziehen.
6. TAA-Pass (postprocessing) auf High-Tier evaluieren.
7. N8AO High-Tier: `quality="high"`, Full-Res A/B gegen Frametime.
8. Material-Registry + `envMapIntensity`-Standard für Metalle/Glas.
9. Mobile: 3D-Leiste + Bau-Studio als Bottom-Sheet, Touch-Targets ≥ 44px.
10. `ThreeDView.tsx` modularisieren, `@ts-nocheck` je Modul entfernen.

**Verifikations-Kommandos:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`.
Alle müssen grün bleiben; Render-Änderungen zusätzlich visuell abnehmen lassen.
