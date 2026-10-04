/**
 * BoardRoom Durable Object (story 4): persistent, hibernating board room.
 *
 * The board's Y.Doc is reconstructed from SQLite on every wake (construct).
 * Every client update is stored (append) *before* it is broadcast, so a change
 * is durable by the time any peer observes it. The room uses the Durable Object
 * hibernation API: sockets are accepted with ctx.acceptWebSocket and reached
 * through ctx.getWebSockets(); message handling lives in the webSocketMessage
 * DO method so the object can sleep and be woken by a message.
 *
 * Room lifecycle (see room-state.ts):
 *   loading → ready | load-failed
 *   ready   → (update: store-then-broadcast) | compacting → ready
 *   ready   → storage-failed (append throws; all sockets closed 1011, doc discarded)
 *   load-failed → loading (new connection after LOAD_RETRY_MIN_INTERVAL_MS)
 *   storage-failed / hibernated → loading (next connection wakes + reloads)
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { initDoc } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN, createBoardStore, chunkBytes } from './board-store';
import { nextRoomState, type RoomState } from './room-state';

export class BoardRoom extends DurableObject {
  private doc: Y.Doc | null = null;
  private readonly store: BoardStore;
  private state: RoomState = { name: 'loading' };

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.store = createBoardStore(ctx.storage);
    // Load on wake: reconstruct the doc from storage before serving anyone.
    // Note: migrate() is NOT called here; it runs in initialize() or lazily
    // before the first append(). load() treats missing tables as an empty board.
    this.doLoad();
  }

  /**
   * RPC: initialise a new board. Creates tables (if absent) and sets
   * storage_meta.created_at. Returns 'created' on first call, 'exists' if
   * the board was already initialised.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    // Check if created_at already exists
    const row = this.ctx.storage.sql
      .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
      .next();
    if (!row.done) {
      return 'exists';
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)",
      String(Date.now()),
    );
    return 'created';
  }

  /**
   * RPC: read-only existence check. True if the board has created_at or
   * (legacy) any updates/snapshot_chunks rows.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get('upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      // Health probe / non-WS: report the room state.
      return new Response(
        JSON.stringify({ state: this.state.name }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    // Reject non-existent boards before accepting (share.not_found).
    // A board exists if it has created_at or (legacy) any data rows.
    if (!this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }

    // A connection wakes a storage-failed or hibernated room: reload first.
    if (this.state.name === 'storage-failed' || this.state.name === 'hibernated') {
      this.state = nextRoomState(this.state, { type: 'wake' });
      this.doLoad();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Load-failed: retry the load only once the minimum interval has elapsed.
    if (this.state.name === 'load-failed') {
      const next = nextRoomState(this.state, { type: 'connection', nowMs: Date.now() });
      if (next.name !== 'load-failed') {
        this.state = next;
        this.doLoad();
      }
      if (this.state.name === 'load-failed') {
        // Still failing: accept the socket, then close it with the load-failed
        // code. The close is sent both here (deferred, works in-process) and
        // from webSocketMessage (works in `wrangler dev` when the client sends
        // its first sync frame). Whichever arrives first wins; the second is a
        // no-op on an already-closed socket.
        this.ctx.acceptWebSocket(server);
        setTimeout(() => {
          try { server.close(CLOSE_BOARD_LOAD_FAILED); } catch { /* already closed */ }
        }, 0);
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Ready: accept the socket and send the initial sync.
    this.ctx.acceptWebSocket(server);
    this.sendInitialSync(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Woken by an incoming message on an accepted socket. */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // State gates first: a room that cannot serve closes the socket.
    if (this.state.name === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state.name === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    if (!this.doc) return;

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (decoded.kind === 'sync') {
      this.handleSync(ws, decoded.payload);
    } else if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
    }
    // query-awareness: ignored (no stored awareness in this story)
  }

  webSocketClose(_ws: WebSocket): void {
    // Sockets are tracked by the runtime (ctx.getWebSockets); nothing to clean up.
  }

  webSocketError(_ws: WebSocket): void {
    // Nothing to clean up.
  }

  /**
   * Test-only: force a reload from storage now (consumes any armed test fault
   * and transitions the room state). Lets tests arm a fault / corrupt a
   * snapshot after construction and observe the resulting load outcome.
   */
  testReload(): void {
    this.doLoad();
  }

  /**
   * Test-only: corrupt the board's snapshot so the next load fails with
   * `snapshot-unreadable`. Materialises a snapshot from the current doc (a
   * young board may only have log rows), backs it up (so
   * {@link repairSnapshotForTest} can restore it), overwrites it with bytes
   * Yjs cannot apply, and forces the room to reload on the next connection.
   * Only reachable through the TEST_HOOKS endpoint (never enabled in
   * production config).
   */
  corruptSnapshotForTest(): void {
    const sql = this.ctx.storage.sql;
    // 1. Materialise a snapshot from the current doc (a young board may only
    //    have log rows) and point snapshot_through_seq at it so the next load
    //    uses the snapshot (not the intact log rows).
    if (this.doc) {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(this.doc));
      sql.exec('DELETE FROM snapshot_chunks');
      chunks.forEach((chunk, idx) => {
        sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
      });
      const maxSeq = (sql.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one() as { m: number }).m;
      sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', 'snapshot_through_seq', String(maxSeq));
    }
    // 2. Back up the snapshot (so repairSnapshotForTest can restore it).
    sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot_backup_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    sql.exec('DELETE FROM snapshot_backup_chunks');
    const rows = sql
      .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
      .toArray() as Array<{ idx: number; data: ArrayBuffer }>;
    for (const row of rows) {
      sql.exec('INSERT INTO snapshot_backup_chunks (idx, data) VALUES (?, ?)', row.idx, row.data);
    }
    // 3. Overwrite the snapshot with bytes Yjs cannot apply.
    sql.exec('DELETE FROM snapshot_chunks');
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);
    sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, garbage);
    // 4. Force a reload on the next connection so the room hits the corrupted
    //    snapshot and goes LoadFailed.
    this.state = { name: 'storage-failed' };
    this.doc = null;
  }

  /**
   * Test-only: seed a legacy board with updates rows but no created_at.
   * This simulates a board that existed before the initialize() RPC was added.
   * Does NOT call doLoad() so the data stays in the updates table.
   */
  async seedLegacyForTest(data: ArrayBuffer): Promise<void> {
    // Create tables (as a legacy board would have them) but do NOT set created_at
    this.store.migrate();
    // Remove created_at if it was set (ensure legacy state)
    this.ctx.storage.sql.exec("DELETE FROM storage_meta WHERE key = 'created_at'");
    // Insert the update data as a log row
    const bytes = new Uint8Array(data);
    this.ctx.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      bytes,
      bytes.length,
    );
  }

  /**
   * Test-only: restore the snapshot from the backup made by
   * {@link corruptSnapshotForTest} so the next load succeeds.
   */
  repairSnapshotForTest(): void {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM snapshot_chunks');
    const rows = sql
      .exec('SELECT idx, data FROM snapshot_backup_chunks ORDER BY idx')
      .toArray() as Array<{ idx: number; data: ArrayBuffer }>;
    for (const row of rows) {
      sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', row.idx, row.data);
    }
    sql.exec('DELETE FROM snapshot_backup_chunks');
    // NOTE: snapshot_through_seq is left at the value set by
    // corruptSnapshotForTest (the max seq at corruption time). The restored
    // snapshot is the source of truth for the next load; the log rows after
    // that point (if any) are applied on top.
    // Reload the doc from the restored snapshot.
    this.state = { name: 'loading' };
    this.doc = null;
    this.doLoad();
  }

  /** Reconstruct the doc from storage and transition the room state. */
  private doLoad(): void {
    this.state = { name: 'loading' };
    const doc = new Y.Doc();
    initDoc(doc);
    this.doc = doc;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.handleDocUpdate(update, origin);
    });
    // NOTE: migrate() is NOT called here. It runs in initialize() or lazily
    // before the first append(). load() treats missing tables as an empty board.
    const result = this.store.load(doc);
    if (result.ok) {
      this.state = nextRoomState(this.state, {
        type: 'load-success',
        quarantined: result.quarantined,
      });
      if (result.quarantined > 0) {
        console.error(
          JSON.stringify({
            event: 'board-load-quarantined',
            boardId: this.ctx.id,
            quarantined: result.quarantined,
          }),
        );
      }
    } else {
      console.error(
        JSON.stringify({
          event: 'board-load-failed',
          boardId: this.ctx.id,
          reason: result.reason,
          error: result.error,
        }),
      );
      this.state = nextRoomState(this.state, { type: 'load-failed', atMs: Date.now() });
      this.doc = null;
    }
  }

  /**
   * A client's update landed in the doc. Persist it first; only then broadcast.
   * A storage failure resets the room (close all 1011, discard the doc) so the
   * next connection reloads and clients re-send their unsaved changes.
   */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return; // updates applied during load are never stored/broadcast

    try {
      this.store.append(update);
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'board-storage-failed',
          boardId: this.ctx.id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      this.state = nextRoomState(this.state, { type: 'storage-failed' });
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.close(CLOSE_STORAGE_FAILURE);
        } catch {
          /* already closed */
        }
      }
      this.doc = null;
      return;
    }

    this.state = nextRoomState(this.state, { type: 'update' });
    this.broadcast(update, origin);

    if (this.doc) {
      this.state = nextRoomState(this.state, { type: 'compact-start' });
      const compacted = this.store.compactIfNeeded(this.doc);
      this.state = nextRoomState(this.state, {
        type: compacted ? 'compact-success' : 'compact-failed',
      });
    }
  }

  /** Apply an inbound sync message to the doc (origin = the sending socket). */
  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.doc;
    if (!doc) return;
    const decoder = createDecoder(payload);
    const encoder = createEncoder();
    try {
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      const response = toUint8Array(encoder);
      if (response.length > 0) {
        ws.send(this.frameMessage(MESSAGE_SYNC, response));
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  /** Relay awareness bytes verbatim to every socket (keeps clients alive). */
  private relayAwareness(payload: Uint8Array): void {
    const frame = this.frameMessage(MESSAGE_AWARENESS, payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(frame);
      } catch {
        /* drop dead socket */
      }
    }
  }

  /** Broadcast a stored update to every socket except the origin. */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frame = this.frameMessage(MESSAGE_SYNC, toUint8Array(encoder));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue; // sender gets no echo
      try {
        socket.send(frame);
      } catch {
        /* drop dead socket */
      }
    }
  }

  /** Send a new socket the current state (SyncStep1 + full state as update). */
  private sendInitialSync(ws: WebSocket): void {
    const doc = this.doc;
    if (!doc) return;
    const encoder = createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(this.frameMessage(MESSAGE_SYNC, toUint8Array(encoder)));

    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > 0) {
      const updateEnc = createEncoder();
      syncProtocol.writeUpdate(updateEnc, state);
      ws.send(this.frameMessage(MESSAGE_SYNC, toUint8Array(updateEnc)));
    }
  }

  private frameMessage(type: number, payload: Uint8Array): ArrayBuffer {
    const encoder = createEncoder();
    writeUint8(encoder, type);
    if (payload.length > 0) {
      writeUint8Array(encoder, payload);
    }
    return toUint8Array(encoder).slice().buffer as ArrayBuffer;
  }
}
