# OMEGA ONVIF Bridge

The web app cannot directly perform ONVIF SOAP / WS-Discovery against a LAN camera. This small local Node service is the network-side half of the ONVIF connector.

## Start

From the repository root:

```bash
cd tools/onvif-bridge
npm install
OMEGA_ONVIF_BRIDGE_TOKEN="change-this" node server.mjs
```

Windows PowerShell:

```powershell
cd tools/onvif-bridge
npm install
$env:OMEGA_ONVIF_BRIDGE_TOKEN="change-this"
node server.mjs
```

The default listener is `http://127.0.0.1:8787`.

If Omega Atelier is opened on another device, bind the bridge to the LAN:

```bash
OMEGA_ONVIF_BRIDGE_HOST=0.0.0.0
```

Then use the bridge machine's LAN address in Omega, for example `http://192.168.0.20:8787`.

## Arenti test

The current Omega screenshots show:

- camera IP: `192.168.0.107`
- ONVIF user: `admin`
- ONVIF port: enter the port configured in the Arenti ONVIF settings (the UI defaults to 8000)

Do not assume a guessed RTSP path. The bridge asks ONVIF for the actual RTSP URI.

## Security

Set `OMEGA_ONVIF_BRIDGE_TOKEN`. The bridge keeps camera credentials in memory only and never returns them. Do not expose an unauthenticated bridge to the LAN or the Internet.

The bridge does not store camera passwords on disk.
