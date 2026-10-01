import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { SNAPSHOT_CHUNK_BYTES } from '../shared/config';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from './room-state';
import type { Env } from './index';

/**
 * One board: a Y.Doc backed by the object's SQLite storage. Every applied update is stored before it is
 * broadcast; sockets use the hibernation API so an idle board costs nothing.
 */
export class BoardRoom extends DurableObject<Env> {
  /** Public so tests can wrap it to inject storage failures. */
  store: BoardStore;
  doc: Y.Doc | null = null;
  lifecycle: RoomLifecycle = 'loading';
  loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.loadNow());
  }

  private step(event: RoomEvent): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  /** (Re)loads the doc from storage into a fresh Y.Doc; a failure leaves the room in load-failed. */
  loadNow(): void {
    this.doc = null;
    this.lifecycle = 'loading';
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    let result;
    try {
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false as const, reason: 'sql-error' as const, error: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      console.error(JSON.stringify({ event: 'load-failed', reason: result.reason, error: result.error }));
      this.loadFailedAt = Date.now();
      this.step({ type: 'load-failed' });
      return;
    }
    this.doc = doc;
    this.step({ type: result.quarantined > 0 ? 'loaded-quarantined' : 'loaded' });
  }

  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      // A single row must stay far below the platform row limit: a huge update goes into snapshot chunks.
      if (update.length > SNAPSHOT_CHUNK_BYTES) {
        if (!this.store.compact(doc)) throw new Error('could not store oversized update');
      } else {
        this.store.append(update);
      }
    } catch (e) {
      console.error(JSON.stringify({ event: 'append-failed', error: e instanceof Error ? e.message : String(e) }));
      this.resetAfterStorageFailure();
      return;
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    // Outgoing messages are held by the output gate until the insert above is durable.
    for (const s of this.ctx.getWebSockets()) if (s !== origin) this.send(s, msg);
    this.step({ type: 'compact-start' });
    this.step({ type: this.store.compactIfNeeded(doc) ? 'compact-done' : 'compact-rollback' });
  }

  private resetAfterStorageFailure(): void {
    this.step({ type: 'append-failed' });
    this.doc = null;
    for (const s of this.ctx.getWebSockets()) this.closeSocket(s, CLOSE_STORAGE_FAILURE, 'storage failure');
    this.step({ type: 'reset' });
    // The next connection reloads from storage (lifecycle 'loading' with no doc).
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      /* socket already gone */
    }
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** The doc to serve, reloading when a retry is due; null when the board cannot be loaded. */
  private ensureDoc(): Y.Doc | null {
    if (this.lifecycle === 'load-failed') {
      const msSinceLoadFailure = Date.now() - this.loadFailedAt;
      if (nextRoomState('load-failed', { type: 'connect', msSinceLoadFailure }) === 'loading') this.loadNow();
    } else if (!this.doc) {
      this.loadNow();
    }
    return this.lifecycle === 'load-failed' ? null : this.doc;
  }

  /** RPC: creates the board (tables + created_at) unless it already exists. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize();
  }

  /** RPC: read-only existence check. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    if (!this.store.existsReadOnly()) return new Response('Not Found', { status: 404 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const doc = this.ensureDoc();
    if (!doc) {
      this.closeSocket(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    this.send(server, encoding.toUint8Array(enc));
    return new Response(null, { status: 101, webSocket: client });
  }

  private reject(ws: WebSocket): void {
    this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.lifecycle === 'load-failed') return this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    const doc = this.doc ?? this.ensureDoc();
    if (!doc) return this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    const msg = decodeMessage(data);
    if (msg.kind === 'invalid') return this.reject(ws);
    if (msg.kind === 'query-awareness') return;
    if (msg.kind === 'awareness') {
      // Relayed verbatim to everyone, sender included (keeps idle clients alive); not interpreted.
      const bytes = new Uint8Array(data as ArrayBuffer);
      for (const s of this.ctx.getWebSockets()) this.send(s, bytes);
      return;
    }
    try {
      const decoder = decoding.createDecoder(msg.payload);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const syncType = decoding.readVarUint(decoder);
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, enc, doc);
      } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
        // Applied (and thereby stored, then broadcast) directly: y-protocols swallows decode errors.
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
      } else {
        throw new Error(`unknown sync message type ${syncType}`);
      }
      if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
    } catch {
      this.reject(ws);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // Echo the close (code 1005/1006 may not be sent back).
    this.closeSocket(ws, code === 1005 || code === 1006 || code === 1015 ? 1000 : code, 'closing');
  }

  webSocketError(ws: WebSocket): void {
    this.closeSocket(ws, 1011, 'error');
  }

  // --- Test hooks (reachable only through src/worker/test-hooks.ts, which needs env.TEST_HOOKS === '1') ---

  /** Forces a snapshot, keeps its first chunk aside and overwrites it with a truncated copy. */
  testCorruptSnapshot(): void {
    const doc = this.doc;
    if (!doc) throw new Error('no doc');
    const sql = this.ctx.storage.sql;
    this.store.compact(doc);
    sql.exec('CREATE TABLE IF NOT EXISTS test_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('DELETE FROM test_backup');
    sql.exec('INSERT INTO test_backup (idx, data) SELECT idx, data FROM snapshot_chunks WHERE idx = 0');
    const chunk = new Uint8Array(sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', chunk.slice(0, Math.max(1, chunk.length - 10)));
    this.loadNow();
    for (const s of this.ctx.getWebSockets()) this.closeSocket(s, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
  }

  /** A board from before explicit creation: saved content in the log but no created_at. */
  testSeedLegacy(update: Uint8Array): void {
    this.store.migrate();
    this.store.append(update);
    this.loadNow();
  }

  testRepairSnapshot(): void {
    const sql = this.ctx.storage.sql;
    sql.exec('UPDATE snapshot_chunks SET data = (SELECT data FROM test_backup WHERE idx = 0) WHERE idx = 0');
  }
}
