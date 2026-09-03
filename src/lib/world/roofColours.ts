/**
 * roofColours.ts — die Dachfarben kommen aus dem Luftbild.
 *
 * Die Nachbarschaft stand bisher in erfundenen Farben da: der Regionalstil
 * gibt eine Palette vor, und jedes Haus zieht daraus zufällig. Über einem
 * echten Luftbild fällt das sofort auf — die Straße hat rote Ziegel, dunklen
 * Schiefer und graue Flachdächer nebeneinander, das Modell malt sie in drei
 * ausgedachten Tönen.
 *
 * Dabei liegt die Antwort direkt unter den Häusern: das Orthophoto *ist* die
 * Aufsicht auf genau diese Dächer. Ein Haus steht auf seiner eigenen
 * Dachfarbe.
 *
 * ## Warum quantisiert wird
 *
 * Jede Farbe einzeln zu nehmen hieße, für jedes der hunderten Gebäude ein
 * eigenes Material zu bauen — und jedes Material ist ein eigener Zeichenaufruf.
 * Deshalb werden die abgelesenen Farben auf eine kleine Palette
 * zusammengefasst. Der Unterschied zwischen zwei benachbarten Rottönen ist
 * für das Auge belanglos, der Unterschied zwischen Rot und Schiefergrau
 * dagegen alles.
 */

/** Eine abgelesene Farbe, 0…255 je Kanal. */
export interface Rgb { r: number; g: number; b: number }

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Liest die vorherrschende Farbe eines Bereichs.
 *
 * Bewusst der **Median** je Kanal und nicht der Mittelwert: ein Dach hat
 * Gauben, Fenster, Solarmodule und Schattenkanten. Ein Mittelwert zieht diese
 * Ausreißer mit hinein und liefert einen matschigen Grauton; der Median
 * beschreibt die Fläche, die tatsächlich überwiegt.
 */
export function medianColour(pixels: Uint8ClampedArray): Rgb | undefined {
  const n = pixels.length / 4
  if (n === 0) return undefined
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  for (let i = 0; i < pixels.length; i += 4) {
    // Vollständig durchsichtige Pixel gibt es hier nicht, aber schwarze Ränder
    // eines Ausschnitts schon — die würden das Ergebnis verdunkeln.
    if (pixels[i + 3] < 8) continue
    rs.push(pixels[i]); gs.push(pixels[i + 1]); bs.push(pixels[i + 2])
  }
  if (rs.length === 0) return undefined
  const med = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1] }
  return { r: med(rs), g: med(gs), b: med(bs) }
}

/**
 * Fasst viele abgelesene Farben zu einer kleinen Palette zusammen.
 *
 * Verfahren: k-Means im RGB-Raum mit festen Startpunkten entlang der
 * Helligkeit. Fest, weil das Ergebnis reproduzierbar sein muss — dieselbe
 * Straße darf beim nächsten Laden nicht anders aussehen.
 */
export function quantise(colours: Rgb[], k = 10, rounds = 8): { palette: string[]; indexOf: number[] } {
  if (colours.length === 0) return { palette: [], indexOf: [] }
  const kk = Math.max(1, Math.min(k, colours.length))

  // Startpunkte gleichmäßig über die nach Helligkeit sortierten Farben. Das
  // trifft die tatsächliche Streuung besser als zufällige Startwerte und
  // braucht deutlich weniger Durchläufe.
  const byLum = [...colours].sort((a, b) =>
    (a.r * 0.299 + a.g * 0.587 + a.b * 0.114) - (b.r * 0.299 + b.g * 0.587 + b.b * 0.114))
  const centres: Rgb[] = Array.from({ length: kk }, (_, i) =>
    ({ ...byLum[Math.floor(((i + 0.5) / kk) * byLum.length)] }))

  const assign = new Array<number>(colours.length).fill(0)
  for (let round = 0; round < rounds; round++) {
    let moved = false
    for (let i = 0; i < colours.length; i++) {
      const c = colours[i]
      let bi = 0, bd = Infinity
      for (let j = 0; j < kk; j++) {
        const q = centres[j]
        const d = (c.r - q.r) ** 2 + (c.g - q.g) ** 2 + (c.b - q.b) ** 2
        if (d < bd) { bd = d; bi = j }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true }
    }
    if (!moved) break
    const sum = Array.from({ length: kk }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
    for (let i = 0; i < colours.length; i++) {
      const s = sum[assign[i]], c = colours[i]
      s.r += c.r; s.g += c.g; s.b += c.b; s.n++
    }
    for (let j = 0; j < kk; j++) {
      if (sum[j].n === 0) continue
      centres[j] = { r: sum[j].r / sum[j].n, g: sum[j].g / sum[j].n, b: sum[j].b / sum[j].n }
    }
  }

  return { palette: centres.map(rgbToHex), indexOf: assign }
}
