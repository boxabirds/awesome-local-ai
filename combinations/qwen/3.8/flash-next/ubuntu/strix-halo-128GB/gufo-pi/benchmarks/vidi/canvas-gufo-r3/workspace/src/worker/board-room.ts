import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './env';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@shared/config';
import { BoardStore, LOAD_ORIGIN, LoadResult } from './board-store';
import { chunkBytes } from './board-store-pure';
import { nextRoomState, type RoomState, type RoomEvent } from './room-state';
import { initDoc, createSticky } from '@shared/board-model';

/**
 * One BoardRoom per board. Holds the board's Y.Doc in memory, persists every
 * update to SQLite-backed Durable Object storage before broadcasting, and uses
 * the WebSocket hibernation API so idle boards cost no compute.
 *
 * Story 5: boards must be explicitly created via POST /api/boards before they
 * exist. `initialize()` creates storage; `exists()` checks read-only. `fetch`
 * rejects unknown boards with 404 before accepting WebSocket.
 */
export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore | null = null;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'uninitialized';
  private loadFailedAt = 0;
  private readyPromise: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Do NOT load on construct — wait for initialize() or exists()/fetch().
  }

  /**
   * RPC: Create this board's storage. Returns 'created' on first call,
   * 'exists' if already initialized.
   */
  async initialize(): Promise<'created' | 'exists'> {
    const store = new BoardStore(this.ctx.storage);
    store.migrate();
    const result = store.setCreatedAtIfAbsent();
    // Load the doc (should be empty for a new board)
    this.performLoadWithStore(store);
    return result;
  }

  /**
   * RPC: Read-only existence check. Does not create tables or write storage.
   */
  async exists(): Promise<boolean> {
    const store = new BoardStore(this.ctx.storage);
    return store.existsReadOnly();
  }

  private performLoadWithStore(store: BoardStore): void {
    try {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === LOAD_ORIGIN) return;
        this.handleDocUpdate(update, origin);
      });

      const result = store.load(doc);
      if (result.ok) {
        this.store = store;
        this.doc = doc;
        this.state = 'ready';
        this.loadFailedAt = 0;
      } else {
        console.error(`[board-room] load failed: ${result.reason} - ${result.error}`);
        this.store = store;
        this.doc = null;
        this.state = 'load-failed';
        this.loadFailedAt = Date.now();
      }
    } catch (e) {
      console.error('[board-room] load threw:', e);
      this.store = null;
      this.doc = null;
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
    }
  }

  private performLoad(): void {
    // Lazily create the store if we haven't yet; migrate only if tables don't exist (legacy path)
    const store = new BoardStore(this.ctx.storage);
    this.performLoadWithStore(store);
  }

  private transition(event: RoomEvent): void {
    const result = nextRoomState(this.state, event);
    this.state = result.state;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    // Test hooks: handle POST /test/* before WebSocket check
    if (path.startsWith('/test/') && request.method === 'POST') {
      await this.ensureLoaded();
      return this.handleTest(path.slice(6), request);
    }

    // Existence check: reject unknown boards before accepting WebSocket
    const store = new BoardStore(this.ctx.storage);
    if (!store.existsReadOnly()) {
      return new Response('Not found', { status: 404 });
    }

    // Ensure loaded before handling WebSocket
    await this.ensureLoaded();

    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    // Handle load-failed state
    if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        this.performLoad();
        if ((this.state as RoomState) !== 'ready') {
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          return new Response(null, { status: 101, webSocket: client });
        }
      } else {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Handle storage-failed state
    if (this.state === 'storage-failed') {
      this.performLoad();
      if ((this.state as RoomState) !== 'ready') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed after storage error');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.binaryType = 'arraybuffer';

    // Send SyncStep1 so client responds with SyncStep2
    const doc = this.doc!;
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(hello, doc);
    this.safeSend(server, encoding.toUint8Array(hello));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Ensure the doc is loaded. Called lazily on first fetch/RPC that needs the doc.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
      return;
    }
    if (this.state === 'uninitialized') {
      this.readyPromise = this.ctx.blockConcurrencyWhile(async () => {
        this.performLoad();
      });
      await this.readyPromise;
    }
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed'); } catch { /* */ }
      return;
    }
    if (this.state === 'storage-failed') {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* */ }
      return;
    }
    if (!this.doc) {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'no doc'); } catch { /* */ }
      return;
    }

    const decoded = decodeMessage(message);

    if (decoded.kind === 'invalid') {
      try { ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason); } catch { /* */ }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return;
    }

    if (decoded.kind === 'awareness') {
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(frame, decoded.payload);
      const bytes = encoding.toUint8Array(frame);
      for (const socket of this.ctx.getWebSockets()) {
        this.safeSend(socket, bytes);
      }
      return;
    }

    const decoder = decoding.createDecoder(decoded.payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(decoder, reply, this.doc, ws, (err) => { throw err; });
    } catch {
      try { ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync update'); } catch { /* */ }
      return;
    }

    if (encoding.length(reply) > 1) {
      this.safeSend(ws, encoding.toUint8Array(reply));
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API: no state to clean up.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Socket errors don't affect the room.
  }

  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (this.state !== 'ready' || !this.store || !this.doc) return;

    try {
      this.store.append(update);
    } catch (e) {
      console.error('[board-room] storage write failed:', e);
      this.state = 'storage-failed';
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* */ }
      }
      this.doc = null;
      return;
    }

    this.broadcastUpdate(update, origin);
    this.store.compactIfNeeded(this.doc);
  }

  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    const bytes = encoding.toUint8Array(frame);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.safeSend(socket, bytes);
    }
  }

  private safeSend(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(data);
    } catch (err) {
      console.error('[room] send failed:', err);
    }
  }

  // --- Test hooks (only reached when TEST_HOOKS=1 is set in the environment) ---
  private handleTest(action: string, request: Request): Response {
    const url = new URL(request.url);

    if (action === 'corrupt-snapshot') {
      const storage = this.ctx.storage;
      const rows = storage.sql.exec<{ idx: number; data: ArrayBuffer }>(
        `SELECT idx, data FROM snapshot_chunks WHERE idx = 0`,
      );
      const first = rows.next();
      if (first.done) return new Response('No snapshot chunk 0 found', { status: 404 });
      const original = new Uint8Array(first.value.data);
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
      });
      storage.transactionSync(() => {
        storage.sql.exec(
          `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (-999, ?1, 'test_backup', 0)`,
          original,
        );
      });
      this.state = 'load-failed';
      this.doc = null;
      this.loadFailedAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS - 1000;
      return new Response('Corrupted', { status: 200 });
    }

    if (action === 'repair') {
      const storage = this.ctx.storage;
      const rows = storage.sql.exec<{ seq: number; data: ArrayBuffer }>(
        `SELECT seq, data FROM quarantined_updates WHERE seq = -999`,
      );
      const first = rows.next();
      if (first.done) return new Response('No saved original chunk', { status: 404 });
      const original = new Uint8Array(first.value.data);
      storage.transactionSync(() => {
        storage.sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, original);
        storage.sql.exec(`DELETE FROM quarantined_updates WHERE seq = -999`);
      });
      return new Response('Repaired', { status: 200 });
    }

    if (action === 'seed') {
      const count = parseInt(url.searchParams.get('notes') || '25', 10);
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < count; i++) {
        createSticky(doc, { x: i * 220, y: i * 100 });
      }
      // Always ensure tables exist for test seeding
      if (!this.store) {
        const store = new BoardStore(this.ctx.storage);
        this.store = store;
      }
      this.store.migrate();
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const storage = this.ctx.storage;
      storage.transactionSync(() => {
        storage.sql.exec(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          storage.sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, i, chunks[i]);
        }
        storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          '0',
        );
      });
      this.performLoad();
      if (this.doc) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.writeUpdate(enc, encoded);
        const bytes = encoding.toUint8Array(enc);
        for (const socket of this.ctx.getWebSockets()) {
          this.safeSend(socket, bytes);
        }
      }
      return new Response(`Seeded ${count} notes`, { status: 200 });
    }

    if (action === 'seed-legacy') {
      // Create a legacy board: has updates rows but no created_at
      const count = parseInt(url.searchParams.get('notes') || '3', 10);
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < count; i++) {
        createSticky(doc, { x: i * 220, y: i * 100 });
      }
      const encoded = Y.encodeStateAsUpdate(doc);
      const storage = this.ctx.storage;
      // Create only updates table and insert a row; do NOT write created_at
      storage.transactionSync(() => {
        storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        );
        storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
        );
        storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
        );
        storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
        );
        storage.sql.exec(
          `INSERT INTO updates (data, bytes) VALUES (?1, ?2)`,
          encoded,
          encoded.byteLength,
        );
      });
      this.performLoad();
      return new Response(`Seeded legacy board with ${count} notes`, { status: 200 });
    }

    return new Response('Unknown test action', { status: 404 });
  }
}
