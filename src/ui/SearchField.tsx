import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchFieldProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Placeholder-style prompt. Say what can be found, not "Suche". */
  placeholder: string
  /** Keyboard hint chip, right-aligned. */
  shortcut?: string
}

/**
 * SearchField — a button that *looks* like a search input and opens the command
 * palette.
 *
 * Deliberately not an input. The palette owns its own field (with ranking,
 * sections and keyboard navigation), so a second real input here would either
 * duplicate that machinery or steal focus from it. What the bar needs is the
 * affordance: a field-shaped control with a prompt inside it reads as "type to
 * find things" at a glance, which a magnifier glyph never did — the palette was
 * previously reachable only by people who already knew ⌘K existed.
 */
export const SearchField = forwardRef<HTMLButtonElement, SearchFieldProps>(function SearchField(
  { placeholder, shortcut, className, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" className={cn('field-search', className)} {...rest}>
      <Search size={14} aria-hidden className="shrink-0" />
      <span className="truncate">{placeholder}</span>
      {shortcut && <kbd aria-hidden>{shortcut}</kbd>}
    </button>
  )
})
