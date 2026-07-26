import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { installChunkRecovery } from '@/lib/chunkRecovery'
import { installSwFreshness } from '@/lib/swFreshness'
import { installMotion } from '@/lib/motion'
import { installSound } from '@/lib/sound'
import '@/styles/index.css'

// Recover from stale lazy-chunk loads after a PWA redeploy (blank/black screen).
installChunkRecovery()
// Converge long-open tabs/PWAs to the newest deploy (periodic SW update check
// + one controlled reload when a new service worker takes over).
installSwFreshness()
// Upgrade the --spring-* motion tokens to physical damped-oscillator curves.
installMotion()
// Arm the micro-auditory feedback (unlocks on the first user gesture).
installSound()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
