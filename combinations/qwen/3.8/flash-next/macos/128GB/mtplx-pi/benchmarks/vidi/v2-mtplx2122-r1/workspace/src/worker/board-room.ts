/**
 * BoardRoom: one Durable Object per board address.
 *
 * The object holds that board's `Y.Doc` in memory and relays y-websocket
 * frames between the sockets connected to it:
 *
 * - sync frames are applied to the doc and the resulting update is forwarded
 *   to every *other* socket immediately, framed as an update message (no
 *   batching, no timers);
 * - awareness frames are relayed to *all* sockets, including the sender, so
 *   idle y-websocket clients keep seeing traffic and never hit their 30s
 *   "no message received" timeout (see the "Awareness relay" sequence in the
 *   design);
 * - anything that is not decodable closes only the offending socket, with
 *   `CLOSE_UNSUPPORTED_DATA` (1003).
 *
 * Sockets are accepted with the non-hibernating `accept()` on purpose: the
 * document only lives in memory until story 4, and hibernation would evict
 * the object (and silently drop the doc) while sockets stay open.
 */

import * as Y from 'yjs'
import { DurableObject } from 'cloudflare:workers'
import * as syncProtocol from 'y-protocols/sync'
import { createDecoder } from 'lib0/decoding'
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding'
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol'
import type { Env } from './index'

const WS_OPEN = 1

/** `[MESSAGE_SYNC, messageYjsUpdate, len, ...update]` — what clients expect. */
function syncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = createEncoder()
  writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return toUint8Array(encoder)
}

/** `[MESSAGE_SYNC, messageYjsSyncStep1, len, ...stateVector]` */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = createEncoder()
  writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return toUint8Array(encoder)
}

function toFrameData(data: unknown): ArrayBuffer | string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    // Copy so the byteOffset/byteLength window is all the decoder sees.
    const copy = new Uint8Array(view.byteLength)
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    return copy.buffer
  }
  return ''
}

export class BoardRoom extends DurableObject<Env> {
  /** Open sockets, used for broadcast. Cleared on close/error. */
  #sockets = new Set<WebSocket>()

  /** The board document, created on the first accept and never persisted. */
  #doc: Y.Doc | null = null

  get sockets(): ReadonlySet<WebSocket> {
    return this.#sockets
  }

  get doc(): Y.Doc {
    if (this.#doc === null) {
      const doc = new Y.Doc()
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.#broadcast(syncUpdateFrame(update), origin)
      })
      this.#doc = doc
    }
    return this.#doc
  }

  fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade')
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    this.#addSocket(server)

    // Ask the newcomer for its state vector. Every (re)connection gets this,
    // which is how a room that was just restarted is repopulated: the client
    // answers with a SyncStep2 carrying the missing updates.
    this.#send(server, syncStep1Frame(this.doc))

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── sockets ────────────────────────────────────────────────────────────────

  #addSocket(ws: WebSocket): void {
    this.#sockets.add(ws)
    ws.addEventListener('message', event => {
      this.#handleMessage(ws, toFrameData((event as MessageEvent).data))
    })
    ws.addEventListener('close', () => {
      this.#sockets.delete(ws)
    })
    ws.addEventListener('error', () => {
      this.#sockets.delete(ws)
    })
  }

  #send(ws: WebSocket, bytes: Uint8Array): boolean {
    if (ws.readyState !== WS_OPEN) return false
    try {
      ws.send(bytes)
      return true
    } catch {
      // A socket we cannot write to is dropped from the set: that is the
      // "send to dead socket → socket dropped from set" error path.
      this.#sockets.delete(ws)
      return false
    }
  }

  #broadcast(bytes: Uint8Array, except?: unknown): void {
    for (const ws of this.#sockets) {
      if (except !== undefined && ws === except) continue
      this.#send(ws, bytes)
    }
  }

  #drop(ws: WebSocket, reason: string): void {
    this.#sockets.delete(ws)
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 100))
    } catch {
      // The socket was already broken; dropping it from the set is enough.
    }
  }

  // ── messages ───────────────────────────────────────────────────────────────

  #handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data)

    if (decoded.kind === 'invalid') {
      this.#drop(ws, decoded.reason)
      return
    }

    if (decoded.kind === 'query-awareness') {
      // Ignored in this story: the room keeps no awareness state.
      return
    }

    if (decoded.kind === 'awareness') {
      // Relay the complete frame verbatim to every open socket, including the
      // sender (that is what keeps an idle connection's traffic counter up).
      this.#broadcast(decoded.payload)
      return
    }

    const doc = this.doc
    const encoder = createEncoder()
    writeVarUint(encoder, MESSAGE_SYNC)

    let failure: string | null = null
    const decoder = createDecoder(decoded.payload)
    try {
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (error: unknown) => {
        failure = error instanceof Error ? error.message : String(error)
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }

    if (failure !== null) {
      this.#drop(ws, `Yjs rejected the update: ${failure}`)
      return
    }

    const reply = toUint8Array(encoder)
    // Length 1 means the encoder only holds the sync type byte: nothing to send.
    if (reply.byteLength > 1) this.#send(ws, reply)
  }
}
