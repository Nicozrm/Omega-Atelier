import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { StartScreen } from '@/components/ui/StartScreen'
import { AuthGate } from '@/components/auth/AuthGate'
import { ToastViewport } from '@/components/ui/Toast'
import { CommandPalette } from '@/components/ui/CommandPalette'
import { KeyboardHelp } from '@/components/ui/KeyboardHelp'
import { RouteFallback } from '@/components/ui/RouteFallback'
import { ensureAuthInit } from '@/store/useAuthStore'
import { useUIStore } from '@/store/useUIStore'
import { AmbientScene } from '@/components/ui/AmbientScene'
import { InsightsDialog } from '@/components/insights/InsightsDialog'
import { ComposerWizard } from '@/components/composer/ComposerWizard'

/**
 * Lazily-loaded routes. Each becomes its own chunk, so the heavy Editor (and
 * its canvas/dialog dependencies) no longer ships in the initial bundle for
 * users landing on Start / Login / Plans. The pages use named exports, hence
 * the `default` re-map required by `React.lazy`.
 *
 * StartScreen stays eager: it is the "/" landing route and must paint without
 * an extra round-trip.
 */
const LandingPage = lazy(() => import('@/pages/Landing').then((m) => ({ default: m.LandingPage })))
const LoginPage = lazy(() => import('@/pages/Login').then((m) => ({ default: m.LoginPage })))
const PlansPage = lazy(() => import('@/pages/Plans').then((m) => ({ default: m.PlansPage })))
const EditorPage = lazy(() => import('@/pages/Editor').then((m) => ({ default: m.EditorPage })))
const SettingsPage = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })))
const DashboardPage = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.DashboardPage })))
const RobotPage = lazy(() => import('@/pages/Robot').then((m) => ({ default: m.RobotPage })))
const ImpressumPage = lazy(() => import('@/pages/Legal').then((m) => ({ default: m.ImpressumPage })))
const DatenschutzPage = lazy(() => import('@/pages/Legal').then((m) => ({ default: m.DatenschutzPage })))
const AGBPage = lazy(() => import('@/pages/Legal').then((m) => ({ default: m.AGBPage })))

// Image-Blaster-3D studio: heavy (three.js exporters, R3F preview) and only
// loaded on first open — mounted globally so it works from every page.
const ImageBlasterStudio = lazy(() =>
  import('@/features/imageBlaster/ImageBlasterStudio').then((m) => ({ default: m.ImageBlasterStudio })),
)

/**
 * The ambient background belongs to the app surfaces, not the landing page —
 * the public page stays deliberately still, so no permanent motion runs there.
 */
function RouteAmbient() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return <AmbientScene />
}

/**
 * Application root. Mounts routes, auth initialisation, global toast viewport.
 */
export default function App() {
  useEffect(() => { ensureAuthInit() }, [])
  const blasterOpen = useUIStore((s) => s.blasterOpen)
  const setBlasterOpen = useUIStore((s) => s.setBlasterOpen)

  return (
    <>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <RouteAmbient />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/start" element={<StartScreen />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/impressum" element={<ImpressumPage />} />
          <Route path="/datenschutz" element={<DatenschutzPage />} />
          <Route path="/agb" element={<AGBPage />} />
          <Route
            path="/plans"
            element={
              <AuthGate>
                <PlansPage />
              </AuthGate>
            }
          />
          <Route
            path="/plan/:id"
            element={
              <AuthGate>
                <EditorPage />
              </AuthGate>
            }
          />
          <Route
            path="/dashboard"
            element={
              <AuthGate>
                <DashboardPage />
              </AuthGate>
            }
          />
          <Route
            path="/robot"
            element={
              <AuthGate>
                <RobotPage />
              </AuthGate>
            }
          />
          <Route
            path="/settings"
            element={
              <AuthGate>
                <SettingsPage />
              </AuthGate>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
      <ToastViewport />
      <CommandPalette />
      <KeyboardHelp />
      <InsightsDialog />
      <ComposerWizard />
      {blasterOpen && (
        <Suspense fallback={null}>
          <ImageBlasterStudio open={blasterOpen} onClose={() => setBlasterOpen(false)} />
        </Suspense>
      )}
    </BrowserRouter>
    </>
  )
}
