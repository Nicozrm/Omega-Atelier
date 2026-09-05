/**
 * MethodMark.tsx — das Erkennungszeichen einer Zahlungsart.
 *
 * Bewusst **keine** Herstellerlogos. Drei Gründe, in dieser Reihenfolge:
 *
 *  1. Marken sind geschützt. PayPal, Klarna und Visa geben genaue Vorschriften
 *     zu Schutzraum, Mindestgrösse und Hintergrund heraus; eine aus dem Netz
 *     gezogene SVG-Datei in einer selbst gebauten Kachel verletzt sie fast
 *     zwangsläufig.
 *  2. Fremde Logos ziehen die Aufmerksamkeit auf sich. Zwanzig Marken in
 *     ihren eigenen Farben nebeneinander sind ein Flickenteppich, kein
 *     Auswahlmenü — und die Kachel soll die Entscheidung tragen, nicht der
 *     lauteste Farbklecks.
 *  3. Ein Logo pro Anbieter wäre eine Datei pro Anbieter. Das hier ist ein
 *     Glyph und eine Farbe aus dem Katalog.
 *
 * Der Zusammenhalt entsteht über die Form: gleiche Kachel, gleiche Grösse,
 * gleicher Radius, und die Markenfarbe nur als gedämpfter Farbstich. Das liest
 * sich als *ein* Menü statt als Sammlung fremder Anzeigen — und lässt den Namen
 * darunter die Arbeit machen, die er ohnehin am besten kann.
 */

import {
  Apple, Banknote, Bitcoin, Building2, Clock, CreditCard, FileText, Globe,
  Landmark, QrCode, Smartphone, Wallet, Zap, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PaymentMethodSpec } from '@/lib/billing'

/** Glyph je Zahlungsart. Ohne Eintrag entscheidet die Gruppe (siehe unten). */
const ICONS: Record<string, LucideIcon> = {
  'apple-pay': Apple,
  'google-pay': Smartphone,
  'paypal': Wallet,
  'link': Zap,
  'revolut-pay': Smartphone,
  'amazon-pay': Wallet,
  'card': CreditCard,
  'sepa-debit': Landmark,
  'bank-transfer': Banknote,
  'klarna': Clock,
  'ideal': Landmark,
  'bancontact': CreditCard,
  'eps': Landmark,
  'twint': QrCode,
  'p24': Landmark,
  'blik': Smartphone,
  'mb-way': Smartphone,
  'multibanco': Banknote,
  'satispay': Smartphone,
  'swish': Smartphone,
  'mobilepay': Smartphone,
  'vipps': Smartphone,
  'alipay': QrCode,
  'wechat-pay': QrCode,
  'invoice': FileText,
  'purchase-order': Building2,
  'crypto': Bitcoin,
}

export function methodIcon(method: PaymentMethodSpec): LucideIcon {
  return ICONS[method.id] ?? (method.group === 'local' ? Globe : CreditCard)
}

export function MethodMark({
  method, size = 'md', className,
}: {
  method: PaymentMethodSpec
  size?: 'sm' | 'md'
  className?: string
}) {
  const Icon = methodIcon(method)
  const px = size === 'sm' ? 16 : 20
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[12px] border',
        size === 'sm' ? 'h-8 w-8' : 'h-11 w-11',
        className,
      )}
      style={{
        // Die Markenfarbe nur als Hauch: genug, um zwei Kacheln nebeneinander
        // zu unterscheiden, zu wenig, um das Menü zu zerreissen.
        background: `color-mix(in srgb, ${method.accent} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${method.accent} 30%, transparent)`,
        color: method.accent,
      }}
    >
      <Icon size={px} strokeWidth={1.75} />
    </span>
  )
}

/**
 * Die Kartenmarke im Kartennummernfeld.
 *
 * Ein Wort, kein Bild — „VISA" in Versalien ist an dieser Stelle sowieso
 * lesbarer als ein 20 Pixel breites Logo, und es wächst mit der Schriftgrösse
 * des Nutzers mit.
 */
export function CardBrandTag({ brand, label }: { brand: string; label: string }) {
  if (brand === 'unknown') return null
  return (
    <span className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-strong)]">
      {label}
    </span>
  )
}
