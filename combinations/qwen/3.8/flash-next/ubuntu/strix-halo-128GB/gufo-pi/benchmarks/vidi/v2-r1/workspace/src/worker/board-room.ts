import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';

import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore } from './board-store';
import { nextRoomState, type RoomEvent } from './room-state';

/** Origin sentinel indicating updates applied during load (not stored, not broadcast). */
const LOAD_ORIGIN = '__vidi6_load__';

type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * BoardRoom Durable Object: persists every Yjs update to SQLite storage before
 * broadcasting it, reloads on wake, and uses the WebSocket hibernation API.
 */
export class BoardRoom extends DurableObject {
  private doc!: Y.Doc;
  private store!: BoardStore;
  private state: RoomState = 'ready';
  private loadFailedAt = 0;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
  }

  /**
   * RPC: initialize the board. Migrates tables and sets created_at.
   * Returns 'created' if new, 'exists' if already initialized.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const result = this.store.setCreatedAt();
    // Also set up the doc for this instance
    if (!this.initialized) {
      this.doInitialize();
    }
    return result;
  }

  /**
   * RPC: read-only existence check. Does not create any storage.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  private doInitialize(): void {
    this.doc = new Y.Doc();
    // Don't migrate here - tables are created by initialize() or lazily by append()
    const result = this.store.load(this.doc);
    if (result.ok) {
      this.state = 'ready';
    } else {
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
    }
    this.initialized = true;

    // Set up update handler
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      // Store before broadcast
      try {
        this.store.append(update);
      } catch {
        this.resetRoom();
        return;
      }
      // Broadcast to all sockets except origin
      this.broadcastUpdate(update, origin);
      // Compact if needed
      this.store.compactIfNeeded(this.doc);
    });
  }

  private resetRoom(): void {
    this.state = 'storage-failed';
    // Close all sockets with 1011
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // ignore
      }
    }
    // Discard doc
    this.doc = new Y.Doc();
    this.initialized = false;
  }

  private broadcastUpdate(update: Uint8Array, origin?: unknown): void {
    const msg = buildSyncUpdateMessage(update);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      if (ws === origin) continue;
      try {
        ws.send(msg);
      } catch {
        // ignore - socket might be closing
      }
    }
  }

  fetch(request: Request): Response | Promise<Response> {
    // Handle internal test hook requests
    const url = new URL(request.url);
    if (url.pathname === '/__test/corrupt-snapshot' && request.method === 'POST') {
      return this.handleTestCorrupt();
    }
    if (url.pathname === '/__test/repair-snapshot' && request.method === 'POST') {
      return this.handleTestRepair();
    }
    if (url.pathname === '/__test/reset-state' && request.method === 'POST') {
      return this.handleTestResetState();
    }
    if (url.pathname === '/__test/force-compaction' && request.method === 'POST') {
      return this.handleTestForceCompaction();
    }
    if (url.pathname === '/__test/storage-stats' && request.method === 'GET') {
      return this.handleTestStorageStats();
    }
    if (url.pathname === '/__test/seed-legacy' && request.method === 'POST') {
      return this.handleTestSeedLegacy(request);
    }

    // Check existence before accepting WebSocket: unknown boards get 404
    // If the room is already initialized (from initialize() or from a prior session),
    // it exists; only reject truly unknown boards.
    if (!this.initialized && !this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }

    // Re-initialize if coming from storage-failed or load-failed with retry allowed
    if (!this.initialized) {
      this.doInitialize();
    }

    if (this.state === 'load-failed') {
      const now = Date.now();
      const elapsed = now - this.loadFailedAt;
      const event: RoomEvent = elapsed >= LOAD_RETRY_MIN_INTERVAL_MS
        ? { type: 'retry-load-allowed' }
        : { type: 'retry-load-denied' };
      const nextState = nextRoomState('load-failed', event);

      if (nextState === 'loading') {
        // Attempt reload
        this.doc = new Y.Doc();
        const result = this.store.load(this.doc);
        if (result.ok) {
          this.state = 'ready';
          this.initialized = true;
          // Re-register update handler
          this.setupDocHandlers();
        } else {
          this.state = 'load-failed';
          this.loadFailedAt = Date.now();
          // Accept and close 4500
          return this.acceptAndClose(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        }
      } else {
        // Still load-failed, close with 4500
        return this.acceptAndClose(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      }
    }

    if (this.state === 'storage-failed') {
      // Reload
      this.doInitialize();
      if (this.state === 'storage-failed') {
        return this.acceptAndClose(CLOSE_STORAGE_FAILURE, 'storage failure');
      }
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    // Send SyncStep1 so the new client can reply with its full state
    this.sendSyncStep1(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private setupDocHandlers(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      try {
        this.store.append(update);
      } catch {
        this.resetRoom();
        return;
      }
      this.broadcastUpdate(update, origin);
      this.store.compactIfNeeded(this.doc);
    });
  }

  private handleTestCorrupt(): Response {
    try {
      // Try to corrupt snapshot chunk 0 first
      const rows = this.store.sqlForTest(`SELECT data FROM snapshot_chunks WHERE idx = 0`).toArray();
      if (rows.length > 0) {
        // Corrupt snapshot chunk 0
        this.store.sqlForTest(`CREATE TABLE IF NOT EXISTS _test_backup (key TEXT PRIMARY KEY, data BLOB)`);
        this.store.sqlForTest(`INSERT OR REPLACE INTO _test_backup (key, data) VALUES ('chunk0', ?)`, rows[0].data);
        const garbage = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
        this.store.sqlForTest(`UPDATE snapshot_chunks SET data = ? WHERE idx = 0`, garbage);
      } else {
        // No snapshot: corrupt the first update row instead
        const updateRows = this.store.sqlForTest(`SELECT seq, data FROM updates ORDER BY seq LIMIT 1`).toArray();
        if (updateRows.length === 0) {
          return new Response('No snapshot chunks or updates to corrupt', { status: 400 });
        }
        this.store.sqlForTest(`CREATE TABLE IF NOT EXISTS _test_backup (key TEXT PRIMARY KEY, data BLOB)`);
        this.store.sqlForTest(`INSERT OR REPLACE INTO _test_backup (key, data) VALUES ('update0', ?)`, updateRows[0].data);
        const garbage = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
        this.store.sqlForTest(`UPDATE updates SET data = ? WHERE seq = ?`, garbage, updateRows[0].seq);
      }
      // Force the room into load-failed state so next connection gets 4500
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      return new Response('Corrupted', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${e}`, { status: 500 });
    }
  }

  private handleTestRepair(): Response {
    try {
      this.store.sqlForTest(`CREATE TABLE IF NOT EXISTS _test_backup (key TEXT PRIMARY KEY, data BLOB)`);
      const chunk0Rows = this.store.sqlForTest(`SELECT data FROM _test_backup WHERE key = 'chunk0'`).toArray();
      const update0Rows = this.store.sqlForTest(`SELECT data FROM _test_backup WHERE key = 'update0'`).toArray();
      if (chunk0Rows.length > 0) {
        // Restore snapshot chunk 0
        this.store.sqlForTest(`UPDATE snapshot_chunks SET data = ? WHERE idx = 0`, chunk0Rows[0].data);
        this.store.sqlForTest(`DELETE FROM _test_backup WHERE key = 'chunk0'`);
      } else if (update0Rows.length > 0) {
        // Restore first update row
        const seqRow = this.store.sqlForTest(`SELECT seq FROM updates ORDER BY seq LIMIT 1`).toArray();
        if (seqRow.length > 0) {
          this.store.sqlForTest(`UPDATE updates SET data = ? WHERE seq = ?`, update0Rows[0].data, seqRow[0].seq);
        }
        this.store.sqlForTest(`DELETE FROM _test_backup WHERE key = 'update0'`);
      } else {
        return new Response('No backup to restore', { status: 400 });
      }
      // Reset load-failed state to allow retry
      this.state = 'ready';
      this.initialized = false;
      return new Response('Repaired', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${e}`, { status: 500 });
    }
  }

  private handleTestResetState(): Response {
    // Simulate DO eviction: clear in-memory state so next fetch triggers a reload
    this.initialized = false;
    this.state = 'ready';
    this.loadFailedAt = 0;
    this.doc = new Y.Doc();
    // Close all existing WebSocket connections
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1001, 'DO evicted (simulated)');
    }
    return new Response('State reset', { status: 200 });
  }

  private handleTestForceCompaction(): Response {
    if (!this.initialized || this.state !== 'ready') {
      return new Response('Room not ready', { status: 503 });
    }
    const result = this.store.compact(this.doc);
    return new Response(result ? 'Compacted' : 'Failed', { status: 200 });
  }

  private handleTestStorageStats(): Response {
    try {
      const updateCount = this.store.sqlForTest(`SELECT COUNT(*) as cnt FROM updates`).toArray()[0]?.cnt ?? 0;
      const updateBytes = this.store.sqlForTest(`SELECT COALESCE(SUM(bytes), 0) as total FROM updates`).toArray()[0]?.total ?? 0;
      const snapshotChunkCount = this.store.sqlForTest(`SELECT COUNT(*) as cnt FROM snapshot_chunks`).toArray()[0]?.cnt ?? 0;
      const snapshotBytes = this.store.sqlForTest(`SELECT COALESCE(SUM(LENGTH(data)), 0) as total FROM snapshot_chunks`).toArray()[0]?.total ?? 0;
      const quarantineCount = this.store.sqlForTest(`SELECT COUNT(*) as cnt FROM quarantined_updates`).toArray()[0]?.cnt ?? 0;
      return new Response(JSON.stringify({
        updateCount,
        updateBytes,
        snapshotChunkCount,
        snapshotBytes,
        quarantineCount,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(`Error: ${e}`, { status: 500 });
    }
  }

  /**
   * Seed a legacy board: creates tables with updates rows but NO created_at.
   * Body: JSON array of base64-encoded Yjs updates.
   */
  private async handleTestSeedLegacy(request: Request): Promise<Response> {
    try {
      const body = await request.text();
      let updates: string[];
      if (body) {
        updates = JSON.parse(body);
      } else {
        // Default: seed with a legacy Yjs update containing a known marker
        const doc = new Y.Doc();
        const map = doc.getMap('objects');
        map.set('legacy-seed-stroke', { type: 'stroke' });
        const encoded = Y.encodeStateAsUpdate(doc);
        updates = [btoa(String.fromCharCode(...encoded))];
      }
      // Migrate to create tables
      this.store.migrate();
      // Delete created_at so this looks like a legacy board
      this.store.sqlForTest(`DELETE FROM storage_meta WHERE key = 'created_at'`);
      // Insert updates
      for (const u of updates) {
        const bytes = Uint8Array.from(atob(u), (c) => c.charCodeAt(0));
        this.store.append(bytes);
      }
      return new Response('Seeded', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${e}`, { status: 500 });
    }
  }

  private acceptAndClose(code: number, reason: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Use non-hibernating accept for immediate-close case to ensure close code propagates
    server.accept();
    server.close(code, reason);
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed'); } catch { /* ignore */ }
      return;
    }
    if (this.state === 'storage-failed') {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* ignore */ }
      return;
    }

    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync': {
        this.handleSyncMessage(ws, decoded.payload);
        break;
      }
      case 'awareness': {
        // Relay awareness to ALL sockets including sender
        const frame = new Uint8Array(1 + decoded.payload.byteLength);
        frame[0] = 1; // MESSAGE_AWARENESS
        frame.set(decoded.payload, 1);
        const sockets = this.ctx.getWebSockets();
        for (const socket of sockets) {
          try {
            socket.send(frame);
          } catch {
            // ignore
          }
        }
        break;
      }
      case 'query-awareness': {
        // Ignored
        break;
      }
      case 'invalid': {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        } catch {
          // ignore
        }
        break;
      }
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // No cleanup needed - hibernation API tracks sockets via ctx.getWebSockets()
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // No cleanup needed
  }

  private sendSyncStep1(ws: WebSocket): void {
    const stateVector = Y.encodeStateVector(this.doc);
    const msg = buildSyncStep1Message(stateVector);
    try {
      ws.send(msg);
    } catch {
      // ignore
    }
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array): void {
    const decoder = createDecoder(payload);
    const syncType = readUint8(decoder);

    switch (syncType) {
      case 0: {
        // SyncStep1: client sends state vector, we reply with SyncStep2
        const svBuf = readUint8Array(decoder);
        const sv = new Uint8Array(svBuf);
        const missing = Y.encodeStateAsUpdate(this.doc, sv);
        if (missing.byteLength > 0) {
          const msg = buildSyncStep2Message(missing);
          try {
            ws.send(msg);
          } catch {
            // ignore
          }
        }
        break;
      }
      case 1: {
        // SyncStep2: client sends the update we are missing
        const updateBuf = readUint8Array(decoder);
        const update = new Uint8Array(updateBuf);
        try {
          Y.applyUpdate(this.doc, update, ws);
        } catch {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
          } catch {
            // ignore
          }
        }
        break;
      }
      case 2: {
        // Update: incremental update from client
        const updateBuf = readUint8Array(decoder);
        const update = new Uint8Array(updateBuf);
        try {
          Y.applyUpdate(this.doc, update, ws);
        } catch {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
          } catch {
            // ignore
          }
        }
        break;
      }
      default: {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'unknown sync type');
        } catch {
          // ignore
        }
        break;
      }
    }
  }
}

// ---- Binary message builders ----

interface Encoder {
  buf: Uint8Array;
  pos: number;
}

interface Decoder {
  data: Uint8Array;
  pos: number;
}

function createEncoder(): Encoder {
  return { buf: new Uint8Array(1024), pos: 0 };
}

function ensureCapacity(encoder: Encoder, extra: number): void {
  while (encoder.pos + extra > encoder.buf.length) {
    const newBuf = new Uint8Array(encoder.buf.length * 2);
    newBuf.set(encoder.buf);
    encoder.buf = newBuf;
  }
}

function writeUint8(encoder: Encoder, val: number): void {
  ensureCapacity(encoder, 1);
  encoder.buf[encoder.pos++] = val;
}

function writeVarUint(encoder: Encoder, num: number): void {
  while (num > 127) {
    writeUint8(encoder, (num & 127) | 128);
    num >>>= 7;
  }
  writeUint8(encoder, num);
}

function writeUint8Array(encoder: Encoder, arr: Uint8Array): void {
  writeVarUint(encoder, arr.byteLength);
  ensureCapacity(encoder, arr.byteLength);
  encoder.buf.set(arr, encoder.pos);
  encoder.pos += arr.byteLength;
}

function toUint8Array(encoder: Encoder): Uint8Array {
  return encoder.buf.slice(0, encoder.pos);
}

function createDecoder(data: Uint8Array): Decoder {
  return { data, pos: 0 };
}

function readUint8(decoder: Decoder): number {
  if (decoder.pos >= decoder.data.length) return 0;
  return decoder.data[decoder.pos++];
}

function readVarUint(decoder: Decoder): number {
  let num = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = readUint8(decoder);
    num |= (byte & 127) << shift;
    shift += 7;
  } while (byte >= 128);
  return num >>> 0;
}

function readUint8Array(decoder: Decoder): ArrayBuffer {
  const len = readVarUint(decoder);
  const arr = decoder.data.slice(decoder.pos, decoder.pos + len);
  decoder.pos += len;
  return arr.buffer as ArrayBuffer;
}

function buildSyncStep1Message(stateVector: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeUint8(encoder, 0); // MESSAGE_SYNC
  writeUint8(encoder, 0); // SyncStep1
  writeUint8Array(encoder, stateVector);
  return toUint8Array(encoder);
}

function buildSyncStep2Message(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeUint8(encoder, 0); // MESSAGE_SYNC
  writeUint8(encoder, 1); // SyncStep2
  writeUint8Array(encoder, update);
  return toUint8Array(encoder);
}

function buildSyncUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeUint8(encoder, 0); // MESSAGE_SYNC
  writeUint8(encoder, 2); // Update
  writeUint8Array(encoder, update);
  return toUint8Array(encoder);
}
