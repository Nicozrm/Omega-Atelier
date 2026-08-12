import { describe, it, expect } from 'vitest'
import { bridgeCanSnapshot, diagnoseStreamFailure } from './liveView'
import { OnvifBridgeError, type OnvifBridgeHealth } from './transport'
import { SimulatedOnvifTransport } from './simulatedTransport'

/**
 * The reported failure: an Arenti camera that connects perfectly — 2560 × 1440,
 * 15 FPS, "Verbunden", PTZ present — over a video area reading
 *
 *     Live-Stream nicht verfügbar
 *     ONVIF-Route nicht gefunden
 *
 * That text is the *bridge's own* 404 fallback, printed raw. The bridge is a
 * process started by hand and left running, and this one predated the live-view
 * routes: `/cameras` works (hence the profiles and PTZ), `/stream` does not
 * exist. The fix is to restart the bridge — which the message never said.
 */

/** A bridge from before the live-view routes: answers /health, claims nothing. */
const OLD_BRIDGE: OnvifBridgeHealth = { ok: true, cameras: 1 }

/** A current bridge. */
const NEW_BRIDGE: OnvifBridgeHealth = {
  ok: true,
  version: 2,
  cameras: 1,
  features: { stream: true, snapshot: true, mjpeg: true, ptz: true, ticket: true },
}

const ROUTE_404 = { message: 'ONVIF-Route nicht gefunden', status: 404 }

describe('diagnoseStreamFailure', () => {
  it('names an outdated bridge and how to restart it', () => {
    const message = diagnoseStreamFailure(ROUTE_404, OLD_BRIDGE)
    expect(message).toContain('ältere')
    expect(message).toContain('node server.mjs')
    // The raw bridge text is replaced, not merely decorated with.
    expect(message).not.toBe(ROUTE_404.message)
  })

  it('still offers the restart hint when the bridge says nothing useful', () => {
    // A 404 from a bridge that does report features means a genuinely unknown
    // route; the hint is still the most likely fix and the text says so.
    const message = diagnoseStreamFailure(ROUTE_404, NEW_BRIDGE)
    expect(message).toContain('ONVIF-Route nicht gefunden')
    expect(message).toContain('node server.mjs')
  })

  it('attributes a rejected token to the token, not to the camera', () => {
    const message = diagnoseStreamFailure({ message: 'Bridge-Authentifizierung abgelehnt', status: 401 }, OLD_BRIDGE)
    expect(message).toContain('OMEGA_ONVIF_BRIDGE_TOKEN')
  })

  it('says the bridge is unreachable when health cannot be read either', () => {
    const message = diagnoseStreamFailure({ message: 'Failed to fetch' }, null)
    expect(message).toContain('antwortet nicht')
  })

  it('passes an unremarkable failure through unchanged', () => {
    const message = diagnoseStreamFailure({ message: 'Kamera liefert keine RTSP-Adresse', status: 409 }, NEW_BRIDGE)
    expect(message).toBe('Kamera liefert keine RTSP-Adresse')
  })
})

describe('bridgeCanSnapshot — no second dead end from the same cause', () => {
  it('is false for a bridge without the snapshot route', () => {
    // Offering "Snapshot laden" here produces another 404 for the same reason.
    expect(bridgeCanSnapshot(OLD_BRIDGE)).toBe(false)
  })

  it('is true for a current bridge', () => {
    expect(bridgeCanSnapshot(NEW_BRIDGE)).toBe(true)
  })

  it('is false when the bridge could not be reached at all', () => {
    expect(bridgeCanSnapshot(null)).toBe(false)
  })
})

describe('OnvifBridgeError keeps the status', () => {
  it('carries the code the diagnosis branches on', () => {
    const error = new OnvifBridgeError('ONVIF-Route nicht gefunden', 404)
    expect(error.status).toBe(404)
    expect(error.message).toBe('ONVIF-Route nicht gefunden')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('the simulator models a current bridge', () => {
  it('reports every live-view route, so simulated runs never hit this path', async () => {
    const health = await new SimulatedOnvifTransport().health()
    expect(health.features?.stream).toBe(true)
    expect(bridgeCanSnapshot(health)).toBe(true)
    expect(diagnoseStreamFailure(ROUTE_404, health)).toContain('ONVIF-Route nicht gefunden')
  })
})
