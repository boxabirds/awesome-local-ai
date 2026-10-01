import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState } from './room-state';
import type { RoomEvent, RoomLifecycle } from './room-state';
import type { Env } from './index';

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/**
 * One room per board. Every applied Yjs update is stored in the object's SQLite storage before it is
 * broadcast (output gates hold the broadcast until the write is durable); the doc is reloaded on wake.
 */
export class BoardRoom extends DurableObject<Env> {
  readonly store: BoardStore;
  private doc: Y.Doc | null = null;
  private lifecycle: RoomLifecycle = 'hibernated';
  private failedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      this.loadDoc();
    });
  }

  get state(): RoomLifecycle {
    return this.lifecycle;
  }

  private step(event: RoomEvent): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  /** Loads the doc from storage; on failure the room refuses to serve (never an empty doc). */
  private loadDoc(): void {
    this.lifecycle = 'loading';
    const doc = new Y.Doc();
    let ok = false;
    try {
      const result = this.store.load(doc);
      ok = result.ok;
      if (!result.ok) console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-load-failed', reason: 'sql-error', error: String(e) }));
    }
    if (!ok) {
      this.doc = null;
      this.failedAt = Date.now();
      this.step({ type: 'load-error' });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.step({ type: 'loaded' });
  }

  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'storage-failed', error: String(e) }));
      this.failStorage();
      return;
    }
    this.step({ type: 'update-stored' });
    const message = syncMessage((e) => syncProtocol.writeUpdate(e, update));
    for (const ws of this.ctx.getWebSockets()) if (ws !== origin) this.send(ws, message);
    this.step({ type: 'compact-start' });
    const compacted = this.store.compactIfNeeded(doc);
    this.step({ type: compacted ? 'compact-done' : 'compact-error' });
  }

  /** The change was not saved: nobody is told about it, every client reconnects and re-sends what it holds. */
  private failStorage(): void {
    this.step({ type: 'append-failed' });
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
    this.step({ type: 'sockets-closed' }); // doc is gone: the next connection loads again
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      // socket already gone; hibernation runtime delivers the close event
    }
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** RPC: makes this board exist (tables + `created_at`). */
  initialize(): 'created' | 'exists' {
    return this.store.initialize() ? 'created' : 'exists';
  }

  /** RPC: read-only existence check. */
  exists(): boolean {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    if (!this.store.existsReadOnly()) return new Response('Not Found', { status: 404 });
    if (this.lifecycle === 'load-failed') {
      const next = nextRoomState('load-failed', {
        type: 'connect',
        sinceFailureMs: Date.now() - this.failedAt,
        retryAfterMs: LOAD_RETRY_MIN_INTERVAL_MS,
      });
      if (next === 'loading') this.loadDoc();
    } else if (!this.doc) {
      this.loadDoc(); // storage failed or the doc was dropped
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (this.lifecycle === 'load-failed' || !this.doc) {
      this.closeSocket(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    } else {
      // Ask the newcomer for what we lack: repopulates a restarted room from the first reconnecting client.
      this.send(server, syncMessage((e) => syncProtocol.writeSyncStep1(e, this.doc as Y.Doc)));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.lifecycle === 'load-failed') return this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    const doc = this.doc;
    if (!doc) return this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'query-awareness':
        return;
      case 'awareness':
        for (const other of this.ctx.getWebSockets()) this.send(other, new Uint8Array(data as ArrayBuffer));
        return;
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(msg.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
            // Applied (validated) before it is stored; y-protocols' own reader swallows bad updates.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          } else {
            throw new Error(`unknown sync type ${syncType}`);
          }
          if (this.doc !== doc) return; // storage failed while applying: sockets are already closed
          if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        } catch {
          if (this.doc === doc) this.reject(ws);
        }
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    this.closeSocket(ws, code === 1005 || code === 1006 ? 1000 : code, 'closing');
  }

  webSocketError(ws: WebSocket): void {
    this.closeSocket(ws, 1011, 'error');
  }

  private reject(ws: WebSocket): void {
    this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
  }

  /** Drops the in-memory doc and loads again from storage (used by tests and test hooks). */
  reload(): RoomLifecycle {
    this.loadDoc();
    return this.lifecycle;
  }

  /** Test-only (env.TEST_HOOKS === '1'): compacts, saves snapshot chunk 0 aside and damages it. */
  testCorruptSnapshot(): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    if (!this.doc) this.loadDoc();
    if (this.doc) this.store.compactIfNeeded(this.doc, true);
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS test_chunk_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    const first = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
    if (!first) throw new Error('no snapshot to corrupt');
    const original = new Uint8Array(first.data as ArrayBuffer);
    sql.exec('INSERT OR REPLACE INTO test_chunk_backup (idx, data) VALUES (0, ?)', original.slice());
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice(0, Math.max(0, original.length - 10)));
    for (const ws of this.ctx.getWebSockets()) this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'test reset');
    this.doc = null;
    this.lifecycle = 'hibernated';
  }

  /** Test-only: stores one update the way boards were saved before creation was explicit (no `created_at`). */
  testSeedLegacy(update: Uint8Array): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    this.store.migrate();
    this.store.append(update);
    this.loadDoc();
  }

  testRepairSnapshot(): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    const sql = this.ctx.storage.sql;
    const saved = sql.exec('SELECT data FROM test_chunk_backup WHERE idx = 0').toArray()[0];
    if (!saved) throw new Error('nothing to repair');
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', new Uint8Array(saved.data as ArrayBuffer).slice());
  }
}
