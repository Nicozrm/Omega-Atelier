/**
 * Tuya Cloud connector — public surface.
 *
 * A real, signed Tuya OpenAPI integration behind the neutral `Connector`
 * contract. Production uses `HttpTuyaTransport` (a data-centre region + the
 * project's Client ID / Secret); the demo and tests use `SimulatedTuyaTransport`
 * so the exact same connector logic runs without credentials or network.
 */

export { createTuyaConnector } from './tuyaConnector'
export type { TuyaConnectorOptions } from './tuyaConnector'
export { HttpTuyaTransport, TUYA_ENDPOINTS } from './transport'
export type { TuyaTransport, TuyaRegion, TuyaApiResponse, TuyaRequest } from './transport'
export { relayBaseUrl, tuyaRelayUrl, tuyaDirectUrl } from './relay'
export { SimulatedTuyaTransport } from './simulatedTransport'
export type { SimulatedTuyaOptions } from './simulatedTransport'
export { signRequest, hmacSha256Hex, sha256Hex, makeNonce } from './signing'
export { mapTuyaDevice, mapStatusToCapabilities, commandToTuya } from './mapping'
export type { TuyaDevice, TuyaStatus, TuyaCommand } from './mapping'
