# ONVIF Connector Implementation

Files added:
- src/connectors/onvif/index.ts
- src/connectors/onvif/transport.ts
- src/connectors/onvif/mapping.ts
- src/connectors/onvif/onvifConnector.ts
- src/connectors/onvif/simulatedTransport.ts
- src/connectors/onvif/mapping.test.ts
- src/connectors/onvif/onvifConnector.test.ts
- tools/onvif-bridge/server.mjs
- tools/onvif-bridge/package.json
- tools/onvif-bridge/.env.example
- tools/onvif-bridge/README.md

The physical-camera path is:
Omega browser -> HttpOnvifTransport -> local bridge -> ONVIF -> Arenti.

The bridge is intentionally separate from the Vite bundle. It must run on a machine that can reach the camera's LAN IP.
