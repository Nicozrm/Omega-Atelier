/**
 * The Device & Connector domain — the manufacturer-, renderer- and
 * connector-neutral core of the Digital Twin. Everything here is pure data,
 * pure logic and contracts. Future integrations (Matter, Home Assistant, MQTT,
 * Alexa, Apple/Google Home, SwitchBot, Govee, Lockin, Tuya, Arenti, Osaio, …)
 * build on this domain and never modify it.
 */
export * from './capabilities'
export * from './device'
export * from './connector'
export * from './runtime'
