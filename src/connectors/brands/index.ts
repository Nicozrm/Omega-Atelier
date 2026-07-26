/**
 * Brand connectors — Govee, SwitchBot, Tuya/Smart Life, Alexa, Lockin.
 * One generic Connector over a per-brand client; real cloud clients for
 * Govee + SwitchBot, an authentic simulator for every brand.
 */
export { createBrandConnector } from './brandConnector'
export type { BrandClient, BrandConnectorOptions } from './brandConnector'
export { createSimulatedBrandClient, BRAND_FLEETS } from './simulatedBrandClient'
export { createGoveeClient, goveeControlBody, goveeCapsFor, hexToRgbInt } from './goveeClient'
export type { GoveeClientOptions } from './goveeClient'
export { createSwitchBotClient, switchbotSign, switchbotCommand, switchbotCapsFor } from './switchbotClient'
export type { SwitchBotClientOptions } from './switchbotClient'
export { createTuyaClient, tuyaSign, tuyaStringToSign, tuyaCapsFor, tuyaCommandFor } from './tuyaClient'
export type { TuyaClientOptions, TuyaRegion } from './tuyaClient'
