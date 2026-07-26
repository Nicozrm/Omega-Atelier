/**
 * Normalise a user-entered Home Assistant address into its WebSocket API URL.
 *  - `http` → `ws`, `https` → `wss` (no scheme ⇒ `wss`, the safe default);
 *  - strips trailing slashes; appends `/api/websocket` if not already present.
 *
 * Note: a browser on an `https://` page cannot open a `ws://` socket (mixed
 * content), so a real Home Assistant must be reachable over `https/wss`
 * (Nabu Casa or a reverse proxy). Localhost dev over `http/ws` works.
 */
export function haWebsocketUrl(input: string): string {
  let s = input.trim()
  if (!s) return s
  if (s.startsWith('https://')) s = 'wss://' + s.slice(8)
  else if (s.startsWith('http://')) s = 'ws://' + s.slice(7)
  else if (!s.startsWith('ws://') && !s.startsWith('wss://')) s = 'wss://' + s
  s = s.replace(/\/+$/, '')
  if (!/\/api\/websocket$/.test(s)) s += '/api/websocket'
  return s
}
