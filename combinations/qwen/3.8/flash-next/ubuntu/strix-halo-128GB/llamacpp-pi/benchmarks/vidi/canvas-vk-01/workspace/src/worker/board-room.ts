import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  decodeMessage,
  isEchoableCloseCode,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import {
  initialRoomState,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from './room-state';
import type { Env } from './env';

/**
 * One BoardRoom per board. Holds the board's `Y.Doc` in memory, keeps every
 * change in the board's SQLite storage *before* anyone else sees it, and relays
 * y-websocket sync/awareness messages between connected clients.
 *
 * Three rules hold this story together:
 *
 * 1. **Nothing is broadcast before it is stored.** Once a change shows on
 *    someone's screen it is in the database, so closing the tab right after
 *    typing loses nothing (PRD persist.save_failure's counterpart).
 * 2. **Nothing is stored before it applies.** An update Yjs refuses closes the
 *    socket with 1003 and never reaches the database.
 * 3. **A board that cannot be loaded is never presented as empty.** The room
 *    refuses the connection with 4500 and retries, and the client says so
 *    instead of showing a blank page.
 *
 * Sockets use the hibernation API (`ctx.acceptWebSocket`): an idle board costs
 * no compute and no memory, and the platform may evict the object while people
 * stay connected. Their messages wake it, and the constructor reloads the board
 * from storage first — that is why `loadNow` runs inside
 * `ctx.blockConcurrencyWhile`, so no message is handled against a half-loaded
 * document. There is deliberately no participant counting: capacity is soft
 * (PRD live.over_capacity), a 6th person is never refused.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly store: BoardStore;

  /** The board in memory, or null while loading / after a storage failure. */
  private doc: Y.Doc | null = null;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  private state: RoomState = initialRoomState();

  /** When loading last failed, to keep retries `LOAD_RETRY_MIN_INTERVAL_MS` apart. */
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // A woken object must have the board before it answers anything: input is
    // gated until the (synchronous) load below finishes.
    void ctx.blockConcurrencyWhile(async () => {
      this.loadNow();
    });
  }

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    this.ensureLoaded();

    const [client, server] = Object.values(new WebSocketPair());
    // workerd hands binary frames to `webSocketMessage` as a Blob unless
    // `binaryType` says otherwise; the sync protocol decoder needs the bytes.
    server.binaryType = 'arraybuffer';

    if (this.state === 'load-failed') {
      // Refuse the connection honestly rather than serve a board that looks
      // empty. The client keeps the user's work and retries.
      server.accept();
      server.close(CLOSE_BOARD_LOAD_FAILED);
      return new Response(null, { status: 101, webSocket: client });
    }

    const doc = this.doc;
    if (doc === null) {
      // Storage is failing and the room is waiting for clients to reconnect.
      server.accept();
      server.close(CLOSE_STORAGE_FAILURE);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Hibernating from here on: no listeners on `server`, the platform delivers
    // its messages to `webSocketMessage` below, waking the object if needed.
    this.ctx.acceptWebSocket(server);

    // Send our own SyncStep1: every client answers with a SyncStep2 containing
    // whatever this room is missing, so a change that never made it to storage
    // is recovered from someone who still holds it.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(server, encoding.toUint8Array(encoder));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A message arrived on a socket this object accepted, possibly before it was
   * evicted and reconstructed around the same open connection.
   */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.doc === null) {
      // Woken by a message with nothing in memory, or storage failed earlier.
      this.ensureLoaded();
      if (this.doc === null) {
        this.closeSocket(ws, CLOSE_STORAGE_FAILURE);
        return;
      }
    }
    this.handleMessage(ws, message);
  }

  /**
   * The peer closed its end. Measured on workerd, a hibernated socket is not
   * torn down on its own — the client sits in CLOSING until the object answers
   * — so the close is echoed here. Nothing else is cleaned up: no per-socket
   * state is kept (presence is story 6).
   */
  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    this.closeSocket(ws, isEchoableCloseCode(code) ? code : 1000);
  }

  /** As above; a socket error simply ends in `webSocketClose`. */
  webSocketError(_ws: WebSocket, _error: unknown): void {}

  /** Move the lifecycle forward, returning the state the room is in now. */
  private advance(event: RoomEvent): RoomState {
    this.state = nextRoomState(this.state, event);
    return this.state;
  }

  /**
   * Read the board from storage into a fresh document. Synchronous: the SQL API
   * is synchronous, and `blockConcurrencyWhile` keeps input out until it returns.
   */
  private loadNow(): void {
    this.detachDoc();
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (error) {
      result = { ok: false, reason: 'sql-error', error: describe(error) };
    }

    if (!result.ok) {
      // Deliberately keeps whatever half-applied document is discarded: serving
      // a partial board would read as "someone deleted my notes".
      console.error(
        JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }),
      );
      this.advance({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      return;
    }
    if (result.quarantined > 0) {
      console.error(
        JSON.stringify({ event: 'board-load-quarantined', quarantined: result.quarantined }),
      );
    }

    this.attachDoc(doc);
    this.advance({ type: 'load-succeeded', quarantined: result.quarantined });
  }

  /** Load when the lifecycle says the board is not in memory. */
  private ensureLoaded(): void {
    if (this.doc !== null || this.state === 'loading') return;

    if (this.state === 'load-failed') {
      // A new connection retries the load at most once per retry interval;
      // inside the window it is refused without touching storage.
      if (
        this.advance({
          type: 'client-connected',
          sinceFailureMs: Date.now() - this.loadFailedAt,
        }) !== 'loading'
      ) {
        return;
      }
    } else if (this.state === 'storage-failed') {
      this.advance({ type: 'reset-for-reload' });
    } else {
      this.advance({ type: 'woken' });
    }
    this.loadNow();
  }

  private attachDoc(doc: Y.Doc): void {
    const handler = (update: Uint8Array, origin: unknown): void => {
      if (origin === LOAD_ORIGIN) return; // replayed from storage, not a new change

      try {
        // Durable before it is visible. If this throws, the change is not shown
        // to anyone and the room resets instead of pretending (PRD persist.save_failure).
        this.store.append(update);
      } catch (error) {
        this.failStorage(error);
        return;
      }

      this.advance({ type: 'update-stored' });
      this.broadcastSync(update, origin);

      if (this.advance({ type: 'compaction-started' }) === 'compacting') {
        this.store.compactIfNeeded(doc);
        this.advance({ type: 'compaction-finished' });
      }
    };

    doc.on('update', handler);
    this.doc = doc;
    this.updateHandler = handler;
  }

  /**
   * Drop the in-memory board. Not `Y.Doc.destroy()`: this can be called from
   * inside the document's own update handler, and destroying a document that
   * `readSyncMessage` is still holding would fail somewhere unrelated.
   */
  private detachDoc(): void {
    if (this.doc !== null && this.updateHandler !== null) {
      this.doc.off('update', this.updateHandler);
    }
    this.doc = null;
    this.updateHandler = null;
  }

  /**
   * A storage write failed: the board cannot promise durability, so this object
   * stops serving. Sockets close with 1011 — which the client reads as
   * "Reconnecting…", never as a lost board — and the next connection reloads
   * from storage while clients re-send whatever the room never stored.
   */
  private failStorage(error: unknown): void {
    console.error(JSON.stringify({ event: 'board-storage-failed', error: describe(error) }));
    this.advance({ type: 'storage-write-failed' });
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE);
    }
    this.detachDoc();
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const doc = this.doc;
    if (doc === null) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE);
      return;
    }

    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync': {
        const decoder = decoding.createDecoder(message.payload);
        const reply = encoding.createEncoder();
        try {
          syncProtocol.readSyncMessage(
            decoder,
            reply,
            doc,
            ws,
            // Yjs rejected the update: drop this socket, store nothing.
            () => this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA),
          );
        } catch {
          // Undecodable frame (truncated payload, unknown inner type).
          this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA);
          return;
        }
        if (encoding.length(reply) > 0) {
          const frame = encoding.createEncoder();
          encoding.writeVarUint(frame, MESSAGE_SYNC);
          encoding.writeUint8Array(frame, encoding.toUint8Array(reply));
          this.send(ws, encoding.toUint8Array(frame));
        }
        break;
      }
      case 'awareness': {
        // Relay verbatim to every open socket *including the sender*: idle
        // y-websocket clients close when they receive nothing for their
        // reconnect timeout, and awareness updates are what keep them alive.
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(frame, message.payload);
        this.broadcastRaw(encoding.toUint8Array(frame), null);
        break;
      }
      case 'query-awareness':
        // No awareness state is kept in this story (presence is story 6).
        break;
      case 'invalid':
        this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA);
        break;
    }
  }

  private broadcastSync(update: Uint8Array, except: unknown): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    this.broadcastRaw(encoding.toUint8Array(frame), except);
  }

  /**
   * Send `bytes` to every open socket, skipping `except` (when provided). The
   * socket list comes from the platform, so it is correct for sockets opened
   * before this object existed.
   */
  private broadcastRaw(bytes: Uint8Array, except: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.send(socket, bytes);
    }
  }

  private send(ws: WebSocket, bytes: Uint8Array): void {
    try {
      // A copy per socket: workerd may detach the buffer it is handed.
      ws.send(bytes.slice());
    } catch {
      // A socket that cannot be written to is already gone; the platform drops
      // it from `getWebSockets()`.
    }
  }

  private closeSocket(ws: WebSocket, code: number): void {
    try {
      ws.close(code);
    } catch {
      // already closing
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
