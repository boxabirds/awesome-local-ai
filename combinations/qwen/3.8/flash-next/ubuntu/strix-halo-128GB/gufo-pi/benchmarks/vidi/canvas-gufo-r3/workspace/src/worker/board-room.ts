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
 */
export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore | null = null;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private loadFailedAt = 0;
  private readyPromise: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.readyPromise = this.ctx.blockConcurrencyWhile(async () => {
      this.performLoad();
    });
  }

  private performLoad(): void {
    try {
      const store = new BoardStore(this.ctx.storage);
      store.migrate();
      const doc = new Y.Doc();

      // Subscribe update handler before loading so load updates are skipped (LOAD_ORIGIN)
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

  private transition(event: RoomEvent): void {
    const result = nextRoomState(this.state, event);
    this.state = result.state;
  }

  async fetch(request: Request): Promise<Response> {
    await this.readyPromise;

    // Test hooks: handle POST /test/* before WebSocket check
    const path = new URL(request.url).pathname;
    if (path.startsWith('/test/') && request.method === 'POST') {
      return this.handleTest(path.slice(6), request);
    }

    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    // Handle load-failed state
    if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Retry load
        this.performLoad();
        if ((this.state as RoomState) !== 'ready') {
          // Still failed — accept and close with 4500
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          return new Response(null, { status: 101, webSocket: client });
        }
        // Load succeeded this time, fall through to serve normally
      } else {
        // Before retry interval — close immediately with 4500
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Handle storage-failed state
    if (this.state === 'storage-failed') {
      // Reload
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
      // Relay to all sockets including sender (keeps y-websocket clients alive)
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(frame, decoded.payload);
      const bytes = encoding.toUint8Array(frame);
      for (const socket of this.ctx.getWebSockets()) {
        this.safeSend(socket, bytes);
      }
      return;
    }

    // Sync sub-message
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
    // Hibernation API: no state to clean up; ctx.getWebSockets() reflects current state.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Socket errors don't affect the room.
  }

  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (this.state !== 'ready' || !this.store || !this.doc) return;

    // Store before broadcast (write-before-broadcast)
    try {
      this.store.append(update);
    } catch (e) {
      console.error('[board-room] storage write failed:', e);
      this.state = 'storage-failed';
      // Close all sockets with 1011
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* */ }
      }
      this.doc = null;
      return;
    }

    // Broadcast to all except origin
    this.broadcastUpdate(update, origin);

    // Compact if needed
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
      // Save original chunk 0, then overwrite with garbage
      const rows = storage.sql.exec<{ idx: number; data: ArrayBuffer }>(
        `SELECT idx, data FROM snapshot_chunks WHERE idx = 0`,
      );
      const first = rows.next();
      if (first.done) return new Response('No snapshot chunk 0 found', { status: 404 });
      const original = new Uint8Array(first.value.data);
      // Store original in KV storage (not in SQL tables) so repair can restore
      // Use transactionSync + put in a transaction to keep it atomic
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
      });
      // KV put is async but can be called after the sync transaction
      // We store in the sync transaction context via SQL in a helper table
      // Actually we use DO list/KV: storage.put returns a promise but works in sync context
      // Use a workaround: store in quarantined_updates with a special seq
      storage.transactionSync(() => {
        storage.sql.exec(
          `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (-999, ?1, 'test_backup', 0)`,
          original,
        );
      });
      // Force reload state to trigger failure on next connection
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
      // Seed notes and compact to ensure snapshot_chunks exist
      const count = parseInt(url.searchParams.get('notes') || '25', 10);
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < count; i++) {
        createSticky(doc, { x: i * 220, y: i * 100 });
      }
      // Write state as a snapshot
      if (!this.store) {
        const store = new BoardStore(this.ctx.storage);
        store.migrate();
        this.store = store;
      }
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
      // Reload into memory
      this.performLoad();
      // Broadcast to connected sockets
      if (this.doc) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
        syncProtocol.writeUpdate(enc, encoded);
        const bytes = encoding.toUint8Array(enc);
        for (const socket of this.ctx.getWebSockets()) {
          this.safeSend(socket, bytes);
        }
      }
      return new Response(`Seeded ${count} notes`, { status: 200 });
    }

    return new Response('Unknown test action', { status: 404 });
  }
}
