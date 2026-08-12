/**
 * registry.ts — how a camera widget reaches the bridge behind its connector.
 *
 * The Digital Twin's `Device` is deliberately manufacturer-neutral: it carries
 * capabilities and metadata strings, never a transport. But a live viewer needs
 * to fetch bytes (snapshot, MJPEG ticket, stream descriptor) from the exact
 * bridge that this camera's connector was built with — including its token.
 *
 * Rather than widening the domain with an ONVIF-shaped field, the connector
 * registers its transport under its own connector id and the widget looks it
 * up. Nothing else in the app knows this module exists, and if the connector is
 * gone, the lookup simply misses and the widget degrades to "not available".
 */

import type { OnvifTransport } from './transport'

const transports = new Map<string, OnvifTransport>()

export function registerOnvifTransport(connectorId: string, transport: OnvifTransport): void {
  transports.set(connectorId, transport)
}

export function unregisterOnvifTransport(connectorId: string): void {
  transports.delete(connectorId)
}

export function getOnvifTransport(connectorId: string): OnvifTransport | undefined {
  return transports.get(connectorId)
}
