/**
 * AccountStep.tsx — Kontakt und Rechnungsadresse.
 *
 * Der Schritt, an dem die meisten Kassen Kunden verlieren, und fast immer aus
 * demselben Grund: zu viele Felder. Hier steht nur, was auf einen Beleg gehört
 * oder was das Steuerrecht verlangt — kein Geburtsdatum, keine zweite
 * Telefonnummer, keine „Wie haben Sie von uns erfahren?".
 *
 * ── Warum das Land oben steht ────────────────────────────────────────────
 * Weil es alles darunter verändert: die Postleitzahl-Prüfung, den Steuersatz,
 * die Währung und die Zahlungsarten im nächsten Schritt. Ein Land, das man
 * unten einträgt, färbt die Felder darüber nachträglich rot — deshalb zuerst
 * fragen, dann prüfen.
 *
 * `autoComplete` ist überall gesetzt und mit den Standardwerten benannt
 * (`given-name`, `address-line1`, `postal-code`). Damit füllt der Browser das
 * Formular in einem Zug aus, und genau das ist der grösste einzelne Gewinn an
 * dieser Stelle — mehr als jede Layoutfrage.
 */

import { Building2, Info, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CURRENCIES, countriesByRegion, currencyForCountry, formatRate, resolveVat, validateVatId,
  type CheckoutForm, type CurrencyCode, type FieldErrors,
} from '@/lib/billing'
import { SelectField, TextField } from './Field'
import { RadioGroup } from './RadioGroup'

interface Props {
  form: CheckoutForm
  errors: FieldErrors
  onChange: (patch: Partial<CheckoutForm>) => void
  /** Vorbelegt aus der Sitzung — dann bleibt die E-Mail fest. */
  lockedEmail?: string | null
}

export function AccountStep({ form, errors, onChange, lockedEmail }: Props) {
  const groups = countriesByRegion()
  const vat = resolveVat({ country: form.country, business: form.business, vatId: form.vatId })
  const vatCheck = form.vatId.trim() ? validateVatId(form.vatId) : null

  /**
   * Land wechseln heisst auch: Währung wechseln. Nicht stillschweigend im
   * Hintergrund — der Kunde sieht die Währung im Feld daneben und kann sie
   * überstimmen, falls er in Euro zahlen will, obwohl er in der Schweiz sitzt.
   */
  const changeCountry = (country: string) => {
    onChange({ country, currency: currencyForCountry(country) })
  }

  return (
    <div className="space-y-8">
      {/* ── Wer ─────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <User size={15} className="text-[color:var(--muted)]" aria-hidden="true" />
          <h3 className="text-[0.9375rem] font-medium">Kontakt</h3>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Vollständiger Name"
            required
            value={form.fullName}
            onChange={(e) => onChange({ fullName: e.target.value })}
            error={errors.fullName}
            autoComplete="name"
            placeholder="Vor- und Nachname"
          />
          <TextField
            label="E-Mail"
            type="email"
            required
            value={form.email}
            onChange={(e) => onChange({ email: e.target.value })}
            error={errors.email}
            autoComplete="email"
            inputMode="email"
            readOnly={Boolean(lockedEmail)}
            aside={lockedEmail ? 'aus deinem Konto' : undefined}
            hint={lockedEmail ? undefined : 'Hierhin gehen Beleg und Zugangsdaten.'}
            placeholder="du@beispiel.de"
          />
        </div>

        {/* Der Umschalter auf Geschäftskunde. Als Kachelreihe, weil die
            Entscheidung mehr verändert als ein Häkchen vermuten lässt:
            USt-IdNr., Reverse-Charge und die Zahlungsart „Rechnung" hängen
            daran. */}
        <fieldset>
          <legend className="co-label mb-2">Ich bestelle als</legend>
          <RadioGroup label="Kundenart" className="grid grid-cols-2 gap-3">
            {([
              { business: false, label: 'Privatperson', sub: 'Preise inkl. USt.' },
              { business: true, label: 'Unternehmen', sub: 'Rechnung & Reverse-Charge' },
            ] as const).map((o) => (
              <button
                key={String(o.business)}
                type="button"
                role="radio"
                aria-checked={form.business === o.business}
                onClick={() => onChange({ business: o.business })}
                className="co-tile flex-col !gap-0.5 !p-3.5"
              >
                <span className="text-[0.875rem] font-medium">{o.label}</span>
                <span className="text-[0.75rem] text-[color:var(--muted)]">{o.sub}</span>
              </button>
            ))}
          </RadioGroup>
        </fieldset>

        {form.business && (
          <div className="co-step-body grid gap-5 md:grid-cols-2">
            <TextField
              label="Firma"
              required
              value={form.company}
              onChange={(e) => onChange({ company: e.target.value })}
              error={errors.company}
              autoComplete="organization"
              placeholder="Muster GmbH"
            />
            <TextField
              label="USt-IdNr."
              value={form.vatId}
              onChange={(e) => onChange({ vatId: e.target.value })}
              error={errors.vatId}
              aside="optional"
              placeholder="DE123456789"
              hint={
                vatCheck?.valid && vat.reverseCharge
                  ? 'Erkannt — die Rechnung geht ohne Umsatzsteuer raus.'
                  : 'Mit gültiger Nummer aus einem anderen EU-Land entfällt die Umsatzsteuer.'
              }
            />
          </div>
        )}
      </section>

      {/* ── Wohin ───────────────────────────────────────────────────── */}
      <section className="space-y-5 border-t border-[color:var(--border)] pt-8">
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-[color:var(--muted)]" aria-hidden="true" />
          <h3 className="text-[0.9375rem] font-medium">Rechnungsadresse</h3>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <SelectField
            label="Land"
            required
            value={form.country}
            onChange={(e) => changeCountry(e.target.value)}
            autoComplete="country"
            hint="Bestimmt Steuersatz und verfügbare Zahlungsarten."
          >
            {groups.map((g) => (
              <optgroup key={g.region} label={g.label}>
                {g.countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </SelectField>

          <SelectField
            label="Währung"
            value={form.currency}
            onChange={(e) => onChange({ currency: e.target.value as CurrencyCode })}
            hint="Vorbelegt nach Land — änderbar."
          >
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>{c.code} · {c.symbol}</option>
            ))}
          </SelectField>
        </div>

        <TextField
          label="Strasse und Hausnummer"
          required
          value={form.street}
          onChange={(e) => onChange({ street: e.target.value })}
          error={errors.street}
          autoComplete="address-line1"
          placeholder="Musterweg 12"
        />

        <div className="grid gap-5 md:grid-cols-[minmax(0,10rem)_1fr]">
          <TextField
            label="PLZ"
            required
            value={form.postalCode}
            onChange={(e) => onChange({ postalCode: e.target.value })}
            error={errors.postalCode}
            autoComplete="postal-code"
            inputMode="text"
          />
          <TextField
            label="Ort"
            required
            value={form.city}
            onChange={(e) => onChange({ city: e.target.value })}
            error={errors.city}
            autoComplete="address-level2"
          />
        </div>

        {form.business && (
          <TextField
            label="Telefon"
            type="tel"
            value={form.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="tel"
            aside="optional"
            hint="Nur für Rückfragen zur Rechnung. Kein Vertrieb, kein Newsletter."
          />
        )}
      </section>

      {/* ── Was das für die Steuer heisst ───────────────────────────── */}
      <p className={cn(
        'flex items-start gap-2.5 rounded-[var(--radius-lg)] border p-3.5 text-[0.8125rem] leading-relaxed',
        vat.reverseCharge
          ? 'border-[color:var(--border-accent)] bg-[rgba(199,162,78,0.07)] text-[color:var(--muted-strong)]'
          : 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted)]',
      )}>
        <Info size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
        <span>
          {vat.reverseCharge
            ? 'Reverse-Charge: die Rechnung weist 0 % aus, du versteuerst im eigenen Land.'
            : vat.rate > 0
              ? `Auf deine Bestellung fallen ${formatRate(vat.rate)} Umsatzsteuer an — im Endbetrag rechts bereits enthalten.`
              : 'Auf deine Bestellung fällt keine Umsatzsteuer an.'}
        </span>
      </p>
    </div>
  )
}
