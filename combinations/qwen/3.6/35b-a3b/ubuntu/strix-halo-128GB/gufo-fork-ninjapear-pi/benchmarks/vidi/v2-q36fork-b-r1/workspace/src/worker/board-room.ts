/**
 * BoardRoom Durable Object — persistent Y.Doc room with SQLite storage.
 * Story 4 — persistence.
 *
 * Every Yjs update is stored before broadcasting. On wake the document is
 * reloaded from snapshot + log rows. Damaged snapshots trigger LoadFailed.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';
import type { Decoded } from '@/shared/protocol';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '@/shared/protocol';
import { BoardStore } from './board-store-do';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';

// ── Wire constants ───────────────────────────────────────────────────
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const LOAD_ORIGIN = 'load-origin';

// ── Environment & types ──────────────────────────────────────────────

export interface Env { TEST_HOOKS?: string; }

type RoomState = 'ready' | 'load-failed' | 'storage-failed';

interface RoomSocket { id: string; ws: WebSocket; }

// ── Helpers ──────────────────────────────────────────────────────────

/** Build [varint:0][update-bytes]. */
function makeSyncFrame(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  const arr = encoding.toUint8Array(enc);
  const result = new Uint8Array(arr.length + update.length);
  result.set(arr);
  result.set(update, arr.length);
  return result;
}

// ── BoardRoom ────────────────────────────────────────────────────────

/**
 * Persistent board room. Holds one Y.Doc per board-id and persists every
 * change to SQlite-backed Durable Object storage.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc!: Y.Doc;
  private store!: BoardStore;
  private sockets: Set<RoomSocket> = new Set();
  private state: RoomState = 'ready';
  private failedAt: number = 0;
  private _ctx!: DurableObjectState;

  // ── Lifecycle ────────────────────────────────────────────────────

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this._ctx = ctx;

    // Block concurrency while we load — prevents parallel connections
    ctx.blockConcurrencyWhile(async () => {
      this.doc = new Y.Doc();
      this.store = new BoardStore(ctx.storage);
      this.store.migrate();

      const result = this.store.load(this.doc);
      if (!result.ok) {
        console.error(JSON.stringify({ event: 'load-failed', reason: result.reason }));
        this.state = 'load-failed';
        this.failedAt = Date.now();
        return;
      }
      if (result.quarantined > 0) {
        console.error(JSON.stringify({ event: 'quarantined', count: result.quarantined }));
      }
      this.state = 'ready';

      // Subscribe to document updates — persist then broadcast
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Ignore our own load operations
        if (origin === LOAD_ORIGIN) return;
        // Persist (throws on storage failure → triggers reset)
        this.tryAppendAndBroadcast(String(origin), update);
      });
    });
  }

  // ── Persistence + broadcast ──────────────────────────────────────

  /** Append an update to storage, then broadcast to non-origin sockets. */
  private tryAppendAndBroadcast(originId: string, update: Uint8Array): void {
    try {
      this.store.append(update);
    } catch {
      // Storage failure — discard everything, close sockets, next connection reloads
      console.error(JSON.stringify({ event: 'storage-fail' }));
      this.state = 'storage-failed';
      for (const s of this.sockets) {
        try { s.ws.close(CLOSE_STORAGE_FAILURE, 'Storage failure'); } catch {}
      }
      this.sockets.clear();
      // Discard in-memory doc — next connection will reload fresh from storage.
      // Existing socket listeners are cleaned up via their close/error handlers.
      this.doc = new Y.Doc();
      return;
    }
    // Compaction (best-effort, never throws)
    try { this.store.compactIfNeeded(this.doc); } catch {}
    // Broadcast to all except origin
    const frame = makeSyncFrame(update);
    this.broadcastExcept(originId, frame);
  }

  private broadcastExcept(originId: string, frame: Uint8Array): void {
    for (const s of this.sockets) {
      if (s.id !== originId) {
        try { s.ws.send(frame); } catch { this.sockets.delete(s); }
      }
    }
  }

  // ── fetch handler ────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Test hooks (never compiled into production builds where env.TEST_HOOKS is absent)
    if (this.env.TEST_HOOKS && url.pathname.startsWith('/__test/')) {
      return this.handleTestHooks(url, req);
    }

    // Only WebSocket upgrades are valid
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    switch (this.state) {
      case 'storage-failed': {
        // Close immediately with 1011
        const pair = new WebSocketPair();
        try { pair[0].accept(); } catch {}
        pair[0].close(CLOSE_STORAGE_FAILURE, 'Storage failure');
        return new Response(null, { status: 101, webSocket: pair[1] });
      }

      case 'load-failed': {
        return this.handleLoadFailed(req);
      }

      default: /* ready */ {
        return this.handleReady(req);
      }
    }
  }

  /** Accept a hibernating WebSocket connection. Returns [serverWs, clientWs]. */
  private setupClientSocket(): [serverWs: WebSocket, clientWs: WebSocket] {
    const pair = new WebSocketPair();
    const srvWs = pair[0];
    const cliWs = pair[1];
    srvWs.accept();
    const roomThis = this;

    const socketId = crypto.randomUUID();
    const entry: RoomSocket = { id: socketId, ws: srvWs };
    roomThis.sockets.add(entry);

    // Send SyncStep1
    const step1Enc = encoding.createEncoder();
    encoding.writeVarUint(step1Enc, MSG_SYNC);
    writeSyncStep1(step1Enc, roomThis.doc);
    srvWs.send(encoding.toUint8Array(step1Enc));

    function cleanup(): void {
      roomThis.sockets.delete(entry);
    }
    srvWs.addEventListener('close', cleanup);
    srvWs.addEventListener('error', cleanup);

    // Incoming message handler
    srvWs.addEventListener('message', async (event: MessageEvent) => {
      let data: ArrayBuffer | string;
      if (typeof event.data === 'string') {
        data = event.data;
      } else {
        const buf = event.data instanceof ArrayBuffer
          ? event.data
          : event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength);
        data = buf;
      }

      const decoded = decodeMessage(data);

      if (decoded.kind === 'invalid') {
        srvWs.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        cleanup();
        return;
      }
      if (decoded.kind === 'query-awareness') return;

      if (decoded.kind === 'awareness') {
        const frame = new Uint8Array(1 + decoded.payload.length);
        frame[0] = MSG_AWARENESS;
        frame.set(decoded.payload, 1);
        for (const s of this.sockets) {
          try { s.ws.send(frame); } catch { this.sockets.delete(s); }
        }
        return;
      }

      if (decoded.kind === 'sync') {
        try {
          const respEnc = encoding.createEncoder();
          encoding.writeVarUint(respEnc, MSG_SYNC);
          const dec = decoding.createDecoder(new Uint8Array(decoded.payload));
          readSyncMessage(dec, respEnc, this.doc, socketId);
          const respBytes = encoding.toUint8Array(respEnc);
          if (respBytes.length > 1) srvWs.send(respBytes);
        } catch {
          srvWs.close(CLOSE_UNSUPPORTED_DATA, 'sync error');
          cleanup();
        }
      }
    });

    return [srvWs, cliWs];
  }

  private handleReady(_req: Request): Response {
    const [srvWs, cliWs] = this.setupClientSocket();
    return new Response(null, { status: 101, webSocket: cliWs });
  }

  /** Retry loading after interval; close with 4500 before that. */
  private handleLoadFailed(_req: Request): Response {
    const elapsed = Date.now() - this.failedAt;
    const canRetry = elapsed >= LOAD_RETRY_MIN_INTERVAL_MS;

    const pair = new WebSocketPair();
    try { pair[0].accept(); } catch {}

    if (canRetry) {
      // Attempt a single reload
      try {
        const tmpDoc = new Y.Doc();
        tmpDoc.getMap('meta').set('schemaVersion', 1);
        const tmpStore = new BoardStore(this._ctx.storage);
        tmpStore.migrate();
        const res = tmpStore.load(tmpDoc);
        if (res.ok) {
          this.doc = tmpDoc;
          this.store = tmpStore;
          this.state = 'ready';
          this.failedAt = 0;

          // Re-subscribe to document updates
          this.doc.on('update', (update: Uint8Array, origin: unknown) => {
            if (origin === LOAD_ORIGIN) return;
            this.tryAppendAndBroadcast(String(origin), update);
          });

          // Now serve the client as a normal ready connection
          const [srvWs, cliWs] = this.setupClientSocket();
          return new Response(null, { status: 101, webSocket: cliWs });
        }
      } catch { /* ignore reload failures */ }
    }

    // Before interval or still failing → close 4500
    pair[0].close(CLOSE_BOARD_LOAD_FAILED, 'Loading failed');
    return new Response(null, { status: 101, webSocket: pair[1] });
  }

  // ── Test hooks ───────────────────────────────────────────────────

  private async handleTestHooks(url: URL, req: Request): Promise<Response> {
    const parts = url.pathname.split('/');
    // Pattern: /__test/store/{boardId}/action

    if (parts[4] === 'row-counts') {
      try {
        const s = this._ctx.storage;
        const uc = Number(s.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM updates').next().value?.c ?? 0);
        const cc = Number(s.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM snapshot_chunks').next().value?.c ?? 0);
        const qc = Number(s.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM quarantined_updates').next().value?.c ?? 0);
        const bc = Number(s.sql.exec<{ b: number }>('SELECT COALESCE(SUM(bytes),0) as b FROM updates').next().value?.b ?? 0);
        return new Response(JSON.stringify({ updates: uc, chunks: cc, quarantined: qc, bytes: bc }), { headers: { 'Content-Type': 'application/json' }});
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    if (parts[4] === 'state') {
      return new Response(JSON.stringify({ state: this.state, notes: this.doc?.getMap('objects')?.size ?? 0 }), { headers: { 'Content-Type': 'application/json' }});
    }

    if (parts[4] === 'corrupt-snapshot') {
      try {
        const rbytes = new Uint8Array(64);
        crypto.getRandomValues(rbytes);
        this._ctx.storage.transactionSync(() => {
          this._ctx.storage.sql.exec('DELETE FROM snapshot_chunks WHERE idx = 0');
          this._ctx.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, rbytes.buffer as ArrayBuffer);
        });
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' }});
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    if (parts[4] === 'delete-all-chunks') {
      try {
        this._ctx.storage.sql.exec('DELETE FROM snapshot_chunks');
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' }});
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    if (parts[4] === 'overwrite-update') {
      try {
        const seq = parseInt(parts[5] || '-1', 10);
        if (seq < 0) return new Response(JSON.stringify({ error: 'missing seq' }), { status: 400 });
        const body = (await req.json()) as { bytes: number[] };
        const bytes = new Uint8Array(body.bytes);
        this._ctx.storage.sql.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = ?', bytes.buffer as ArrayBuffer, bytes.length, seq);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' }});
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    return new Response('unknown hook', { status: 404 });
  }
}
