/**
 * PaymentStep.tsx — die Zahlungsart wählen und, falls nötig, ausfüllen.
 *
 * ── Warum gesperrte Kacheln stehen bleiben ───────────────────────────────
 * Weil „iDEAL fehlt" eine schlechtere Erfahrung ist als „iDEAL geht nur im
 * Jahresabo". Das Erste lässt jemanden suchen; das Zweite gibt ihm eine
 * Entscheidung. Nur was schlicht sinnlos wäre — Apple Pay auf einem
 * Android-Telefon, TWINT in Portugal — verschwindet ganz; darüber entscheidet
 * `methodVerdict` mit seinem `hide`-Flag, nicht diese Komponente.
 *
 * ── Warum die Kartenfelder trotzdem hier stehen ──────────────────────────
 * Damit ein Tippfehler dort auffällt, wo er passiert ist. Die Nummer verlässt
 * den Browser nicht Richtung OMEGA — `buildIntent` nimmt Marke, letzte vier
 * Ziffern und Ablauf mit, sonst nichts (siehe `session.ts`). Die Prüfung ist
 * echt, die Übertragung findet nicht statt.
 */

import { useMemo } from 'react'
import { AlertTriangle, Check, Info, Lock, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  PROVIDERS, detectCardBrand, findMethod, formatCardNumber, formatExpiry, formatIban,
  groupedMethods, needsRecurring, validateIban,
  type CheckoutForm, type DeviceCapabilities, type FieldErrors, type MethodOffer,
  type PaymentMethodSpec, type Quote,
} from '@/lib/billing'
import { CardBrandTag, MethodMark } from './MethodMark'
import { CheckField, TextField } from './Field'
import { RadioGroup } from './RadioGroup'

interface Props {
  form: CheckoutForm
  errors: FieldErrors
  quote: Quote
  capabilities: DeviceCapabilities
  onChange: (patch: Partial<CheckoutForm>) => void
}

export function PaymentStep({ form, errors, quote, capabilities, onChange }: Props) {
  const groups = useMemo(
    () => groupedMethods({
      country: form.country,
      currency: form.currency,
      amount: quote.total,
      recurring: needsRecurring(form),
      business: form.business,
      capabilities,
    }),
    [form, quote.total, capabilities],
  )

  const selected = form.methodId ? findMethod(form.methodId) : null
  const available = groups.flatMap((g) => g.offers).filter((o) => o.verdict.available).length

  return (
    <div className="space-y-8">
      {/* Keine einzige Zahlungsart — kommt bei exotischen Land/Währungs-
          Kombinationen vor. Statt einer leeren Seite ein Weg nach vorn. */}
      {available === 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_8%,transparent)] p-4">
          <AlertTriangle size={16} className="mt-[2px] shrink-0 text-[color:var(--warn)]" aria-hidden="true" />
          <div className="text-[0.875rem] leading-relaxed">
            <p className="font-medium">Für {form.country} und {form.currency} haben wir gerade nichts im Angebot.</p>
            <p className="mt-1 text-[color:var(--muted)]">
              Wechsle die Währung im vorigen Schritt oder schreib uns —
              wir richten die passende Zahlungsart ein.
            </p>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <fieldset key={group.group}>
          <legend className="label-xs">{group.label}</legend>
          <p className="mb-3 mt-1 text-[0.78125rem] text-[color:var(--muted)]">{group.hint}</p>
          <RadioGroup label={group.label} className="grid gap-2.5 sm:grid-cols-2">
            {group.offers.map((offer) => (
              <MethodTile
                key={offer.method.id}
                offer={offer}
                selected={form.methodId === offer.method.id}
                onSelect={() => onChange({ methodId: offer.method.id })}
              />
            ))}
          </RadioGroup>
        </fieldset>
      ))}

      {errors.methodId && (
        <p role="alert" className="co-error">{errors.methodId}</p>
      )}

      {/* ── Das Formular zur gewählten Art ──────────────────────────── */}
      {selected && (
        <div className="co-step-body space-y-6 border-t border-[color:var(--border)] pt-8">
          <MethodDetails form={form} errors={errors} method={selected} onChange={onChange} />
          <ProviderNote method={selected} />
        </div>
      )}
    </div>
  )
}

/** Eine Kachel. Gesperrte tragen ihren Grund im Klartext, nicht nur als Grauton. */
function MethodTile({ offer, selected, onSelect }: {
  offer: MethodOffer
  selected: boolean
  onSelect: () => void
}) {
  const { method, verdict } = offer
  const blocked = !verdict.available
  const reason = verdict.available ? null : verdict.reason

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={blocked || undefined}
      onClick={() => !blocked && onSelect()}
      className={cn('co-tile items-start !p-3.5', blocked && 'cursor-not-allowed')}
    >
      <MethodMark method={method} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[0.9375rem] font-medium leading-tight">{method.label}</span>
          {method.badge && !blocked && (
            <span className="rounded-full border border-[color:var(--border-accent)] bg-[rgba(199,162,78,0.10)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[color:var(--accent-bright)]">
              {method.badge}
            </span>
          )}
        </span>
        <span className={cn(
          'mt-1 block text-[0.78125rem] leading-snug',
          blocked ? 'text-[color:var(--warn)]' : 'text-[color:var(--muted)]',
        )}>
          {reason ?? method.blurb}
        </span>
      </span>
      <span className="co-dot mt-0.5" aria-hidden="true">
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  )
}

/** Karte, SEPA, Rechnung — oder gar nichts, wenn beim Anbieter bestätigt wird. */
function MethodDetails({ form, errors, method, onChange }: {
  form: CheckoutForm
  errors: FieldErrors
  method: PaymentMethodSpec
  onChange: (patch: Partial<CheckoutForm>) => void
}) {
  if (method.form === 'card') {
    const spec = detectCardBrand(form.card.number)
    return (
      <div className="space-y-5">
        <h3 className="flex items-center gap-2 text-[0.9375rem] font-medium">
          <Lock size={14} className="text-[color:var(--muted)]" aria-hidden="true" />
          Kartendaten
        </h3>

        <TextField
          label="Kartennummer"
          required
          value={form.card.number}
          onChange={(e) => onChange({ card: { ...form.card, number: formatCardNumber(e.target.value) } })}
          error={errors['card.number']}
          autoComplete="cc-number"
          inputMode="numeric"
          placeholder="4242 4242 4242 4242"
          className="font-mono tracking-[0.06em]"
          trailing={<CardBrandTag brand={spec.brand} label={spec.label} />}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Gültig bis"
            required
            value={form.card.expiry}
            onChange={(e) => onChange({ card: { ...form.card, expiry: formatExpiry(e.target.value) } })}
            error={errors['card.expiry']}
            autoComplete="cc-exp"
            inputMode="numeric"
            placeholder="MM/JJ"
            className="font-mono"
          />
          <TextField
            label="Prüfcode"
            required
            value={form.card.cvc}
            onChange={(e) => onChange({ card: { ...form.card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) } })}
            error={errors['card.cvc']}
            autoComplete="cc-csc"
            inputMode="numeric"
            placeholder={spec.cvcLength === 4 ? '4 Stellen' : '3 Stellen'}
            className="font-mono"
            hint={spec.cvcLength === 4 ? 'Vier Ziffern auf der Vorderseite.' : 'Drei Ziffern auf der Rückseite.'}
          />
        </div>

        <TextField
          label="Name auf der Karte"
          required
          value={form.card.holder}
          onChange={(e) => onChange({ card: { ...form.card, holder: e.target.value } })}
          error={errors['card.holder']}
          autoComplete="cc-name"
        />

        <p className="co-trust">
          <ShieldCheck size={13} aria-hidden="true" />
          Die Nummer wird hier nur geprüft. Belastet wird sie bei {PROVIDERS[method.provider].label} —
          auf unseren Servern liegen nur Marke und die letzten vier Stellen.
        </p>
      </div>
    )
  }

  if (method.form === 'sepa') {
    const check = form.sepa.iban.trim() ? validateIban(form.sepa.iban) : null
    return (
      <div className="space-y-5">
        <h3 className="text-[0.9375rem] font-medium">Bankverbindung</h3>

        <TextField
          label="IBAN"
          required
          value={form.sepa.iban}
          onChange={(e) => onChange({ sepa: { ...form.sepa, iban: formatIban(e.target.value) } })}
          error={errors['sepa.iban']}
          placeholder="DE89 3704 0044 0532 0130 00"
          className="font-mono tracking-[0.04em]"
          hint={check?.valid ? `Prüfziffer stimmt — ${check.country}.` : 'Wir prüfen die Prüfziffer sofort, noch bevor du absendest.'}
        />

        <TextField
          label="Kontoinhaber"
          required
          value={form.sepa.holder}
          onChange={(e) => onChange({ sepa: { ...form.sepa, holder: e.target.value } })}
          error={errors['sepa.holder']}
          autoComplete="name"
        />

        {/*
          Das Mandat. Der Text ist nicht Zierde, sondern Pflichtinhalt: ohne
          Nennung von Gläubiger, Zweck und Erstattungsfrist ist ein
          SEPA-Lastschriftmandat nicht wirksam erteilt.
        */}
        <CheckField
          checked={form.sepa.mandate}
          onChange={(mandate) => onChange({ sepa: { ...form.sepa, mandate } })}
          error={errors['sepa.mandate']}
          title="SEPA-Lastschriftmandat erteilen"
          description={
            <>
              Ich ermächtige OMEGA Atelier, wiederkehrende Zahlungen von meinem Konto
              mittels Lastschrift einzuziehen, und weise mein Kreditinstitut an, diese
              einzulösen. Ich kann innerhalb von acht Wochen ab Belastungsdatum die
              Erstattung verlangen; es gelten die mit meiner Bank vereinbarten
              Bedingungen. Die Ankündigung erfolgt mindestens einen Tag vor Einzug.
            </>
          }
        />
      </div>
    )
  }

  if (method.form === 'invoice') {
    return (
      <div className="space-y-5">
        <h3 className="text-[0.9375rem] font-medium">Angaben für die Rechnung</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Bestellnummer"
            value={form.invoice.poNumber}
            onChange={(e) => onChange({ invoice: { ...form.invoice, poNumber: e.target.value } })}
            aside="optional"
            hint="Erscheint auf der Rechnung — für eure Beschaffung."
          />
          <TextField
            label="Rechnungs-E-Mail"
            type="email"
            value={form.invoice.billingEmail}
            onChange={(e) => onChange({ invoice: { ...form.invoice, billingEmail: e.target.value } })}
            error={errors['invoice.billingEmail']}
            aside="optional"
            autoComplete="email"
            hint="Leer lassen, dann geht sie an deine Kontoadresse."
          />
        </div>
        {errors.company && <p role="alert" className="co-error">{errors.company}</p>}
      </div>
    )
  }

  // Redirect-Verfahren brauchen kein Formular — aber eine Erwartung.
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
      <MethodMark method={method} size="sm" />
      <div className="text-[0.875rem] leading-relaxed">
        <p className="font-medium">Weiter zu {PROVIDERS[method.provider].label}</p>
        <p className="mt-1 text-[color:var(--muted)]">
          {method.blurb} Nach der Bestätigung landest du wieder hier —
          erst dann ist die Bestellung abgeschlossen.
        </p>
      </div>
    </div>
  )
}

/**
 * Wer die Zahlung abwickelt und wo dieses Unternehmen sitzt.
 *
 * Steht hier, weil es hierher gehört: Art. 13 DSGVO verlangt die Information
 * beim Erheben der Daten, nicht drei Klicks entfernt in der
 * Datenschutzerklärung. Und weil es eine ehrliche Antwort auf die Frage ist,
 * die sich beim Eintippen einer Kartennummer ohnehin stellt.
 */
function ProviderNote({ method }: { method: PaymentMethodSpec }) {
  const provider = PROVIDERS[method.provider]
  if (provider.id === 'omega') return null
  return (
    <p className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-[color:var(--muted)]">
      <Info size={12} className="mt-[2px] shrink-0" aria-hidden="true" />
      <span>
        Abgewickelt von {provider.label} ({provider.home}). Dabei werden Zahlungsdaten
        an den Anbieter übermittelt —{' '}
        <a
          href={provider.privacy}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--fg)]"
        >
          Datenschutzerklärung
        </a>
        .
      </span>
    </p>
  )
}
