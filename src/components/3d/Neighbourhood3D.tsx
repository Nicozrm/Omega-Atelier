/**
 * Neighbourhood3D — the renderer for the Living World.
 *
 * Everything drawn here comes from the pure model in `@/lib/world`: the street
 * graph decides where asphalt goes, the plot subdivision decides where houses
 * stand, the amenity pass decides where the supermarket and the park are. This
 * component makes no layout decision of its own — it owns materials and meshes,
 * nothing else. That separation is what lets the same world feed traffic,
 * pedestrians and, later, shading or noise studies.
 *
 * Cost control, in the order it matters:
 *   • **LOD** — buildings carry full trim only near the plan (see `HouseLod`);
 *     further out they lose garnish, then windows, then everything but massing.
 *   • **Batching** — the whole static world is wrapped in `Static`, which merges
 *     by material into a handful of draw calls.
 *   • **Shared textures** — brick, tiles, asphalt and pavers come from the
 *     module-level cache in `@/lib/proceduralTextures`, so a 300-house estate
 *     costs the same texture memory as a single house.
 *
 * Materials and cloned textures are disposed when the world changes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutdoorTextures } from '@/hooks/useOutdoorTextures'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSkyEnvironment } from './skyEnvironment'
import { quantise, type Rgb } from '@/lib/world/roofColours'
import { RoundedBox } from '@react-three/drei'
import { Static } from './Static'
import {
  brickTextures, boardTextures, roofTextures, asphaltSurface, paverTextures, grassTexture,
  type Surface,
} from '@/lib/proceduralTextures'
import { canopyGeometry } from '@/lib/render/canopy'
import { seasonPalette, snowed, mixHex, type Season } from '@/lib/season'
import type { DayPhase } from '@/lib/environment'
import {
  cityStyleSpec,
  type Amenity, type HouseLod, type HouseSpec, type Neighbourhood, type ParkSpec,
  type StreetFurniture, type TreeKind, type Vec2,
} from '@/lib/world'

/**
 * Wie weit das Vorfeld über die Szene hinausreicht.
 *
 * Es hat nur eine Aufgabe: den Horizont schließen, damit man bei flachem
 * Blickwinkel nicht über die Kante der Bodenebene ins Nichts sieht. Vier
 * reichen dafür — acht waren der erste Entwurf und haben die Grastextur auf
 * über zweitausend Kachelungen getrieben, was als graues Moiré endet statt als
 * Rasen.
 */
const APRON_FACTOR = 4

/** Ground sits a hair below the plan's floor slab, as the old estate did. */
const GROUND_Y = -0.13

/**
 * Beyond this distance from the plan a generated building stops casting.
 * The directional light's shadow camera is framed on the plan, so anything
 * further out contributes nothing to the shadow map while still costing a full
 * shadow-pass traversal — with a few hundred houses that is the single largest
 * avoidable per-frame cost in the scene.
 */
const SHADOW_RANGE_M = 28

interface Props {
  world: Neighbourhood
  phase: DayPhase
  /** The environment's continuous exterior-albedo scale (see lib/environment). */
  daylightScale: number
  season: Season
  /** Full trim only where it can be seen. */
  rich: boolean
  /**
   * Amtliches Luftbild als Bodentextur, exakt auf die Kantenlänge der
   * Grundebene bestellt. Fehlt es, bleibt die erzeugte Rasenfläche stehen.
   */
  groundTexture?: THREE.Texture | null
  /**
   * Liest die echte Farbe an einer Stelle des Luftbilds. Damit bekommt jedes
   * Nachbardach den Ton, den es wirklich hat, statt einen aus der Palette des
   * Regionalstils gewürfelten.
   */
  sampleGround?: (x: number, z: number, radiusM?: number) => string | undefined
}

/* ────────────────────────────── Materials ────────────────────────────── */

type MatBag = ReturnType<typeof buildMaterials>

function buildMaterials(world: Neighbourhood, season: Season, daylight: number, phase: DayPhase) {
  const spec = cityStyleSpec(world.style)
  const sp = seasonPalette(season)
  const lit = phase === 'night' || phase === 'dusk' || phase === 'goldenHour'
  const K = daylight

  const ground = (c: string) => snowed(c, sp.snow)
  const roofTint = (c: string) => snowed(c, sp.snow, 0.8)
  const dim = (c: string) => '#' + new THREE.Color(c).multiplyScalar(K).getHexString()

  const S = (c: string, rough = 0.9, metal = 0) =>
    new THREE.MeshStandardMaterial({ color: dim(c), roughness: rough, metalness: metal })
  /** Foliage reads best faceted — flat shading gives crisp low-poly canopies. */
  const F = (c: string) => new THREE.MeshStandardMaterial({ color: dim(c), roughness: 1, flatShading: true })

  const textures: THREE.Texture[] = []
  const clone = (t: THREE.Texture, rx: number, ry: number) => {
    const c = t.clone()
    c.needsUpdate = true
    c.wrapS = c.wrapT = THREE.RepeatWrapping
    c.repeat.set(rx, ry)
    textures.push(c)
    return c
  }

  /**
   * Hängt eine vollständige Oberfläche an ein Material — Farbe, Relief und
   * Glanz, alle drei in derselben Kachelung.
   *
   * Dass die Kachelung für alle Kanäle dieselbe sein muss, ist kein Detail:
   * läuft die Rauheitskarte anders als die Farbkarte, sitzt der matte Fleck
   * neben der Fuge statt in ihr, und die Fläche wirkt schmutzig statt
   * strukturiert. Deshalb geht es durch **eine** Funktion und nicht durch drei
   * Zuweisungen nebeneinander.
   *
   * `roughness` wird dabei auf 1 gesetzt: three **multipliziert** den
   * Skalarwert mit der Karte. Bliebe er auf 0.85 stehen, wäre die
   * mühsam gezeichnete Bandbreite von 0.55 bis 0.98 auf 0.47 bis 0.83
   * zusammengedrückt — und der Glanzunterschied, um den es hier geht,
   * verlöre ein Sechstel seiner Wirkung.
   */
  const surfaceOn = (mm: THREE.MeshStandardMaterial, s: Surface, rx: number, ry: number) => {
    mm.map = clone(s.map, rx, ry)
    mm.normalMap = clone(s.normal, rx, ry)
    mm.normalScale = new THREE.Vector2(0.85, 0.85)
    mm.roughnessMap = clone(s.roughness, rx, ry)
    mm.roughness = 1
    return mm
  }

  const brick = brickTextures()
  const board = boardTextures()
  const tiles = roofTextures()
  const pav = paverTextures()

  const pal = spec.palette
  const m = {
    lawn: S(ground(mixHex(pal.lawn, sp.lawn, 0.6)), 1),
    /** Vorfeld bis zum Horizont — bewusst ohne Textur, siehe unten. */
    apron: S(ground(mixHex(pal.lawn, sp.lawn, 0.6)), 1),
    lawnPlot: S(ground(mixHex(pal.lawn, sp.lawn, 0.45)), 1),
    road: S('#ffffff', 0.95),
    kerb: S(pal.kerb, 0.85),
    walk: S('#ffffff', 0.95),
    dash: S('#cfc9bb', 0.9),
    edgeLine: S('#cfc9bb', 0.9),
    zebra: S('#ddd8ca', 0.9),
    drive: S('#ffffff', 0.9),
    gravel: S('#9b968c', 1),
    soil: S('#453728', 1),
    sand: S('#c9b48c', 1),
    water: new THREE.MeshPhysicalMaterial({ color: dim('#2d4a55'), roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86 }),
    poolWater: new THREE.MeshPhysicalMaterial({ color: dim('#3b7f96'), roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8 }),

    drain: S('#2c2d31', 0.6, 0.45),
    manhole: S('#3a3b40', 0.6, 0.5),
    metal: S('#7b7f85', 0.45, 0.6),
    dark: S('#26272b', 0.6, 0.2),
    trim: S(pal.trim, 0.9),
    plinth: S('#3d3e42', 0.92),
    frame: S('#2c2d31', 0.6, 0.1),
    sill: S('#d8d3c8', 0.85),
    garageDoor: S('#c6c1b7', 0.7, 0.1),
    door: S('#2a2b30', 0.55, 0.15),
    fence: S(mixHex(pal.trim, '#000000', 0.06), 0.85),
    wall: S(mixHex(pal.facades[1], '#ffffff', 0.1), 0.92),
    ridge: S('#1e1b19', 0.75),
    chimney: S('#4a4b50', 0.9),
    solar: new THREE.MeshStandardMaterial({ color: '#101623', roughness: 0.14, metalness: 0.5 }),
    solarFrame: S('#2e3138', 0.5, 0.4),
    glassRail: new THREE.MeshPhysicalMaterial({ color: dim('#dfe4e6'), roughness: 0.35, transparent: true, opacity: 0.42 }),

    trunk: S('#5b4632', 1),
    hedge: F(sp.hedge),
    hedgeTop: F(mixHex(sp.hedge, '#ffffff', 0.1)),

    // Window glass in three night states — a mix of lit, dim and dark windows
    // is what makes an estate read as inhabited rather than floodlit.
    /*
     * Fensterglas.
     *
     * Hier stand `metalness: 0.25` bis `0.3`. Das ist nicht bloss ein zu hoher
     * Wert, sondern das falsche Material: Glas ist ein **Dielektrikum**, sein
     * Metallanteil ist null. Bei einem Metallanteil färbt three die Spiegelung
     * mit der Grundfarbe ein und lässt den diffusen Anteil verschwinden — aus
     * einer Scheibe wird dunkel getöntes Blech. Zusammen mit der fehlenden
     * Himmelsspiegelung ergab das genau die flachen dunklen Rechtecke.
     *
     * `envMapIntensity` steht hoch, weil eine Scheibe fast nichts anderes tut,
     * als ihre Umgebung zu spiegeln. Die Spiegelkarte selbst hängt der
     * Renderer später ein (siehe `skyEnvironment`); ohne sie bleibt das Glas
     * dunkel, aber wenigstens nicht metallisch.
     */
    glassLit: new THREE.MeshPhysicalMaterial({
      color: lit ? '#ffe3b0' : '#1e2732', roughness: 0.06, metalness: 0,
      envMapIntensity: lit ? 0.7 : 1.7,
      emissive: new THREE.Color(lit ? '#ffb457' : '#000000'), emissiveIntensity: lit ? 1.3 : 0,
    }),
    glassDim: new THREE.MeshPhysicalMaterial({
      color: lit ? '#c8a276' : '#202834', roughness: 0.07, metalness: 0,
      envMapIntensity: lit ? 0.9 : 1.7,
      emissive: new THREE.Color(lit ? '#c97f2e' : '#000000'), emissiveIntensity: lit ? 0.45 : 0,
    }),
    glassDark: new THREE.MeshPhysicalMaterial({
      color: dim('#151b24'), roughness: 0.05, metalness: 0, envMapIntensity: 1.8,
    }),
    shopGlass: new THREE.MeshPhysicalMaterial({
      color: lit ? '#ffeccb' : '#242c38', roughness: 0.05, metalness: 0,
      envMapIntensity: lit ? 0.8 : 1.9,
      emissive: new THREE.Color(lit ? '#ffcf8a' : '#000000'), emissiveIntensity: lit ? 1.1 : 0,
    }),

    // Street lighting reacts to the sky: the columns switch on at dusk and
    // stay lit through the night, exactly as the estate's real ones do.
    lamp: new THREE.MeshStandardMaterial({
      color: '#1f222a', emissive: new THREE.Color(lit ? '#ffd489' : '#33301f'),
      emissiveIntensity: lit ? 2.8 : 0.15, roughness: 0.5,
    }),
    lampPole: S('#33363c', 0.5, 0.5),
    sconce: new THREE.MeshStandardMaterial({
      color: '#2a2b30', emissive: new THREE.Color(lit ? '#ffd489' : '#2e2a1e'),
      emissiveIntensity: lit ? 2.4 : 0.1, roughness: 0.5,
    }),
    sign: new THREE.MeshStandardMaterial({
      color: '#c8ccd2', emissive: new THREE.Color(lit ? '#8fb4ff' : '#000000'),
      emissiveIntensity: lit ? 0.9 : 0, roughness: 0.5,
    }),
    hydrant: S('#a8342c', 0.7),
    bin: S('#26262b', 0.7),
    binLid: S('#2f4f86', 0.7),
  }

  // ── Textured surfaces ──
  const span = world.extentM * 2
  // Das Vorfeld ist die achtfache Kantenlänge (siehe Grundfläche), also
  // muss die Kachelung mitwachsen — sonst wird ein Grasbüschel hundert
  // Meter breit und die Fläche liest sich als grüner Nebel.
  // Die Kachelung muss mit dem Vorfeld wachsen, aber gedeckelt: jenseits von
  // rund 200 Wiederholungen liegt ein Grasbüschel unter einem Bildschirmpixel,
  // und aus der Textur wird Rauschen. Der Deckel kostet nur, dass ein sehr
  // fernes Grasbüschel groß wirkt — das sieht ohnehin niemand.
  // Die Nahfläche behält ihre Grastextur in vernünftiger Kachelung.
  const lawnRepeat = Math.min(48, span / 2.2)
  m.lawn.map = clone(grassTexture(), lawnRepeat, lawnRepeat)
  m.lawn.side = THREE.DoubleSide
  // Das Vorfeld dagegen bleibt **texturlos**.
  //
  // Es reicht Hunderte Meter weit, und eine Detailtextur auf einer so großen
  // Ebene schimmert am Horizont unweigerlich: dort fällt eine ganze Kachel auf
  // weniger als einen Bildpunkt, und jede Kamerabewegung lässt die Fläche
  // flimmern. Genau das war als „flackert sehr extrem" zu sehen. Eine ruhige
  // Einfarbfläche kann nicht flimmern, und aus dieser Entfernung erkennt
  // ohnehin niemand einzelne Grashalme.
  m.apron.color.copy(m.lawn.color)
  m.apron.side = THREE.DoubleSide
  m.lawnPlot.map = clone(grassTexture(), 6, 6)
  // Straßen und Wege bekommen dasselbe vollständige Material wie die Fassaden:
  // Relief als Normalkarte statt als `bumpMap`, und vor allem eine
  // **Rauheitskarte**. Bei einer Straße trägt die den größten Teil der Wirkung
  // — die polierte Fahrspur neben dem rauen Rand ist das, woran das Auge
  // Asphalt erkennt, nicht der Grauton.
  const asph = asphaltSurface()
  surfaceOn(m.road, asph, span / 3, 1.4)
  m.road.color.set(dim(spec.palette.road))
  if (spec.street.surface === 'pavers') surfaceOn(m.road, pav, span / 4, 2)
  surfaceOn(m.walk, pav, span / 2, 0.8)
  m.walk.color.set(dim(spec.palette.sidewalk))
  surfaceOn(m.drive, pav, 2, 4)
  m.drive.color.set(dim('#e6e2da'))

  // Facades: one material per palette entry, each carrying the surface its
  // style asks for (brick, board, or a smooth render).
  const facades: THREE.MeshStandardMaterial[] = spec.palette.facades.map((hex, i) => {
    const surface = spec.palette.facadeSurface[i] ?? 'plaster'
    const mm = new THREE.MeshStandardMaterial({
      color: dim(hex),
      roughness: surface === 'render' ? 0.82 : 0.88,
      metalness: 0,
    })
    if (surface === 'brick') {
      surfaceOn(mm, brick, 4, 4)
      // The brick canvas already carries its own colour, so tint it white-ish
      // and let the palette entry act as a multiplier.
      mm.color.set(dim(mixHex(hex, '#ffffff', 0.35)))
    } else if (surface === 'board') {
      surfaceOn(mm, board, 3, 3)
      mm.color.set(dim(mixHex(hex, '#ffffff', 0.2)))
    }
    return mm
  })

  const roofs: THREE.MeshStandardMaterial[] = spec.palette.roofs.map((hex) => {
    const mm = new THREE.MeshStandardMaterial({ color: dim(roofTint(hex)), roughness: 0.85, metalness: 0.05 })
    surfaceOn(mm, tiles, 4, 3)
    return mm
  })

  const foliage = sp.foliage.map((c, i) =>
    F(i === 3 && sp.blossom > 0 ? mixHex(c, '#e8b8c8', sp.blossom) : c),
  )

  /**
   * Dasselbe Laub in vier Spielarten je Grundton.
   *
   * Vorher gab es genau vier Laubmaterialien für die ganze Szene, und jeder
   * Baum einer Art griff auf dieselben Indizes zu. Zwei Nadelbäume nebeneinander
   * waren damit bis auf Neigung und Drehung **identisch** — und das ist der
   * eigentliche Grund, warum die Bepflanzung „zu wenig Variation" hat. Nicht zu
   * wenig Farbe, sondern zu wenig *Unterschied* zwischen Nachbarn.
   *
   * Die Spielarten verschieben nicht nur die Helligkeit. Ein Ahorn neben einer
   * Linde unterscheidet sich im Farbton, nicht in der Belichtung: der eine geht
   * ins Blaugrüne, der andere ins Gelbgrüne, der dritte ist von Staub und Alter
   * stumpf. Deshalb je ein Schritt in eine andere Richtung.
   */
  const foliageVars = sp.foliage.map((c, i) => {
    const base = i === 3 && sp.blossom > 0 ? mixHex(c, '#e8b8c8', sp.blossom) : c
    return [
      base,
      mixHex(base, '#1d3a22', 0.24), // tiefes, kühles Grün — Schattenkrone
      mixHex(base, '#c8d76a', 0.20), // gelbgrüner Austrieb
      mixHex(base, '#7d8a6a', 0.22), // staubig, ausgeblichen
    ].map(F)
  })

  /*
   * Autolack ist zweischichtig, und das ist der ganze Punkt.
   *
   * Vorher: `roughness 0.35, metalness 0.5` — ein halb metallischer, matter
   * Körper. Echter Lack besteht aus einer pigmentierten Basis und einem klaren
   * Decklack darüber, der spiegelt. Deshalb `clearcoat`: die Basis bleibt
   * matt und farbig, die Spiegelung sitzt in der Schicht darüber. Ohne diese
   * Trennung sieht ein Auto aus wie eine bemalte Form, und in einer
   * Wohnstraße stehen davon zwanzig.
   */
  const carBodies = ['#20242c', '#6b1f22', '#2b3a4d', '#c9c4bc', '#3d5a44', '#8d8f95']
    .map((c) => new THREE.MeshPhysicalMaterial({
      color: dim(c), roughness: 0.42, metalness: 0.15,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4,
    }))

  const all: THREE.Material[] = [
    ...Object.values(m), ...facades, ...roofs, ...foliage, ...foliageVars.flat(), ...carBodies,
  ]
  return { m, facades, roofs, foliage, foliageVars, carBodies, textures, all, spec, sp }
}

/* ────────────────────────────── Mesh vocabulary ─────────────────────── */

/**
 * Eine Laubmasse.
 *
 * Ersetzt das frühere `icosahedronGeometry(r, 1)`: dieselbe Rolle, aber die
 * Form kommt aus dem gerauschten Pool in `lib/render/canopy`, ist also
 * ausgefranst statt kugelrund. `r` ist der Radius in Baum-Einheiten, `squash`
 * staucht die Krone, `seed` wählt eine der acht Formen — aus dem Standort-Hash
 * des Baumes, damit derselbe Baum nach jedem Neuladen gleich aussieht.
 */
function Canopy({ r, squash = [1, 1, 1], seed, position, material }: {
  r: number
  squash?: [number, number, number]
  seed: number
  position: [number, number, number]
  material: THREE.Material
}) {
  return (
    <mesh
      position={position}
      scale={[squash[0] * r, squash[1] * r, squash[2] * r]}
      castShadow
      geometry={canopyGeometry(seed)}
      material={material}
    />
  )
}

/**
 * A tree. The silhouette is what sells the region — a Mediterranean cypress and
 * a Scandinavian pine must not be the same blob with a different tint — so each
 * canopy kind gets its own construction.
 */
function tree(key: string, kind: TreeKind, at: Vec2, scale: number, mats: MatBag): React.ReactNode {
  const s = scale
  const { m, foliageVars } = mats
  const lean = (Math.abs(Math.sin(at.x * 12.9898 + at.z * 78.233)) % 1) * 0.08 - 0.04
  const spin = at.x + at.z

  /**
   * Der Baum wählt selbst — aus seinem Standort.
   *
   * Kein Zufallsgenerator und kein Index von aussen: derselbe Baum an derselben
   * Stelle sieht nach jedem Neuladen gleich aus, sein Nachbar zwei Meter weiter
   * aber anders. Das ist die Bedingung dafür, dass Variation nicht zu Flimmern
   * wird, sobald die Szene neu aufgebaut wird.
   */
  const h = (n: number) => {
    const x = Math.sin(at.x * 127.1 + at.z * 311.7 + n * 74.7) * 43758.5453
    return x - Math.floor(x)
  }
  /** Laub in der Spielart, die dieser Baum gezogen hat. */
  const fol = (i: number) => {
    const row = foliageVars[i % foliageVars.length]
    return row[Math.floor(h(i + 1) * row.length) % row.length]
  }
  /**
   * Wuchsform statt nur Grösse.
   *
   * Ein gleichmässiger Skalierungsfaktor macht aus einem Baum nur einen
   * grösseren desselben Baums — die Silhouette bleibt dieselbe, und genau die
   * erkennt das Auge wieder. Breite und Höhe getrennt zu variieren erzeugt
   * dagegen echte Wuchsformen: hier eine schmale, hochgeschossene Krone, dort
   * eine breite, gedrungene.
   */
  const gw = 0.82 + h(31) * 0.38
  const gh = 0.84 + h(37) * 0.36
  const shape: [number, number, number] = [gw, gh, gw]

  switch (kind) {
    case 'conifer':
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean]}>
          <mesh position={[0, 0.5 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.09 * s, 0.13 * s, 1.0 * s, 6]} /></mesh>
          <mesh position={[0, 1.55 * s, 0]} castShadow material={fol(1)}><coneGeometry args={[1.0 * s, 1.7 * s, 11]} /></mesh>
          <mesh position={[0, 2.6 * s, 0]} castShadow material={fol(0)}><coneGeometry args={[0.76 * s, 1.5 * s, 11]} /></mesh>
          <mesh position={[0, 3.45 * s, 0]} castShadow material={fol(1)}><coneGeometry args={[0.5 * s, 1.15 * s, 11]} /></mesh>
        </group>
      )
    case 'cypress':
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean * 0.4]}>
          <mesh position={[0, 0.3 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.08 * s, 0.11 * s, 0.6 * s, 6]} /></mesh>
          <mesh position={[0, 2.4 * s, 0]} castShadow material={fol(0)}><coneGeometry args={[0.42 * s, 4.0 * s, 11]} /></mesh>
        </group>
      )
    case 'olive':
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean]}>
          <mesh position={[0, 0.62 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.13 * s, 0.2 * s, 1.25 * s, 7]} /></mesh>
          <Canopy position={[0.2 * s, 1.5 * s, 0]} squash={[1.25, 0.66, 1.2]} r={0.9 * s} seed={h(41) * 97} material={fol(3)} />
          <Canopy position={[-0.45 * s, 1.25 * s, 0.2 * s]} squash={[1.1, 0.6, 1.1]} r={0.62 * s} seed={h(43) * 97} material={fol(2)} />
        </group>
      )
    case 'palm': {
      const fronds = [0, 1, 2, 3, 4, 5]
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean]}>
          <mesh position={[0, 2.0 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.13 * s, 0.2 * s, 4.0 * s, 7]} /></mesh>
          {fronds.map((f) => {
            const a = (f / fronds.length) * Math.PI * 2
            return (
              <mesh
                key={f}
                position={[Math.cos(a) * 0.75 * s, 4.05 * s, Math.sin(a) * 0.75 * s]}
                rotation={[0.5, -a, 0]}
                castShadow
                material={fol(2)}
              >
                <boxGeometry args={[1.7 * s, 0.05 * s, 0.42 * s]} />
              </mesh>
            )
          })}
        </group>
      )
    }
    case 'birch':
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean * 1.4]}>
          <mesh position={[0, 1.15 * s, 0]} castShadow material={m.trim}><cylinderGeometry args={[0.07 * s, 0.1 * s, 2.3 * s, 7]} /></mesh>
          <Canopy position={[0, 2.7 * s, 0]} squash={[0.86, 1.15, 0.86]} r={0.86 * s} seed={h(47) * 97} material={fol(3)} />
          <Canopy position={[0.34 * s, 2.2 * s, 0.2 * s]} squash={[0.8, 1, 0.8]} r={0.5 * s} seed={h(53) * 97} material={fol(2)} />
        </group>
      )
    default:
      return (
        <group key={key} scale={shape} position={[at.x, GROUND_Y, at.z]} rotation={[0, spin, lean]}>
          <mesh position={[0, 0.85 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.08 * s, 0.12 * s, 1.7 * s, 7]} /></mesh>
          <mesh position={[0.32 * s, 1.4 * s, 0]} rotation={[0, 0, -0.65]} castShadow material={m.trunk}><cylinderGeometry args={[0.035 * s, 0.055 * s, 0.75 * s, 5]} /></mesh>
          <Canopy position={[0, 2.2 * s, 0]} squash={[1, 0.86, 1]} r={1.02 * s} seed={h(59) * 97} material={fol(0)} />
          <Canopy position={[0.64 * s, 1.9 * s, 0.2 * s]} squash={[1, 0.8, 1]} r={0.6 * s} seed={h(61) * 97} material={fol(1)} />
          <Canopy position={[-0.52 * s, 1.75 * s, -0.28 * s]} squash={[1, 0.78, 1]} r={0.55 * s} seed={h(67) * 97} material={fol(2)} />
          <Canopy position={[-0.12 * s, 2.85 * s, 0.3 * s]} r={0.48 * s} seed={h(71) * 97} material={fol(1)} />
        </group>
      )
  }
}

/** A window: glass, frame, centre mullion, sill, and a roller-shutter box. */
function windowUnit(
  key: string, x: number, y: number, z: number, w: number, h: number, face: number,
  glass: THREE.Material, mats: MatBag, rich: boolean,
): React.ReactNode {
  const { m } = mats
  return (
    <group key={key} position={[x, y, z]}>
      <mesh position={[0, 0, face * 0.02]} material={glass}><boxGeometry args={[w, h, 0.05]} /></mesh>
      <mesh position={[0, 0, face * 0.03]} material={m.frame}><boxGeometry args={[w + 0.08, h + 0.08, 0.04]} /></mesh>
      {rich && <mesh position={[0, 0, face * 0.05]} material={m.frame}><boxGeometry args={[0.05, h, 0.015]} /></mesh>}
      <mesh position={[0, -h / 2 - 0.04, face * 0.06]} material={m.sill}><boxGeometry args={[w + 0.16, 0.06, 0.12]} /></mesh>
      {rich && <mesh position={[0, h / 2 + 0.11, face * 0.05]} material={m.trim}><boxGeometry args={[w + 0.12, 0.16, 0.1]} /></mesh>}
    </group>
  )
}

/* ────────────────────────────── Buildings ───────────────────────────── */


/**
 * Ein echtes Walmdach.
 *
 * Hier stand `coneGeometry(hypot(W, D) * 0.52, rise, 4)` — ein vierseitiger
 * Kegel, also eine **Vierkantpyramide**, um 45° gedreht. Das ist ein Zeltdach,
 * und ein Zeltdach gibt es nur über einem quadratischen Grundriss. Über einem
 * Rechteck ist es in beide Richtungen zugleich falsch: der Umkreisradius wird
 * aus der Diagonale gebildet, die Grundkante der Pyramide misst also
 * `hypot(W, D) · 0,52 · √2`. Auf einem 12 × 8 m Haus sind das 10,6 × 10,6 m —
 * über der langen Seite fehlen 1,4 m Dach, über der kurzen ragt es 1,3 m je
 * Seite hinaus. Beides sieht man sofort, und beides betraf jedes Walmdachhaus
 * der Nachbarschaft.
 *
 * Ein echtes Walmdach hat bei gleicher Neigung ringsum einen **First**: zwei
 * trapezförmige Hauptflächen über den langen Seiten und zwei dreieckige Walme
 * an den Enden. Der First läuft über die längere Achse und ist genau
 * `|W − D|` lang — bei quadratischem Grundriss wird er null, und dann ist es
 * tatsächlich ein Zeltdach. Der Sonderfall ergibt sich also von selbst, statt
 * der Normalfall zu sein.
 *
 * Die Wicklung wird nicht von Hand abgezählt, sondern je Dreieck geprüft: alle
 * Dachflächen zeigen nach oben, also ist `normal.y > 0` das Kriterium. Das ist
 * kürzer als vier Fälle durchzudenken und lässt sich nicht falsch abschreiben.
 */
export function hipRoofGeometry(w: number, d: number, rise: number): THREE.BufferGeometry {
  const alongX = w >= d
  const ridgeLen = Math.abs(w - d)
  const hw = w / 2, hd = d / 2

  // Traufecken, im Uhrzeigersinn von vorne links.
  const c: [number, number, number][] = [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
  ]
  const r1: [number, number, number] = alongX ? [-ridgeLen / 2, rise, 0] : [0, rise, -ridgeLen / 2]
  const r2: [number, number, number] = alongX ? [ridgeLen / 2, rise, 0] : [0, rise, ridgeLen / 2]

  /*
   * Quadratischer Grundriss: der First fällt auf einen Punkt zusammen, und aus
   * dem Walmdach wird ein Zeltdach. Ohne diesen Fall blieben zwei der sechs
   * Dreiecke mit **null Fläche** stehen — sie haben keine Normale, `computeVertexNormals`
   * bekommt einen Nullvektor, und die angrenzenden Ecken erben eine kaputte
   * Schattierung. Unsichtbar im Standbild, sichtbar als Flackern an der
   * Dachspitze, sobald sich das Licht bewegt.
   */
  const tris: [number, number, number][][] = ridgeLen < 1e-6
    ? [[c[0], c[1], r1], [c[1], c[2], r1], [c[2], c[3], r1], [c[3], c[0], r1]]
    : alongX
    ? [
      [c[0], c[1], r2], [c[0], r2, r1],   // Hauptfläche vorne
      [c[2], c[3], r1], [c[2], r1, r2],   // Hauptfläche hinten
      [c[3], c[0], r1],                    // Walm links
      [c[1], c[2], r2],                    // Walm rechts
    ]
    : [
      [c[1], c[2], r2], [c[1], r2, r1],   // Hauptfläche rechts
      [c[3], c[0], r1], [c[3], r1, r2],   // Hauptfläche links
      [c[0], c[1], r1],                    // Walm vorne
      [c[2], c[3], r2],                    // Walm hinten
    ]

  const pos: number[] = []
  for (const t of tris) {
    const [a, b, e] = t
    const ux = b[0] - a[0], uz = b[2] - a[2]
    const vx = e[0] - a[0], vz = e[2] - a[2]
    // Flächennormale zeigt bei richtiger Wicklung nach oben.
    const ny = uz * vx - ux * vz
    const ordered = ny > 0 ? t : [a, e, b]
    for (const p of ordered) pos.push(p[0], p[1], p[2])
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/**
 * Ein Nachbarhaus.
 *
 * `realGround` ist die wichtigste Unterscheidung darin. Liegt unter der Szene
 * ein echtes Luftbild, hat der Generator am Boden **nichts** mehr zu suchen:
 * Einfahrt, Vorgartenrasen, Weg, Hecke, Zaun, Mülltonnen, geparktes Auto — all
 * das erfindet er anhand eines gedachten Grundstückszuschnitts, der mit dem
 * tatsächlichen nichts zu tun hat. Über einem Foto, das die echten Einfahrten
 * und Hecken bereits zeigt, entsteht daraus eine zweite, falsche Wirklichkeit:
 * erfundener Rasen über echtem Pflaster, erfundene Hecken quer durch echte
 * Gärten.
 *
 * Stehen bleibt, was aufragt und vermessen ist — der Baukörper und sein Dach.
 * Das Flache zeigt das Luftbild besser, als der Generator es raten kann.
 */
function houseNode(h: HouseSpec, mats: MatBag, rich: boolean, realGround = false, roofOverride?: THREE.MeshStandardMaterial): React.ReactNode {
  const { m, facades, roofs, spec } = mats
  const facade = facades[h.facadeIndex % facades.length]
  const roofMat = roofOverride ?? roofs[h.roofIndex % roofs.length]
  const { plot } = h
  const parts: React.ReactNode[] = []

  const W = h.widthM
  const D = h.depthM
  const H = h.heightM
  // Local frame: the group is rotated so −z always points at the street.
  const front = -1
  const detail = h.lod === 'full'
  const mid = h.lod !== 'massing'
  /** Darf der Generator am Boden noch etwas erfinden? */
  const ground = !realGround
  // The sun's shadow camera only spans the plan and its immediate surroundings
  // (see the directional light in ThreeDView), so a house further out can never
  // land in the shadow map — it would only cost a second traversal per frame.
  // Casting is therefore limited to the near ring, which is also the only place
  // a neighbour's shadow is visible at all.
  const casts = h.distanceM < SHADOW_RANGE_M

  /*
   * Firstrichtung.
   *
   * Das Dach wird immer in seinem eigenen Rahmen gebaut — Neigung über x,
   * First entlang z — und danach als Ganzes gedreht. Das ist der Grund, warum
   * hier `rW`/`rD` statt `W`/`D` steht: bei traufständigen Häusern spannen die
   * Sparren über die **Tiefe**, nicht über die Breite.
   *
   * Vorher gab es diese Drehung nicht, und damit stand jedes einzelne Haus der
   * Nachbarschaft giebelständig zur Straße. Eine Straße, in der jedes Dach
   * gleich herum liegt, verrät den Generator schon aus der Ferne — noch bevor
   * man Fassade oder Fenster überhaupt erkennen kann.
   */
  const eavesToStreet = h.ridge === 'eaves'
  const rW = eavesToStreet ? D : W
  const rD = eavesToStreet ? W : D
  const rYaw = eavesToStreet ? Math.PI / 2 : 0

  // Body. Ein erfasster Umriss wird extrudiert; ohne Quelle bleibt es der
  // Quader aus Breite × Tiefe. Das ist der einzige Unterschied zwischen
  // vermessener und erfundener Nachbarschaft im gesamten Renderer.
  if (h.footprint && h.footprint.length >= 3) {
    const shape = new THREE.Shape()
    // `ExtrudeGeometry` baut in der x/y-Ebene und extrudiert nach +z. Um daraus
    // ein aufrechtes Gebäude zu machen, wird die Geometrie um −90° um x gekippt:
    // (sx, sy, d) → (sx, d, −sy). Die Extrusionstiefe wird damit zur Höhe, und
    // die Umriss-Achse y landet auf −z, weshalb z hier gespiegelt eingetragen
    // wird. Mit +90° stünde das Haus spiegelverkehrt **unter** dem Boden.
    shape.moveTo(h.footprint[0].x, -h.footprint[0].z)
    for (let i = 1; i < h.footprint.length; i++) shape.lineTo(h.footprint[i].x, -h.footprint[i].z)
    shape.closePath()
    parts.push(
      <mesh key="b" rotation={[-Math.PI / 2, 0, 0]} castShadow={casts} receiveShadow material={facade}>
        <extrudeGeometry args={[shape, { depth: H, bevelEnabled: false, curveSegments: 1 }]} />
      </mesh>,
    )
  } else {
    parts.push(<mesh key="b" position={[0, H / 2, 0]} castShadow={casts} receiveShadow material={facade}><boxGeometry args={[W, H, D]} /></mesh>)
  }
  if (mid) parts.push(<mesh key="pl" position={[0, 0.16, 0]} material={m.plinth}><boxGeometry args={[W + 0.06, 0.32, D + 0.06]} /></mesh>)

  /*
   * Der zweite Baukörper.
   *
   * Er steht seitlich und hinten bündig, springt also vorne zurück — dadurch
   * wird aus zwei Quadern ein Winkel und nicht bloss ein breiteres Haus. Sein
   * Dach läuft quer zum Hauptdach, was die zweite Firstlinie ergibt, an der
   * man ein gewachsenes Haus von einem gestellten unterscheidet.
   *
   * Nur bei vermessenen Umrissen entfällt er: dort ist der echte Baukörper
   * samt seiner Winkel bereits da, und ein erfundener Anbau daneben wäre eine
   * Erfindung auf einer Messung.
   */
  if (h.wing && mid && !(h.footprint && h.footprint.length >= 3)) {
    const g = h.wing
    const wr: React.ReactNode[] = [
      <mesh key="wb" position={[0, g.heightM / 2, 0]} castShadow={casts} receiveShadow material={facade}>
        <boxGeometry args={[g.widthM, g.heightM, g.depthM]} />
      </mesh>,
      <mesh key="wp" position={[0, 0.15, 0]} material={m.plinth}><boxGeometry args={[g.widthM + 0.06, 0.3, g.depthM + 0.06]} /></mesh>,
    ]
    if (g.roof === 'flat') {
      wr.push(<mesh key="wrf" position={[0, g.heightM + 0.08, 0]} castShadow={casts} material={roofMat}><boxGeometry args={[g.widthM + 0.3, 0.16, g.depthM + 0.3]} /></mesh>)
    } else if (g.roof === 'pent') {
      const rise = g.widthM * 0.18
      const a = Math.atan2(rise, g.widthM)
      wr.push(
        <mesh key="wrp" position={[0, g.heightM + rise / 2, 0]} rotation={[0, 0, a]} castShadow={casts} material={roofMat}>
          <boxGeometry args={[Math.hypot(g.widthM, rise) + 0.3, 0.12, g.depthM + 0.3]} />
        </mesh>,
      )
    } else {
      // Giebel quer zum Hauptdach — die zweite Firstlinie.
      const rh = Math.min(g.widthM, g.depthM) * 0.5
      const sl = Math.hypot(g.widthM / 2 + 0.35, rh)
      const a = Math.atan2(rh, g.widthM / 2 + 0.35)
      wr.push(
        <group key="wrg" position={[0, g.heightM, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[-g.depthM / 4, rh / 2, 0]} rotation={[0, 0, a]} castShadow={casts} material={roofMat}><boxGeometry args={[sl, 0.1, g.widthM + 0.6]} /></mesh>
          <mesh position={[g.depthM / 4, rh / 2, 0]} rotation={[0, 0, -a]} castShadow={casts} material={roofMat}><boxGeometry args={[sl, 0.1, g.widthM + 0.6]} /></mesh>
          <mesh position={[0, rh + 0.02, 0]} material={m.ridge}><boxGeometry args={[0.22, 0.1, g.widthM + 0.62]} /></mesh>
        </group>,
      )
    }
    if (detail) {
      // Ein Fenster zur Straße, damit der Anbau bewohnt aussieht und nicht wie
      // ein angestellter Schuppen.
      wr.push(windowUnit('wgw', 0, g.heightM * 0.52, front * (g.depthM / 2 + 0.03), Math.min(1.5, g.widthM * 0.45), 1.1, front, m.glassDim, mats, detail))
    }
    parts.push(<group key="wg" position={[g.at.x, 0, g.at.z]}>{wr}</group>)
  }

  // Roof
  if (h.roof === 'flat') {
    parts.push(<mesh key="rf" position={[0, H + 0.09, 0]} castShadow={casts} material={roofMat}><boxGeometry args={[W + 0.24, 0.18, D + 0.24]} /></mesh>)
    if (detail) parts.push(<mesh key="rfg" position={[0, H + 0.185, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.gravel}><planeGeometry args={[W + 0.06, D + 0.06]} /></mesh>)
  } else if (h.roof === 'pent') {
    const rise = Math.tan((h.roofPitchDeg * Math.PI) / 180) * rD
    const ang = Math.atan2(rise, rD)
    parts.push(
      <group key="rp" position={[0, 0, 0]} rotation={[0, rYaw, 0]}>
        <mesh position={[0, H + rise / 2, 0]} rotation={[-ang, 0, 0]} castShadow={casts} material={roofMat}>
          <boxGeometry args={[rW + 0.3, 0.12, Math.hypot(rD, rise) + 0.3]} />
        </mesh>
      </group>,
    )
  } else if (h.roof === 'hip') {
    // Traufüberstand wie beim Satteldach — die Kante, die man am weitesten sieht.
    const OVH = 0.42
    const hw = W + OVH * 2, hd = D + OVH * 2
    // Firsthöhe aus der Neigung über die **kurze** Achse: dort spannen die
    // Sparren, und die Neigung ist ringsum dieselbe.
    const rh = (Math.min(hw, hd) / 2) * Math.tan((h.roofPitchDeg * Math.PI) / 180)
    const ridgeLen = Math.abs(hw - hd)
    parts.push(
      <mesh key="rh" position={[0, H, 0]} castShadow={casts} material={roofMat}>
        <primitive object={hipRoofGeometry(hw, hd, rh)} attach="geometry" />
      </mesh>,
    )
    // Firstziegel — nur wo es einen First gibt. Über quadratischem Grundriss
    // läuft `ridgeLen` gegen null, und dann ist es zu Recht ein Zeltdach.
    if (ridgeLen > 0.3) {
      parts.push(
        <mesh
          key="rhr"
          position={[0, H + rh + 0.02, 0]}
          rotation={[0, hw >= hd ? Math.PI / 2 : 0, 0]}
          castShadow={casts}
          material={m.ridge}
        >
          <boxGeometry args={[0.24, 0.1, ridgeLen]} />
        </mesh>,
      )
    }
  } else {
    // Gable (and mansard, drawn as a steeper gable) — two slopes plus a ridge
    // cap, with the triangular gable ends filled by the facade material.
    // Der Dachüberstand ist kein Detail, sondern die Kante, die man am
    // weitesten sieht. 0,45 m Traufe und 0,35 m Ortgang sind der übliche
    // deutsche Zuschnitt; vorher waren es 0,16 bzw. 0,25, und dadurch sass das
    // Dach auf dem Mauerwerk auf wie ein Deckel auf einer Schachtel.
    const OVH = 0.45, VRG = 0.35
    const rh = Math.min(rW, rD) * (h.roof === 'mansard' ? 0.58 : 0.5)
    const slope = Math.hypot(rW / 2 + OVH, rh)
    const ang = Math.atan2(rh, rW / 2 + OVH)
    parts.push(
      <group key="rg" position={[0, H, 0]} rotation={[0, rYaw, 0]}>
        <mesh position={[-rW / 4, rh / 2, 0]} rotation={[0, 0, ang]} castShadow={casts} material={roofMat}><boxGeometry args={[slope, 0.1, rD + VRG * 2]} /></mesh>
        <mesh position={[rW / 4, rh / 2, 0]} rotation={[0, 0, -ang]} castShadow={casts} material={roofMat}><boxGeometry args={[slope, 0.1, rD + VRG * 2]} /></mesh>
        <mesh position={[0, rh + 0.02, 0]} castShadow={casts} material={m.ridge}><boxGeometry args={[0.24, 0.1, rD + VRG * 2 + 0.05]} /></mesh>
        {[-1, 1].map((s) => {
          const sh = new THREE.Shape()
          sh.moveTo(-rW / 2, 0); sh.lineTo(rW / 2, 0); sh.lineTo(0, rh); sh.closePath()
          return <mesh key={s} position={[0, 0, (s * rD) / 2]} material={facade}><shapeGeometry args={[sh]} /></mesh>
        })}
        {/* Ortgangbrett am Giebel — der helle Streifen, der die Dachkante gegen
            den Himmel absetzt. Ohne ihn verschmilzt das dunkle Dach mit dem
            dunklen Giebeldreieck zu einer Fläche. */}
        {detail && [-1, 1].map((sz) => [-1, 1].map((sx) => (
          <mesh
            key={`vg${sz}${sx}`}
            position={[sx * (rW / 4), rh / 2, (sz * (rD + VRG * 2)) / 2]}
            rotation={[0, 0, sx < 0 ? ang : -ang]}
            material={m.trim}
          >
            <boxGeometry args={[slope, 0.16, 0.05]} />
          </mesh>
        )))}
        {/* Zinc gutters along both eaves plus a downpipe to the plinth. */}
        {detail && [-1, 1].map((s) => (
          <group key={`gt${s}`}>
            <mesh position={[s * (rW / 2 + OVH - 0.06), -0.06, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.metal}><cylinderGeometry args={[0.055, 0.055, rD + VRG * 2, 8]} /></mesh>
            <mesh position={[s * (rW / 2 + OVH - 0.04), -H / 2, rD * 0.34]} material={m.metal}><cylinderGeometry args={[0.04, 0.04, H, 8]} /></mesh>
          </group>
        ))}
        {h.solar && (
          <group position={[-rW / 4, rh / 2 + 0.07, 0]} rotation={[0, 0, ang]}>
            <mesh castShadow={casts} material={m.solarFrame}><boxGeometry args={[slope * 0.74, 0.05, rD * 0.52]} /></mesh>
            <mesh position={[0, 0.035, 0]} material={m.solar}><boxGeometry args={[slope * 0.7, 0.02, rD * 0.48]} /></mesh>
          </group>
        )}
        {/* Gaube: liegt auf der Dachfläche und ist mitgeneigt, statt als
            aufrechter Kasten hindurchzustossen. */}
        {h.dormer && detail && (
          <group position={[rW * 0.26, rh * 0.46, -rD * 0.18]}>
            <mesh castShadow={casts} material={facade}><boxGeometry args={[rW * 0.2, 1.0, 1.5]} /></mesh>
            <mesh position={[0, 0.58, 0]} castShadow={casts} material={roofMat}><boxGeometry args={[rW * 0.2 + 0.22, 0.1, 1.7]} /></mesh>
            <mesh position={[rW * 0.1 + 0.02, 0.05, 0]} rotation={[0, Math.PI / 2, 0]} material={m.glassDim}><boxGeometry args={[1.0, 0.68, 0.05]} /></mesh>
          </group>
        )}
      </group>,
    )
  }

  if (h.chimney && mid) {
    parts.push(<mesh key="ch" position={[W * 0.25, H + 0.9, D * 0.1]} castShadow={casts} material={m.chimney}><boxGeometry args={[0.3, 1.1, 0.3]} /></mesh>)
    parts.push(<mesh key="chc" position={[W * 0.25, H + 1.47, D * 0.1]} material={m.dark}><boxGeometry args={[0.4, 0.06, 0.4]} /></mesh>)
  }

  // Achsraster der Straßenfassade. Steht ausserhalb des Detailblocks, weil auch
  // der Gartenweg wissen muss, wo die Tür sitzt — ein Weg, der neben der Tür
  // endet, fällt sofort auf.
  const bays = Math.max(2, h.bays)
  const step = W / bays
  const bayX = (i: number) => -W / 2 + step * (i + 0.5)
  const doorBay = Math.min(bays - 1, Math.max(0, h.doorBay))
  const doorX = bayX(doorBay)

  if (mid) {
    // Windows: a pair per storey on the street face, one on the gable flank.
    const pick = (i: number) => {
      const t = ((h.windowSeed >>> (i * 3)) & 7) / 8
      return t < 0.4 ? m.glassLit : t < 0.68 ? m.glassDim : m.glassDark
    }
    /*
     * Fensterachsen statt zweier fester Fenster.
     *
     * Vorher standen auf jeder Straßenfassade genau zwei Fenster, an
     * einprogrammierten Stellen (−0,24 W und +0,26 W), in jeder Etage gleich
     * breit und gleich hoch, und die Tür immer exakt mittig. Ein 7-m-Haus und
     * ein 12-m-Haus bekamen dieselbe Aufteilung, nur gestreckt. Genau dieses
     * wiederholte Gesicht ist der Grund, warum eine erzeugte Straße erzeugt
     * aussieht — mehr noch als Farbe oder Textur.
     *
     * Jetzt bestimmt die Breite die Zahl der Achsen, die Tür belegt eine davon,
     * und das Erdgeschoss bekommt die hohen Fenster, die es in Wirklichkeit
     * hat (Wohnraum unten, Schlafraum oben).
     */
    for (let s = 0; s < h.stories; s++) {
      const y = 1.25 + s * spec.building.storeyHeightM
      // Erdgeschossfenster reichen tiefer und sind breiter — der Wohnraum.
      const wh = s === 0 ? 1.5 : 1.15
      const wy = s === 0 ? y + 0.12 : y
      for (let i = 0; i < bays; i++) {
        // Die Türachse bleibt im Erdgeschoss frei.
        if (s === 0 && i === doorBay) continue
        parts.push(windowUnit(
          `wf${s}-${i}`, bayX(i), wy, front * (D / 2 + 0.03),
          Math.min(2.0, step * 0.58), wh, front, pick(s * 4 + i), mats, detail,
        ))
      }
      if (h.attached !== 'right' && h.attached !== 'both') {
        parts.push(
          <group key={`ws${s}`} position={[W / 2 + 0.03, y, 0]} rotation={[0, Math.PI / 2, 0]}>
            {windowUnit(`wss${s}`, 0, 0, D * 0.02, D * 0.3, 1.1, 1, pick(s + 4), mats, detail)}
          </group>,
        )
      }
      if (detail) parts.push(windowUnit(`wr${s}`, W * 0.12, y, -front * (D / 2 + 0.03), W * 0.34, 1.2, -front, pick(s + 6), mats, detail))
    }

    // Front door with a reveal, a step, a canopy and a warm wall light.
    const dz = front * (D / 2)
    parts.push(<mesh key="drf" position={[doorX, 1.12, dz + front * 0.02]} material={m.trim}><boxGeometry args={[1.2, 2.3, 0.08]} /></mesh>)
    parts.push(<mesh key="dr" position={[doorX, 1.05, dz + front * 0.06]} castShadow={casts} material={m.door}><boxGeometry args={[0.95, 2.1, 0.08]} /></mesh>)
    if (detail) {
      parts.push(<mesh key="stp" position={[doorX, 0.05, dz + front * 0.35]} material={m.walk}><boxGeometry args={[1.3, 0.1, 0.55]} /></mesh>)
      parts.push(<mesh key="cn" position={[doorX, 2.35, dz + front * 0.35]} castShadow={casts} material={m.dark}><boxGeometry args={[1.6, 0.08, 0.75]} /></mesh>)
      parts.push(<mesh key="sc" position={[doorX + 0.82, 1.95, dz + front * 0.08]} material={m.sconce}><boxGeometry args={[0.09, 0.22, 0.09]} /></mesh>)
    }
  }

  if (h.balcony && mid) {
    parts.push(
      <group key="bal" position={[0, spec.building.storeyHeightM, -front * (D / 2 + 0.5)]}>
        <mesh castShadow={casts} material={m.trim}><boxGeometry args={[W * 0.55, 0.1, 1.0]} /></mesh>
        <mesh position={[0, 0.45, -front * 0.5]} material={m.glassRail}><boxGeometry args={[W * 0.55, 0.9, 0.04]} /></mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * W * 0.275, 0.45, 0]} rotation={[0, Math.PI / 2, 0]} material={m.glassRail}><boxGeometry args={[1.0, 0.9, 0.04]} /></mesh>
        ))}
      </group>,
    )
  }

  // Garage / carport plus its drive out to the kerb.
  if (h.garage !== 'none' && mid) {
    const gx = h.garageOffsetM
    const gz = front * (D * 0.12)
    const gdz = front * (D * 0.12 + D * 0.32 + 0.03)
    if (h.garage === 'garage') {
      parts.push(<mesh key="gb" position={[gx, 1.35, gz]} castShadow={casts} receiveShadow material={facade}><boxGeometry args={[3, 2.7, D * 0.66]} /></mesh>)
      parts.push(<mesh key="gr" position={[gx, 2.75, gz]} castShadow={casts} material={roofMat}><boxGeometry args={[3.2, 0.16, D * 0.66 + 0.2]} /></mesh>)
      parts.push(<mesh key="gd" position={[gx, 1.15, gdz]} material={m.garageDoor}><boxGeometry args={[2.5, 2.1, 0.08]} /></mesh>)
      if (detail) for (const ry of [0.62, 1.15, 1.68]) {
        parts.push(<mesh key={`gl${ry}`} position={[gx, ry, gdz + front * 0.045]} material={m.frame}><boxGeometry args={[2.44, 0.025, 0.02]} /></mesh>)
      }
    } else {
      // Carport: a flat canopy on four slim posts — no walls, no door.
      parts.push(<mesh key="cpr" position={[gx, 2.5, gz]} castShadow={casts} material={m.dark}><boxGeometry args={[3.2, 0.12, D * 0.6]} /></mesh>)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        parts.push(<mesh key={`cp${sx}${sz}`} position={[gx + sx * 1.4, 1.25, gz + sz * D * 0.26]} material={m.metal}><cylinderGeometry args={[0.06, 0.06, 2.5, 6]} /></mesh>)
      }
    }
    if (ground) parts.push(
      <mesh key="dv" position={[gx, 0.006, front * (D / 2 + h.driveLengthM / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.drive}>
        <planeGeometry args={[2.9, h.driveLengthM]} />
      </mesh>,
    )
    if (h.parkedCar && ground) parts.push(car('pc', { x: gx, z: front * (D / 2 + Math.min(2.6, h.driveLengthM * 0.5)) }, 0, mats.carBodies[h.carColorIndex % mats.carBodies.length], mats, detail))
  }

  // Front garden: lawn strip, path to the door, boundary treatment. Its depth
  // is the setback the generator resolved, so the boundary lands exactly on the
  // property line and never on the pavement.
  const frontLen = h.frontYardM
  if (ground) parts.push(
    <mesh key="fg" position={[0, 0.003, front * (D / 2 + frontLen / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.lawnPlot}>
      <planeGeometry args={[plot.widthM - 0.6, frontLen]} />
    </mesh>,
  )
  if (mid && ground) {
    parts.push(
      <mesh key="pa" position={[doorX, 0.006, front * (D / 2 + frontLen / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.walk}>
        <planeGeometry args={[1.2, frontLen]} />
      </mesh>,
    )
  }

  if (mid && ground && h.boundary !== 'open') {
    const by = front * (D / 2 + frontLen * 0.96)
    const segW = (plot.widthM - 1.6) / 2
    for (const sx of [-1, 1]) {
      const x = sx * (segW / 2 + 0.8)
      if (h.boundary === 'hedge') {
        const hh = mats.spec.vegetation.hedgeHeightM
        parts.push(
          <group key={`hg${sx}`} position={[x, 0, by]}>
            <mesh position={[0, hh / 2, 0]} castShadow={casts} material={m.hedge}><boxGeometry args={[segW, hh, 0.44]} /></mesh>
            <mesh position={[sx * segW * 0.08, hh + 0.06, 0]} castShadow={casts} material={m.hedgeTop}><boxGeometry args={[segW * 0.7, 0.14, 0.34]} /></mesh>
          </group>,
        )
      } else if (h.boundary === 'wall') {
        parts.push(
          <group key={`wl${sx}`} position={[x, 0, by]}>
            <mesh position={[0, 0.62, 0]} castShadow={casts} material={m.wall}><boxGeometry args={[segW, 1.24, 0.24]} /></mesh>
            <mesh position={[0, 1.28, 0]} material={m.trim}><boxGeometry args={[segW + 0.08, 0.08, 0.32]} /></mesh>
          </group>,
        )
      } else if (detail) {
        parts.push(
          <group key={`fn${sx}`} position={[x, 0, by]}>
            <mesh position={[0, 0.6, 0]} material={m.fence}><boxGeometry args={[segW, 0.08, 0.05]} /></mesh>
            <mesh position={[0, 0.28, 0]} material={m.fence}><boxGeometry args={[segW, 0.08, 0.05]} /></mesh>
            {[-1, 0, 1].map((p) => (
              <mesh key={p} position={[p * segW * 0.45, 0.36, 0]} castShadow={casts} material={m.fence}><boxGeometry args={[0.08, 0.72, 0.08]} /></mesh>
            ))}
          </group>,
        )
      } else {
        parts.push(<mesh key={`fs${sx}`} position={[x, 0.35, by]} material={m.fence}><boxGeometry args={[segW, 0.7, 0.06]} /></mesh>)
      }
    }
  }

  // Kerbside life: bins, a letterbox, a bike stand. Alles am erfundenen
  // Grundstückszuschnitt ausgerichtet und damit über einem echten Luftbild
  // schlicht an der falschen Stelle.
  if (detail && ground) {
    const kerbZ = front * (D / 2 + frontLen * 0.86)
    if (h.bins > 0) {
      parts.push(
        <group key="bins" position={[plot.widthM * 0.3, 0.4, kerbZ]}>
          {Array.from({ length: h.bins }).map((_, bi) => (
            <group key={bi} position={[bi * 0.52, 0, 0]} rotation={[0, (bi - 0.5) * 0.3, 0]}>
              <mesh castShadow={casts} material={m.bin}><boxGeometry args={[0.42, 0.78, 0.5]} /></mesh>
              <mesh position={[0, 0.42, -0.02]} material={bi % 2 ? m.binLid : m.frame}><boxGeometry args={[0.44, 0.06, 0.54]} /></mesh>
            </group>
          ))}
        </group>,
      )
    }
    if (h.letterbox) {
      parts.push(
        <group key="mb" position={[-plot.widthM * 0.26, 0, kerbZ]}>
          <mesh position={[0, 0.55, 0]} castShadow={casts} material={m.lampPole}><cylinderGeometry args={[0.035, 0.04, 1.1, 8]} /></mesh>
          <RoundedBox position={[0, 1.16, 0]} args={[0.3, 0.22, 0.4]} radius={0.04} smoothness={3} castShadow={casts} material={m.dark} />
          <mesh position={[0, 1.16, 0.205]} material={m.frame}><boxGeometry args={[0.2, 0.03, 0.01]} /></mesh>
        </group>,
      )
    }
    if (h.bikeRack) {
      parts.push(
        <group key="br" position={[plot.widthM * 0.34, 0, front * (D / 2 + 0.9)]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[i * 0.35 - 0.35, 0.24, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.metal}>
              <torusGeometry args={[0.22, 0.025, 6, 12, Math.PI]} />
            </mesh>
          ))}
        </group>,
      )
    }
  }

  // Garden trees and back-garden features.
  for (const [i, t] of h.trees.entries()) {
    if (!mid && i > 0) break
    parts.push(tree(`t${i}`, t.kind, { x: t.at.x, z: t.at.z }, t.scale, mats))
  }
  if (detail) {
    for (const [i, g] of h.garden.entries()) {
      parts.push(gardenFeature(`g${i}`, g.kind, g.at, g.rotationY, mats))
    }
  }

  return (
    <group key={h.plot.id} position={[h.centre.x, GROUND_Y, h.centre.z]} rotation={[0, plot.rotationY, 0]}>
      {parts}
    </group>
  )
}

function gardenFeature(
  key: string, kind: HouseSpec['garden'][number]['kind'], at: Vec2, rot: number, mats: MatBag,
): React.ReactNode {
  const { m } = mats
  switch (kind) {
    case 'terrace':
      return (
        <group key={key} position={[at.x, 0, at.z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.drive}><planeGeometry args={[3.4, 2.3]} /></mesh>
          <mesh position={[0.9, 1.15, 0.2]} material={m.lampPole}><cylinderGeometry args={[0.03, 0.03, 2.3, 6]} /></mesh>
          <mesh position={[0.9, 2.35, 0.2]} castShadow material={m.trim}><coneGeometry args={[1.1, 0.52, 8]} /></mesh>
          <mesh position={[-0.5, 0.36, -0.2]} material={m.frame}><cylinderGeometry args={[0.045, 0.045, 0.72, 6]} /></mesh>
          <mesh position={[-0.5, 0.75, -0.2]} castShadow material={m.trim}><cylinderGeometry args={[0.46, 0.46, 0.05, 12]} /></mesh>
        </group>
      )
    case 'trampoline':
      return (
        <group key={key} position={[at.x, 0, at.z]}>
          <mesh position={[0, 0.64, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow material={m.dark}><torusGeometry args={[1.0, 0.07, 8, 20]} /></mesh>
          <mesh position={[0, 0.62, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.frame}><circleGeometry args={[0.95, 20]} /></mesh>
          {[0, 1, 2, 3].map((k) => {
            const a = (k / 4) * Math.PI * 2 + 0.5
            return <mesh key={k} position={[Math.cos(a) * 0.86, 0.32, Math.sin(a) * 0.86]} material={m.dark}><cylinderGeometry args={[0.035, 0.035, 0.62, 6]} /></mesh>
          })}
        </group>
      )
    case 'pool':
      return (
        <group key={key} position={[at.x, 0, at.z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.02, 0]} material={m.trim}><boxGeometry args={[5.2, 0.12, 3.2]} /></mesh>
          <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.poolWater}><planeGeometry args={[4.6, 2.6]} /></mesh>
        </group>
      )
    case 'shed':
      return (
        <group key={key} position={[at.x, 0, at.z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 1.0, 0]} castShadow material={m.fence}><boxGeometry args={[2.2, 2.0, 1.8]} /></mesh>
          <mesh position={[0, 2.08, 0]} rotation={[0.18, 0, 0]} castShadow material={m.dark}><boxGeometry args={[2.5, 0.1, 2.1]} /></mesh>
        </group>
      )
    case 'washing':
      return (
        <group key={key} position={[at.x, 0, at.z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.95, 0]} material={m.metal}><cylinderGeometry args={[0.04, 0.05, 1.9, 6]} /></mesh>
          {[0, 1, 2, 3].map((k) => {
            const a = (k / 4) * Math.PI * 2
            return (
              <group key={k}>
                <mesh position={[Math.cos(a) * 0.7, 1.75, Math.sin(a) * 0.7]} rotation={[0, -a, 0.24]} material={m.metal}><boxGeometry args={[1.5, 0.02, 0.02]} /></mesh>
                <mesh position={[Math.cos(a) * 0.8, 1.5, Math.sin(a) * 0.8]} rotation={[0, -a, 0]} material={m.trim}><boxGeometry args={[0.45, 0.5, 0.01]} /></mesh>
              </group>
            )
          })}
        </group>
      )
    case 'vegetable':
      return (
        <group key={key} position={[at.x, 0, at.z]}>
          {[0, 1].map((r) => (
            <group key={r} position={[0, 0, r * 0.9 - 0.45]}>
              <mesh position={[0, 0.09, 0]} material={m.soil}><boxGeometry args={[2.4, 0.18, 0.7]} /></mesh>
              {[0, 1, 2, 3].map((c) => (
                <mesh key={c} position={[c * 0.6 - 0.9, 0.28, 0]} material={m.hedgeTop}><icosahedronGeometry args={[0.16, 0]} /></mesh>
              ))}
            </group>
          ))}
        </group>
      )
    default:
      return null
  }
}

/** A car body — shared by driveways, parking bays and moving traffic. */
export function car(
  key: string, at: Vec2, rot: number, body: THREE.Material, mats: MatBag, detail = true,
): React.ReactNode {
  const { m } = mats
  return (
    <group key={key} position={[at.x, 0, at.z]} rotation={[0, rot, 0]}>
      <RoundedBox position={[0, 0.46, 0]} args={[1.84, 0.52, 4.3]} radius={0.14} smoothness={3} castShadow material={body} />
      <RoundedBox position={[0, 0.88, -0.2]} args={[1.66, 0.5, 2.25]} radius={0.12} smoothness={3} castShadow material={body} />
      <RoundedBox position={[0, 0.88, -0.2]} args={[1.68, 0.4, 2.05]} radius={0.1} smoothness={3} material={m.glassDark} />
      {detail && [-1, 1].map((s) => (
        <mesh key={`h${s}`} position={[s * 0.6, 0.54, 2.12]} material={m.sign}><boxGeometry args={[0.36, 0.1, 0.06]} /></mesh>
      ))}
      {detail && <mesh position={[0, 0.56, -2.12]} material={m.hydrant}><boxGeometry args={[1.46, 0.08, 0.06]} /></mesh>}
      {([[-0.88, 1.32], [0.88, 1.32], [-0.88, -1.32], [0.88, -1.32]] as const).map(([wx, wz], i) => (
        <group key={i} position={[wx, 0.33, wz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow material={m.dark}><cylinderGeometry args={[0.33, 0.33, 0.22, 12]} /></mesh>
          {detail && <mesh position={[0, -Math.sign(wx) * 0.12, 0]} material={m.metal}><cylinderGeometry args={[0.19, 0.19, 0.04, 10]} /></mesh>}
        </group>
      ))}
    </group>
  )
}

/* ────────────────────────────── Streets ─────────────────────────────── */

/**
 * Die Straßen.
 *
 * Der Verlauf stammt aus OSM und stimmt; Breite, Bordstein, Gehweg und
 * Markierung erfindet dagegen der Regionalstil. Über einem echten Luftbild ist
 * das ein grauer Streifen quer über die tatsächliche Straße — daneben, in der
 * falschen Breite, mit erfundenen Linien. Deshalb bleibt der Belag bei
 * `realGround` weg.
 *
 * Was aufragt, bleibt: Laternen und Bäume stehen weiterhin, denn ein Luftbild
 * zeigt sie nur von oben und kann sie nicht ersetzen.
 */
function streetNodes(world: Neighbourhood, mats: MatBag, rich: boolean, realGround = false): React.ReactNode[] {
  const { m, spec } = mats
  const out: React.ReactNode[] = []
  const ground = !realGround

  for (const seg of world.network.segments) {
    const mid = { x: (seg.a.x + seg.b.x) / 2, z: (seg.a.z + seg.b.z) / 2 }
    const rotY = seg.horizontal ? 0 : Math.PI / 2
    const L = seg.lengthM
    const W = seg.widthM

    if (ground) out.push(
      <group key={`st-${seg.id}`} position={[mid.x, GROUND_Y, mid.z]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.road}><planeGeometry args={[L, W]} /></mesh>
        {seg.sidewalkM > 0 && [-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[0, 0.03, s * (W / 2 + 0.09)]} material={m.kerb}><boxGeometry args={[L, 0.12, 0.18]} /></mesh>
            <mesh position={[0, 0.006, s * (W / 2 + 0.18 + seg.sidewalkM / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.walk}>
              <planeGeometry args={[L, seg.sidewalkM]} />
            </mesh>
          </group>
        ))}
        {/* Painted markings — the biggest "real road" cue, and per-region. */}
        {spec.street.edgeLines && [-1, 1].map((s) => (
          <mesh key={`e${s}`} position={[0, 0.007, s * (W / 2 - 0.16)]} rotation={[-Math.PI / 2, 0, 0]} material={m.edgeLine}><planeGeometry args={[L, 0.1]} /></mesh>
        ))}
        {(spec.street.centreLine || seg.kind === 'collector') && (
          Array.from({ length: Math.max(1, Math.floor(L / 6)) }).map((_, i, arr) => (
            <mesh key={`d${i}`} position={[(i / arr.length - 0.5) * L + L / (arr.length * 2), 0.007, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.dash}>
              <planeGeometry args={[2.2, 0.14]} />
            </mesh>
          ))
        )}
        {/* Roadside parking bays on the quiet streets — the estate reads used. */}
        {rich && seg.kind === 'residential' && (
          <mesh position={[0, 0.0065, W / 2 - 1.05]} rotation={[-Math.PI / 2, 0, 0]} material={m.edgeLine}><planeGeometry args={[L * 0.5, 0.08]} /></mesh>
        )}
      </group>,
    )
  }

  // Junction character: the roundabout is a real island with a kerb ring.
  for (const node of world.network.nodes.values()) {
    if (node.roundabout) {
      if (ground) out.push(
        <group key={`ra-${node.id}`} position={[node.at.x, GROUND_Y, node.at.z]}>
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.road}><circleGeometry args={[11, 32]} /></mesh>
          <mesh position={[0, 0.05, 0]} material={m.kerb}><cylinderGeometry args={[4.4, 4.4, 0.2, 28]} /></mesh>
          <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.lawnPlot}><circleGeometry args={[4.2, 28]} /></mesh>
          {tree('ra-tree', 'broadleaf', { x: 0, z: 0 }, 1.3, mats)}
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2
            return <mesh key={i} position={[Math.cos(a) * 5.4, 0.28, Math.sin(a) * 5.4]} material={m.sign}><cylinderGeometry args={[0.07, 0.07, 0.56, 6]} /></mesh>
          })}
        </group>,
      )
    }
    if (node.crossing) {
      if (ground) out.push(
        <group key={`cr-${node.id}`} position={[node.at.x, GROUND_Y, node.at.z]}>
          {Array.from({ length: 7 }).map((_, b) => (
            <mesh key={b} position={[(b - 3) * 0.62, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.zebra}><planeGeometry args={[0.42, 7]} /></mesh>
          ))}
        </group>,
      )
    }
  }

  return out
}

function furnitureNode(f: StreetFurniture, i: number, mats: MatBag): React.ReactNode {
  const { m } = mats
  const p: [number, number, number] = [f.at.x, GROUND_Y, f.at.z]
  switch (f.kind) {
    case 'lamp':
      return (
        <group key={`f${i}`} position={p} rotation={[0, f.rotationY, 0]}>
          <mesh position={[0, 0.05, 0]} material={m.lampPole}><cylinderGeometry args={[0.11, 0.14, 0.1, 8]} /></mesh>
          <mesh position={[0, 1.9, 0]} castShadow material={m.lampPole}><cylinderGeometry args={[0.045, 0.06, 3.7, 8]} /></mesh>
          <mesh position={[0, 3.68, 0]} material={m.lamp}><cylinderGeometry args={[0.07, 0.075, 0.14, 8]} /></mesh>
          <mesh position={[0, 3.82, 0]} material={m.lampPole}><cylinderGeometry args={[0.1, 0.055, 0.16, 8]} /></mesh>
        </group>
      )
    case 'busStop':
      return (
        <group key={`f${i}`} position={p} rotation={[0, f.rotationY, 0]}>
          <mesh position={[0, 1.3, -0.6]} material={m.glassRail}><boxGeometry args={[3.4, 2.2, 0.06]} /></mesh>
          <mesh position={[0, 2.45, 0]} castShadow material={m.metal}><boxGeometry args={[3.6, 0.1, 1.5]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 1.7, 1.22, 0]} material={m.metal}><cylinderGeometry args={[0.05, 0.05, 2.45, 6]} /></mesh>
          ))}
          <mesh position={[0, 0.55, 0.35]} material={m.fence}><boxGeometry args={[2.4, 0.08, 0.4]} /></mesh>
          <mesh position={[1.95, 2.2, 0]} material={m.sign}><boxGeometry args={[0.05, 0.5, 0.7]} /></mesh>
        </group>
      )
    case 'hydrant':
      return (
        <group key={`f${i}`} position={p}>
          <mesh position={[0, 0.35, 0]} castShadow material={m.hydrant}><cylinderGeometry args={[0.12, 0.15, 0.7, 8]} /></mesh>
          <mesh position={[0, 0.74, 0]} material={m.hydrant}><sphereGeometry args={[0.13, 8, 6]} /></mesh>
        </group>
      )
    case 'litterBin':
      return (
        <group key={`f${i}`} position={p}>
          <mesh position={[0, 0.55, 0]} castShadow material={m.dark}><cylinderGeometry args={[0.22, 0.19, 0.7, 10]} /></mesh>
          <mesh position={[0, 0.28, 0]} material={m.lampPole}><cylinderGeometry args={[0.04, 0.04, 0.55, 6]} /></mesh>
        </group>
      )
    case 'bench':
      return (
        <group key={`f${i}`} position={p} rotation={[0, f.rotationY, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow material={m.trunk}><boxGeometry args={[1.7, 0.08, 0.5]} /></mesh>
          <mesh position={[0, 0.72, -0.22]} rotation={[-0.25, 0, 0]} material={m.trunk}><boxGeometry args={[1.7, 0.08, 0.36]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.72, 0.22, 0]} material={m.dark}><boxGeometry args={[0.08, 0.44, 0.46]} /></mesh>
          ))}
        </group>
      )
    case 'signpost':
      return (
        <group key={`f${i}`} position={p} rotation={[0, f.rotationY, 0]}>
          <mesh position={[0, 1.1, 0]} material={m.metal}><cylinderGeometry args={[0.035, 0.035, 2.2, 6]} /></mesh>
          <mesh position={[0, 2.05, 0]} material={m.sign}><boxGeometry args={[0.02, 0.32, 0.32]} /></mesh>
        </group>
      )
    case 'bollard':
      return <mesh key={`f${i}`} position={[p[0], p[1] + 0.42, p[2]]} material={m.metal}><cylinderGeometry args={[0.06, 0.07, 0.84, 8]} /></mesh>
    case 'cabinet':
      return (
        <group key={`f${i}`} position={p} rotation={[0, f.rotationY, 0]}>
          <mesh position={[0, 0.68, 0]} castShadow material={m.lampPole}><boxGeometry args={[0.9, 1.36, 0.38]} /></mesh>
          <mesh position={[0, 1.38, 0]} material={m.dark}><boxGeometry args={[0.96, 0.06, 0.44]} /></mesh>
        </group>
      )
    case 'manhole':
      return <mesh key={`f${i}`} position={[p[0], p[1] + 0.007, p[2]]} rotation={[-Math.PI / 2, 0, 0]} material={m.manhole}><circleGeometry args={[0.32, 16]} /></mesh>
    case 'drain':
      return <mesh key={`f${i}`} position={[p[0], p[1] + 0.007, p[2]]} rotation={[-Math.PI / 2, 0, 0]} material={m.drain}><planeGeometry args={[0.5, 0.24]} /></mesh>
    default:
      return null
  }
}

/* ────────────────────────────── Amenities ───────────────────────────── */

function amenityNode(a: Amenity, mats: MatBag, rich: boolean): React.ReactNode {
  const { m, facades } = mats
  const parts: React.ReactNode[] = []
  const W = a.widthM
  const D = a.depthM
  const H = a.heightM
  const shell = facades[2 % facades.length]

  if (a.kind === 'supermarket') {
    parts.push(<mesh key="b" position={[0, H / 2, 0]} castShadow receiveShadow material={shell}><boxGeometry args={[W, H, D]} /></mesh>)
    parts.push(<mesh key="r" position={[0, H + 0.12, 0]} castShadow material={m.metal}><boxGeometry args={[W + 0.6, 0.24, D + 0.6]} /></mesh>)
    // Full-height glazing across the entrance front, with a projecting canopy.
    parts.push(<mesh key="g" position={[0, 2.1, D / 2 + 0.04]} material={m.shopGlass}><boxGeometry args={[W * 0.72, 4.0, 0.08]} /></mesh>)
    parts.push(<mesh key="c" position={[0, 4.4, D / 2 + 1.6]} castShadow material={m.metal}><boxGeometry args={[W * 0.86, 0.16, 3.2]} /></mesh>)
    parts.push(<mesh key="s" position={[0, 5.4, D / 2 + 0.1]} material={m.sign}><boxGeometry args={[W * 0.42, 0.9, 0.14]} /></mesh>)
    // Rooftop plant — every store has it and it breaks the flat silhouette.
    if (rich) for (const [i, ox] of [-0.24, 0.06, 0.3].entries()) {
      parts.push(<mesh key={`u${i}`} position={[W * ox, H + 0.6, -D * 0.2]} castShadow material={m.metal}><boxGeometry args={[2.4, 0.9, 1.8]} /></mesh>)
    }

    if (a.parking) {
      const lot = a.parking
      const lotW = lot.baysPerRow * lot.bayWidthM
      const lotD = lot.rows * lot.bayDepthM + lot.aisleM
      const offZ = lot.at.z - a.at.z
      parts.push(
        <group key="lot" position={[lot.at.x - a.at.x, 0, offZ]}>
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.road}><planeGeometry args={[lotW + 4, lotD + 3]} /></mesh>
          {/* Bay markings — one line per bay boundary, both rows. */}
          {Array.from({ length: lot.rows }).map((_, r) => (
            <group key={r} position={[0, 0, (r - 0.5) * (lot.bayDepthM + lot.aisleM / 2)]}>
              {Array.from({ length: lot.baysPerRow + 1 }).map((_, b) => (
                <mesh key={b} position={[(b - lot.baysPerRow / 2) * lot.bayWidthM, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.edgeLine}>
                  <planeGeometry args={[0.1, lot.bayDepthM]} />
                </mesh>
              ))}
            </group>
          ))}
          {/* Parked cars — the lot is never empty and never full. */}
          {rich && lot.occupied.slice(0, 26).map((idx) => {
            const r = Math.floor(idx / lot.baysPerRow)
            const b = idx % lot.baysPerRow
            return car(
              `lc${idx}`,
              { x: (b - lot.baysPerRow / 2 + 0.5) * lot.bayWidthM, z: (r - 0.5) * (lot.bayDepthM + lot.aisleM / 2) },
              0,
              mats.carBodies[idx % mats.carBodies.length],
              mats,
              false,
            )
          })}
          {/* Trolley shelters — a roof on posts with a rank of trolleys. */}
          {lot.trolleyShelters.map((t, i) => (
            <group key={`ts${i}`} position={[t.x, 0, t.z]}>
              <mesh position={[0, 2.3, 0]} castShadow material={m.metal}><boxGeometry args={[3.0, 0.08, 1.9]} /></mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * 1.4, 1.15, 0]} material={m.metal}><cylinderGeometry args={[0.05, 0.05, 2.3, 6]} /></mesh>
              ))}
              {rich && Array.from({ length: 5 }).map((_, k) => (
                <mesh key={k} position={[k * 0.28 - 0.6, 0.5, 0]} material={m.metal}><boxGeometry args={[0.5, 0.9, 0.55]} /></mesh>
              ))}
            </group>
          ))}
          {/* EV charging — a post with a lit status band per bay. */}
          {lot.chargers.map((c, i) => (
            <group key={`ch${i}`} position={[c.x, 0, c.z]}>
              <mesh position={[0, 0.75, 0]} castShadow material={m.lampPole}><boxGeometry args={[0.34, 1.5, 0.24]} /></mesh>
              <mesh position={[0, 1.2, 0.13]} material={m.lamp}><boxGeometry args={[0.22, 0.1, 0.03]} /></mesh>
            </group>
          ))}
        </group>,
      )
    }
  } else if (a.kind === 'fuel') {
    parts.push(<mesh key="k" position={[0, 1.6, -D / 2 + 2]} castShadow material={shell}><boxGeometry args={[W * 0.4, 3.2, 4]} /></mesh>)
    parts.push(<mesh key="c" position={[0, 5.0, 1]} castShadow material={m.trim}><boxGeometry args={[W, 0.5, D * 0.7]} /></mesh>)
    for (const [i, sx] of [-1, 1].entries()) {
      parts.push(<mesh key={`p${i}`} position={[sx * W * 0.3, 2.5, 1]} material={m.metal}><cylinderGeometry args={[0.14, 0.14, 5, 8]} /></mesh>)
      parts.push(<mesh key={`d${i}`} position={[sx * 2.2, 0.7, 1]} castShadow material={m.sign}><boxGeometry args={[0.7, 1.4, 1.2]} /></mesh>)
    }
  } else {
    // Parade unit: shop front, sign band, awning.
    parts.push(<mesh key="b" position={[0, H / 2, 0]} castShadow receiveShadow material={shell}><boxGeometry args={[W, H, D]} /></mesh>)
    parts.push(<mesh key="r" position={[0, H + 0.08, 0]} castShadow material={m.metal}><boxGeometry args={[W + 0.3, 0.16, D + 0.3]} /></mesh>)
    parts.push(<mesh key="g" position={[0, 1.5, D / 2 + 0.04]} material={m.shopGlass}><boxGeometry args={[W * 0.8, 2.6, 0.08]} /></mesh>)
    parts.push(<mesh key="s" position={[0, 3.4, D / 2 + 0.08]} material={m.sign}><boxGeometry args={[W * 0.78, 0.55, 0.1]} /></mesh>)
    if (rich) {
      parts.push(<mesh key="aw" position={[0, 3.0, D / 2 + 0.7]} rotation={[0.32, 0, 0]} castShadow material={m.hydrant}><boxGeometry args={[W * 0.82, 0.06, 1.5]} /></mesh>)
      // Pavement tables outside the café.
      if (a.kind === 'cafe') {
        for (const [i, ox] of [-1.6, 0.2, 2.0].entries()) {
          parts.push(
            <group key={`tb${i}`} position={[ox, 0, D / 2 + 2.2]}>
              <mesh position={[0, 0.36, 0]} material={m.frame}><cylinderGeometry args={[0.04, 0.04, 0.72, 6]} /></mesh>
              <mesh position={[0, 0.74, 0]} castShadow material={m.trim}><cylinderGeometry args={[0.36, 0.36, 0.05, 12]} /></mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * 0.6, 0.42, 0]} castShadow material={m.dark}><boxGeometry args={[0.4, 0.06, 0.4]} /></mesh>
              ))}
            </group>,
          )
        }
      }
    }
  }

  return <group key={a.id} position={[a.at.x, GROUND_Y, a.at.z]} rotation={[0, a.rotationY, 0]}>{parts}</group>
}

function parkNode(park: ParkSpec, mats: MatBag, rich: boolean, realGround = false): React.ReactNode {
  const { m } = mats
  const w = park.maxX - park.minX
  const d = park.maxZ - park.minZ
  const cx = (park.minX + park.maxX) / 2
  const cz = (park.minZ + park.maxZ) / 2
  const parts: React.ReactNode[] = []

  // Der Parkrasen ist eine Fläche in erfundener Größe an erfundener Stelle;
  // das Luftbild zeigt die echte Grünfläche bereits.
  if (!realGround) parts.push(<mesh key="g" position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.lawnPlot}><planeGeometry args={[w, d]} /></mesh>)

  // Gravel path: one quad per polyline leg.
  for (let i = 1; i < park.path.length; i++) {
    const a = park.path[i - 1]
    const b = park.path[i]
    const mx = (a.x + b.x) / 2 - cx
    const mz = (a.z + b.z) / 2 - cz
    const L = Math.hypot(b.x - a.x, b.z - a.z)
    const ang = Math.atan2(b.z - a.z, b.x - a.x)
    parts.push(
      <mesh key={`p${i}`} position={[mx, 0.008, mz]} rotation={[-Math.PI / 2, 0, -ang]} receiveShadow material={m.gravel}>
        <planeGeometry args={[L + 1.2, 1.8]} />
      </mesh>,
    )
  }

  if (park.pond) {
    parts.push(
      <group key="pond" position={[park.pond.at.x - cx, 0, park.pond.at.z - cz]}>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.soil}><circleGeometry args={[park.pond.radiusM + 0.6, 24]} /></mesh>
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.water}><circleGeometry args={[park.pond.radiusM, 24]} /></mesh>
      </group>,
    )
  }

  if (park.playground) {
    const pg = park.playground
    const items: React.ReactNode[] = []
    for (const [i, it] of pg.items.entries()) {
      const at: [number, number, number] = [it.at.x, 0, it.at.z]
      if (it.kind === 'swing') {
        items.push(
          <group key={i} position={at} rotation={[0, it.rotationY, 0]}>
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh position={[s * 1.1, 1.0, -0.5]} rotation={[0, 0, s * 0.2]} material={m.metal}><cylinderGeometry args={[0.05, 0.05, 2.1, 6]} /></mesh>
                <mesh position={[s * 1.1, 1.0, 0.5]} rotation={[0, 0, s * 0.2]} material={m.metal}><cylinderGeometry args={[0.05, 0.05, 2.1, 6]} /></mesh>
              </group>
            ))}
            <mesh position={[0, 2.0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.metal}><cylinderGeometry args={[0.05, 0.05, 2.4, 6]} /></mesh>
            {[-0.6, 0.6].map((ox) => (
              <group key={ox}>
                <mesh position={[ox, 1.3, 0]} material={m.dark}><cylinderGeometry args={[0.012, 0.012, 1.4, 4]} /></mesh>
                <mesh position={[ox, 0.6, 0]} material={m.hydrant}><boxGeometry args={[0.42, 0.05, 0.2]} /></mesh>
              </group>
            ))}
          </group>,
        )
      } else if (it.kind === 'slide') {
        items.push(
          <group key={i} position={at} rotation={[0, it.rotationY, 0]}>
            <mesh position={[0, 0.8, -0.6]} castShadow material={m.trunk}><boxGeometry args={[1.1, 1.6, 1.1]} /></mesh>
            <mesh position={[0, 0.85, 0.9]} rotation={[0.62, 0, 0]} castShadow material={m.metal}><boxGeometry args={[0.7, 0.06, 2.4]} /></mesh>
          </group>,
        )
      } else if (it.kind === 'sandpit') {
        items.push(
          <group key={i} position={at}>
            <mesh position={[0, 0.06, 0]} material={m.sand}><boxGeometry args={[3.0, 0.12, 3.0]} /></mesh>
            <mesh position={[0, 0.16, 0]} material={m.trunk}><boxGeometry args={[3.2, 0.16, 0.18]} /></mesh>
          </group>,
        )
      } else if (it.kind === 'climb') {
        items.push(
          <group key={i} position={at} rotation={[0, it.rotationY, 0]}>
            {[-1, 1].map((s) => [-1, 1].map((t) => (
              <mesh key={`${s}${t}`} position={[s * 0.7, 0.85, t * 0.7]} material={m.metal}><cylinderGeometry args={[0.045, 0.045, 1.7, 6]} /></mesh>
            )))}
            {[0.6, 1.1, 1.6].map((y) => (
              <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.metal}><torusGeometry args={[0.7, 0.03, 4, 4]} /></mesh>
            ))}
          </group>,
        )
      } else if (it.kind === 'seesaw') {
        items.push(
          <group key={i} position={at} rotation={[0, it.rotationY, 0]}>
            <mesh position={[0, 0.35, 0]} material={m.metal}><boxGeometry args={[0.2, 0.7, 0.2]} /></mesh>
            <mesh position={[0, 0.72, 0]} rotation={[0, 0, 0.14]} castShadow material={m.hydrant}><boxGeometry args={[2.6, 0.08, 0.28]} /></mesh>
          </group>,
        )
      } else {
        items.push(
          <group key={i} position={at} rotation={[0, it.rotationY, 0]}>
            <mesh position={[0, 0.45, 0]} castShadow material={m.trunk}><boxGeometry args={[1.7, 0.08, 0.5]} /></mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.72, 0.22, 0]} material={m.dark}><boxGeometry args={[0.08, 0.44, 0.46]} /></mesh>
            ))}
          </group>,
        )
      }
    }
    parts.push(
      <group key="pg" position={[pg.at.x - cx, 0, pg.at.z - cz]}>
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.sand}><circleGeometry args={[pg.radiusM, 24]} /></mesh>
        {items}
      </group>,
    )
  }

  for (const [i, t] of park.trees.entries()) {
    if (!rich && i % 2 === 1) continue
    parts.push(tree(`pt${i}`, i % 3 === 0 ? 'conifer' : 'broadleaf', { x: t.at.x - cx, z: t.at.z - cz }, t.scale, mats))
  }
  if (rich) {
    for (const [i, b] of park.benches.entries()) {
      parts.push(
        <group key={`bn${i}`} position={[b.at.x - cx, 0, b.at.z - cz]} rotation={[0, b.rotationY, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow material={m.trunk}><boxGeometry args={[1.7, 0.08, 0.5]} /></mesh>
          <mesh position={[0, 0.72, -0.22]} rotation={[-0.25, 0, 0]} material={m.trunk}><boxGeometry args={[1.7, 0.08, 0.36]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.72, 0.22, 0]} material={m.dark}><boxGeometry args={[0.08, 0.44, 0.46]} /></mesh>
          ))}
        </group>,
      )
    }
  }

  return <group key="park" position={[cx, GROUND_Y, cz]}>{parts}</group>
}

/* ────────────────────────────── Component ───────────────────────────── */

/**
 * Wie grob der Kamera-Anker gerastert wird, in Metern.
 *
 * Die Detailstufe muss an der Kamera hängen (siehe unten), aber sie darf nicht
 * an *jedem Bild* neu bestimmt werden — das hieße, den gesamten Knotenbaum aus
 * hunderten Gebäuden pro Frame neu aufzubauen. 25 m ist der Kompromiss: fein
 * genug, dass die Aufwertung beim Heranfahren rechtzeitig kommt, grob genug,
 * dass eine ruhige Kamerabewegung nur wenige Neuaufbauten auslöst.
 */
const LOD_ANCHOR_STEP_M = 25

/** Rang der Detailstufen — `massing` ist die grobste. */
const RANK_LOD: Record<HouseLod, number> = { massing: 0, simple: 1, full: 2 }

export function Neighbourhood3D({ world, phase, daylightScale, season, rich, groundTexture, sampleGround }: Props) {
  /**
   * Der Bezugspunkt der Detailstufe.
   *
   * Bisher stand die Stufe jedes Nachbargebäudes fest, sobald die Welt gebaut
   * war — berechnet aus der Entfernung zum **Plan-Mittelpunkt**. Bei knapp 700
   * Katastergebäuden ist damit fast alles `massing`, also eine reine Box, und
   * die bleibt eine Box, egal wie nah man heranzoomt. Genau deshalb wurde die
   * Ansicht beim Hineinzoomen schlechter statt besser.
   *
   * Jetzt zählt die Entfernung zur Kamera. Gerastert auf
   * {@link LOD_ANCHOR_STEP_M}, damit der Knotenbaum nicht pro Frame entsteht.
   */
  const [anchor, setAnchor] = useState<{ x: number; z: number }>({ x: 0, z: 0 })
  const lastAnchor = useRef(anchor)
  useFrame(({ camera }) => {
    const q = (v: number) => Math.round(v / LOD_ANCHOR_STEP_M) * LOD_ANCHOR_STEP_M
    const next = { x: q(camera.position.x), z: q(camera.position.z) }
    if (next.x === lastAnchor.current.x && next.z === lastAnchor.current.z) return
    lastAnchor.current = next
    setAnchor(next)
  })

  /**
   * Materialien und Texturen — bewusst **ohne** den Kamera-Anker in den
   * Abhängigkeiten.
   *
   * Sie hier gemeinsam mit den Knoten neu zu bauen wäre ein schlimmerer Fehler
   * als der, den die kamerabezogene Detailstufe behebt: `buildMaterials`
   * erzeugt prozedurale Texturen und Materialien und gibt die alten frei. Alle
   * 25 m Kamerabewegung wäre das ein Neuaufbau des gesamten Materialsatzes —
   * spürbares Stocken und GPU-Speicher, der auf- und abgebaut wird.
   */
  // Starts the baked outdoor library loading and returns a version that bumps
  // once it lands, so these materials rebuild against the new pixels exactly
  // once instead of only after a reload.
  const bakedVersion = useOutdoorTextures()
  const mats = useMemo(
    () => buildMaterials(world, season, daylightScale, phase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, season, daylightScale, phase, bakedVersion],
  )

  /*
   * Der Himmel als Spiegelbild — auf genau die Materialien, die spiegeln.
   *
   * Es wird bewusst **nicht** `scene.environment` gesetzt. Dort hängt die
   * Archviz-Box, die die Innenräume beleuchtet; sie durch den Aussenhimmel zu
   * ersetzen hiesse, die abgestimmte Innenbeleuchtung für den Aussenraum zu
   * opfern. Ein Material mit eigener `envMap` überschreibt die Szenenumgebung
   * nur für sich selbst — innen bleibt innen, draussen spiegelt der Himmel.
   *
   * Die Auswahl ist keine Geschmacksfrage: hier stehen die Oberflächen, die in
   * der Wirklichkeit ein Spiegelbild tragen. Rasen, Putz und Ziegel gehören
   * nicht dazu und bekommen es deshalb auch nicht.
   */
  const skyEnv = useSkyEnvironment()
  useEffect(() => {
    const { m } = mats

    /*
     * Nur die **spiegelnden** Materialien bekommen den Himmel.
     *
     * Hier standen zwischenzeitlich auch alle diffusen Flächen — Putz,
     * Klinker, Ziegel, Rasen, Asphalt —, in der Absicht, ihnen den Himmel als
     * Umgebungslicht zu geben. Das war ein Fehler, und zwar ein grosser: eine
     * eigene `envMap` am Material **ersetzt** `scene.environment`. Die
     * Aussenflächen verloren damit die Archviz-Box, die sie vorher beleuchtet
     * hat, und bekamen dafür den Himmel — nur eben mit einer Stärke, die
     * gegen das Hemisphärenlicht bemessen war statt gegen die Box.
     *
     * Nachgerechnet (`verify:gi`, beide Grössen linear, wie three sie
     * verrechnet):
     *
     *     Innenraum-Box   1,396
     *     Himmel 08:15    0,075   →  nötige envMapIntensity 18,7
     *     gesetzt war                                        0,15
     *
     * Also rund **125-fach zu wenig**. Praktisch das gesamte Umgebungslicht des
     * Aussenraums war weg. Ohne Umgebungslicht liegt auf einer Klinkerwand nur
     * noch Sonne und Hemisphärenlicht, ihre Struktur verliert die Aufhellung,
     * in der man sie überhaupt sieht — die Fläche liest sich als flache Farbe,
     * und genau das war als „die Textur ist schlechter" zu sehen.
     *
     * Die Lehre ist nicht „die Zahl war zu klein", sondern: ich habe gegen die
     * falsche Bezugsgrösse bilanziert. Verglichen wurde mit dem
     * Hemisphärenlicht, während der Beitrag, den die `envMap` tatsächlich
     * verdrängt, `scene.environment` ist.
     *
     * Deshalb bleibt `scene.environment` für alles Diffuse unangetastet. Der
     * Himmel liegt nur dort, wo er ein **Spiegelbild** ist und nicht eine
     * Lichtmenge: Glas, Wasser, Lack, Metall, Solarmodule. Dort ersetzt er die
     * Fotostudio-Spiegelung, die vorher in den Fenstern stand, und dort ist die
     * Stärke keine Bilanzfrage — eine Scheibe soll den Himmel so hell zeigen,
     * wie er ist.
     */
    const reflective: THREE.Material[] = [
      m.glassLit, m.glassDim, m.glassDark, m.shopGlass, m.glassRail,
      m.water, m.poolWater, m.solar, m.metal, m.drain, m.manhole,
      ...mats.carBodies,
    ]
    for (const mat of reflective) {
      const mm = mat as THREE.MeshStandardMaterial
      mm.envMap = skyEnv
      mm.needsUpdate = true
    }
    return () => {
      // Beim Abbau die Karte wieder lösen: sie gehört dem Himmel, nicht dem
      // Material, und ein Material mit Verweis auf eine freigegebene Textur
      // zeichnet schwarz.
      for (const mat of reflective) {
        const mm = mat as THREE.MeshStandardMaterial
        if (mm.envMap === skyEnv) { mm.envMap = null; mm.needsUpdate = true }
      }
    }
  }, [mats, skyEnv])

  const built = useMemo(() => {
    const nodes: React.ReactNode[] = []

    // Dachfarben aus dem Luftbild.
    //
    // Der Regionalstil würfelt sie sonst aus einer Palette — über einem echten
    // Foto sieht man den Unterschied sofort: die Straße hat rote Ziegel,
    // dunklen Schiefer und graues Flachdach nebeneinander, das Modell malt sie
    // in drei ausgedachten Tönen. Dabei liegt die Antwort direkt darunter, denn
    // das Orthophoto ist die Aufsicht auf genau diese Dächer.
    //
    // Quantisiert, weil jede eigene Farbe ein eigenes Material und damit einen
    // eigenen Zeichenaufruf bedeutet. Zwei benachbarte Rottöne unterscheidet
    // niemand, Rot von Schiefergrau jeder.
    const roofOverride = new Map<HouseSpec, THREE.MeshStandardMaterial>()
    if (sampleGround) {
      const sampled: { house: HouseSpec; rgb: Rgb }[] = []
      for (const h of world.houses) {
        // Ein Drittel der kleineren Gebäudekante als Leseradius: groß genug,
        // um Gauben und Schattenkanten wegzumitteln, klein genug, um nicht auf
        // dem Nachbardach oder im Garten zu landen.
        const r = Math.max(1.5, Math.min(h.widthM, h.depthM) / 3)
        const hex = sampleGround(h.centre.x, h.centre.z, r)
        if (!hex) continue
        sampled.push({ house: h, rgb: hexToRgb(hex) })
      }
      if (sampled.length > 0) {
        const { palette, indexOf } = quantise(sampled.map((s) => s.rgb), 12)
        const mats2 = palette.map((hex) => {
          const mat = mats.roofs[0].clone()
          mat.color.set(hex)
          // Das Luftbild bringt die Beleuchtung der Befliegung schon mit;
          // ungedämpft wären die Dächer im Modell doppelt beleuchtet.
          mat.color.multiplyScalar(0.92)
          return mat
        })
        sampled.forEach((s, i) => roofOverride.set(s.house, mats2[indexOf[i]]))
      }
    }

    // Ground plane under everything — blocks, verges and the space beyond.
    const size = world.extentM * 2.4

    // Liegt ein amtliches Luftbild vor, ist *es* der Boden. Die Textur ist auf
    // exakt diese Kantenlänge bestellt worden (siehe `useOrthophotoGround`),
    // deckt die Ebene also 1:1 — deshalb kein `repeat`, kein Versatz.
    //
    // Die Ausrichtung stimmt ohne Zutun: die Ebene wird um −90° um x gekippt,
    // ihre lokale +y-Achse zeigt danach nach −z, also nach Norden. Texturen
    // werden in three standardmäßig gespiegelt geladen (`flipY`), sodass die
    // oberste Bildzeile — beim WMS der Norden — bei v = 1 landet. Norden oben
    // im Bild wird Norden in der Szene.
    //
    // `MeshBasicMaterial` wäre falsch: der Boden muss Schatten annehmen, sonst
    // schwebt das Haus über seinem eigenen Luftbild.
    if (groundTexture) {
      // Vorfeld: eine große Fläche **unter** und um das Luftbild herum.
      //
      // Das Luftbild ist exakt so groß wie bestellt — daran darf sich nichts
      // ändern, sonst stimmt die Georeferenzierung nicht mehr. Genau deshalb
      // hat es aber eine sichtbare Kante, und bei flachem Blickwinkel sah man
      // über sie hinaus ins Nichts; die Szene wirkte wie eine schwebende
      // Platte. Das Vorfeld schließt den Horizont, ohne den Maßstab des Bildes
      // anzutasten.
      nodes.push(
        <mesh
          key="ground-apron"
          // 40 cm tiefer, nicht 5.
          //
          // Bei 5 cm lagen zwei riesige, fast parallele Flächen im selben
          // Tiefenbereich — das Vorfeld und die Bodenebene. Auf große
          // Entfernung reicht die Genauigkeit des Tiefenpuffers dort nicht
          // mehr aus, um sie zu trennen, und das Bild flackert zwischen beiden
          // hin und her. Ein größerer Abstand löst das ohne Tricks; sichtbar
          // ist die Stufe nicht, weil sie am Rand des Luftbilds liegt und dort
          // ohnehin über hundert Meter entfernt ist.
          position={[world.network.centre.x, GROUND_Y - 0.4, world.network.centre.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          // **Kein** `receiveShadow`. Das Vorfeld ist ein Vielfaches der Szene
          // groß und liegt damit fast vollständig außerhalb des
          // Schatten-Frustums (siehe `shadowExtentM` in ThreeDView). Dort
          // liefert die Schattenkarte keine sinnvollen Werte mehr, und das
          // Ergebnis ist Schattenakne: helle und dunkle Streifen quer über die
          // ganze Fläche. Genau so sah es aus, bis diese Zeile fehlte.
          material={mats.m.apron}
        >
          <planeGeometry args={[size * APRON_FACTOR, size * APRON_FACTOR]} />
        </mesh>,
      )
      nodes.push(
        <mesh
          key="ground"
          position={[world.network.centre.x, GROUND_Y - 0.002, world.network.centre.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[size, size]} />
          <meshStandardMaterial
            map={groundTexture}
            /*
             * Tageszeit-Tönung — der Grund, warum der Boden nachts weiß leuchtete.
             *
             * Jedes andere Material dieser Szene bekommt seine Grundfarbe über
             * `dim()` mit `daylightScale` multipliziert (nachts 0,07). Der
             * Luftbild-Boden hatte gar keine Grundfarbe, nur die Textur — und
             * `color` steht bei three standardmäßig auf Weiß, wirkt also als
             * neutraler Faktor 1. Zusammen mit der Studio-IBL, die nachts noch
             * mit 35 % leuchtet, ergab das eine strahlend weiße Platte unter
             * einer stockdunklen Nachtszene.
             *
             * Nicht ganz bis auf `daylightScale` hinunter: das Luftbild ist bei
             * Tageslicht aufgenommen und bringt seine eigene Helligkeit mit.
             * Der Exponent dämpft die Kurve nur leicht, damit der Boden nachts
             * wirklich dunkel wird — nachgerechnet mit der IBL, die dann noch
             * mit 35 % leuchtet: 0,07^0,75 ≈ 0,14, also rund 5 % Resthelligkeit.
             * Der Boden verschwindet damit nicht ganz; man soll noch erkennen,
             * wo man steht.
             */
            color={new THREE.Color().setScalar(Math.max(0.08, daylightScale ** 0.75))}
            // Beidseitig: eine einseitige Ebene ist von unten unsichtbar, und
            // dann schaut man durch den Boden hindurch in die Szene.
            side={THREE.DoubleSide}
            roughness={0.94}
            metalness={0}
            // Das Luftbild bringt seine eigene Beleuchtung mit — Sonnenstand,
            // Schatten, Jahreszeit der Befliegung. Ein zweites Mal voll zu
            // beleuchten überstrahlt es; die Szene darf es nur noch tönen.
            envMapIntensity={0.35}
          />
        </mesh>,
      )
    } else {
      nodes.push(
        <mesh key="ground-apron" position={[world.network.centre.x, GROUND_Y - 0.4, world.network.centre.z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.m.apron}>
          <planeGeometry args={[size * APRON_FACTOR, size * APRON_FACTOR]} />
        </mesh>,
        <mesh key="ground" position={[world.network.centre.x, GROUND_Y - 0.002, world.network.centre.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mats.m.lawn}>
          <planeGeometry args={[size, size]} />
        </mesh>,
      )
    }

    nodes.push(...streetNodes(world, mats, rich, !!groundTexture))
    // Die Stufen sind absichtlich enger als die des Weltgenerators: dort geht
    // es um das Budget der ganzen Szene, hier um das, was gerade im Bild ist.
    const FULL_M = 55, SIMPLE_M = 130
    for (const h of world.houses) {
      const d = Math.hypot(h.centre.x - anchor.x, h.centre.z - anchor.z)
      const lod: HouseLod = d <= FULL_M ? 'full' : d <= SIMPLE_M ? 'simple' : 'massing'
      // Nie *unter* die Einstufung des Generators fallen: der kennt das
      // Gesamtbudget der Szene und hat Gründe für seine Obergrenze.
      const effective: HouseLod = RANK_LOD[lod] < RANK_LOD[h.lod] ? lod : h.lod
      const shown = effective === h.lod ? h : { ...h, lod: effective }
      nodes.push(houseNode(shown, mats, rich, !!groundTexture, roofOverride.get(h)))
    }
    for (const a of world.amenities) nodes.push(amenityNode(a, mats, rich))
    if (world.park) nodes.push(parkNode(world.park, mats, rich, !!groundTexture))
    for (const [i, f] of world.furniture.entries()) {
      // Drains and manholes are pure garnish at low tier.
      if (!rich && (f.kind === 'drain' || f.kind === 'manhole' || f.kind === 'signpost')) continue
      nodes.push(furnitureNode(f, i, mats))
    }

    return { nodes }
  }, [world, mats, rich, groundTexture, sampleGround, anchor, daylightScale])

  // Freigabe hängt an **`mats`**, nicht am Knotenbaum.
  //
  // Seit die Detailstufe an der Kamera hängt, entsteht der Knotenbaum bei jeder
  // Bewegung neu — mit `[built]` als Abhängigkeit hätte dieser Effekt die
  // Materialien und Texturen also alle 25 m weggeworfen, während sie noch in
  // Gebrauch sind. Aufgeräumt wird, wenn der Materialsatz ersetzt wird, und
  // nur dann.
  useEffect(() => {
    const { all, textures } = mats
    return () => {
      all.forEach((mm) => mm.dispose())
      textures.forEach((t) => t.dispose())
    }
  }, [mats])

  return <Static>{built.nodes}</Static>
}

export { GROUND_Y, buildMaterials }
export type { MatBag }


/** Umkehrung von `rgbToHex` — bewusst hier, weil nur dieser Pfad sie braucht. */
function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
