/**
 * BoardRoom Durable Object: a Y.Doc backed by SQLite storage.
 *
 * Every update is written before it is broadcast, the log is compacted into a
 * chunked snapshot, and the object reloads its state when it wakes. Sockets use
 * the WebSocket hibernation API, so an idle board costs no compute.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { createSticky, getStickyText, initDoc } from '../shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS, STICKY_COLORS, type StickyColor } from '../shared/config';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, shouldCompact, type LoadResult } from './board-store';
import { nextRoomState, type RoomLifecycleState } from './room-state';
import { matchTestHook, runTestHook, undecodableBytes, phraseFor, type TestHookTarget } from './test-hooks';
import type { Env } from './index';

export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject<Env> implements TestHookTarget {
  /**
   * Room storage. Public so tests can wrap a single method to inject a failure
   * (design: "Storage failures: injected by wrapping BoardStore methods").
   */
  store: BoardStore;
  private doc: Y.Doc;
  private state: RoomState = 'load-failed';
  /** When the last load attempt failed, for the LOAD_RETRY_MIN_INTERVAL_MS gate. */
  private lastLoadFailureAt = 0;
  /** Updates received while the doc was still loading, applied once ready. */
  private pending: Uint8Array[] = [];
  private lifecycle: RoomLifecycleState = 'loading';

  /** Whether tables have been created (migrate called). */
  private migrated = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = this.createStore();
    this.doc = new Y.Doc();
    // The document is only usable once the stored state has been applied: no
    // event (message, connection) runs before the load finishes.
    this.ctx.blockConcurrencyWhile(() => this.load());
  }

  /** Overridable seam: tests substitute a store whose statements fail. */
  protected createStore(): BoardStore {
    return new BoardStore(this.ctx.storage);
  }

  /**
   * Re-run the load a waking connection performs. Used by tests that damage or
   * repair storage after the object was constructed; a client reaching the room
   * performs the same transition through `fetch`.
   */
  async reload(): Promise<RoomState> {
    await this.load();
    return this.state;
  }

  // ---------------------------------------------------------------- lifecycle

  private transition(event: Parameters<typeof nextRoomState>[1]): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  private async load(): Promise<void> {
    this.transition({ type: 'wake' });
    const doc = new Y.Doc();
    initDoc(doc);
    const result = this.readInto(doc);
    if (result.ok) {
      this.attachDoc(doc);
      this.state = 'ready';
      this.transition({ type: 'load-ok' });
      if (result.quarantined > 0) {
        this.log({ event: 'board_loaded', quarantined: result.quarantined });
      }
      const queued = this.pending;
      this.pending = [];
      for (const update of queued) this.applyRemote(update, null);
    } else {
      this.state = 'load-failed';
      this.lastLoadFailureAt = Date.now();
      this.transition({ type: 'load-failed' });
      this.log({ event: 'board_load_failed', reason: result.reason, error: result.error });
    }
  }

  /** Load, converting a thrown store error into the same failure result. */
  private readInto(doc: Y.Doc): LoadResult {
    try {
      return this.store.load(doc);
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorMessage(e) };
    }
  }

  private attachDoc(doc: Y.Doc): void {
    if (this.doc !== doc) {
      this.doc.destroy();
      this.doc = doc;
    }
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // State read from storage must not be written back or echoed.
      if (origin === LOAD_ORIGIN) return;
      // Updates applied while loading are handled when the load finishes.
      if (this.state !== 'ready') return;
      this.persist(update, origin);
    });
  }

  // ---------------------------------------------------------------- RPC methods

  /**
   * Initialize this board: create tables and set created_at if absent.
   * Returns 'created' on first call, 'exists' on subsequent calls.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    this.migrated = true;
    const existing = this.store.metaValue('created_at');
    if (existing !== undefined) {
      return 'exists';
    }
    // Set created_at via direct SQL (not in the public store API)
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('created_at', ?)",
      String(Date.now()),
    );
    // Reload state after migration
    await this.load();
    return 'created';
  }

  /**
   * Check if this board exists (read-only, no writes).
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** Write first, broadcast second; a failed write resets the room. */
  private persist(update: Uint8Array, origin: unknown): void {
    try {
      // Ensure tables exist before first write (lazy migrate for legacy boards)
      if (!this.migrated) {
        this.store.migrate();
        this.migrated = true;
      }
      this.store.append(update);
    } catch (e) {
      this.storageFailed(e);
      return;
    }
    this.broadcastUpdate(update, origin);
    // Compaction is synchronous and cheap to check: the thresholds are compared
    // against counters kept in memory, no COUNT(*) per write.
    const stats = this.store.stats;
    if (shouldCompact(stats.count, stats.bytes)) {
      this.transition({ type: 'compact-start' });
      const compacted = this.store.compactIfNeeded(this.doc);
      this.transition({ type: compacted ? 'compact-done' : 'compact-failed' });
    }
  }

  private storageFailed(err: unknown): void {
    this.state = 'storage-failed';
    this.transition({ type: 'storage-error' });
    this.log({ event: 'storage_failed', error: errorMessage(err) });
    // The in-memory doc no longer matches storage: drop it and let the next
    // connection reload. Clients re-send what the server lacks on reconnect.
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.closeAll(CLOSE_STORAGE_FAILURE, 'storage failure');
  }

  // -------------------------------------------------------------- connections

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.env.TEST_HOOKS === '1') {
      // Local-only test routes; the worker router checks the same flag.
      const route = matchTestHook(url.pathname, url.searchParams);
      if (route !== null) return runTestHook(this, route);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Reject WebSocket upgrades for boards that don't exist
    if (!this.store.existsReadOnly()) {
      return new Response('Not found', { status: 404 });
    }

    if (this.state === 'storage-failed') {
      // Sockets were closed and the doc discarded: reload for this connection.
      this.transition({ type: 'reconnect' });
      await this.load();
    } else if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.lastLoadFailureAt;
      this.transition({ type: 'connect-after-load-failure', elapsedMs: elapsed });
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        this.log({ event: 'board_load_retry', elapsedMs: elapsed });
        await this.load();
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernating accept: the object may go idle with sockets still open.
    this.ctx.acceptWebSocket(server);

    if (this.state !== 'ready') {
      // load-failed: honest failure, no empty board served.
      server.close(
        this.state === 'load-failed' ? CLOSE_BOARD_LOAD_FAILED : CLOSE_STORAGE_FAILURE,
        this.state === 'load-failed' ? 'board could not be loaded' : 'storage failure',
      );
      return new Response(null, { status: 101, webSocket: client });
    }

    this.sendSyncStep1(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendSyncStep1(ws: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    try {
      ws.send(encoding.toUint8Array(encoder));
    } catch {
      // Socket already gone; the runtime will drop it.
    }
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      // Never apply or store anything from an unloaded board.
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.state === 'storage-failed') {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        // Applying may raise an update event, which stores and broadcasts.
        this.applyRemote(decoded.payload, ws);
      } catch (e) {
        // Malformed sync content: rejected, nothing stored (story 3 behaviour).
        this.log({ event: 'invalid_sync', error: errorMessage(e) });
        this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload, ws);
      return;
    }
    // query-awareness: no stored awareness in this story, ignore.
  }

  /** Apply a client message through the y-protocols sync engine. */
  private applyRemote(payload: Uint8Array, ws: WebSocket | null): void {
    if (this.state !== 'ready') {
      // Loading: keep it, the state will be applied once the doc is ready.
      this.pending.push(payload);
      return;
    }
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    // y-protocols swallows apply errors (they also cover errors thrown by this
    // room's update handler); capture it so a bad update can be rejected.
    let applyError: string | null = null;
    syncProtocol.readSyncMessage(
      decoding.createDecoder(payload),
      reply,
      this.doc,
      ws,
      (error: Error) => {
        applyError = error.message;
      },
    );
    if (applyError !== null) {
      if (this.state === 'ready') {
        // Nothing was stored: the update never made it into the doc.
        this.log({ event: 'invalid_update', error: applyError });
        this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'update could not be applied');
      }
      return;
    }
    const frame = encoding.toUint8Array(reply);
    // Only send if there is content beyond the type byte.
    if (frame.byteLength > 1 && ws !== null) {
      try {
        ws.send(frame);
      } catch {
        // Socket gone: nothing to deliver.
      }
    }
  }

  private relayAwareness(payload: Uint8Array, _from: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    // Relayed verbatim to every socket, sender included (story 3 behaviour).
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(frame);
      } catch {
        // Closed sockets are removed by the runtime.
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) {
      // Do not echo an update back to the socket it came from.
      if (socket === origin) continue;
      try {
        socket.send(frame);
      } catch {
        // Ignore: a hibernated socket's close is handled by the runtime.
      }
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Nothing tracks sockets; hibernation owns them. With nobody watching, fold
    // the log so the next wake reads a snapshot instead of replaying it.
    const stats = this.store.stats;
    if (this.state === 'ready' && this.ctx.getWebSockets().length === 0 && shouldCompact(stats.count, stats.bytes)) {
      this.transition({ type: 'compact-start' });
      const compacted = this.store.compactIfNeeded(this.doc);
      this.transition({ type: compacted ? 'compact-done' : 'compact-failed' });
      if (compacted) this.log({ event: 'compacted_on_idle', ...stats });
    }
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // The socket is dropped by the runtime; storage is unaffected.
  }

  private closeAll(code: number, reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, code, reason);
    }
  }

  private closeSocket(ws: WebSocket | null, code: number, reason: string): void {
    if (ws === null) return;
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  // ------------------------------------------------------------- test hooks
  //
  // Reached only through /__test/boards/:id/<action>, which exists only when
  // TEST_HOOKS=1 (never set in wrangler.jsonc). They put storage into states no
  // user interaction produces: a big seeded board, a compacted log, an
  // unreadable snapshot, and its repair.

  /** Append `count` notes through the normal write path, then compact. */
  testSeed(count: number): { notes: number; updates: number; snapshotChunks: number } {
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    this.doc.transact(() => {
      for (let i = 0; i < count; i++) {
        const column = i % 8;
        const row = Math.floor(i / 8);
        const id = createSticky(
          this.doc,
          { x: column * 260 - 130, y: row * 250 - 130 },
          colors[i % colors.length],
        );
        getStickyText(this.doc, id)?.insert(0, phraseFor(i));
      }
    });
    this.store.compact(this.doc);
    return {
      notes: count,
      updates: this.store.updateRowCount(),
      snapshotChunks: this.store.snapshotRowCount(),
    };
  }

  testCompact(): { snapshotChunks: number } {
    this.store.compact(this.doc);
    return { snapshotChunks: this.store.snapshotRowCount() };
  }

  /**
   * Overwrite every snapshot chunk with bytes that will not decode, keeping a
   * backup so `testRepairSnapshot` can put them back. Then re-run the load, so
   * the room is in the state a woken object would find itself in.
   */
  testCorruptSnapshot(): { chunks: number } {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS test_snapshot_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    sql.exec('DELETE FROM test_snapshot_backup');
    const rows = sql.exec('SELECT idx, data FROM snapshot_chunks').toArray();
    for (const row of rows) {
      const data = toBytes(row.data);
      sql.exec(
        'INSERT INTO test_snapshot_backup (idx, data) VALUES (?, ?)',
        Number(row.idx),
        toArrayBuffer(data),
      );
      sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
        toArrayBuffer(undecodableBytes(data)),
        Number(row.idx),
      );
    }
    // The live doc is now known to be out of reach of storage: reload, which
    // fails, so new connections are refused with 4500 exactly as after a wake.
    void this.load();
    return { chunks: rows.length };
  }

  /** Restore the original chunk bytes and allow an immediate load retry. */
  testRepairSnapshot(): { chunks: number } {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec('SELECT idx, data FROM test_snapshot_backup').toArray();
    for (const row of rows) {
      sql.exec(
        'INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        Number(row.idx),
        toArrayBuffer(toBytes(row.data)),
      );
    }
    sql.exec('DELETE FROM test_snapshot_backup');
    this.lastLoadFailureAt = 0;
    return { chunks: rows.length };
  }

  testStats(): Record<string, unknown> {
    return {
      state: this.state,
      lifecycle: this.lifecycle,
      updates: this.store.updateRowCount(),
      snapshotChunks: this.store.snapshotRowCount(),
      quarantined: this.store.quarantinedRowCount(),
      notes: this.state === 'ready' ? this.doc.getMap('objects').size : 0,
      sockets: this.ctx.getWebSockets().length,
    };
  }

  private log(fields: Record<string, unknown>): void {
    console.error(JSON.stringify({ room: 'board', ...fields }));
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** BLOB columns arrive as ArrayBuffer or Uint8Array depending on the host. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

/** BLOB bindings are typed as ArrayBuffer. */
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}
