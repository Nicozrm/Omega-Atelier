# OMEGA ONVIF Bridge

The web app cannot directly perform ONVIF SOAP / WS-Discovery against a LAN camera, and no browser plays RTSP. This small local Node service is the network-side half of the ONVIF connector: it speaks ONVIF to the camera and hands the browser something it can actually display.

```
Arenti → RTSP → bridge → WebRTC (preferred) or MJPEG → Omega Atelier
```

## Start

From the repository root:

```bash
cd tools/onvif-bridge
npm install
OMEGA_ONVIF_BRIDGE_TOKEN="change-this" node server.mjs
```

**The bridge is a long-lived process, so keep it in step with the app.** It is
started by hand and left running, which means a bridge from an older checkout
happily serves `/cameras` — the camera connects, its resolution and PTZ appear —
and then 404s on the routes it does not have yet. In the app that surfaces as

> Live-Stream nicht verfügbar — ONVIF-Route nicht gefunden

After pulling, restart it. `GET /health` reports what a running bridge can do:

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true,"version":2,"features":{"stream":true,"snapshot":true,…}}
```

A response without `version`/`features` is a build from before the live-view
routes; the app detects exactly that and says so instead of printing the raw
404.

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

> The bridge URL in Omega is the **base** URL — `http://127.0.0.1:8787`, not `http://127.0.0.1:8787/cameras/connect`. The connector appends its own routes. Omega normalises a pasted API URL back to the base, but it is worth knowing which one is meant.

## Live picture

The bridge picks the best path it can offer and tells Omega which one it is (`GET /cameras/:id/stream`).

### 1 · WebRTC — preferred, lowest latency

Set `OMEGA_ONVIF_WEBRTC_WHEP` to a **local** WHEP endpoint. `{id}` is replaced with the camera id.

```bash
# go2rtc
OMEGA_ONVIF_WEBRTC_WHEP="http://127.0.0.1:1984/api/webrtc?src={id}"
# MediaMTX
OMEGA_ONVIF_WEBRTC_WHEP="http://127.0.0.1:8889/{id}/whep"
```

The browser negotiates directly with that endpoint. It is a local process; nothing leaves the machine and the media server never sees the ONVIF password.

### 2 · MJPEG — the zero-configuration fallback

If `ffmpeg` is on `PATH`, the bridge remuxes the RTSP stream into `multipart/x-mixed-replace`, which an `<img>` plays with no plugin, no media server and no build step. This is the default path.

```bash
# Debian/Ubuntu
sudo apt install ffmpeg
# macOS
brew install ffmpeg
# Windows
winget install Gyan.FFmpeg
```

Tuning: `OMEGA_ONVIF_MJPEG_FPS` (default 12) and `OMEGA_ONVIF_MJPEG_QUALITY` (ffmpeg `-q:v`, default 6; lower is better).

Because a media element cannot send an `Authorization` header, the MJPEG URL is authorised by a short-lived ticket that Omega requests over the token-protected API (`POST /cameras/:id/stream/ticket`). The bridge token itself never appears in a URL.

### 3 · Snapshot — always available

`GET /cameras/:id/snapshot` fetches the ONVIF snapshot URI (digest or basic auth, whichever the camera asks for) and relays the JPEG. Omega uses it when neither WebRTC nor MJPEG can start — and says *why* instead of showing a black rectangle.

## PTZ

PTZ availability is decided by `ContinuousMove`, not by capability discovery.

This matters for the Arenti, which reports `PTZ = false` in its ONVIF capabilities and answers `GetStatus` with `Action Not Implemented` — while still serving `ContinuousMove`. The bridge therefore:

- probes `ContinuousMove` with a zero velocity vector once after connect (moves nothing), and records `ptzSupport` as `available`, `unavailable` or `unknown`;
- never refuses a move because of a missing capability flag;
- marks PTZ `unavailable` **only** when `ContinuousMove` itself answers "not implemented";
- answers `GET /ptz/status` with `200 {"supported": false, "reason": …}` instead of an error, so a missing status readout does not disable the controls.

Set `OMEGA_ONVIF_PTZ_PROBE=0` to skip the probe.

Manual test:

```bash
curl -X POST http://127.0.0.1:8787/cameras/arenti-aussenkamera/ptz/move \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"x":0.2,"y":0,"zoom":0,"timeoutMs":300}'

curl -X POST http://127.0.0.1:8787/cameras/arenti-aussenkamera/ptz/stop \
  -H 'Authorization: Bearer <token>'
```

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ok, cameras, ffmpeg, webrtc, auth}` |
| `POST /cameras/connect` | Connect + discover (RTSP URI comes from ONVIF) |
| `GET /cameras` · `GET /cameras/:id` | Camera view (never includes credentials) |
| `POST /cameras/:id/disconnect` | Forget a camera |
| `GET /cameras/:id/stream` | Which live-view mode to use, and why not a better one |
| `POST /cameras/:id/stream/ticket` | Short-lived ticket for the MJPEG URL |
| `GET /cameras/:id/stream.mjpeg?ticket=…` | MJPEG multipart stream |
| `GET /cameras/:id/snapshot` | One JPEG frame |
| `POST /cameras/:id/ptz/move` · `/ptz/stop` | ContinuousMove / Stop |
| `GET /cameras/:id/ptz/status` · `/ptz/presets` | Optional readouts; never fatal |
| `POST /cameras/:id/ptz/preset` · `/ptz/home` | Goto preset / home |

## Arenti test

The current Omega setup:

- camera IP: `192.168.0.107`
- ONVIF user: `admin`
- ONVIF port: the port configured in the Arenti ONVIF settings (the UI defaults to 8000)

Do not assume a guessed RTSP path. The bridge asks ONVIF for the actual RTSP URI, and if the camera does not answer, the bridge reports "no stream" rather than inventing one.

## Security

Set `OMEGA_ONVIF_BRIDGE_TOKEN`. The bridge keeps camera credentials in memory only, never writes them to disk and never returns them — including inside a stream or snapshot URI, where some cameras embed them (`rtsp://user:pass@…`); those are stripped before the URI leaves the process.

Do not expose an unauthenticated bridge to the LAN or the Internet. The default binding is `127.0.0.1` on purpose.

## Tests

The bridge routes are covered by the repository's test suite:

```bash
npm test -- tools/onvif-bridge
```
