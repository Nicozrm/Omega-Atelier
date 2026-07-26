# Metrics — Base Normalization (v53)

Stand: 2026-06-30 · Branch `claude/omega-atelier-master-tpjpnj` · Node 22 / npm 10

## Codebase
| Kennzahl | Wert |
|---|---|
| Quell-Dateien (`.ts`/`.tsx`, ohne Tests) | 105 |
| Test-Dateien | 26 |
| Tests gesamt | 224 (alle grün) |
| Domänen-Verzeichnisse | connectors (homeAssistant, mqtt), domain, twin, lib, components, store, features, data |
| Abhängigkeiten installiert | 717 Pakete (`npm ci`, Lockfile synchron) |

## Build / Bundle (vite build, gzip)
| Chunk | roh | gzip | Lazy? |
|---|---|---|---|
| Entry `index` | 102.24 kB | 27.78 kB | nein (Entry) |
| `Editor` | 124.49 kB | 35.72 kB | ja |
| `ThreeDView` | 155.33 kB | 37.99 kB | ja |
| `router` | 162.30 kB | 53.01 kB | ja |
| `supabase` | 209.62 kB | 54.67 kB | ja |
| `three` | 897.63 kB | 246.45 kB | ja (nur 3D-View) |
| `ConnectorManager` | 37.71 kB | 12.01 kB | ja |
| CSS `index` | 56.28 kB | 11.43 kB | — |
| dist gesamt (inkl. Maps + PWA) | ~9.0 MB | — | — |
| PWA Precache | 36 Einträge / 2091.9 KiB | — | — |

## Verifikations-Gates
| Gate | Ergebnis |
|---|---|
| `tsc --noEmit` | ✅ 0 Fehler |
| `eslint --max-warnings 0` | ✅ 0/0 |
| `vitest run` | ✅ 224/224 |
| `vite build` | ✅ erfolgreich |

## Hinweis
Der einzige >800 kB Chunk (`three`) ist bereits **lazy** (nur beim Öffnen der
3D-Ansicht geladen) — der Build-Warnhinweis bezieht sich darauf und ist by-design.
Diese Werte dienen als Baseline für künftige Bundle-Vergleiche (Ziel: Initial-Bundle
konstant halten).
