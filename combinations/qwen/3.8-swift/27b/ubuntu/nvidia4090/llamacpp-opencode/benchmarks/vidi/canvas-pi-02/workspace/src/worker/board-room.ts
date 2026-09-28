// BoardRoom Durable Object (story 4, persist.room): one instance per board
// id. Loads the board from its SQLite-backed storage on construct/wake,
// stores every applied update BEFORE broadcasting it (the platform's output
// gate holds sends until the write is durable), and hibernates when idle so
// an idle board costs no compute — only storage.
//
// Lifecycle (see room-state.ts for the pure transition function):
//   Loading → Ready | LoadFailed        (construct or wake)
//   Ready → Ready (update: apply → append → broadcast → compact-if-needed)
//   Ready → Compacting → Ready          (compaction, rolled back on error)
//   Ready → StorageFailed → Loading     (insert threw: close 1011, discard
//                                        doc; the next connection reloads)
//   Ready → Hibernated → Loading        (runtime freeze; sockets may stay
//                                        open and are served on wake)
//   LoadFailed → Loading                (new connection after
//                                        LOAD_RETRY_MIN_INTERVAL_MS; earlier
//                                        connections are closed 4500)
//
// Failure semantics:
// - An update is applied to the in-memory doc first (Yjs rejects garbage, so
//   nothing undecodable is ever stored); a rejected update closes only that
//   socket with 1003.
// - A failed append closes EVERY socket with CLOSE_STORAGE_FAILURE and
//   discards the doc: no change is broadcast as if saved, and reconnecting
//   clients re-send what the server lacks (story 3 SyncStep1/2 exchange), so
//   open pages retry their unsaved changes (persist.save_failure).
// - A board that cannot be loaded (damaged snapshot, SQL read error) is
//   never served as an empty board: new connections are accepted and closed
//   with CLOSE_BOARD_LOAD_FAILED, and loading is retried on a later
//   connection once LOAD_RETRY_MIN_INTERVAL_MS has elapsed (persist
//   .load_failure).
//
// Awareness is relayed verbatim to all open sockets INCLUDING the sender:
// the y-websocket client closes a connection that receives no message within
// its 30 s timeout, and clients renew awareness periodically (~15 s), so the
// relay keeps idle clients alive. Interpreting awareness is story 6.

import { DurableObject } from 'cloudflare:workers';
import {
  createEncoder,
  toUint8Array,
  writeUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { createDecoder, readVarUint } from 'lib0/decoding';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../shared/protocol';
import { KEEP_ALIVE_INTERVAL_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { snapshot, type StickySnapshot } from '../shared/board-model';
import { BoardStore } from './board-store';
import { nextRoomState, type RoomLifecycleState } from './room-state';

/** A valid, no-op frame: type 1 (awareness) with an empty varBytes payload.
 *  The client applies it as an empty awareness update (no state change), and
 *  receiving it refreshes its no-message watchdog. */
const KEEP_ALIVE_FRAME: Uint8Array = (() => {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_AWARENESS);
  writeVarUint8Array(frame, new Uint8Array(0));
  return toUint8Array(frame);
})();

export default class BoardRoom extends DurableObject {
  private store: BoardStore;
  private lifecycle: RoomLifecycleState = 'loading';
  private doc: Y.Doc | null = null;
  /** Epoch ms of the last load attempt for a load-failed room (null when
   *  not load-failed). */
  private loadFailedAt: number | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  /** Test seam: controllable clock offset for the load-retry interval. */
  private nowOffsetMs = 0;
  /** Test seam: original snapshot chunk 0 while it is corrupted. */
  private testOriginalChunk0: Uint8Array | null = null;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Load inside blockConcurrencyWhile: the first connection (or the wake
    // message) waits for the board to be readable before being served.
    ctx.blockConcurrencyWhile(() => {
      this.store.migrate();
      this.loadDoc();
      return Promise.resolve();
    });
  }

  private now(): number {
    return Date.now() + this.nowOffsetMs;
  }

  /** (Re)loads the doc from storage. Expects lifecycle 'loading'. */
  private loadDoc(): void {
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    if (result.ok) {
      this.lifecycle = nextRoomState('loading', 'load-ok');
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.onDocUpdate(update, origin === undefined ? undefined : (origin as WebSocket));
      });
      this.doc = doc;
      this.loadFailedAt = null;
      if (result.quarantined > 0) {
        console.error({ event: 'board-room-load-quarantined', quarantined: result.quarantined });
      }
    } else {
      this.lifecycle = nextRoomState('loading', 'load-failed');
      this.doc = null;
      this.loadFailedAt = this.now();
      console.error({
        event: 'board-room-load-failed',
        reason: result.reason,
        error: result.error,
      });
    }
  }

  /** A hibernated object wakes by forgetting its memory and reloading;
   *  sockets accepted before the freeze are served by ctx.getWebSockets(). */
  private wakeIfHibernated(): void {
    if (this.lifecycle === 'hibernated') {
      this.lifecycle = nextRoomState('hibernated', 'wake');
      this.loadDoc();
    }
  }

  /** Guarantees a doc before serving: wakes a hibernated object, and reloads
   *  after a storage-failed reset (doc discarded). */
  private ensureLoaded(): void {
    this.wakeIfHibernated();
    if (this.doc === null && this.lifecycle === 'storage-failed') {
      this.lifecycle = nextRoomState('storage-failed', 'doc-discarded');
      this.loadDoc();
    }
  }

  fetch(req: Request): Promise<Response> {
    if (!req.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
      return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
    }
    this.ensureLoaded();
    if (this.lifecycle === 'load-failed') {
      // Retry loading at most every LOAD_RETRY_MIN_INTERVAL_MS; before the
      // interval the connection is accepted and closed 4500.
      const elapsed = this.now() - (this.loadFailedAt ?? 0);
      const next = nextRoomState('load-failed', {
        kind: 'connection',
        elapsedMs: elapsed,
        minIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
      });
      if (next === 'loading') {
        this.lifecycle = next;
        this.loadDoc();
      }
      if (this.lifecycle === 'load-failed') {
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return Promise.resolve(new Response(null, { status: 101, webSocket: pair[0] }));
      }
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.ensureKeepAlive();
    // Send our own SyncStep1: a joining client answers with SyncStep2
    // (everything the room lacks) and receives the whole board as SyncStep2
    // in the reply.
    const step1 = createEncoder();
    sync.writeSyncStep1(step1, this.doc!);
    server.send(syncFrame(toUint8Array(step1)));
    return Promise.resolve(new Response(null, { status: 101, webSocket: pair[0] }));
  }

  /** DO lifecycle hook: every message from a connected socket. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.ensureLoaded();
    if (this.lifecycle === 'load-failed') {
      // A LoadFailed room neither serves an empty doc nor stores updates.
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.lifecycle === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // no stored awareness in this story
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, sender included (see above).
      this.sendToAll(awarenessFrame(decoded.payload));
      return;
    }
    this.handleSyncMessage(ws, decoded.payload);
  }

  webSocketClose(_ws: WebSocket): void {
    if (this.ctx.getWebSockets().length === 0 && this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  webSocketError(_ws: WebSocket): void {
    // The runtime drops the socket from ctx.getWebSockets(); nothing to track.
  }

  /** Pings every open socket on a timer so the y-websocket 30 s no-message
   *  watchdog never drops an idle connection (a send to the socket that just
   *  sent us a message is not reliably delivered in workerd, so the awareness
   *  relay to the sender cannot be relied on; this timer is independent of
   *  message handling). With no open sockets the timer stops and the object
   *  may hibernate. */
  private ensureKeepAlive(): void {
    if (this.keepAliveTimer !== undefined) return;
    this.keepAliveTimer = setInterval(() => {
      this.sendToAll(KEEP_ALIVE_FRAME);
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  /** A doc update: store first (the platform's output gate holds the
   *  broadcast until the write is durable), then broadcast to everyone but
   *  the origin socket, then compact if the log grew past a threshold.
   *  Updates applied during load (LOAD_ORIGIN) are neither stored nor
   *  broadcast. */
  private onDocUpdate(update: Uint8Array, origin: WebSocket | undefined): void {
    if (this.doc === null) return;
    try {
      this.store.append(update);
    } catch (err) {
      // Storage failure: nothing is broadcast as if saved, the doc is
      // discarded, and every socket is closed so clients reconnect and
      // re-send what the server lacks (persist.save_failure).
      console.error({ event: 'board-store-append-failed', error: String(err) });
      this.lifecycle = nextRoomState('ready', 'insert-threw');
      for (const socket of [...this.ctx.getWebSockets()]) {
        try {
          socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
        } catch {
          // socket already gone
        }
      }
      this.doc = null;
      return;
    }
    this.broadcast(update, origin);
    if (this.store.shouldCompactNow()) {
      this.lifecycle = nextRoomState('ready', 'compaction-start');
      const compacted = this.store.compactIfNeeded(this.doc);
      this.lifecycle = nextRoomState(
        'compacting',
        compacted ? 'compaction-done' : 'compaction-rolled-back',
      );
    }
  }

  /** Broadcasts a stored doc update to every open socket except `except`. */
  private broadcast(update: Uint8Array, except: WebSocket | undefined): void {
    const message = createEncoder();
    sync.writeUpdate(message, update);
    const frame = syncFrame(toUint8Array(message));
    for (const socket of [...this.ctx.getWebSockets()]) {
      if (socket === except) continue;
      this.sendOrDrop(socket, frame);
    }
  }

  private sendToAll(frame: Uint8Array): void {
    for (const socket of [...this.ctx.getWebSockets()]) {
      this.sendOrDrop(socket, frame);
    }
  }

  /** A send that throws drops the socket (the runtime then removes it from
   *  ctx.getWebSockets()). */
  private sendOrDrop(socket: WebSocket, frame: Uint8Array): void {
    try {
      socket.send(frame);
    } catch {
      // dropped
    }
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.doc;
    if (doc === null) return;
    const encoder = createEncoder();
    // Peeked inner sync message type (without consuming the payload) so we
    // can guarantee a reply to SyncStep1 (see below). Both the peek and the
    // read are guarded: a truncated/malformed frame must close only this
    // socket, never throw out of the lifecycle hook.
    let innerType = 0;
    let applyError: Error | null = null;
    try {
      innerType = readVarUint(createDecoder(payload));
      sync.readSyncMessage(
        createDecoder(payload),
        encoder,
        doc,
        ws,
        (err: Error) => {
          applyError = err;
        },
      );
    } catch {
      // Truncated or malformed sync frame: close only this socket.
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported sync data');
      return;
    }
    if (applyError !== null) {
      // An update Yjs rejects: close only this socket; nothing stored.
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported sync data');
      return;
    }
    const reply = toUint8Array(encoder);
    if (reply.length > 0) {
      ws.send(syncFrame(reply));
    } else if (innerType === sync.messageYjsSyncStep1) {
      // Guarantee a reply to every SyncStep1: an empty SyncStep2 lets the
      // y-websocket client flip to `synced` even when nothing is missing.
      const empty = createEncoder();
      sync.writeSyncStep2(empty, doc, new Uint8Array(0));
      ws.send(syncFrame(toUint8Array(empty)));
    }
  }

  /* --- Test-only seams (integration/e2e) ---
   * Plain values cross the DO stub boundary, so the seams expose results as
   * serialisable data; they are exercised by tests in the same isolate and
   * by the e2e /__test/ routes (env-gated). */

  /** Runs BoardStore.migrate on this room's storage. */
  testMigrate(): void {
    this.store.migrate();
  }

  /** Applies raw update bytes to the room's doc exactly as a client update
   *  would (store-before-broadcast, then threshold compaction). With no doc
   *  in memory (e.g. load-failed) the bytes go straight to the log. */
  testAppend(data: Uint8Array): void {
    if (this.doc === null) {
      this.store.append(data);
      return;
    }
    Y.applyUpdate(this.doc, data);
  }

  /** Loads a FRESH doc from this room's storage (the room's own doc is
   *  untouched) and returns the load result with the loaded snapshot. */
  testLoadSnapshot(): {
    ok: boolean;
    quarantined?: number;
    reason?: string;
    notes: StickySnapshot[];
  } {
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    const notes = snapshot(doc).map((n) => ({ ...n }));
    return result.ok
      ? { ok: true, quarantined: result.quarantined, notes }
      : { ok: false, reason: result.reason, notes };
  }

  /** Forces a compaction pass on the room's doc (bypassing the threshold),
   *  loading a doc from storage first if the room has none in memory. */
  testCompact(): boolean {
    let doc = this.doc;
    if (doc === null) {
      doc = new Y.Doc();
      this.store.load(doc);
    }
    return this.store.compact(doc);
  }

  /** Simulates hibernation: the room forgets its memory while its sockets
   *  stay open; the next fetch/message wakes it (reload from storage). */
  testHibernate(): void {
    if (this.lifecycle === 'ready') {
      this.lifecycle = nextRoomState('ready', 'hibernate');
      this.doc = null;
    }
  }

  /** Current lifecycle state and board size (for assertions). */
  testGetState(): { lifecycle: string; loadFailedAt: number | null; notes: number } {
    return {
      lifecycle: this.lifecycle,
      loadFailedAt: this.loadFailedAt,
      notes: this.doc === null ? 0 : snapshot(this.doc).length,
    };
  }

  /** Shifts the room's clock (load-retry interval tests). */
  testSetNowOffset(ms: number): void {
    this.nowOffsetMs = ms;
  }

  /** Test seam: replaces the data of one log row (corruption fixtures). */
  testOverwriteUpdateRow(seq: number, data: Uint8Array): number {
    const written = this.ctx.storage.sql
      .exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = ?', data, data.length, seq);
    return written.rowsWritten;
  }

  /** Test seam: raw row counts and metadata for storage assertions. */
  testInspectStorage(): {
    updates: number;
    updateBytes: number;
    snapshotChunks: number;
    quarantined: number;
    quarantinedSeq: number | null;
    quarantinedError: string | null;
    schemaVersion: string | null;
    throughSeq: number | null;
  } {
    const sql = this.ctx.storage.sql;
    const updates = oneRow(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates'));
    const latest = oneRow(sql.exec<{ bytes: number }>('SELECT bytes FROM updates ORDER BY seq DESC LIMIT 1'));
    const chunks = oneRow(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM snapshot_chunks'));
    const q = oneRow(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM quarantined_updates'));
    const qRow = oneRow(
      sql.exec<{ seq: number; error: string }>(
        'SELECT seq, error FROM quarantined_updates ORDER BY seq LIMIT 1',
      ),
    );
    const schema = oneRow(
      sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        'storage_schema_version',
      ),
    );
    const through = oneRow(
      sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        'snapshot_through_seq',
      ),
    );
    return {
      updates: updates === null ? 0 : updates.n,
      updateBytes: latest === null ? 0 : latest.bytes,
      snapshotChunks: chunks === null ? 0 : chunks.n,
      quarantined: q === null ? 0 : q.n,
      quarantinedSeq: qRow === null ? null : qRow.seq,
      quarantinedError: qRow === null ? null : qRow.error,
      schemaVersion: schema === null ? null : schema.value,
      throughSeq: through === null ? null : Number(through.value),
    };
  }

  /** Test hook (e2e): saves original chunk 0, overwrites it with a
   *  truncated copy, and forces the room to reload from storage on the next
   *  connection — a damaged snapshot with a "restarted" room. Returns the
   *  number of chunks found (0 when there is no snapshot to corrupt). */
  testCorruptSnapshot(): number {
    const sql = this.ctx.storage.sql;
    const row = oneRow(sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0'));
    if (row === null) return 0;
    const original = new Uint8Array(row.data);
    this.testOriginalChunk0 = original;
    const damaged = original.slice(0, Math.max(0, original.length - 10));
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged);
    // A restarted room reloads from storage: forget the in-memory doc.
    this.lifecycle = nextRoomState('ready', 'hibernate');
    this.doc = null;
    this.loadFailedAt = null;
    return 1;
  }

  /** Test hook (e2e): restores the saved chunk 0. */
  testRepairSnapshot(): number {
    if (this.testOriginalChunk0 === null) return 0;
    this.ctx.storage.sql.exec(
      'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
      this.testOriginalChunk0,
    );
    this.testOriginalChunk0 = null;
    return 1;
  }
}

export { BoardRoom };

/** `cursor.one()` (this workerd) throws when the query has no row. */
function oneRow<T extends Record<string, SqlStorageValue>>(cursor: SqlStorageCursor<T>): T | null {
  try {
    return cursor.one();
  } catch {
    return null;
  }
}

/** Frames a complete y-protocols sync message as a type-0 WebSocket frame.
 *  The inner sync message follows the type byte RAW (no varBytes wrapper),
 *  matching what the y-websocket provider sends and expects. */
function syncFrame(message: Uint8Array): Uint8Array {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_SYNC);
  writeUint8Array(frame, message);
  return toUint8Array(frame);
}

/** Frames an awareness update as a type-1 WebSocket frame. */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_AWARENESS);
  writeVarUint8Array(frame, payload);
  return toUint8Array(frame);
}

/**
 * Local dev only: miniflare's local workerd evicts idle DO instances and
 * re-keys the evicted instance's SQLite storage when it is woken, which
 * scatters a board's rows across files and loses state. Production workerd
 * does not evict, so this flag (consumed only by local miniflare/workerd)
 * keeps local e2e deterministic. It is a no-op in production.
 */
(BoardRoom as unknown as Record<string, unknown>).unsafePreventEviction = true;
