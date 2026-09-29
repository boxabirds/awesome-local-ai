import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoder from 'lib0/encoding';
import * as decoder from 'lib0/decoding';
import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import {
  decodeMessage,
  encodeSyncFrame,
  encodeAwarenessFrame,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { initDoc } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { RoomState } from './room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * Convert SQL params that crossed a JSON boundary (BLOBs arrive as plain
 * number arrays) into the `ArrayBuffer` form workerd's Durable Object SQLite
 * expects for BLOB bindings. Non-array params pass through unchanged.
 */
function toSqlParams(params: any[]): any[] {
  return (params || []).map((p) => {
    if (Array.isArray(p)) {
      const u8 = new Uint8Array(p.length);
      for (let i = 0; i < p.length; i++) u8[i] = p[i];
      return u8.buffer;
    }
    return p;
  });
}

export class BoardRoom extends DurableObject {
  private store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  // Track connected sockets ourselves: with the client/server WebSocketPair
  // split (required for the 101 response at the DO RPC boundary in workerd
  // local mode), `ctx.getWebSockets()` does not return the accepted halves.
  private sockets = new Set<WorkersWebSocket>();
  private loadFailedAt: number = 0;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);

    ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  /**
   * RPC: initialize this board (share.board_api).
   *
   * Runs the schema migration and sets `storage_meta.created_at` exactly once.
   * Returns `created` the first time and `exists` on any later call; an
   * existing board is never re-initialised (TC-15).
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const sql = this.ctx.storage.sql;
    const existing = sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").next();
    if (!existing.done) {
      return 'exists';
    }
    sql.exec("INSERT INTO storage_meta (key, value) VALUES (?, ?)", 'created_at', String(Date.now()));
    return 'created';
  }

  /**
   * RPC: read-only existence check (share.board_api).
   * True if `created_at` is set, or the board has legacy data
   * (updates/snapshot_chunks rows) without `created_at`.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /**
   * RPC: re-load the live doc from storage (test hook: seed-legacy).
   * The seed writes `updates` rows directly to storage, which may happen
   * after the DO was first constructed (empty doc). Reloading picks up the
   * newly written rows so connected clients see the seeded content.
   */
  async reload(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  private async loadDoc(): Promise<void> {
    // migrate() no longer runs on construct (story 5): only initialize() and
    // the first append() migrate. load() treats missing tables as empty.
    const doc = new Y.Doc();
    initDoc(doc);

    const result = this.store.load(doc);

    if (result.ok) {
      this.doc = doc;
      this.state = 'ready';
      this.setupUpdateHandler();
    } else {
      this.doc = null;
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
    }
  }

  private setupUpdateHandler(): void {
    if (!this.doc) return;
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;

      // Store before broadcast
      try {
        this.store.append(update);
      } catch (e) {
        // Storage failure: close all sockets, discard doc
        this.state = 'storage-failed';
        this.doc = null;
        this.updateHandler = null;
        for (const ws of this.sockets) {
          try { ws.close(CLOSE_STORAGE_FAILURE); } catch {}
        }
        return;
      }

      // Broadcast to all except origin
      this.broadcast(update);

      // Compact if needed
      if (this.doc) {
        this.store.compactIfNeeded(this.doc);
      }
    };
    this.doc.on('update', this.updateHandler);
  }

  private broadcast(update: Uint8Array): void {
    if (!this.doc) return;
    // y-websocket frame: varuint(0) + raw Update sync message.
    const inner = encoder.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const bytes = encodeSyncFrame(encoder.toUint8Array(inner));

    for (const ws of this.sockets) {
      try {
        ws.send(bytes);
      } catch {}
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Test storage endpoint
    if (url.pathname === '/__test/storage') {
      return this.handleTestStorage(req);
    }

    // Reject non-existent boards before accepting (share.not_found): rooms can
    // no longer be created implicitly by connecting. This is a read-only
    // check; nothing is written for an unknown board.
    if (!this.store.existsReadOnly()) {
      return new Response('Board Not Found', { status: 404 });
    }

    // Normal WebSocket upgrade
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // If load-failed, check retry interval
    if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Retry load
        this.state = 'loading';
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.loadDoc();
        });
      }

      if (this.state === 'load-failed') {
        // Still failing: accept then close
        server.accept();
        server.close(CLOSE_BOARD_LOAD_FAILED);
        return new Response(null, {
          status: 101,
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
          webSocket: client,
        } as ResponseInit);
      }
    }

    // If storage-failed, close with 1011
    if (this.state === 'storage-failed') {
      // Try to reload
      this.state = 'loading';
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.loadDoc();
      });

      const currentState: string = this.state;
      if (currentState === 'storage-failed' || currentState === 'load-failed') {
        server.accept();
        server.close(CLOSE_STORAGE_FAILURE);
        return new Response(null, {
          status: 101,
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
          webSocket: client,
        } as ResponseInit);
      }
    }

    server.accept();
    this.handleConnect(server);

    // Return the client half of the pair; the accepted server half stays in
    // the DO. (Returning the accepted socket itself — or `body:` — breaks
    // the 101 response at the DO RPC boundary in workerd local mode.)
    return new Response(null, {
      status: 101,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      webSocket: client,
    } as ResponseInit);
  }

  private handleConnect(server: WorkersWebSocket): void {
    if (!this.doc) return;

    this.sockets.add(server);

    // Send SyncStep1: y-websocket frame varuint(0) + raw SyncStep1 message.
    const inner = encoder.createEncoder();
    syncProtocol.writeSyncStep1(inner, this.doc);
    server.send(encodeSyncFrame(encoder.toUint8Array(inner)));

    server.onmessage = (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    };

    server.onclose = () => {
      this.sockets.delete(server);
    };
    server.onerror = () => {
      this.sockets.delete(server);
    };
  }

  private handleMessage(ws: WorkersWebSocket, data: ArrayBuffer | string): void {
    // Check state first
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }

    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    // Awareness frame (outer type 1): relay to all connected sockets.
    if (decoded.kind === 'awareness') {
      const bytes = encodeAwarenessFrame(decoded.awarenessBytes);
      for (const socket of this.sockets) {
        try {
          socket.send(bytes);
        } catch {}
      }
      return;
    }

    // Query-awareness (outer type 3): reply with the (empty) awareness state.
    if (decoded.kind === 'query-awareness') {
      ws.send(encodeAwarenessFrame(new Uint8Array(0)));
      return;
    }

    // Sync frame (outer type 0): `rest` is the raw y-protocols sync message.
    if (!this.doc) return;
    try {
      const dec = decoder.createDecoder(decoded.rest);
      const res = encoder.createEncoder();
      syncProtocol.readSyncMessage(dec, res, this.doc, ws);
      if (encoder.hasContent(res)) {
        ws.send(encodeSyncFrame(encoder.toUint8Array(res)));
      }
    } catch (e) {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private handleTestStorage(req: Request): Promise<Response> {
    return req.json().then(async (body: any) => {
      const { operation, data } = body;

      switch (operation) {
        case 'migrate': {
          this.store.migrate();
          return Response.json({ ok: true });
        }
        case 'append': {
          const update = new Uint8Array(data);
          this.store.append(update);
          return Response.json({ ok: true });
        }
        case 'load': {
          const doc = new Y.Doc();
          initDoc(doc);
          const result = this.store.load(doc);
          const encoded = Y.encodeStateAsUpdate(doc);
          return Response.json({ ...result, docBytes: Array.from(encoded) });
        }
        case 'compact': {
          const doc = new Y.Doc();
          initDoc(doc);
          const loadResult = this.store.load(doc);
          if (!loadResult.ok) {
            return Response.json({ ok: false, reason: loadResult.reason, error: loadResult.error });
          }
          const compacted = this.store.compactIfNeeded(doc);
          return Response.json({ ok: true, compacted });
        }
        case 'query': {
          // Read-only SQL query for test assertions
          try {
            const rows = this.ctx.storage.sql.exec(data.query, ...toSqlParams(data.params)).toArray();
            return Response.json({ ok: true, rows });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'execute': {
          // SQL execution for damage injection (test only)
          try {
            this.ctx.storage.sql.exec(data.query, ...toSqlParams(data.params));
            return Response.json({ ok: true });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'get-state': {
          return Response.json({ ok: true, state: this.state });
        }
        case 'set-state': {
          this.state = data.state as RoomState;
          if (data.state === 'load-failed') {
            this.loadFailedAt = data.loadFailedAt || Date.now();
          }
          return Response.json({ ok: true });
        }
        case 'force-load-failed': {
          this.state = 'load-failed';
          this.loadFailedAt = Date.now() - (data.elapsedMs || 0);
          this.doc = null;
          return Response.json({ ok: true });
        }
        case 'get-updates-count': {
          const r = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM updates').next();
          return Response.json({ ok: true, count: r.done ? 0 : r.value.cnt });
        }
        case 'get-snapshot-chunks-count': {
          const r = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next();
          return Response.json({ ok: true, count: r.done ? 0 : r.value.cnt });
        }
        case 'get-quarantined-count': {
          const r = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM quarantined_updates').next();
          return Response.json({ ok: true, count: r.done ? 0 : r.value.cnt });
        }
        case 'get-through-seq': {
          const r = this.ctx.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").next();
          return Response.json({ ok: true, throughSeq: r.done ? 0 : parseInt(r.value.value, 10) });
        }
        case 'get-schema-version': {
          const r = this.ctx.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'").next();
          return Response.json({ ok: true, version: r.done ? null : parseInt(r.value.value, 10) });
        }
        case 'get-update-row': {
          const r = this.ctx.storage.sql.exec('SELECT seq, bytes FROM updates WHERE seq = ?', data.seq).next();
          return Response.json({ ok: true, row: r.done ? null : r.value });
        }
        case 'corrupt-update-row': {
          // Overwrite a specific update row's data with damaged bytes
          try {
            const damaged = new Uint8Array(data.damagedBytes);
            this.ctx.storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged.buffer.slice(damaged.byteOffset, damaged.byteOffset + damaged.byteLength), data.seq);
            return Response.json({ ok: true });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'corrupt-snapshot-chunk': {
          // Overwrite a specific snapshot chunk with damaged bytes
          try {
            const damaged = new Uint8Array(data.damagedBytes);
            this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', damaged.buffer.slice(damaged.byteOffset, damaged.byteOffset + damaged.byteLength), data.idx);
            return Response.json({ ok: true });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'get-snapshot-chunk': {
          const r = this.ctx.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', data.idx).next();
          return Response.json({ ok: true, data: r.done ? null : Array.from(r.value.data as Uint8Array) });
        }
        case 'restore-snapshot-chunk': {
          try {
            const bytes = new Uint8Array(data.bytes);
            this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), data.idx);
            return Response.json({ ok: true });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'reset-store-counters': {
          // Re-read counters from DB
          const r = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates').next();
          (this.store as any).rowCount = r.done ? 0 : r.value.cnt;
          (this.store as any).byteTotal = r.done ? 0 : r.value.total;
          return Response.json({ ok: true });
        }
        default:
          return Response.json({ ok: false, error: `unknown operation: ${operation}` });
      }
    });
  }
}
