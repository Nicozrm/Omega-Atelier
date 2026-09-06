/**
 * Field.tsx — die Formularbausteine der Kasse.
 *
 * Sie existieren, weil Barrierefreiheit in einem Formular aus lauter kleinen
 * Verdrahtungen besteht, die man einzeln vergisst: `htmlFor` auf dem Label,
 * `aria-describedby` auf Hinweis *und* Fehler, `aria-invalid` nur wenn wirklich
 * etwas falsch ist, `role="alert"` damit der Screenreader die Meldung
 * ausspricht statt sie zu verschlucken. Einmal richtig gebaut, danach in jedem
 * Feld richtig.
 *
 * Die IDs kommen aus `useId()` und nicht aus dem Feldnamen. Zwei Formulare auf
 * einer Seite hätten sonst dieselbe ID, und ein Klick auf das zweite Label
 * fokussierte das erste Feld — ein Fehler, den man beim Testen mit der Maus nie
 * bemerkt und mit der Tastatur sofort.
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FieldShellProps {
  label: string
  /** Erklärung unter dem Feld — immer sichtbar, nie ein Tooltip. */
  hint?: ReactNode
  error?: string
  /** Optionale Kennzeichnung rechts vom Label („optional", „nur EU"). */
  aside?: ReactNode
  required?: boolean
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  className?: string
}

/**
 * Die Hülle: Label oben, Feld, darunter Hinweis oder Fehler.
 *
 * Hinweis und Fehler teilen sich den Platz — beide gleichzeitig zu zeigen
 * verdoppelt die Zeilenhöhe genau in dem Moment, in dem das Layout still
 * bleiben sollte. Der Fehler gewinnt, weil er der dringendere Satz ist.
 */
export function FieldShell({ label, hint, error, aside, required, children, className }: FieldShellProps) {
  const base = useId()
  const inputId = `${base}-input`
  const hintId = `${base}-hint`
  const errorId = `${base}-error`
  const invalid = Boolean(error)
  const describedBy = invalid ? errorId : hint ? hintId : undefined

  return (
    <div className={cn('co-field', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="co-label">
          {label}
          {required && <span aria-hidden="true" className="ml-0.5 text-[color:var(--accent-bright)]">*</span>}
        </label>
        {aside && <span className="text-[0.75rem] text-[color:var(--muted)]">{aside}</span>}
      </div>

      {children({ inputId, describedBy, invalid })}

      {invalid ? (
        <p id={errorId} role="alert" className="co-error">
          <AlertCircle size={13} className="mt-[1px] shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="co-hint">{hint}</p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: ReactNode
  error?: string
  aside?: ReactNode
  /** Zusätzliches Element im Feld, rechts — z. B. das Kartenlogo. */
  trailing?: ReactNode
  wrapperClassName?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, aside, trailing, required, wrapperClassName, className, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error} aside={aside} required={required} className={wrapperClassName}>
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <input
            {...rest}
            ref={ref}
            id={inputId}
            required={required}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn('co-input', trailing && 'pr-14', className)}
          />
          {trailing && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>
          )}
        </div>
      )}
    </FieldShell>
  )
})

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hint?: ReactNode
  error?: string
  aside?: ReactNode
  wrapperClassName?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, aside, required, wrapperClassName, className, children, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error} aside={aside} required={required} className={wrapperClassName}>
      {({ inputId, describedBy, invalid }) => (
        <select
          {...rest}
          ref={ref}
          id={inputId}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn('co-select', className)}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
})

export interface CheckFieldProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Die fette Zeile. */
  title: ReactNode
  /** Der Kleingedruckte darunter — hier gehört er hin, nicht in ein Popup. */
  description?: ReactNode
  error?: string
  name?: string
}

/**
 * Kontrollkästchen mit Text.
 *
 * Das ganze Feld ist ein `<label>`, damit auch der Text schaltet — auf dem
 * Telefon ist ein 18px-Kästchen kein Ziel, der Satz daneben schon.
 */
export function CheckField({ checked, onChange, title, description, error, name }: CheckFieldProps) {
  const base = useId()
  const errorId = `${base}-error`
  return (
    <div>
      <label className={cn('co-check', error && 'border-[color:var(--danger)]')}>
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] leading-snug text-[color:var(--fg)]">{title}</span>
          {description && (
            <span className="mt-1 block text-[0.78125rem] leading-relaxed text-[color:var(--muted)]">{description}</span>
          )}
        </span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="co-error mt-1.5 px-1">
          <AlertCircle size={13} className="mt-[1px] shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

/**
 * Zahlen-Stepper für die Arbeitsplätze.
 *
 * Mit Knöpfen *und* Eingabefeld: für ein oder zwei Plätze ist Tippen umständlich,
 * für vierzig ist Klicken es. Beides zu haben kostet eine Zeile Code und spart
 * dem einen wie dem anderen Fall den Ärger.
 */
export function SeatStepper({
  value, onChange, min = 1, max = 250, label, hint, error,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  label: string
  hint?: ReactNode
  error?: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.floor(n) : min))
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy, invalid }) => (
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => onChange(clamp(value - 1))}
            disabled={value <= min}
            aria-label="Ein Arbeitsplatz weniger"
            className="co-input flex w-12 shrink-0 items-center justify-center text-lg font-medium disabled:opacity-40"
          >
            −
          </button>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="co-input text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => onChange(clamp(value + 1))}
            disabled={value >= max}
            aria-label="Ein Arbeitsplatz mehr"
            className="co-input flex w-12 shrink-0 items-center justify-center text-lg font-medium disabled:opacity-40"
          >
            +
          </button>
        </div>
      )}
    </FieldShell>
  )
}
