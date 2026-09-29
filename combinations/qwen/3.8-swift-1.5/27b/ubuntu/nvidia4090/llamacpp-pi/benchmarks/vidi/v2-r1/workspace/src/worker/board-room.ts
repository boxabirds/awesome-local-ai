import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoder from 'lib0/encoding';
import * as decoder from 'lib0/decoding';
import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '../shared/protocol';
import { initDoc } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { RoomState } from './room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export class BoardRoom extends DurableObject {
  private store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private loadFailedAt: number = 0;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);

    ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  private async loadDoc(): Promise<void> {
    this.store.migrate();
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
        for (const ws of this.ctx.getWebSockets()) {
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
    const inner = encoder.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, MESSAGE_SYNC);
    encoder.writeVarUint8Array(frame, encoder.toUint8Array(inner));
    const bytes = encoder.toUint8Array(frame);

    for (const ws of this.ctx.getWebSockets()) {
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
          body: client,
        } as any);
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
          body: client,
        } as any);
      }
    }

    server.accept();
    this.handleConnect(server);

    return new Response(null, {
      status: 101,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      body: client,
    } as any);
  }

  private handleConnect(server: WorkersWebSocket): void {
    if (!this.doc) return;

    // Send SyncStep1
    const inner = encoder.createEncoder();
    syncProtocol.writeSyncStep1(inner, this.doc);
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, MESSAGE_SYNC);
    encoder.writeVarUint8Array(frame, encoder.toUint8Array(inner));
    server.send(encoder.toUint8Array(frame));

    server.onmessage = (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    };

    server.onclose = () => {};
    server.onerror = () => {};
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

    if (decoded.kind === 'query-awareness') {
      return;
    }

    if (decoded.kind === 'sync') {
      if (!this.doc) return;
      try {
        const dec = decoder.createDecoder(decoded.payload);
        const res = encoder.createEncoder();
        syncProtocol.readSyncMessage(dec, res, this.doc, ws);
        if (encoder.hasContent(res)) {
          const frame = encoder.createEncoder();
          encoder.writeVarInt(frame, MESSAGE_SYNC);
          encoder.writeVarUint8Array(frame, encoder.toUint8Array(res));
          ws.send(encoder.toUint8Array(frame));
        }
      } catch (e) {
        ws.close(CLOSE_UNSUPPORTED_DATA);
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      const frame = encoder.createEncoder();
      encoder.writeVarInt(frame, MESSAGE_AWARENESS);
      encoder.writeVarUint8Array(frame, decoded.payload);
      const bytes = encoder.toUint8Array(frame);
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(bytes);
        } catch {}
      }
      return;
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
            const rows = this.ctx.storage.sql.exec(data.query, ...(data.params || [])).toArray();
            return Response.json({ ok: true, rows });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) });
          }
        }
        case 'execute': {
          // SQL execution for damage injection (test only)
          try {
            this.ctx.storage.sql.exec(data.query, ...(data.params || []));
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
