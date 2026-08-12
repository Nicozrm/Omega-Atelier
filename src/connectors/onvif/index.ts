/**
 * ONVIF camera connector — public surface.
 *
 * The browser-facing connector talks to a local/nearby bridge. The bridge is
 * the only component that talks SOAP/WS-Discovery to the physical camera.
 */
export { createOnvifConnector } from './onvifConnector'
export type { OnvifConnectorOptions } from './onvifConnector'
export {
  HttpOnvifTransport,
} from './transport'
export type {
  OnvifTransport,
  OnvifCameraConfig,
  OnvifCameraInfo,
  OnvifPtzCommand,
  OnvifPtzStatus,
  OnvifPreset,
} from './transport'
export { SimulatedOnvifTransport } from './simulatedTransport'
export { mapOnvifCamera } from './mapping'
