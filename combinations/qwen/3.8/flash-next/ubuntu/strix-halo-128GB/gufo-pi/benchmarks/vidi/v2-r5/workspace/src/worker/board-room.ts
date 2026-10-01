import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  wrapSyncMessage,
  encodeAwarenessMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { chunkBytes } from '../shared/persistence';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomState, type RoomEvent } from '../shared/room-state';
import type { Env } from './index';

/**
 * BoardRoom: one Durable Object instance per board.
 *
 * Persists every Yjs update to SQLite storage before broadcasting, reloads on wake,
 * uses WebSocket hibernation so idle boards consume no compute. Damaged updates are
 * quarantined; an unreadable snapshot puts the room into load-failed state.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private lastLoadFailedAt = 0;
  private loadPromise: Promise<void>;
  private savedChunk0: Uint8Array | null = null;
  private store: BoardStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(this.ctx.storage);
    this.loadPromise = this.ctx.blockConcurrencyWhile(async () => {
      this.performLoad();
    });
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  /** Returns current state without TypeScript narrowing. */
  private getState(): RoomState {
    return this.state as RoomState;
  }

  private performLoad(): void {
    // Set state directly to 'loading' — this is the entry point for all load paths
    this.state = 'loading';

    try {
      const store = this.store;
      // Do NOT call migrate() here; load() handles missing tables gracefully
      const doc = new Y.Doc();
      const result: LoadResult = store.load(doc);

      if (result.ok) {
        this.doc = doc;
        this.state = 'ready';

        // Set up update listener for persistence and broadcasting
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === LOAD_ORIGIN) return;

          // Try to store before broadcasting
          try {
            store.append(update);
          } catch (e) {
            // Storage failure: close all sockets, discard doc
            console.error(JSON.stringify({ event: 'storage_failure', error: String(e) }));
            this.transition('storage-error');
            this.discardDoc();
            this.closeAllSockets(CLOSE_STORAGE_FAILURE, 'storage failure');
            return;
          }

          // Broadcast to all sockets except the origin
          if (origin instanceof WebSocket) {
            this.broadcastUpdate(update, origin);
          } else {
            this.broadcastUpdate(update, null);
          }

          // Compact if needed
          store.compactIfNeeded(doc);
        });
      } else {
        // Load failed
        this.state = 'load-failed';
        this.lastLoadFailedAt = Date.now();
        console.error(JSON.stringify({ event: 'load_failure', reason: result.reason, error: result.error }));
      }
    } catch (e) {
      this.state = 'load-failed';
      this.lastLoadFailedAt = Date.now();
      console.error(JSON.stringify({ event: 'load_exception', error: String(e) }));
    }
  }

  private discardDoc(): void {
    this.doc = null;
  }

  private closeAllSockets(code: number, reason: string): void {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(code, reason);
      } catch {
        // already closed
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.loadPromise;

    // Handle internal test hook requests (corrupt-snapshot, repair)
    const url = new URL(request.url);
    if (url.pathname === '/corrupt-snapshot' && request.method === 'POST') {
      return this.handleCorruptSnapshot();
    }
    if (url.pathname === '/repair' && request.method === 'POST') {
      return this.handleRepair();
    }
    if (url.pathname === '/seed-legacy' && request.method === 'POST') {
      return this.handleSeedLegacy(request);
    }
    if (url.pathname === '/compact' && request.method === 'POST') {
      return this.handleCompact();
    }
    if (url.pathname === '/reload' && request.method === 'POST') {
      this.performLoad();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Check board existence before accepting
    if (!this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }

    // Handle state-specific connection logic
    if (this.state === 'load-failed') {
      const now = Date.now();
      if (now - this.lastLoadFailedAt < LOAD_RETRY_MIN_INTERVAL_MS) {
        // Too soon to retry; reject
        const pair = new WebSocketPair();
        const [client, server] = [pair[0] as WebSocket, pair[1] as WebSocket];
        server.accept();
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
      // Retry load
      this.performLoad();
      const stateAfter = this.getState();
      if (stateAfter !== 'ready') {
        // Still failing
        const pair = new WebSocketPair();
        const [client, server] = [pair[0] as WebSocket, pair[1] as WebSocket];
        server.accept();
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    if (this.state === 'storage-failed') {
      // Retry load
      this.performLoad();
      const stateAfter2 = this.getState();
      if (stateAfter2 !== 'ready') {
        const pair = new WebSocketPair();
        const [client, server] = [pair[0] as WebSocket, pair[1] as WebSocket];
        server.accept();
        server.close(CLOSE_STORAGE_FAILURE, 'storage failure');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0] as WebSocket, pair[1] as WebSocket];

    // Use hibernation API
    this.ctx.acceptWebSocket(server);

    // Send SyncStep1 to the newly connected client
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc!);
    server.send(encoding.toUint8Array(encoder));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // State checks
    if (this.state === 'load-failed') {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed'); } catch { /* */ }
      return;
    }
    if (this.state === 'storage-failed') {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* */ }
      return;
    }

    const decoded = decodeMessage(message);

    switch (decoded.kind) {
      case 'sync': {
        try {
          const doc = this.doc;
          if (!doc) {
            ws.close(CLOSE_STORAGE_FAILURE, 'no document');
            return;
          }
          const decoder = decoding.createDecoder(decoded.payload);
          const enc = encoding.createEncoder();

          const messageType = decoding.readVarUint(decoder);

          if (messageType === 0) {
            // SyncStep1 from client: respond with SyncStep2
            syncProtocol.readSyncStep1(decoder, enc, doc);
          } else {
            // SyncStep2 (type 1) or Update (type 2): apply the update to our doc
            const updateBytes = decoding.readVarUint8Array(decoder);
            // Apply update with ws as origin so the 'update' handler can broadcast
            Y.applyUpdate(doc, updateBytes, ws);
          }

          // Send reply if non-empty (SyncStep2 reply to a SyncStep1)
          if (encoding.length(enc) > 0) {
            const syncReply = encoding.toUint8Array(enc);
            const framed = wrapSyncMessage(syncReply);
            ws.send(framed);
          }
        } catch {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
          } catch { /* already closed */ }
        }
        break;
      }
      case 'awareness': {
        // Relay awareness bytes to all connected sockets including sender
        const framed = encodeAwarenessMessage(decoded.payload);
        const sockets = this.ctx.getWebSockets();
        for (const socket of sockets) {
          try {
            socket.send(framed);
          } catch {
            // socket may be closing
          }
        }
        break;
      }
      case 'query-awareness': {
        // No stored awareness state
        break;
      }
      case 'invalid': {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        } catch { /* already closed */ }
        break;
      }
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Nothing needed; hibernation API tracks sockets via ctx.getWebSockets()
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Nothing needed
  }

  /**
   * RPC: Initialize a board. Creates tables and sets created_at if absent.
   * Returns 'created' on first call, 'exists' on subsequent calls.
   */
  async initialize(): Promise<'created' | 'exists'> {
    await this.loadPromise;
    this.store.migrate();
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
      .toArray();
    if (existing.length > 0) {
      return 'exists';
    }
    sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES ('created_at', ?1)`,
      String(Date.now()),
    );
    return 'created';
  }

  /**
   * RPC: Check if a board exists (read-only, never creates tables).
   */
  async exists(): Promise<boolean> {
    await this.loadPromise;
    return this.store.existsReadOnly();
  }

  private broadcastUpdate(update: Uint8Array, origin: WebSocket | null): void {
    // Frame as: varuint(MESSAGE_SYNC) + syncProtocol.writeUpdate(update)
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const framed = encoding.toUint8Array(enc);

    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket === origin) continue; // sender gets no echo
      try {
        socket.send(framed);
      } catch {
        // socket may be closing
      }
    }
  }

  /** Test hook: save chunk 0 and corrupt it. */
  private handleCorruptSnapshot(): Response {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ idx: number; data: ArrayBuffer }>(
      `SELECT idx, data FROM snapshot_chunks WHERE idx = 0`,
    ).toArray();
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'no snapshot chunks' }), { status: 404 });
    }
    // Save original chunk 0
    this.savedChunk0 = new Uint8Array(rows[0]!.data);
    // Overwrite with garbage
    sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  /** Test hook: restore chunk 0 from saved data. */
  private handleRepair(): Response {
    if (!this.savedChunk0) {
      return new Response(JSON.stringify({ ok: false, error: 'no saved chunk' }), { status: 404 });
    }
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ idx: number }>(
      `SELECT idx FROM snapshot_chunks WHERE idx = 0`,
    ).toArray();
    if (rows.length > 0) {
      sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, this.savedChunk0);
    } else {
      sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?1)`, this.savedChunk0);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  /** Test hook: force compaction on the board. */
  private handleCompact(): Response {
    if (this.state !== 'ready' || !this.doc) {
      return new Response(JSON.stringify({ ok: false, error: 'not ready' }), { status: 409 });
    }
    // Compact regardless of thresholds
    const chunks = chunkBytes(Y.encodeStateAsUpdate(this.doc));
    const sql = this.ctx.storage.sql;
    const maxRows = sql.exec<{ seq: number }>(`SELECT MAX(seq) as seq FROM updates`).toArray();
    const maxSeq = maxRows[0]?.seq ?? 0;
    this.ctx.storage.transactionSync(() => {
      sql.exec(`DELETE FROM snapshot_chunks`);
      for (let i = 0; i < chunks.length; i++) {
        sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, i, chunks[i]!);
      }
      sql.exec(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
      const existing = sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      if (existing.length > 0) {
        sql.exec(`UPDATE storage_meta SET value = ?1 WHERE key = 'snapshot_through_seq'`, String(maxSeq));
      } else {
        sql.exec(`INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`, String(maxSeq));
      }
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  /**
   * Test hook: seed a legacy board (updates rows without created_at).
   * Body: { updates: string[] } — each string is a hex-encoded Yjs update.
   */
  private async handleSeedLegacy(request: Request): Promise<Response> {
    const body = await request.json() as { updates: string[] };
    const sql = this.ctx.storage.sql;
    // Create tables (like migrate) but do NOT set created_at
    sql.exec(`CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`);

    for (const hex of body.updates) {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      }
      sql.exec(`INSERT INTO updates (data, bytes) VALUES (?1, ?2)`, bytes, bytes.length);
    }
    // Reload the in-memory doc from storage
    this.performLoad();
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
}
