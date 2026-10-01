import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  readSyncMessage,
  writeSyncStep1,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { decodeMessage, MESSAGE_SYNC, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomState, type RoomEvent } from './room-state';
import type { Env } from './index';

/**
 * BoardRoom: one Durable Object per board with SQLite-backed persistence.
 * Holds an in-memory Y.Doc and relays Yjs sync + awareness messages over WebSockets.
 *
 * Uses hibernating WebSockets (ctx.acceptWebSocket) so idle boards consume no compute.
 * On wake, the constructor reloads the doc from storage via blockConcurrencyWhile.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private state: RoomState = 'loading';
  private loadFailedAt = 0;
  /** Whether this board exists (has been initialized or has legacy data). */
  private boardExists = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      // Only load if the board exists (has been initialized or has legacy data)
      this.store = new BoardStore(this.ctx.storage);
      this.boardExists = this.store.existsReadOnly();
      if (this.boardExists) {
        await this.doLoad();
      } else {
        // Board doesn't exist yet; don't create tables or load
        this.state = 'ready';
      }
    });
  }

  /**
   * RPC: Initialize a new board. Creates tables and sets created_at.
   * Returns 'created' on first call, 'exists' on subsequent calls.
   */
  async initialize(): Promise<'created' | 'exists'> {
    if (!this.store) {
      this.store = new BoardStore(this.ctx.storage);
    }
    this.store.migrate();
    // Check if already initialized
    if (this.store.hasCreatedAt()) {
      this.boardExists = true;
      return 'exists';
    }
    // Set created_at
    this.store.setCreatedAt();
    this.boardExists = true;
    // Initialize doc if not already loaded
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.store.load(this.doc);
      this.setupDocListener();
    }
    return 'created';
  }

  /**
   * RPC: Check if this board exists (read-only, never creates storage).
   */
  async exists(): Promise<boolean> {
    if (!this.store) {
      this.store = new BoardStore(this.ctx.storage);
    }
    return this.store.existsReadOnly();
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  private async doLoad(): Promise<void> {
    try {
      if (!this.store) {
        this.store = new BoardStore(this.ctx.storage);
      }
      // migrate() is NOT called here; it runs in initialize() and lazily before first append()

      this.doc = new Y.Doc();
      const result: LoadResult = this.store.load(this.doc);

      if (result.ok) {
        this.transition({ type: result.quarantined > 0 ? 'load-success-quarantined' : 'load-success' });
        this.setupDocListener();
      } else {
        this.transition({ type: 'load-failed' });
        this.loadFailedAt = Date.now();
        console.error(JSON.stringify({ type: 'board-load-failed', reason: result.reason, error: result.error }));
      }
    } catch (err) {
      this.transition({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      console.error(JSON.stringify({ type: 'board-load-failed', reason: 'unexpected', error: String(err) }));
    }
  }

  private setupDocListener(): void {
    if (!this.doc) return;
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Don't store or broadcast updates originating from load
      if (origin === LOAD_ORIGIN) return;

      // Store before broadcast
      try {
        this.store!.append(update);
      } catch {
        // Storage failure: close all sockets with 1011, discard doc
        this.transition({ type: 'storage-error' });
        const sockets = this.ctx.getWebSockets();
        for (const ws of sockets) {
          try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* already closed */ }
        }
        this.doc = null;
        return;
      }

      // Broadcast to all sockets except origin
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      encoding.writeVarUint(encoder, 2); // messageYjsUpdate
      encoding.writeVarUint8Array(encoder, update);
      const message = encoding.toUint8Array(encoder);

      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) {
        if (ws === origin) continue;
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        } catch { /* socket gone */ }
      }

      // Compact if needed
      if (this.doc) {
        this.store!.compactIfNeeded(this.doc);
      }
    });
  }

  private async handleRetryLoad(): Promise<boolean> {
    // Check if enough time has passed since last load failure
    if (Date.now() - this.loadFailedAt < LOAD_RETRY_MIN_INTERVAL_MS) {
      return false;
    }
    await this.doLoad();
    return this.state === 'ready';
  }

  async fetch(req: Request): Promise<Response> {
    // Test-only endpoints for e2e tests (corrupt/repair board storage)
    if (req.url.includes('/internal/test-corrupt')) {
      return this.handleTestCorrupt();
    }
    if (req.url.includes('/internal/test-repair')) {
      return this.handleTestRepair();
    }
    if (req.url.includes('/internal/test-fail-append')) {
      return this.handleTestFailAppend();
    }
    if (req.url.includes('/internal/test-fail-load')) {
      return this.handleTestFailLoad();
    }
    if (req.url.includes('/internal/test-seed-legacy')) {
      return this.handleTestSeedLegacy();
    }

    // Reject WebSocket upgrade for unknown boards
    const upgradeHeader = req.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      if (!this.boardExists) {
        // Check one more time (legacy data might have been seeded externally)
        if (!this.store) this.store = new BoardStore(this.ctx.storage);
        if (!this.store.existsReadOnly()) {
          return new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        this.boardExists = true;
        // Load the doc now that we know the board exists
        if (!this.doc) {
          await this.doLoad();
        }
      }
    }

    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Handle load-failed state
    if (this.state === 'load-failed') {
      const loaded = await this.handleRetryLoad();
      if (!loaded) {
        // Close immediately with 4500
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Handle storage-failed state: try to reload
    if (this.state === 'storage-failed') {
      this.transition({ type: 'wake' });
      await this.doLoad();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Send SyncStep1 so the client responds with its state
    if (this.doc) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeSyncStep1(encoder, this.doc);
      server.send(encoding.toUint8Array(encoder));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // Check state first
    if (this.state === 'load-failed') {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded'); } catch { /* already closed */ }
      return;
    }
    if (this.state === 'storage-failed') {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* already closed */ }
      return;
    }
    if (!this.doc) {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'no doc'); } catch { /* already closed */ }
      return;
    }

    const decoded = decodeMessage(message);

    if (decoded.kind === 'invalid') {
      try { ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason); } catch { /* already closed */ }
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
        readSyncMessage(createDecoder(decoded.payload), replyEncoder, this.doc, ws);
        const reply = encoding.toUint8Array(replyEncoder);
        if (reply.length > 1) {
          ws.send(reply);
        }
      } catch {
        try { ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update'); } catch { /* already closed */ }
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness to all sockets including sender
      const raw = decoded.payload;
      const frame = new Uint8Array(1 + raw.length);
      frame[0] = 1; // MESSAGE_AWARENESS
      frame.set(raw, 1);
      const sockets = this.ctx.getWebSockets();
      for (const s of sockets) {
        try {
          if (s.readyState === WebSocket.OPEN) {
            s.send(frame);
          }
        } catch { /* socket gone */ }
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // Ignored
      return;
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Nothing to clean up; ctx.getWebSockets() is the source of truth
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Nothing to clean up
  }

  /** Flag to inject a throw on the next store.append call. */
  private testFailAppend = false;

  /** Test-only: corrupt the snapshot to trigger load-failed. */
  private handleTestCorrupt(): Response {
    if (!this.store) return new Response('no store', { status: 500 });
    try {
      // Ensure tables exist
      this.store.migrate();
      // Write corrupt snapshot chunks
      const sql = this.ctx.storage.sql;
      // Delete existing snapshot chunks
      sql.exec(`DELETE FROM snapshot_chunks`);
      // Insert garbage that Yjs will reject
      sql.exec(
        `INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?)`,
        new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
      );
      // Set through_seq high so no log rows are loaded
      sql.exec(
        `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '999999')`,
      );
      // Force reload to fail
      this.state = 'loading';
      this.doLoad();
      return new Response('ok');
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  /** Test-only: remove corrupt snapshot so board can load again. */
  private handleTestRepair(): Response {
    if (!this.store) return new Response('no store', { status: 500 });
    try {
      const sql = this.ctx.storage.sql;
      sql.exec(`DELETE FROM snapshot_chunks`);
      sql.exec(
        `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '0')`,
      );
      // Reload the doc from repaired storage
      this.state = 'loading';
      this.doLoad();
      return new Response('ok');
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  /** Test-only: make next store.append throw (TC-14). */
  private handleTestFailAppend(): Response {
    this.testFailAppend = true;
    // Override the store's append to throw once
    const store = this.store!;
    const origAppend = store.append.bind(store);
    store.append = (update: Uint8Array) => {
      store.append = origAppend;
      if (this.testFailAppend) {
        this.testFailAppend = false;
        throw new Error('injected append failure');
      }
      origAppend(update);
    };
    return new Response('ok');
  }

  /** Test-only: make next load throw via corrupt data (TC-26). */
  private handleTestFailLoad(): Response {
    if (!this.store) return new Response('no store', { status: 500 });
    try {
      const sql = this.ctx.storage.sql;
      // Write a corrupt snapshot that will cause Y.applyUpdate to fail
      sql.exec(`DELETE FROM snapshot_chunks`);
      sql.exec(
        `INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?)`,
        new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
      );
      sql.exec(
        `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '999999')`,
      );
      // Immediately reload to force load-failed state
      this.state = 'loading';
      this.doLoad();
      return new Response('ok');
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  /** Test-only: seed a legacy board (updates rows, no created_at). */
  private handleTestSeedLegacy(): Response {
    try {
      const sql = this.ctx.storage.sql;
      // Create tables without setting created_at (legacy style)
      sql.exec(
        `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
      );
      // Insert a schema version and seq pointer (needed for load)
      sql.exec(
        `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', '1')`,
      );
      sql.exec(
        `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '0')`,
      );
      // Generate real Yjs update bytes and insert them
      const doc = new Y.Doc();
      doc.getMap('objects').set('legacy-note-1', new Y.Map([
        ['type', 'sticky'], ['x', 0], ['y', 0], ['z', 0], ['color', 'yellow'],
      ]));
      const objMap = doc.getMap('objects');
      const noteMap = objMap.get('legacy-note-1') as Y.Map<any>;
      const ytext = new Y.Text('Legacy note text');
      noteMap.set('text', ytext);
      const update = Y.encodeStateAsUpdate(doc);
      sql.exec(
        `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
        update, update.length,
      );
      // Do NOT set created_at: this is legacy
      // Load the doc so WebSocket connections work
      this.boardExists = true;
      if (!this.doc) {
        this.doc = new Y.Doc();
        this.store = new BoardStore(this.ctx.storage);
        this.store.load(this.doc);
        this.setupDocListener();
      }
      return new Response('ok');
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }
}
