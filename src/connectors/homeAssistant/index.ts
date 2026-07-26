/**
 * The Home Assistant reference connector — the first complete validation of the
 * Connector contract. Everything Home-Assistant-specific (transport, mapping,
 * auth) lives here; the core and runtime never learn the vendor. A real
 * deployment passes `WebSocketHaTransport`, the self-contained demo passes
 * `SimulatedHaTransport`.
 */
export { createHomeAssistantConnector } from './homeAssistantConnector'
export type { HaConnectorOptions } from './homeAssistantConnector'
export { WebSocketHaTransport } from './transport'
export { SimulatedHaTransport } from './simulatedTransport'
export type { HaTransport, HaMessage, HaEntityState } from './transport'
export { mapEntityToDevice, mapStateToCapabilities, commandToCallService } from './mapping'
export { haWebsocketUrl } from './url'
