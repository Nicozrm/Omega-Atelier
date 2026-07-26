# Material-Qualität — Ist-Analyse & priorisierte Roadmap (AAA/Archviz-Mission)

Ziel: gesamte Materialbibliothek auf Premium-/Produkt-Niveau, additiv, prozedural,
offline-first, Bundle konstant. Externe Assets nur nach Freigabe.

## Ist-Analyse der Materialbibliothek

**Quelle der Wahrheit:** `ThreeDView.tsx > buildMaterials()` (THREE-Materialien) +
`data/materials.ts` (renderer-neutraler Katalog) + `matFromCatalog` (Brücke).

**Material-Inventar (THREE):**
| Material | Typ | Maps | rough / metal | Bewertung |
|---|---|---|---|---|
| floorParquet/Vinyl/Slate | Physical | C+N | 0.45–0.7 / – | ✅ v55 Clearcoat |
| wallPlaster | Standard | C+N | 0.92 | ok (matt) |
| wallConcrete/wallpaper | Standard | C | 0.85–0.88 | flach, ohne N |
| woodOak/Walnut | Standard | C+N | 0.5–0.55 | gut, unversiegelt |
| fabric/Gray/Blue, bedding, pillow | Standard | C(+N) | 0.95 | **kein Sheen** (Textil-Tell) |
| leatherBlack | Standard | C | 0.55 | flach |
| marble | Standard | C | 0.25 | **kein Clearcoat/Veining-Normal** |
| steel / metal | Standard | C+N | 0.4 / 0.85 | generisch, **nicht gebürstet** |
| brass | Standard | C+N | 0.4 / 0.8 | ok |
| glass | Standard | – | 0.05 | ✅ v56 transparentes Fensterglas |
| matteWhite | Standard | C | 0.7 / 0.05 | **überladen 32× (Geräte-Lack ⊕ Kunststoff ⊕ Keramik)** |
| matteBlack | Standard | C | 0.5 / 0.2 | überladen (Kunststoff ⊕ Display) |
| rug | Standard | C+N | 0.97 | ok |

**Geräte/Möbel-Mapping (Auszug):** Kühlschrank/Geschirrspüler/Waschmaschine = **matteWhite-Box
+ Glas-Front**; Ofen/Sink = matteWhite + Glas + Messing; Küche = matteWhite-Korpus + Marmor +
Stahl-Kochfeld; TV-Screen = Glas. ⇒ Geräte wirken als **matte weiße/graue Kisten**, nicht als
Produkte aus gebürstetem Edelstahl/Glas/Lack.

**Zwei systemische Befunde:**
1. **Überladene „Sammelmaterialien":** `matteWhite` (32×) und `matteBlack` decken physikalisch
   sehr verschiedene Stoffe ab (Geräte-Emaille, Kunststoff, glasierte Keramik, Displays).
   Entflechtung = größter Hebel für Geräte + Sanitär.
2. **v56-Nebeneffekt:** Mehrere *opake* Flächen (Geräte-Fronten, Sink-Becken, TV-Screen)
   nutzten `MAT.glass()` nur als **dunkles Glanz-Panel**. Da Glas in v56 transparent wurde,
   sind diese jetzt durchsichtig → muss durch ein dediziertes opakes Display-/Panel-Material
   ersetzt werden (Korrektheit + Premium-Look).

**Technische Basis (verifiziert, three 0.169 + @types/three):** `MeshPhysicalMaterial`
unterstützt `anisotropy` (gebürstetes Metall), `sheen` (Textil), `clearcoat`, `transmission`,
`iridescence` — alles **prozedural ohne neue Dependency** nutzbar.

## Priorisierte Sprints (nach sichtbarem Qualitätsgewinn / Codezeile)

- **S1 — Haushaltsgeräte & Displays (Edelstahl + Panel) [START].** Neue Materialien
  `brushedSteel` (anisotrop, reuse `steelN`) + `darkPanel` (opakes, hochglänzendes
  Display-/Front-Glas). Geräte-Korpora matteWhite→brushedSteel, Fronten/Screens Glas→darkPanel,
  Küchen-Sink/Kochfeld→brushedSteel. Korrigiert zugleich den v56-Transparenz-Nebeneffekt.
  Größter Produkt-Effekt; Mission-Schwerpunkt. Reuse-Texturen → Bundle ~konstant.
- **S2 — `matteWhite`/`matteBlack` entflechten.** `glazedCeramic` (Sanitär: Toilette/Sink/
  Bidet/Wanne — glasiert, Clearcoat) und `plastic` (matt) trennen; Display-Schwarz auf
  `darkPanel` ziehen. Bad-Objekte wirken wie neue Sanitärkeramik.
- **S3 — Textilien: Sheen.** `sheen`/`sheenRoughness` auf fabric/bedding/pillow/curtain
  (großer Sofa-/Bett-Flächenanteil) → authentischer Stoff-Glanz an Streiflicht.
- **S4 — Stein poliert.** Marmor: Clearcoat + dezentes Veining-Normal (prozedural);
  Katalog-Keramik/Fliesen-Böden via `matFromCatalog` kategorie-korrekte Rauheit/Clearcoat.
- **S5 — Holz veredeln + Metalle differenzieren.** Geöltes/lackiertes Holz (dezenter
  Clearcoat); Messing gebürstet vs. Chrom (Armaturen) vs. mattes Schwarzmetall.
- **S6 — Katalog-Materialqualität.** Jede `matFromCatalog`-Fläche (Teppich/Beton/Tapete)
  mit kategorie-korrekter Mikrostruktur/Reflexion statt Pauschalwerten.

**Später / nur mit Freigabe (externe Assets):** echte `transmission`-Spezialgläser,
höher aufgelöste prozedurale Texturen, optionale Produkt-Texturpacks.

## Leitplanken
Additiv · prozedural/Reuse zuerst · keine neue Dependency · Bundle ~konstant · pro Sprint
volle Verifikation (TS/ESLint/Tests/Build/Bundle/Desktop/Mobile/Performance) · Standard =
neu/gepflegt/hochwertig (Alterung nur wo fachlich sinnvoll).
