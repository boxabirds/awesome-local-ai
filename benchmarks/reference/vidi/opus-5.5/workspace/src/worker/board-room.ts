/**
 * BoardRoom: one Durable Object per board. Relays y-websocket sync and awareness messages
 * between every socket on the board and keeps the board in its SQLite storage (story 4).
 *
 * - Load on construct/wake: `blockConcurrencyWhile` loads snapshot + log into a fresh Y.Doc.
 * - Write before broadcast: an applied update is appended to storage in the same turn, then
 *   sent to the other sockets. Durable Object output gates hold those sends until the write is
 *   durable, so nobody sees a change that is not saved.
 * - Hibernation: sockets are accepted with `ctx.acceptWebSocket`, so an idle board uses no
 *   compute; `ctx.getWebSockets()` is the list of sockets, which survives hibernation.
 * - Load failure (unreadable snapshot or SQL error): connections are accepted and closed with
 *   CLOSE_BOARD_LOAD_FAILED; loading is retried on a new connection at most every
 *   LOAD_RETRY_MIN_INTERVAL_MS. The room never serves or accepts edits to an empty stand-in.
 * - Storage failure (append throws): the change is not broadcast, every socket is closed with
 *   CLOSE_STORAGE_FAILURE and the doc is discarded; reconnecting clients re-send what the
 *   reloaded room lacks through the SyncStep1/SyncStep2 exchange.
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { SNAPSHOT_CHUNK_BYTES } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, applyCheckedUpdate } from './board-store';
import type { Env } from './index';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from './room-state';

const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_UPGRADE_REQUIRED = 426;
/** Encoder length of a reply that contains only the message type (nothing to send). */
const EMPTY_REPLY_LENGTH = 1;

export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

export class BoardRoom extends DurableObject<Env> {
  private readonly store: BoardStore;
  private lifecycle: RoomLifecycle = { kind: 'loading' };
  private doc: Y.Doc | null = null;
  /** Number of load attempts by this instance (tests check retries are rate-limited). */
  loadAttempts = 0;
  /**
   * Settles when the initial load has run. The runtime delivers no event before then; tests
   * that construct an instance by hand await it the same way.
   */
  readonly loaded: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  /** The room's externally visible state. */
  get state(): RoomState {
    switch (this.lifecycle.kind) {
      case 'load-failed':
        return 'load-failed';
      case 'storage-failed':
        return 'storage-failed';
      default:
        return 'ready';
    }
  }

  private transition(event: RoomEvent): RoomLifecycle {
    this.lifecycle = nextRoomState(this.lifecycle, event);
    return this.lifecycle;
  }

  /** Loading → Ready or LoadFailed. */
  private load(): void {
    this.loadAttempts += 1;
    this.lifecycle = { kind: 'loading' };
    this.doc?.destroy();
    this.doc = null;
    const doc = new Y.Doc();
    let result;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (error) {
      result = { ok: false as const, reason: 'sql-error' as const, error: String(error) };
    }
    if (!result.ok) {
      console.error(JSON.stringify({ event: 'board-room.load-failed', reason: result.reason, error: result.error }));
      doc.destroy();
      this.transition({ type: 'load-failed', at: Date.now() });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.transition({ type: 'loaded', quarantined: result.quarantined });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: HTTP_UPGRADE_REQUIRED });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    // A failed room retries loading on a new connection (rate-limited by the state machine).
    if (this.lifecycle.kind === 'load-failed' || this.lifecycle.kind === 'storage-failed') {
      if (this.transition({ type: 'connection', at: Date.now() }).kind === 'loading') this.load();
    }
    if (this.doc === null) {
      closeQuietly(server, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
    } else {
      // Our state vector first: a client that has content we lack (e.g. changes the room
      // failed to save) answers with SyncStep2 and the room stores it.
      const doc = this.doc;
      this.send(
        server,
        frame((e) => {
          encoding.writeVarUint(e, MESSAGE_SYNC);
          syncProtocol.writeSyncStep1(e, doc);
        }),
      );
    }
    return new Response(null, { status: HTTP_SWITCHING_PROTOCOLS, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.lifecycle.kind === 'storage-failed') {
      closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
      return;
    }
    if (this.lifecycle.kind === 'load-failed' || this.doc === null) {
      closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return;
    }
    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, sender included: the renewals keep idle clients'
        // no-message watchdog satisfied. Interpreting awareness is story 6.
        this.broadcast(new Uint8Array(message as ArrayBuffer), null);
        return;
      case 'query-awareness':
        return;
      case 'sync':
        this.onSync(ws, this.doc, decoded.payload);
        return;
    }
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Complete the closing handshake; nothing else to clean up (getWebSockets drops it).
    closeQuietly(ws, 1000, 'Closed');
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    closeQuietly(ws, 1000, 'Error');
  }

  private onSync(ws: WebSocket, doc: Y.Doc, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const syncType = decoding.readVarUint(decoder);
    // Handled directly rather than via readSyncMessage, which swallows update errors: a
    // malformed state vector or update closes the offending socket and nothing is stored.
    try {
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncStep1(decoder, reply, doc);
        if (encoding.length(reply) > EMPTY_REPLY_LENGTH) this.send(ws, encoding.toUint8Array(reply));
        return;
      }
      // SyncStep2 or update: applied first (validation), stored and broadcast by onDocUpdate.
      applyCheckedUpdate(doc, decoding.readVarUint8Array(decoder), ws);
    } catch {
      this.reject(ws);
    }
  }

  /** Every applied update: store, then broadcast to everyone but its sender, then compact. */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      if (update.byteLength > SNAPSHOT_CHUNK_BYTES) {
        // Too big for one log row: save it by compacting (the snapshot is chunked).
        if (!this.store.compact(doc)) throw new Error('oversized update could not be saved');
      } else {
        this.store.append(update);
      }
    } catch (error) {
      this.failStorage(error);
      return;
    }
    this.transition({ type: 'update-stored' });
    const message = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, update);
    });
    this.broadcast(message, origin instanceof WebSocket ? origin : null);
    this.transition({ type: 'compaction-started' });
    const compacted = this.store.compactIfNeeded(doc);
    this.transition({ type: compacted ? 'compaction-committed' : 'compaction-rolled-back' });
  }

  /** Ready → StorageFailed: nothing is broadcast; every socket closes; the doc is discarded. */
  private failStorage(error: unknown): void {
    console.error(JSON.stringify({ event: 'board-room.append-failed', error: String(error) }));
    this.transition({ type: 'append-failed' });
    const doc = this.doc;
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
    // Destroyed after the current applyUpdate has finished using it.
    queueMicrotask(() => doc?.destroy());
  }

  /** Closes one misbehaving socket; everyone else is unaffected. */
  private reject(ws: WebSocket): void {
    closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
  }

  private broadcast(message: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.send(ws, message);
    }
  }

  /** A socket whose send throws is dead; the runtime removes it from getWebSockets. */
  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      // Closed.
    }
  }

  // ---- Test hooks (used only when env.TEST_HOOKS === '1'; see test-hooks.ts) ----

  /** Forces compaction of the current board. */
  testCompact(): boolean {
    this.assertTestHooks();
    return this.doc !== null && this.store.compact(this.doc);
  }

  /** Saves snapshot chunk 0, overwrites it with damaged bytes and reloads (→ LoadFailed). */
  testCorruptSnapshot(): RoomState {
    this.assertTestHooks();
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('INSERT OR REPLACE INTO test_saved_chunks (idx, data) SELECT idx, data FROM snapshot_chunks WHERE idx = 0');
    sql.exec('UPDATE snapshot_chunks SET data = substr(data, 1, length(data) / 2) WHERE idx = 0');
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Reloading');
    this.load();
    return this.state;
  }

  /** Restores the chunk saved by testCorruptSnapshot. The room reloads on a later connection. */
  testRepairSnapshot(): void {
    this.assertTestHooks();
    const sql = this.ctx.storage.sql;
    sql.exec('UPDATE snapshot_chunks SET data = (SELECT data FROM test_saved_chunks WHERE idx = 0) WHERE idx = 0');
    sql.exec('DROP TABLE IF EXISTS test_saved_chunks');
  }

  private assertTestHooks(): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks are disabled');
  }
}
