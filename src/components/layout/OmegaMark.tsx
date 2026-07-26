/**
 * OmegaMark — the compact brand glyph (Ω as an architectural arch on an
 * indigo tile). Shared by the Topbar and anywhere the small logo appears.
 * Pure presentation; size-driven.
 */
export function OmegaMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <defs>
        <linearGradient id="omega-mark-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E6CC86" />
          <stop offset="55%" stopColor="#C7A24E" />
          <stop offset="100%" stopColor="#9A7B36" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#omega-mark-tile)" />
      <g stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M22 70 L32 70" />
        <path d="M32 70 C 32 60, 28 56, 28 46 C 28 32, 40 24, 50 24" />
        <path d="M50 24 C 60 24, 72 32, 72 46 C 72 56, 68 60, 68 70" />
        <path d="M68 70 L78 70" />
      </g>
    </svg>
  )
}
