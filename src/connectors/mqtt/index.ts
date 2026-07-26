/**
 * The MQTT (Homie) reference connector — the second validation of the Connector
 * contract, over a schemaless pub/sub transport. Everything MQTT/Homie-specific
 * (transport, broker semantics, convention mapping) lives here; the core and
 * runtime never learn the vendor. A production deployment passes an MQTT-over-
 * WebSocket client implementing `MqttTransport`; the self-contained demo passes
 * `SimulatedMqttBroker`.
 */
export { createMqttConnector } from './mqttConnector'
export type { MqttConnectorOptions } from './mqttConnector'
export { SimulatedMqttBroker } from './simulatedBroker'
export type { MqttTransport, MqttMessage, MqttConnectionState } from './transport'
export { topicMatches } from './transport'
export { parseHomieDevices, commandToHomie } from './mapping'
