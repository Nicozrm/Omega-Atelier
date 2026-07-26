import { useEffect, useRef } from 'react'
import type { CommandPhase } from '@/twin/twinManager'

/**
 * Haptic counterpart of the predictive command state: when a tracked command
 * transitions into `failed`, the device answers with a short double tap
 * (where the platform exposes vibration — mobile). Silent everywhere else.
 */
export function useFailureHaptics(commands: Record<string, CommandPhase>): void {
  const prev = useRef<Record<string, CommandPhase>>({})
  useEffect(() => {
    const before = prev.current
    prev.current = commands
    for (const [key, phase] of Object.entries(commands)) {
      if (phase === 'failed' && before[key] !== 'failed') {
        navigator.vibrate?.([14, 70, 22])
        break // one failure, one tap — even if a batch fails at once
      }
    }
  }, [commands])
}
