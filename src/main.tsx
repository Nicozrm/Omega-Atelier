import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { installChunkRecovery } from '@/lib/chunkRecovery'
import '@/styles/index.css'

// Recover from stale lazy-chunk loads after a PWA redeploy (blank/black screen).
installChunkRecovery()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
