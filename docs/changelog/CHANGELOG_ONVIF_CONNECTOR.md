# ONVIF / PTZ Connector

## Added

- Generic `src/connectors/onvif` connector following the existing Connector/Transport/Mapping/Simulator/Test pattern.
- Browser-safe `HttpOnvifTransport` targeting a local ONVIF bridge.
- `SimulatedOnvifTransport` for deterministic tests without hardware.
- Neutral camera mapping using the existing `Camera` capability.
- PTZ commands via the existing `Camera` command channel: continuous move, stop, preset and home.
- Live ONVIF connection card and wizard source in the Digital Twin UI.
- PTZ controls on live ONVIF camera cards.
- Local `tools/onvif-bridge/server.mjs` using the maintained `onvif` Node package.
- Bridge token authentication and in-memory credential handling.
- Connector unit tests and mapping tests.

## Architecture

The Vite browser bundle never imports the Node ONVIF library. The browser connector calls the local bridge over HTTP; the bridge performs authenticated ONVIF/WS-Discovery operations against the LAN camera.

This keeps the existing manufacturer-neutral core intact and avoids putting Node/SOAP/UDP dependencies into the browser bundle.
