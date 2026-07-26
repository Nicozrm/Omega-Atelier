import { Link } from 'react-router-dom'
import { Crown, Sparkles, ShieldCheck } from 'lucide-react'
import { Badge, type BadgeTone } from '@/ui/Badge'
import { useTier } from '@/hooks/useTier'
import { cn } from '@/lib/utils'
import type { Tier } from '@/lib/entitlements'

const TONE: Record<Tier, BadgeTone> = { free: 'neutral', pro: 'accent', max: 'cyan' }

/**
 * PlanBadge — the always-visible subscription (Zahlplan) badge.
 *
 * Shows the active plan (Free · Pro · Max) everywhere the chrome is mounted, so
 * a user can always see what they're on. Product owners additionally carry an
 * Admin badge. Tapping the plan chip jumps straight to the pricing section, so
 * upgrading (or reviewing the plan) is one click from any screen.
 */
export function PlanBadge({ className }: { className?: string }) {
  const { tier, label, admin } = useTier()
  const Icon = tier === 'max' ? Crown : tier === 'pro' ? Sparkles : null
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Link
        to={{ pathname: '/', hash: '#preise' }}
        title="Zahlplan ansehen / wechseln"
        aria-label={`Aktueller Plan: ${label}. Plan ansehen oder wechseln.`}
        className="transition-transform hover:-translate-y-px focus-visible:outline-none"
      >
        <Badge tone={TONE[tier]} dot={!Icon}>
          {Icon && <Icon size={11} aria-hidden />}
          {label}
        </Badge>
      </Link>
      {admin && (
        <Badge tone="warn" aria-label="Admin-Konto">
          <ShieldCheck size={11} aria-hidden /> Admin
        </Badge>
      )}
    </div>
  )
}
