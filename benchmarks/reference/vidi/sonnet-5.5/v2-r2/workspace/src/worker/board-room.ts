import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { Env } from './index';

type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * One room per board. Every applied update is appended to Durable Object SQLite before it is
 * broadcast (output gates hold the broadcast until the write is durable). Sockets use the
 * hibernation API, so an idle board costs no compute and reloads from storage on wake.
 */
export class BoardRoom extends DurableObject<Env> {
  /** Exposed so integration tests can inject storage failures. */
  store: BoardStore;
  doc: Y.Doc | null = null;
  state: RoomState = 'ready';
  private failedAt = 0;
  /** Resolves once the initial load has finished (tests await it on hand-built instances). */
  readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.ready = ctx.blockConcurrencyWhile(async () => this.load());
  }

  /** Loads the board from storage; on failure the room refuses to serve (never an empty doc). */
  load(): void {
    this.doc = null;
    try {
      this.store.migrate();
    } catch (e) {
      console.error(JSON.stringify({ event: 'migrate-failed', error: String(e) }));
      this.fail();
      return;
    }
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    if (!result.ok) {
      this.fail();
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(update, origin));
    this.doc = doc;
    this.state = 'ready';
  }

  private fail(): void {
    this.doc = null;
    this.state = 'load-failed';
    this.failedAt = Date.now();
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'append-failed', error: String(e) }));
      this.resetRoom();
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | null);
    if (this.doc) this.store.compactIfNeeded(this.doc);
  }

  /** Storage failed: nothing was broadcast; drop all sockets and the doc, reload on next use. */
  private resetRoom(): void {
    this.state = 'storage-failed';
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* already closed */ }
    }
    this.doc = null;
  }

  /** Returns a ready doc, or null when the room must refuse (the caller closes the socket). */
  private ensureDoc(): Y.Doc | null {
    if (this.state === 'storage-failed') this.load();
    else if (this.state === 'load-failed' && Date.now() - this.failedAt >= LOAD_RETRY_MIN_INTERVAL_MS) this.load();
    return this.state === 'ready' ? this.doc : null;
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    const doc = this.ensureDoc();
    if (!doc) {
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(server, encoding.toUint8Array(encoder));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      this.close(ws, CLOSE_STORAGE_FAILURE);
      return;
    }
    const doc = this.doc;
    if (!doc) {
      this.close(ws, CLOSE_STORAGE_FAILURE);
      return;
    }
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(msg.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
            // Applied directly: y-protocols' readSyncUpdate swallows errors, but a bad update must close the socket.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          } else {
            throw new Error(`unknown sync message type ${syncType}`);
          }
          if (this.state !== 'ready') return; // storage failed while applying; sockets already closed
          if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        } catch {
          if (this.state === 'ready') this.close(ws, CLOSE_UNSUPPORTED_DATA);
        }
        return;
      }
      case 'awareness':
        // Relayed verbatim to everyone, sender included, so idle clients keep receiving traffic.
        this.broadcast(new Uint8Array(data as ArrayBuffer), null);
        return;
      case 'query-awareness':
        return;
      default:
        this.close(ws, CLOSE_UNSUPPORTED_DATA);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // Complete the closing handshake; the runtime already dropped the socket from getWebSockets().
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
  }

  webSocketError(ws: WebSocket, _err: unknown): void {
    try { ws.close(1011); } catch { /* already closed */ }
  }

  private close(ws: WebSocket, code: number): void {
    try { ws.close(code); } catch { /* already closed */ }
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch { /* socket is closing */ }
  }

  private broadcast(data: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.send(ws, data);
    }
  }

  // Test-only helpers, reachable through the TEST_HOOKS routes in test-hooks.ts.

  /** Compacts now, then saves chunk 0 and overwrites it with garbage; the room reloads and fails. */
  testCorruptSnapshot(): void {
    if (this.doc) this.store.compactNow(this.doc);
    const sql = this.ctx.storage.sql;
    const row = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
    if (!row) throw new Error('no snapshot to corrupt');
    const original = new Uint8Array(row.data as ArrayBuffer);
    this.ctx.storage.kv.put('test:chunk0', original);
    const garbage = new Uint8Array(original.length).fill(0xff);
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);
    this.resetRoom();
    this.load();
  }

  testRepairSnapshot(): void {
    const original = this.ctx.storage.kv.get<Uint8Array>('test:chunk0');
    if (!original) throw new Error('nothing to repair');
    this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
  }
}
