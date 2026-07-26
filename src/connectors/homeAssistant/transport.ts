/**
 * transport.ts — the Home Assistant wire transport.
 *
 * This is the ONLY place network logic lives, and it lives INSIDE the connector
 * module — never in the core, never in the runtime. The connector talks to a
 * `HaTransport`; in production that is a real WebSocket to a Home Assistant
 * instance, in the self-contained demo/tests it is an in-memory simulator
 * (see `simulatedTransport.ts`). Either way the connector code is identical.
 */

/** A raw Home Assistant WebSocket message (auth, result, event …). */
export interface HaMessage {
  type: string
  id?: number
  [key: string]: unknown
}

/** A Home Assistant entity state snapshot, as delivered by the WS API. */
export interface HaEntityState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
  last_updated?: string
}

export interface HaTransport {
  /** Open the connection (resolves once the socket is ready for the handshake). */
  connect(): Promise<void>
  /** Send one message toward Home Assistant. */
  send(message: HaMessage): void
  /** Register the single inbound-message handler. */
  onMessage(handler: (message: HaMessage) => void): void
  /** Close the connection. */
  close(): void
}

/**
 * The real transport: a thin pipe over the browser WebSocket. It performs no
 * protocol logic — auth, request correlation and event routing all live in the
 * connector. Used in production against `ws(s)://<host>/api/websocket`.
 */
export class WebSocketHaTransport implements HaTransport {
  private ws?: WebSocket
  private handler?: (message: HaMessage) => void

  constructor(private readonly url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('WebSocket-Verbindung zu Home Assistant fehlgeschlagen'))
      ws.onmessage = (ev) => {
        try {
          this.handler?.(JSON.parse(ev.data as string) as HaMessage)
        } catch {
          /* ignore malformed frames */
        }
      }
    })
  }

  send(message: HaMessage): void {
    this.ws?.send(JSON.stringify(message))
  }

  onMessage(handler: (message: HaMessage) => void): void {
    this.handler = handler
  }

  close(): void {
    this.ws?.close()
    this.ws = undefined
  }
}
