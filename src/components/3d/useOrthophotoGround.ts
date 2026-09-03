/**
 * useOrthophotoGround — der Boden der Szene wird zum echten Luftbild.
 *
 * Bis hierher war die Grundfläche eine Rasentextur: plausibel, aber nirgendwo.
 * Man erkennt sein Zuhause aber nicht am Haus allein, sondern an der Einfahrt,
 * dem Pflaster, der Hecke, dem Nachbargrundstück. Genau das liefert die
 * amtliche Befliegung mit 10 cm Auflösung (siehe `sources/dop`).
 *
 * Die Regel ist dieselbe wie überall in dieser Pipeline: **gemessen schlägt
 * angenommen, angenommen schlägt leer.** Ohne Ort, ohne Befliegung oder bei
 * einem Ausfall bleibt der erzeugte Boden stehen — kein Ladebildschirm, kein
 * Fehler, nur weniger Wirklichkeit.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { resolveOrthophoto, type Orthophoto } from '@/lib/composer/sources/dop'
import { medianColour, rgbToHex } from '@/lib/world/roofColours'
import { srgbToLinear } from '@/lib/render/skyModel'
import { activeProfile } from '@/lib/render/quality'
import type { PlanGeo } from '@/types'

export interface OrthophotoGround {
  texture: THREE.Texture | null
  /**
   * Liest die vorherrschende Farbe an einer Stelle der Szene, in Weltmetern
   * relativ zum Bildmittelpunkt. Damit bekommt jedes Nachbardach die Farbe,
   * die es tatsächlich hat — das Luftbild ist die Aufsicht auf genau diese
   * Dächer.
   */
  sampleAt?: (x: number, z: number, radiusM?: number) => string | undefined
  /**
   * Mittlere Reflexion der abgebildeten Fläche, linear, 0…1 je Kanal.
   *
   * Das ist der Bodenanteil der Umgebungsbeleuchtung (siehe `lib/skyModel`):
   * wie viel Licht der Boden zurückwirft und in welcher Farbe. Bisher stand
   * dort ein angenommener Rasenwert. Liegt ein Luftbild vor, ist die Antwort
   * **messbar** — und über einer Straße mit Asphalt, Ziegeldächern und Gärten
   * ist der echte Rückwurf deutlich grauer und wärmer als reines Grün.
   */
  albedo?: [number, number, number]
  /** Für die Nennung im Bild — die Lizenz verlangt sie nicht, der Anstand schon. */
  attribution?: string
  photo?: Orthophoto
  /** Warum kein Luftbild vorliegt — für die Anzeige, nicht nur die Konsole. */
  reason?: string
  loading: boolean
}

export interface UseOrthophotoGroundInput {
  geo?: PlanGeo
  /** Kantenlänge der Grundebene in Metern — Bild und Ebene müssen deckungsgleich sein. */
  groundSizeM: number
  /** Kantenlänge der Textur in Pixeln. Höher = schärfer und teurer. */
  pixels?: number
  enabled?: boolean
}

export function useOrthophotoGround(input: UseOrthophotoGroundInput): OrthophotoGround {
  const { geo, groundSizeM, pixels = 2048, enabled = true } = input
  const [state, setState] = useState<OrthophotoGround>({ texture: null, loading: false })
  const runRef = useRef(0)

  // Auf ganze Meter gerundet, damit ein Pixel Kameradrift nicht jedes Mal ein
  // neues 2048er Bild anfordert.
  const sizeKey = Math.round(groundSizeM)

  useEffect(() => {
    const run = ++runRef.current
    if (!enabled || !geo) {
      // Ohne Ortsbezug wird gar nichts abgefragt — und genau das war bisher
      // unsichtbar: die Szene zeigt erzeugten Rasen, was völlig plausibel
      // aussieht, und niemand erfährt, dass dem Plan schlicht die Koordinate
      // fehlt. Der häufigste Grund, und der einzige, den der Nutzer selbst
      // beheben kann.
      const dbg = window as unknown as Record<string, unknown>
      dbg.__OMEGA_GROUND__ = {
        ergebnis: 'kein Luftbild',
        grund: geo ? 'Luftbild abgeschaltet' : 'Plan hat keinen Ortsbezug — im Composer setzen',
      }
      setState({
        texture: null,
        reason: geo ? 'abgeschaltet' : 'Plan hat keinen Ortsbezug',
        loading: false,
      })
      return
    }
    const ac = new AbortController()
    setState((s) => ({ ...s, loading: true }))

    void (async () => {
      const found = await resolveOrthophoto(
        { at: { lat: geo.lat, lng: geo.lng }, groundSizeM: sizeKey, pixels },
        ac.signal,
      )
      if (run !== runRef.current || ac.signal.aborted) return
      if (!found.ok) {
        setState({ texture: null, reason: found.reason, loading: false })
        return
      }

      const tex = new THREE.Texture(found.image)
      // Farbraum: das Luftbild ist ein Foto, also sRGB. Ohne diese Zeile wäre
      // der Boden sichtbar zu hell und flau — three würde die Werte als linear
      // interpretieren und ein zweites Mal aufhellen.
      tex.colorSpace = THREE.SRGBColorSpace
      // Der Boden wird fast immer flach gesehen. Ohne anisotrope Filterung
      // verwischt genau dort, wo das Auge die Struktur sucht.
      tex.anisotropy = activeProfile().anisotropy
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
      tex.needsUpdate = true

      // Nachvollziehbar machen, was auf dem Boden liegt. Ob eine Textur wirklich
      // ankommt, lässt sich einem gerenderten Bild sonst nicht ansehen — und
      // die Frage „ist das mein Grundstück oder eine Erfindung?" ist genau die,
      // die dieser Digital Twin beantworten soll.
      console.info(
        `%cOMEGA Boden%c ${found.photo.source.label} · ${found.photo.groundSizeM} m auf `
        + `${found.photo.pixels} px = ${found.photo.cmPerPixel} cm/px`,
        'font-weight:600;color:#C7A24E', 'color:inherit',
      )
      const dbg = window as unknown as Record<string, unknown>
      dbg.__OMEGA_GROUND__ = {
        quelle: found.photo.source.label,
        lizenz: found.photo.source.licence,
        bodenkanteM: found.photo.groundSizeM,
        pixel: found.photo.pixels,
        cmProPixel: found.photo.cmPerPixel,
      }

      // Einmal in ein Offscreen-Canvas zeichnen; danach ist jedes Ablesen ein
      // reiner Speicherzugriff. Das Bild selbst wandert unverändert als Textur
      // auf die GPU — hier geht es nur um die Farbwerte.
      const sampler = makeSampler(found.image, found.photo.groundSizeM)
      const albedo = meanAlbedo(found.image)

      setState({
        texture: tex,
        attribution: found.photo.source.attribution,
        photo: found.photo,
        sampleAt: sampler,
        albedo,
        loading: false,
      })
    })()

    return () => { ac.abort() }
    // Keyed on the coordinates rather than the `geo` object: a re-render that
    // hands over an equal-but-new object must not refetch a 2048² aerial image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geo?.lat, geo?.lng, sizeKey, pixels])

  // Die Textur hält ein GPU-Bild fest; ohne Freigabe sammelt jeder Ortswechsel
  // ein weiteres an.
  const lastTex = useRef<THREE.Texture | null>(null)
  useEffect(() => {
    if (lastTex.current && lastTex.current !== state.texture) lastTex.current.dispose()
    lastTex.current = state.texture
  }, [state.texture])
  useEffect(() => () => { lastTex.current?.dispose() }, [])

  return state
}


/**
 * Baut den Farbleser über dem geladenen Luftbild.
 *
 * Die Umrechnung ist die Umkehrung der Bodenebene: das Bild deckt
 * `groundSizeM` Meter ab, sein Mittelpunkt liegt im Plan-Mittelpunkt, Norden
 * ist oben. In der Szene wächst z nach Süden, also wächst auch die Bildzeile
 * mit z — dieselbe Zuordnung, mit der die Textur auf die Ebene kommt.
 *
 * Gibt `undefined` zurück, wenn das Auslesen scheitert (kein Canvas-Backend)
 * oder die Stelle außerhalb des Bildes liegt. Dann bleibt die Farbe aus der
 * Palette des Regionalstils — schlechter, aber nie falsch aussehend.
 */
function makeSampler(
  image: HTMLImageElement,
  groundSizeM: number,
): ((x: number, z: number, radiusM?: number) => string | undefined) | undefined {
  try {
    const px = Math.min(image.naturalWidth || 1024, 1024)
    const cv = document.createElement('canvas')
    cv.width = cv.height = px
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.drawImage(image, 0, 0, px, px)
    const perM = px / groundSizeM

    return (x, z, radiusM = 3) => {
      const cxPx = px / 2 + x * perM
      const cyPx = px / 2 + z * perM
      const r = Math.max(1, Math.round(radiusM * perM))
      const x0 = Math.round(cxPx - r), y0 = Math.round(cyPx - r)
      const w = r * 2, h = r * 2
      if (x0 < 0 || y0 < 0 || x0 + w > px || y0 + h > px) return undefined
      try {
        const data = ctx.getImageData(x0, y0, w, h).data
        const med = medianColour(data)
        return med ? rgbToHex(med) : undefined
      } catch {
        return undefined
      }
    }
  } catch {
    return undefined
  }
}


/**
 * Mittlere Reflexion des Luftbilds — der Bodenanteil der Beleuchtung.
 *
 * Zwei Dinge sind daran wichtig und beide leicht zu übersehen:
 *
 *  1. **Linear mitteln, nicht in sRGB.** Ein Bildwert von 128 entspricht rund
 *     21 % Reflexion, nicht 50 %. Wer die Bildwerte direkt mittelt, überschätzt
 *     die Helligkeit des Bodens erheblich — bei einer typischen Wohnstraße um
 *     mehr als das Doppelte —, und die Szene bekäme von unten viel zu viel
 *     Licht.
 *  2. **Grob abtasten genügt.** Gesucht ist ein einziger Mittelwert über
 *     mehrere hundert Meter Fläche; jedes zweiundreissigste Pixel liefert ihn
 *     mit derselben Genauigkeit wie alle.
 */
function meanAlbedo(image: HTMLImageElement): [number, number, number] | undefined {
  try {
    const px = 128
    const cv = document.createElement('canvas')
    cv.width = cv.height = px
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.drawImage(image, 0, 0, px, px)
    const d = ctx.getImageData(0, 0, px, px).data

    const toLinear = srgbToLinear

    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue // durchsichtige Stellen zählen nicht mit
      r += toLinear(d[i]); g += toLinear(d[i + 1]); b += toLinear(d[i + 2]); n++
    }
    if (n === 0) return undefined
    return [r / n, g / n, b / n]
  } catch {
    return undefined
  }
}
