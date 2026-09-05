/**
 * countries.ts — die Länderliste des Checkouts (rein).
 *
 * Nicht die 249 Einträge der ISO-Liste: verkauft wird dort, wo eine
 * Zahlungsart, ein Steuersatz und ein Rechnungsformat hinterlegt sind. Eine
 * Auswahl, in der ein Land steht, das an der Kasse dann scheitert, ist
 * schlimmer als eine kurze Liste mit einem ehrlichen „dein Land fehlt?"-Weg.
 *
 * `region` gruppiert das `<optgroup>`; innerhalb der Gruppe sortiert die UI
 * alphabetisch nach dem deutschen Namen.
 */

export type Region = 'dach' | 'eu' | 'europe' | 'world'

export interface Country {
  code: string
  name: string
  region: Region
  /** Landesvorwahl, für die Telefon-Zeile bei Geschäftskunden. */
  dial: string
}

export const COUNTRIES: readonly Country[] = [
  { code: 'DE', name: 'Deutschland', region: 'dach', dial: '+49' },
  { code: 'AT', name: 'Österreich', region: 'dach', dial: '+43' },
  { code: 'CH', name: 'Schweiz', region: 'dach', dial: '+41' },
  { code: 'LI', name: 'Liechtenstein', region: 'dach', dial: '+423' },

  { code: 'BE', name: 'Belgien', region: 'eu', dial: '+32' },
  { code: 'BG', name: 'Bulgarien', region: 'eu', dial: '+359' },
  { code: 'HR', name: 'Kroatien', region: 'eu', dial: '+385' },
  { code: 'CY', name: 'Zypern', region: 'eu', dial: '+357' },
  { code: 'CZ', name: 'Tschechien', region: 'eu', dial: '+420' },
  { code: 'DK', name: 'Dänemark', region: 'eu', dial: '+45' },
  { code: 'EE', name: 'Estland', region: 'eu', dial: '+372' },
  { code: 'ES', name: 'Spanien', region: 'eu', dial: '+34' },
  { code: 'FI', name: 'Finnland', region: 'eu', dial: '+358' },
  { code: 'FR', name: 'Frankreich', region: 'eu', dial: '+33' },
  { code: 'GR', name: 'Griechenland', region: 'eu', dial: '+30' },
  { code: 'HU', name: 'Ungarn', region: 'eu', dial: '+36' },
  { code: 'IE', name: 'Irland', region: 'eu', dial: '+353' },
  { code: 'IT', name: 'Italien', region: 'eu', dial: '+39' },
  { code: 'LT', name: 'Litauen', region: 'eu', dial: '+370' },
  { code: 'LU', name: 'Luxemburg', region: 'eu', dial: '+352' },
  { code: 'LV', name: 'Lettland', region: 'eu', dial: '+371' },
  { code: 'MT', name: 'Malta', region: 'eu', dial: '+356' },
  { code: 'NL', name: 'Niederlande', region: 'eu', dial: '+31' },
  { code: 'PL', name: 'Polen', region: 'eu', dial: '+48' },
  { code: 'PT', name: 'Portugal', region: 'eu', dial: '+351' },
  { code: 'RO', name: 'Rumänien', region: 'eu', dial: '+40' },
  { code: 'SE', name: 'Schweden', region: 'eu', dial: '+46' },
  { code: 'SI', name: 'Slowenien', region: 'eu', dial: '+386' },
  { code: 'SK', name: 'Slowakei', region: 'eu', dial: '+421' },

  { code: 'GB', name: 'Vereinigtes Königreich', region: 'europe', dial: '+44' },
  { code: 'NO', name: 'Norwegen', region: 'europe', dial: '+47' },
  { code: 'IS', name: 'Island', region: 'europe', dial: '+354' },

  { code: 'US', name: 'Vereinigte Staaten', region: 'world', dial: '+1' },
  { code: 'CA', name: 'Kanada', region: 'world', dial: '+1' },
  { code: 'AU', name: 'Australien', region: 'world', dial: '+61' },
  { code: 'NZ', name: 'Neuseeland', region: 'world', dial: '+64' },
  { code: 'SG', name: 'Singapur', region: 'world', dial: '+65' },
  { code: 'HK', name: 'Hongkong', region: 'world', dial: '+852' },
  { code: 'CN', name: 'China', region: 'world', dial: '+86' },
]

export const REGION_LABEL: Record<Region, string> = {
  dach: 'Deutschland, Österreich, Schweiz',
  eu: 'Europäische Union',
  europe: 'Übriges Europa',
  world: 'Weltweit',
}

const REGION_ORDER: readonly Region[] = ['dach', 'eu', 'europe', 'world']

/** Die Liste als `<optgroup>`-Struktur, innerhalb der Gruppe alphabetisch. */
export function countriesByRegion(): { region: Region; label: string; countries: Country[] }[] {
  return REGION_ORDER.map((region) => ({
    region,
    label: REGION_LABEL[region],
    countries: COUNTRIES.filter((c) => c.region === region)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  })).filter((g) => g.countries.length > 0)
}

/** Ein Land per Code, oder `null`. */
export function findCountry(code: string | null | undefined): Country | null {
  if (!code) return null
  const up = code.toUpperCase()
  return COUNTRIES.find((c) => c.code === up) ?? null
}

/** Wird das Land unterstützt? */
export function isSupportedCountry(code: string): boolean {
  return findCountry(code) !== null
}

/**
 * Erste Vermutung fürs Rechnungsland aus der Browsersprache.
 *
 * `navigator.language` ist „de-DE" oder „de" — nur die erste Form trägt ein
 * Land. Bleibt eine Sprache ohne Region übrig, wird sie *nicht* geraten
 * („de" heisst nicht Deutschland), sondern es bleibt beim Standard, den der
 * Kunde in einem Zug ändern kann.
 */
export function guessCountry(languages: readonly string[], fallback = 'DE'): string {
  for (const tag of languages) {
    const region = tag.split('-')[1]
    if (region && isSupportedCountry(region)) return region.toUpperCase()
  }
  return fallback
}
