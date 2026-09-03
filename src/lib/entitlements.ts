/**
 * entitlements.ts — plans, features and who may use what (pure).
 *
 * Three tiers — Free, Pro, Max — each unlocking a feature set. The chosen
 * tier persists locally (until real billing exists, choosing a plan on the
 * landing page IS the subscription), and developers always resolve to `max`
 * so the maker of the product owns every switch in their own home.
 */

export type Tier = 'free' | 'pro' | 'max'

/** Gateable product features. */
export type FeatureKey =
  | 'editor-2d' | 'view-3d' | 'digital-twin' | 'export-basic'
  | 'living-home' | 'soundscape' | 'radio-mesh' | 'sun-study' | 'history-cloud'
  | 'plan-doctor' | 'energy-report' | 'cost-report'
  | 'image-blaster' | 'live-connectors' | 'voice-control' | 'robot-map'
  | 'ecosystem-audit'
  | 'auto-furnish' | 'floor-stack' | 'ai-composer' | 'facade-studio'

/** The lowest tier that unlocks each feature. */
export const FEATURE_TIER: Record<FeatureKey, Tier> = {
  'editor-2d': 'free',
  'view-3d': 'free',
  'digital-twin': 'free',
  'export-basic': 'free',
  'living-home': 'pro',
  'soundscape': 'pro',
  'radio-mesh': 'pro',
  'sun-study': 'pro',
  'history-cloud': 'pro',
  // Insights suite
  'plan-doctor': 'pro',
  'energy-report': 'pro',
  'cost-report': 'pro',
  'image-blaster': 'max',
  'live-connectors': 'max',
  'voice-control': 'max',
  'robot-map': 'max',
  'ecosystem-audit': 'max',
  // Studio tools
  'auto-furnish': 'pro',
  'floor-stack': 'pro',
  'ai-composer': 'max',
  'facade-studio': 'max',
}

const ORDER: Record<Tier, number> = { free: 0, pro: 1, max: 2 }

/** Developer accounts always hold every entitlement. */
export const DEV_EMAILS = ['n.zimmermann711@gmail.com']

/**
 * Admin accounts — the product owner(s). They resolve to `max` (via DEV_EMAILS)
 * *and* carry the visible Admin badge. Kept as its own list so "who is admin"
 * stays an explicit, greppable decision, independent of the dev-entitlement one.
 */
export const ADMIN_EMAILS = ['n.zimmermann711@gmail.com']

/** Is this account an admin? (case-insensitive) */
export function isAdmin(userEmail?: string | null): boolean {
  return !!userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase())
}

const TIER_KEY = 'omega.tier'

/** Human-readable plan name for a tier (mirrors the landing-page PLANS). */
export function tierLabel(tier: Tier): string {
  return PLANS.find((p) => p.tier === tier)?.name ?? tier
}

/** Does `tier` unlock `feature`? */
export function hasFeature(tier: Tier, feature: FeatureKey): boolean {
  return ORDER[tier] >= ORDER[FEATURE_TIER[feature]]
}

/**
 * Record which plan the visitor clicked on the pricing cards.
 *
 * **This grants nothing.** It is a note of intent, kept so a later checkout
 * flow (and the "you chose Pro" copy on the way there) knows what they came
 * for. `resolveTier` deliberately does not read it — see there for why.
 */
export function storePlanInterest(tier: Tier): void {
  try { localStorage.setItem(TIER_KEY, tier) } catch { /* private mode */ }
}

/** The plan the visitor last clicked, if any. Never an entitlement. */
export function readPlanInterest(): Tier | null {
  try {
    const t = localStorage.getItem(TIER_KEY)
    if (t === 'free' || t === 'pro' || t === 'max') return t
  } catch { /* private mode */ }
  return null
}

/**
 * Resolve the active tier. **Free for everyone**, `max` for the product owner.
 *
 * This used to return whatever `localStorage['omega.tier']` said, which meant
 * the pricing cards were the subscription: clicking "Max" wrote `max` and the
 * app unlocked the Max feature set — no payment, no account, no server. Anyone
 * who never saw the landing page could reach the same state by typing one line
 * into the console, because a client-side string is not a grant. It is a note
 * the client wrote to itself.
 *
 * So the stored choice is now kept (see `storePlanInterest`) but never read
 * here. Until real billing exists, exactly two answers are possible, and both
 * come from something the client cannot rewrite:
 *
 *  - the product owner's account → `max`
 *  - everybody else → `free`
 *
 * When billing arrives this function is where it lands: the paid tier has to
 * come from the session — a verified claim on the server side — and this
 * signature already takes the account rather than reading storage, so the fix
 * is to consult that claim here and nowhere else.
 */
export function resolveTier(userEmail?: string | null): Tier {
  if (userEmail && DEV_EMAILS.includes(userEmail.toLowerCase())) return 'max'
  return 'free'
}

export interface PlanSpec {
  tier: Tier
  name: string
  /** €/Monat; 0 = free. */
  price: number
  tagline: string
  /** Selling points, in display order. */
  points: string[]
  /** The one word the card celebrates with. */
  celebrate: string
}

/** The three plans as shown on the landing page. */
export const PLANS: PlanSpec[] = [
  {
    tier: 'free',
    name: 'Free',
    price: 0,
    tagline: 'Dein ganzes Zuhause, geplant.',
    celebrate: 'Perfekter Start.',
    points: [
      '2D-Editor mit Licht-Physik',
      'Fotoreale 3D-Ansicht',
      'Digital Twin (simuliert)',
      '94 Geräte · 40+ Möbel',
      'PDF- & PNG-Export',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: 9,
    tagline: 'Dein Zuhause, lebendig.',
    celebrate: 'Die beste Wahl.',
    points: [
      'Alles aus Free',
      '✨ Auto-Möblieren — Räume füllen sich selbst',
      'Etagen-Stack — das ganze Haus auf einen Blick',
      'Living Home — 24h-Tageszyklus',
      'Sonnenstudie mit echten Schatten',
      'SoundScape — hörbarer Grundriss',
      'Insights: Plan-Doktor, Energie- & Kostenreport',
      'Cloud-Versionen & Teilen',
    ],
  },
  {
    tier: 'max',
    name: 'Max',
    price: 19,
    tagline: 'Dein Zuhause, real verbunden.',
    celebrate: 'Alles. Wirklich alles.',
    points: [
      'Alles aus Pro',
      'AI Composer — vom Kartenpunkt zum fertigen Plan',
      'Bau-Studio — Klinker · Putz · Naturstein · Holz, Dachform & Farben',
      'Live-Connectoren (Hue, Tuya, HA …)',
      'Sprachsteuerung',
      'Saugroboter-Karte live',
      'Ökosystem-Audit — läuft mein Setup?',
      'Image Blaster 3D',
      'Priorität bei neuen Features',
    ],
  },
]
