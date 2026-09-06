/**
 * RadioGroup.tsx — Kachelauswahl, die sich wie eine Radiogruppe bedienen lässt.
 *
 * ── Warum das nötig ist ─────────────────────────────────────────────────
 * `role="radio"` auf einen `<button>` zu schreiben, ändert **nichts** am
 * Verhalten. ARIA beschreibt, was ein Element *ist*, und nicht, was es *tut* —
 * ein Screenreader sagt danach zwar „Optionsfeld, 2 von 5", aber die
 * Pfeiltasten bewegen sich nicht, und alle fünf Kacheln stehen einzeln im
 * Tab-Lauf. Wer mit der Tastatur zahlt, tabbt sich dann durch zwei Dutzend
 * Zahlungsarten, statt einmal in die Gruppe und dann mit Pfeilen hindurch.
 *
 * Das ist genau die Lücke, für die die WAI-ARIA Authoring Practices ihr
 * Radio-Group-Muster beschreiben, und dieses Muster steht hier:
 *
 *  · **Roving tabindex** — nur die gewählte Kachel ist tabbierbar (`0`), alle
 *    anderen tragen `-1`. Die ganze Gruppe ist damit *ein* Halt im Tab-Lauf.
 *  · **Pfeile wählen** — ↓/→ zur nächsten, ↑/← zur vorigen, jeweils zyklisch;
 *    Pos1/Ende springen an den Rand. Die Auswahl folgt dem Fokus, wie bei
 *    nativen Radios.
 *  · **Gesperrte werden übersprungen** — eine Kachel, die man nicht wählen
 *    kann, ist kein Ziel. Sie bleibt sichtbar (mit Begründung), aber die
 *    Pfeiltasten halten dort nicht an.
 *
 * Die Kacheln selbst bleiben gewöhnliche Buttons; diese Komponente hängt sich
 * nur an das Tasten- und Fokusverhalten der Gruppe.
 */

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const PREV_KEYS = ['ArrowUp', 'ArrowLeft']
const NEXT_KEYS = ['ArrowDown', 'ArrowRight']

export interface RadioGroupProps {
  /** Wird als `aria-label` der Gruppe gesetzt. */
  label: string
  className?: string
  /** `role="radio"`-Kacheln — beliebig tief verschachtelt. */
  children: ReactNode
  /** Beschreibungs-ID (z. B. eine Fehlermeldung unter der Gruppe). */
  describedBy?: string
}

export function RadioGroup({ label, className, children, describedBy }: RadioGroupProps) {
  const ref = useRef<HTMLDivElement>(null)

  /** Die wählbaren Kacheln in DOM-Reihenfolge. */
  const options = useCallback((): HTMLElement[] => {
    const root = ref.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]'))
      .filter((el) => el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled'))
  }, [])

  /**
   * Tabindex nachziehen. Läuft nach jedem Render, weil sich sowohl die Auswahl
   * als auch die Liste ändern kann — im Zahlungsschritt verschwinden Kacheln,
   * sobald jemand das Land wechselt.
   */
  useEffect(() => {
    const all = ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')
    if (!all || all.length === 0) return
    const selectable = options()
    const checked = selectable.find((el) => el.getAttribute('aria-checked') === 'true')
    // Ohne Auswahl trägt die erste wählbare Kachel den Einstiegspunkt — sonst
    // wäre die Gruppe per Tab gar nicht erreichbar.
    const entry = checked ?? selectable[0]
    all.forEach((el) => { el.tabIndex = el === entry ? 0 : -1 })
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key
    if (![...PREV_KEYS, ...NEXT_KEYS, 'Home', 'End'].includes(key)) return

    const list = options()
    if (list.length === 0) return

    const active = document.activeElement as HTMLElement | null
    const current = list.indexOf(active as HTMLElement)

    let next: number
    if (key === 'Home') next = 0
    else if (key === 'End') next = list.length - 1
    else if (NEXT_KEYS.includes(key)) next = current < 0 ? 0 : (current + 1) % list.length
    else next = current < 0 ? list.length - 1 : (current - 1 + list.length) % list.length

    e.preventDefault()
    const target = list[next]
    target.focus()
    // Auswahl folgt dem Fokus — dasselbe Verhalten wie bei nativen Radios.
    target.click()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className={className}
    >
      {children}
    </div>
  )
}
