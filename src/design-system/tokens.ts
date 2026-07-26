/**
 * OMEGA Design Language — typed token mirror.
 *
 * These constants mirror the CSS custom properties defined in
 * `src/styles/index.css`. Import them where colours/spacing must reach
 * code that cannot read CSS variables (e.g. canvas math, inline SVG
 * gradients, three.js materials). For DOM styling prefer the CSS vars
 * directly (`var(--accent)` …) so theme switching stays automatic.
 *
 * No component imports business logic from here — pure values only.
 */

export const palette = {
  void: '#0A0A0B',
  surface1: '#17161A',
  surface2: '#1F1D22',
  surface3: '#28252D',
  surface4: '#2E2A22',

  accent: '#C7A24E',
  accentBright: '#E6CC86',
  accentDim: '#9A7B36',
  cyan: '#E8C879',
  cyanDim: '#B8912F',

  danger: '#FF4D4D',
  warn: '#FFB13D',
  success: '#2EE59D',

  ink: '#F1ECE1',
  fog: '#C6BEAF',
  slate: '#8B8478',
  steel: '#3A362E',
  line: '#262219',
  white: '#FFFFFF',
} as const

/** 8px spacing scale. Use indices, never magic numbers. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
} as const

export const ease = {
  omega: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  outQuart: 'cubic-bezier(0.25, 1, 0.5, 1)',
  spring: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
} as const

export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const

/** Mode accents — restrained, harmonised to the indigo/cyan family. */
export const modeAccent = {
  auto:        '#C7A24E',
  morning:     '#5BD6C0',
  'day-office':'#E8C879',
  film:        '#8A7BFF',
  night:       '#9A7B36',
  relax:       '#5BB8FF',
  away:        '#8B8478',
  party:       '#C46BFF',
  alarm:       '#FF4D4D',
} as const

export type ModeAccentKey = keyof typeof modeAccent

/** Convenience: rgba string from a hex + alpha (0..1). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
