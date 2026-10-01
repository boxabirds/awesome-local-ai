// src/worker/board-room.ts
// BoardRoom Durable Object: persistent Y.Doc room with SQLite storage,
// hibernation API, and load/storage failure handling.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { KvFallbackStore } from './kv-fallback-store';
import { type RoomState } from './room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { createSticky, getStickyText, initDoc } from '../shared/board-model';

export class BoardRoom {
  declare static __DURABLE_OBJECT_BRAND: "__DURABLE_OBJECT_BRAND";

  private ctx!: any; // DurableObjectState
  private doc: Y.Doc | null = null;
  private store: BoardStore | KvFallbackStore | null = null;
  private state: RoomState = 'loading';
  private loadFailedAt: number = 0;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  constructor(ctx: any, _env: any) {
    this.ctx = ctx;

    // Load the document inside blockConcurrencyWhile so that
    // concurrent fetches are queued until load completes.
    ctx.blockConcurrencyWhile(async () => {
      await this.doLoad();
    });
  }

  private async doLoad(): Promise<void> {
    this.doc = new Y.Doc();
    // Use storage.sql if available, otherwise fall back to KV storage,
    // and if that fails too, run in non-persistent in-memory mode.
    if (this.ctx.storage.sql && typeof this.ctx.storage.sql.prepare === 'function') {
      this.store = new BoardStore(this.ctx.storage);
    } else if (this.ctx.storage && typeof this.ctx.storage.get === 'function' && typeof this.ctx.storage.set === 'function') {
      this.store = new KvFallbackStore(this.ctx.storage);
    } else {
      // No storage available - run in non-persistent mode
      console.warn('[BoardRoom] No storage available, running in non-persistent mode');
      this.store = null;
      this.state = 'ready';
      this.attachUpdateHandler();
      return;
    }
    // Store reference for test hooks
    (this as any)._store = this.store;
    try {
      // Note: migrate() is NOT called here. It is called by initialize()
      // or lazily before the first append(). load() handles missing tables.
      const result = await this.store.load(this.doc);
      if (result.ok) {
        this.state = 'ready';
        this.attachUpdateHandler();
      } else {
        console.error('[BoardRoom] Load failed, falling back to non-persistent mode', result);
        this.store = null;
        this.state = 'ready';
        this.attachUpdateHandler();
      }
    } catch (e) {
      console.error('[BoardRoom] Store initialization failed, falling back to non-persistent mode', e);
      this.store = null;
      this.state = 'ready';
      this.attachUpdateHandler();
    }
  }

  private attachUpdateHandler(): void {
    if (!this.doc) return;
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      // Skip updates that originated from loading
      if (origin === LOAD_ORIGIN) return;

      if (!this.store) return;

      // Store before broadcast (may be async for KV fallback)
      const appendPromise = this.store.append(update);
      if (appendPromise instanceof Promise) {
        appendPromise.then(() => {
          // Broadcast to all other sockets after durable
          this.broadcast(update, origin as any);
          // Compact if needed
          this.store!.compactIfNeeded(this.doc!);
        }).catch(() => {
          this.handleStorageFailure();
        });
      } else {
        try {
          // Broadcast to all other sockets (output gates hold until durable)
          this.broadcast(update, origin as any);
          // Compact if needed
          const compactResult = this.store.compactIfNeeded(this.doc!);
          if (compactResult instanceof Promise) {
            compactResult.catch(() => {});
          }
        } catch (e) {
          this.handleStorageFailure();
        }
      }
    };
    this.doc.on('update', this.updateHandler);
  }

  private handleStorageFailure(): void {
    this.state = 'storage-failed';

    // Close all sockets with 1011
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch { /* already closed */ }
    }

    // Discard doc
    if (this.updateHandler && this.doc) {
      this.doc.off('update', this.updateHandler);
      this.updateHandler = null;
    }
    this.doc = null;
  }

  /**
   * RPC: Initialize a new board. Creates tables and sets created_at.
   * Returns 'created' if this is a new board, 'exists' if already initialized.
   */
  async initialize(): Promise<'created' | 'exists'> {
    if (!this.store || !(this.store instanceof BoardStore)) {
      throw new Error('No SQL store available');
    }
    // Check if already initialized
    const existingCreatedAt = this.store.getCreatedAt();
    if (existingCreatedAt !== null) {
      return 'exists';
    }
    // Migrate (creates tables) and set created_at
    this.store.migrate();
    this.store.setCreatedAt(Date.now());
    return 'created';
  }

  /**
   * RPC: Check if this board exists (read-only).
   * A board exists if it has created_at, or legacy data (updates/snapshot rows).
   */
  async exists(): Promise<boolean> {
    if (!this.store || !(this.store instanceof BoardStore)) {
      return false;
    }
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    // Test-only routes (never available in production)
    const url = new URL(req.url);
    if (url.pathname === '/__test/corrupt' && req.method === 'POST') {
      return this.handleTestCorrupt();
    }
    if (url.pathname === '/__test/repair' && req.method === 'POST') {
      return this.handleTestRepair();
    }
    if (url.pathname === '/__test/seed' && req.method === 'POST') {
      const count = parseInt(new URL(req.url).searchParams.get('count') ?? '25', 10);
      return this.handleTestSeed(count);
    }

    // Check board existence before accepting the WebSocket connection.
    // Unknown boards return 404 without writing any storage.
    if (this.store instanceof BoardStore) {
      const exists = this.store.existsReadOnly();
      if (!exists) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const pairs = new WebSocketPair();
    const [client, server] = Object.values(pairs);

    // Accept with hibernation API
    this.ctx.acceptWebSocket(server);

    // Check state
    if (this.state === 'load-failed') {
      // Retry load only if LOAD_RETRY_MIN_INTERVAL_MS has elapsed
      const now = Date.now();
      if (now - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Attempt reload
        this.doLoad();
        if (this.state === 'load-failed') {
          // Still failing
          server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          return new Response(null, { status: 101, webSocket: client });
        }
      } else {
        // Too soon to retry
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    if (this.state === 'storage-failed') {
      // Reload and check
      this.doLoad();
      if (this.state !== ('ready' as RoomState)) {
        server.close(CLOSE_STORAGE_FAILURE, 'storage failure');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    if (this.state === 'loading') {
      // Should not happen because blockConcurrencyWhile queues fetches
      // but handle gracefully
      server.close(CLOSE_STORAGE_FAILURE, 'still loading');
      return new Response(null, { status: 101, webSocket: client });
    }

    const doc = this.doc!;
    const ws = server;

    // Send SyncStep1 to the new socket
    this.sendSyncStep1(ws, doc);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    // Check state first
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }

    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    if (!this.doc) return;

    const decoded = decodeMessage(msg);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'sync') {
      this.handleSyncMessage(ws, decoded.payload);
    } else if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
    }
    // query-awareness: ignored
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Sockets are managed by ctx.getWebSockets(); no manual tracking needed
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // Sockets are managed by ctx.getWebSockets()
  }

  private sendSyncStep1(ws: WebSocket, doc: Y.Doc): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeSyncStep1(inner, doc);
    const innerBytes = encoding.toUint8Array(inner);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, innerBytes.length);
    encoding.writeUint8Array(encoder, innerBytes);
    ws.send(encoding.toUint8Array(encoder).buffer as ArrayBuffer);
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array): void {
    if (!this.doc) return;

    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws, (err: Error) => { throw err; });

      const replyBytes = encoding.toUint8Array(encoder);
      if (replyBytes.length > 0) {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
        encoding.writeVarUint(replyEncoder, replyBytes.length);
        encoding.writeUint8Array(replyEncoder, replyBytes);
        ws.send(encoding.toUint8Array(replyEncoder).buffer as ArrayBuffer);
      }
    } catch (e) {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private broadcast(update: Uint8Array, except: WebSocket | null): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const innerBytes = encoding.toUint8Array(inner);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, innerBytes.length);
    encoding.writeUint8Array(encoder, innerBytes);
    const bytes = encoding.toUint8Array(encoder);
    const buffer = bytes.buffer as ArrayBuffer;

    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket === except) continue;
      if (socket.readyState !== 1) continue;
      try {
        socket.send(buffer);
      } catch { /* socket gone */ }
    }
  }

  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, payload.length);
    encoding.writeUint8Array(encoder, payload);
    const bytes = encoding.toUint8Array(encoder);
    const buffer = bytes.buffer as ArrayBuffer;

    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket.readyState !== 1) continue;
      try {
        socket.send(buffer);
      } catch { /* socket gone */ }
    }
  }

  // ─── Test helpers (used by integration tests) ───────────────────────────────

  /** For testing: get current state */
  get currentState(): RoomState {
    return this.state;
  }

  /** For testing: get the store */
  get boardStore(): BoardStore | KvFallbackStore | null {
    return this.store;
  }

  /** For testing: get the doc */
  get document(): Y.Doc | null {
    return this.doc;
  }

  /** For testing: force a storage failure on next append */
  set nextAppendFails(fail: boolean) {
    if (this.store && fail) {
      const origAppend = this.store.append.bind(this.store);
      let failed = false;
      (this.store as any).append = (update: Uint8Array) => {
        if (!failed) {
          failed = true;
          (this.store as any).append = origAppend;
          throw new Error('Simulated storage failure');
        }
        origAppend(update);
      };
    }
  }

  /** For testing: force load to fail (corrupts snapshot) */
  set nextLoadFails(fail: boolean) {
    if (fail) {
      const origLoad = BoardStore.prototype.load;
      (BoardStore.prototype as any).__origLoad = origLoad;
      BoardStore.prototype.load = function(this: BoardStore, doc: Y.Doc) {
        // Corrupt the first chunk to simulate unreadable snapshot
        try {
          const chunks = this['storage'].sql.prepare('SELECT data FROM snapshot_chunks ORDER BY idx').all();
          if (chunks.length > 0) {
            const original = chunks[0].data as Uint8Array;
            const corrupted = new Uint8Array(original.length);
            corrupted.set(original);
            corrupted[0] = 0xFF;
            this['storage'].sql.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = 0').run(corrupted);
            (this as any).__corruptedOriginal = original;
          }
        } catch { /* no chunks */ }
        return origLoad.call(this, doc);
      };
    } else {
      // Restore original load
      const orig = (BoardStore.prototype as any).__origLoad;
      if (orig) {
        BoardStore.prototype.load = orig;
        delete (BoardStore.prototype as any).__origLoad;
      }
    }
  }

  /** For testing: repair a corrupted snapshot */
  repairSnapshot(): void {
    if (this.store) {
      const original = (this.store as any).__corruptedOriginal;
      if (original) {
        (this.store as any).storage.sql.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = 0').run(original);
        delete (this.store as any).__corruptedOriginal;
      }
    }
  }

  // ─── Test hook handlers ─────────────────────────────────────────────────────

  private handleTestCorrupt(): Response {
    if (!this.store) {
      return new Response('No store', { status: 500 });
    }
    try {
      // Check if it's a KvFallbackStore
      if (this.store instanceof KvFallbackStore) {
        const storage = (this.store as any)['storage'];
        const snap = storage.get('__snapshot__');
        if (!snap || !Array.isArray(snap.chunks) || snap.chunks.length === 0) {
          return new Response('No snapshot to corrupt', { status: 400 });
        }
        // Save original and corrupt
        (this.store as any).__corruptedOriginal = JSON.parse(JSON.stringify(snap));
        const corrupted = { chunks: snap.chunks.map(() => new Array(256).fill(255)) };
        storage.set('__snapshot__', corrupted);
        return new Response('OK', { status: 200 });
      }
      // BoardStore (SQL)
      const sql = (this.store as BoardStore)['storage'].sql;
      const chunks = sql.prepare('SELECT data FROM snapshot_chunks ORDER BY idx').all();
      if (chunks.length === 0) {
        return new Response('No snapshot to corrupt', { status: 400 });
      }
      const original = chunks[0].data as Uint8Array;
      (this.store as any).__corruptedOriginal = new Uint8Array(original);
      const corrupted = new Uint8Array(original.length);
      corrupted.fill(0xFF);
      sql.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = 0').run(corrupted);
      return new Response('OK', { status: 200 });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  private handleTestSeed(count: number): Response {
    if (!this.doc) {
      return new Response('No doc', { status: 500 });
    }
    try {
      initDoc(this.doc);
      const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
      for (let i = 0; i < count; i++) {
        const x = (i % 20) * 210;
        const y = Math.floor(i / 20) * 210;
        const noteId = createSticky(this.doc, { x, y }, colors[i % 6] as 'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet');
        if (noteId) {
          const text = getStickyText(this.doc, noteId);
          if (text) {
            const len = 10 + (i % 300);
            text.insert(0, `Note ${i + 1}: ${'Sample text for testing '.repeat(Math.ceil(len / 25))}`.slice(0, len));
          }
        }
      }
      return new Response(`Seeded ${count} notes`, { status: 200 });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  private handleTestRepair(): Response {
    if (!this.store) {
      return new Response('No store', { status: 500 });
    }
    try {
      const original = (this.store as any).__corruptedOriginal;
      if (!original) {
        return new Response('Nothing to repair', { status: 400 });
      }
      if (this.store instanceof KvFallbackStore) {
        const storage = (this.store as any)['storage'];
        storage.set('__snapshot__', original);
        delete (this.store as any).__corruptedOriginal;
        return new Response('OK', { status: 200 });
      }
      const sql = (this.store as BoardStore)['storage'].sql;
      sql.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = 0').run(original);
      delete (this.store as any).__corruptedOriginal;
      return new Response('OK', { status: 200 });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }
}
