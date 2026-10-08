/**
 * Integration-test client: a real `Y.Doc` speaking the y-websocket wire
 * protocol over the WebSocket that comes back from a `SELF.fetch()` upgrade.
 *
 * The framing is identical to `y-websocket` (sync messages wrapped in
 * `[MESSAGE_SYNC, …]`, awareness wrapped in `[MESSAGE_AWARENESS,
 * varUint8Array(update)]`), but the client is synchronous and has no
 * timers/reconnect logic, so tests can observe exactly what went in and out.
 */

import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding'
import { createEncoder, length, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding'
import { SELF } from 'cloudflare:test'
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol'

export type Direction = 'in' | 'out'

export interface FrameLogEntry {
  dir: Direction
  /** First byte of the frame (message type). */
  type: number
  /** Complete frame. */
  bytes: Uint8Array
}

export const REMOTE_ORIGIN = 'remote'

export class TestClient {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  readonly log: FrameLogEntry[] = []
  closed: { code: number; reason: string } | null = null
  synced = false
  errors: string[] = []

  #socket: WebSocket | null = null

  private constructor(
    readonly label: string,
    doc: Y.Doc,
    awareness: awarenessProtocol.Awareness,
  ) {
    this.doc = doc
    this.awareness = awareness
  }

  get socket(): WebSocket | null {
    return this.#socket
  }

  get isOpen(): boolean {
    return this.#socket?.readyState === WS_OPEN
  }

  /** Attach to a socket (already `accept()`ed) and run the sync handshake. */
  static attach(
    label: string,
    socket: WebSocket,
    options: { sync?: boolean; doc?: Y.Doc } = {},
  ): TestClient {
    const doc = options.doc ?? new Y.Doc()
    const client = new TestClient(label, doc, new awarenessProtocol.Awareness(doc))

    client.#socket = socket
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return
      const encoder = createEncoder()
      writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      client.send(toUint8Array(encoder))
    })
    socket.addEventListener('message', event => {
      client.#handle((event as MessageEvent).data as ArrayBuffer)
    })
    socket.addEventListener('close', event => {
      const close = event as CloseEvent
      client.closed = { code: close.code ?? 1005, reason: close.reason ?? '' }
    })
    socket.addEventListener('error', event => {
      client.errors.push(String((event as { error?: Error }).error ?? 'socket error'))
    })
    if (options.sync !== false) client.syncStep1()
    return client
  }

  // ── sending ────────────────────────────────────────────────────────────────

  /** `[MESSAGE_SYNC, SyncStep1]`, plus the local awareness state like y-websocket does. */
  syncStep1(): void {
    const encoder = createEncoder()
    writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    this.send(toUint8Array(encoder))
    if (this.awareness.getLocalState() !== null) {
      this.publishAwareness()
    }
  }

  /** Ask again for whatever the room has that we are missing. */
  requestSync(): void {
    this.syncStep1()
  }

  sendFrame(bytes: Uint8Array): void {
    this.send(bytes)
  }

  /** Send raw bytes (used for malformed-frame tests). */
  sendRaw(data: Uint8Array | string): void {
    const socket = this.#socket
    if (socket === null || socket.readyState !== WS_OPEN) {
      this.errors.push('send on closed socket')
      return
    }
    const frame = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.log.push({ dir: 'out', type: typeof data === 'string' ? -1 : frame[0], bytes: frame })
    socket.send(typeof data === 'string' ? data : frame.slice())
  }

  /** Send a raw Yjs update, framed as a sync update message. */
  sendUpdate(update: Uint8Array): void {
    const encoder = createEncoder()
    writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    this.send(toUint8Array(encoder))
  }

  /** Publish the current local awareness state, framed like y-websocket. */
  publishAwareness(): void {
    const encoder = createEncoder()
    writeVarUint(encoder, MESSAGE_AWARENESS)
    writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    )
    this.send(toUint8Array(encoder))
  }

  private send(bytes: Uint8Array): void {
    const socket = this.#socket
    if (socket === null || socket.readyState !== WS_OPEN) {
      this.errors.push('send on closed socket')
      return
    }
    this.log.push({ dir: 'out', type: bytes[0], bytes })
    socket.send(bytes.slice())
  }

  // ── receiving ──────────────────────────────────────────────────────────────

  /** @internal */
  #handle(data: ArrayBuffer): void {
    const frame = new Uint8Array(data)
    this.log.push({ dir: 'in', type: frame[0], bytes: frame })

    const decoder = createDecoder(frame)
    const encoder = createEncoder()
    const type = readVarUint(decoder)

    if (type === MESSAGE_SYNC) {
      writeVarUint(encoder, MESSAGE_SYNC)
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_ORIGIN)
      if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        readVarUint8Array(decoder),
        this,
      )
    }

    if (length(encoder) > 1) this.send(toUint8Array(encoder))
  }

  /** Inbound frames that are sync updates (`[0, 2, len, …]`), i.e. broadcasts. */
  inboundBroadcasts(): Uint8Array[] {
    return this.log
      .filter(entry => entry.dir === 'in' && entry.bytes[0] === MESSAGE_SYNC && entry.bytes[1] === 2)
      .map(entry => entry.bytes)
  }

  // ── teardown ───────────────────────────────────────────────────────────────

  /** Close the socket (no code by default: 1005/1006 cannot be sent). */
  close(code?: number): void {
    try {
      if (code === undefined) this.#socket?.close()
      else this.#socket?.close(code)
    } catch {
      // Already closed.
    }
  }

  destroy(): void {
    this.close()
    this.awareness.destroy()
    this.doc.destroy()
  }
}

const WS_OPEN = 1

/** Convert a Uint8Array to a comparable string. */
export function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * True when both documents contain exactly the same items *and* delete sets.
 *
 * `Y.encodeStateVector` alone is not enough: a `Y.Map.delete()` does not move
 * the state vector, so two docs can have equal vectors and different content.
 */
export function docsConverge(a: Y.Doc, b: Y.Doc): boolean {
  return hex(Y.encodeStateAsUpdate(a)) === hex(Y.encodeStateAsUpdate(b))
}

// ── connection helpers ───────────────────────────────────────────────────────

/** Open a WebSocket against the Worker's `/api/rooms/<id>` route. */
export async function openSocket(boardId: string): Promise<Response> {
  return SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  })
}

/** Connect a client (optionally with a pre-seeded doc) and wait for its first sync. */
export async function connect(
  boardId: string,
  options: { label?: string; sync?: boolean; doc?: Y.Doc; waitForSync?: boolean } = {},
): Promise<TestClient> {
  const response = await openSocket(boardId)
  const socket = (response as Response & { webSocket?: WebSocket }).webSocket
  if (response.status !== 101 || socket === undefined) {
    throw new Error(`expected a 101 upgrade for ${boardId}, got ${response.status}`)
  }
  // workerd hands the client side of the pair over in "unaccepted" state.
  socket.accept()
  const client = TestClient.attach(options.label ?? boardId, socket, options)
  if (options.waitForSync !== false) {
    await waitFor(() => client.synced, 3000, `${options.label ?? boardId} initial sync`)
  }
  return client
}

/** Poll `predicate` until true, or throw with the labels of the clients involved. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  context = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    await new Promise(resolve => setTimeout(resolve, 5))
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${context}`)
  }
}

/** Wait until every client's doc has the same state vector. */
export async function waitForConvergence(clients: readonly TestClient[], timeoutMs = 3000): Promise<void> {
  await waitFor(() => clients.every(client => clients.every(other => docsConverge(client.doc, other.doc))), timeoutMs, 'convergence')
}

/** A board id that no other test in the file uses (DO state is per id). */
export function uniqueBoardId(prefix: string): string {
  const id = `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-6)}`
    .replace(/[^A-Za-z0-9_-]/g, 'x')
    .padEnd(22, 'x')
    .slice(0, 22)
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new Error(`bad test board id: ${id}`)
  return id
}