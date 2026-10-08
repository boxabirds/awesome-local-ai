/**
 * BoardRoom: one persistent, hibernating Durable Object per board address.
 *
 * The object owns that board's `Y.Doc` and its storage, and relays y-websocket
 * frames between the sockets connected to it:
 *
 * - a document change is written to SQLite *before* it is broadcast, so no
 *   other client can see a change that is not durable (`persist.seen_is_saved`);
 * - a change that cannot be written is not broadcast either: every socket is
 *   closed with `CLOSE_STORAGE_FAILURE` (1011), the in-memory doc is dropped and
 *   the next connection reloads the board from storage (`persist.save_failure`);
 * - undecodable traffic closes only the offending socket, with 1003;
 * - a board that cannot be loaded at all is never presented as an empty board:
 *   the room accepts the socket and closes it with `CLOSE_BOARD_LOAD_FAILED`
 *   (4500), which is what puts the client in its load-failure state.
 *
 * Sockets are accepted with `ctx.acceptWebSocket`, so an idle board costs no
 * compute: the runtime may evict the object between messages, and the next
 * wake reads the board back from storage. For the same reason the socket list
 * is `ctx.getWebSockets()` and not a `Set` — a `Set` would be empty after
 * eviction while the sockets are still open.
 */

import * as Y from 'yjs'
import { DurableObject } from 'cloudflare:workers'
import * as syncProtocol from 'y-protocols/sync'
import { createDecoder } from 'lib0/decoding'
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding'
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config'
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol'
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store'
import { blocksUpdates, nextRoomState, type RoomState } from './room-state'
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

/** Copy a frame into a plain `ArrayBuffer` for the decoders. */
function toArrayBuffer(data: unknown): ArrayBuffer | string {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class BoardRoom extends DurableObject<Env> {
  #store: BoardStore

  /** The board, or `null` while it is unreadable (load or storage failure). */
  #doc: Y.Doc | null = null

  #state: RoomState = 'loading'

  /** When the last failed load happened, for the `LOAD_RETRY_MIN_INTERVAL_MS` gate. */
  #loadFailedAt = 0

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.#store = new BoardStore(state.storage)
    // Read the board before serving anything. The concurrency gate means the
    // first client either gets the whole board or is told it could not load —
    // never a page that is still being assembled (`persist.load_failure`).
    state.blockConcurrencyWhile(async () => {
      this.#load()
    })
  }

  // ── loading ────────────────────────────────────────────────────────────────

  /**
   * Build a doc from storage and record what happened.
   *
   * A failed load leaves no doc behind: a half-read board would be broadcast to
   * everyone and then folded into the next snapshot.
   */
  #load(): LoadResult {
    this.#state = 'loading'
    const doc = new Y.Doc()
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.#onUpdate(doc, update, origin)
    })

    const result = this.#store.load(doc)
    if (result.ok) {
      this.#doc = doc
    } else {
      doc.destroy()
      this.#doc = null
      this.#loadFailedAt = Date.now()
      console.error(`[board-room] board not loaded (${result.reason}): ${result.error}`)
    }

    this.#state = nextRoomState('loading', {
      type: 'load-result',
      ok: result.ok,
      quarantined: result.quarantined ?? 0,
    })
    return result
  }

  /**
   * Make the room readable for a new connection, reloading first if the last
   * attempt failed or the document was thrown away after a storage error.
   *
   * A load failure is retried at most once per `LOAD_RETRY_MIN_INTERVAL_MS`:
   * a broken board must not be re-read on every reconnect of every tab.
   */
  #ensureReadable(now: number): boolean {
    if (this.#doc !== null && !blocksUpdates(this.#state)) return true

    if (this.#state === 'load-failed' && now - this.#loadFailedAt < LOAD_RETRY_MIN_INTERVAL_MS) {
      return false
    }
    return this.#load().ok
  }

  // ── sockets ────────────────────────────────────────────────────────────────

  #send(ws: WebSocket, bytes: Uint8Array): boolean {
    if (ws.readyState !== WS_OPEN) return false
    try {
      ws.send(bytes)
      return true
    } catch {
      // Nothing to clean up: `ctx.getWebSockets()` is the list of open sockets,
      // so a socket that cannot be written to is simply skipped next time.
      return false
    }
  }

  #broadcast(bytes: Uint8Array, except?: unknown): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      this.#send(ws, bytes)
    }
  }

  #closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code, reason)
      } catch {
        // Already gone.
      }
    }
  }

  #drop(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason.slice(0, 100))
    } catch {
      // Already broken.
    }
  }

  // ── documents ──────────────────────────────────────────────────────────────

  /**
   * Everything that lands in the document is written here, in the same turn it
   * was applied: storage first, then the broadcast, so a change is only ever
   * visible to someone else once it is durable.
   *
   * Bytes that came out of storage (`LOAD_ORIGIN`) are neither stored again nor
   * broadcast: they are the board the new socket is already being handed.
   */
  #onUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return
    // A doc that has been dropped is not a board: refuse to serve from it.
    if (doc !== this.#doc) return

    try {
      this.#store.append(update)
    } catch (error) {
      this.#failStorage(error)
      return
    }

    this.#state = nextRoomState(this.#state, {
      type: 'update',
      overThreshold: this.#store.needsCompaction,
    })
    this.#broadcast(syncUpdateFrame(update), origin)
    this.#state = nextRoomState(this.#state, {
      type: 'compact',
      ok: this.#store.compactIfNeeded(doc),
    })
  }

  /**
   * A storage write failed. The change stays only on the screen of whoever made
   * it, the board is dropped and everyone is disconnected: on reconnect the
   * client re-sends what the server is missing, and a board that is merely
   * unwritable now is still writable on the next wake.
   */
  #failStorage(error: unknown): void {
    this.#doc = null
    this.#state = nextRoomState(this.#state, { type: 'storage-error' })
    console.error(`[board-room] storage write failed, board discarded: ${messageOf(error)}`)
    this.#closeAll(CLOSE_STORAGE_FAILURE, 'board storage write failed')
  }

  // ── entry points ───────────────────────────────────────────────────────────

  fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade')
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // Accepted before we know whether the board can be read: a socket closed
    // before it was accepted arrives as a plain network failure on the client,
    // which then retries forever without ever telling the user the board is
    // broken. Accepted-then-closed with a code is what the client can read.
    this.ctx.acceptWebSocket(server)

    if (!this.#ensureReadable(Date.now())) {
      this.#drop(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded')
      return new Response(null, { status: 101, webSocket: client })
    }

    const doc = this.#doc
    if (doc === null) {
      this.#drop(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded')
      return new Response(null, { status: 101, webSocket: client })
    }

    // Ask the newcomer for its state vector. Every (re)connection gets this,
    // which is how a client that was open through an outage or a storage
    // failure gets its unsent changes back into the board.
    this.#send(server, syncStep1Frame(doc))
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // Without a readable document there is nothing to apply to, and a board
    // that failed to load must not be edited into a new one.
    if (this.#doc === null || blocksUpdates(this.#state)) {
      const code = this.#state === 'storage-failed' ? CLOSE_STORAGE_FAILURE : CLOSE_BOARD_LOAD_FAILED
      this.#drop(ws, code, 'board is not readable')
      return
    }

    const decoded = decodeMessage(toArrayBuffer(message))

    if (decoded.kind === 'invalid') {
      this.#drop(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason)
      return
    }

    if (decoded.kind === 'query-awareness') {
      // Ignored in this story: the room keeps no awareness state.
      return
    }

    const doc = this.#doc

    if (decoded.kind === 'awareness') {
      // Relay the complete frame verbatim to every open socket, including the
      // sender (that is what keeps an idle connection's traffic counter up).
      this.#broadcast(decoded.payload)
      return
    }

    const encoder = createEncoder()
    writeVarUint(encoder, MESSAGE_SYNC)

    let failure: string | null = null
    const decoder = createDecoder(decoded.payload)
    try {
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (error: unknown) => {
        failure = messageOf(error)
      })
    } catch (error) {
      failure = messageOf(error)
    }

    if (failure !== null) {
      // Nothing was stored: traffic Yjs refuses never reaches the log
      // (persist.partial_damage only ever sees storage corruption).
      this.#drop(ws, CLOSE_UNSUPPORTED_DATA, `Yjs rejected the update: ${failure}`)
      return
    }

    const reply = toUint8Array(encoder)
    // Length 1 means the encoder only holds the sync type byte: nothing to send.
    if (reply.byteLength > 1) this.#send(ws, reply)
  }

  webSocketClose(): void {
    // No per-socket state to clear: broadcasts read `ctx.getWebSockets()`, which
    // no longer lists a closed socket.
  }

  webSocketError(): void {
    // Same: a socket we cannot talk to is dropped by the runtime, and the next
    // broadcast simply does not see it.
  }
}
