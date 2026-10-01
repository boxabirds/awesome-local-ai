import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState, type RoomPhase } from './room-state';
import { handleTestHook } from './test-hooks';
import type { Env } from './index';

type RoomState = 'ready' | 'load-failed' | 'storage-failed';

/**
 * One room per board. Every update is applied to the in-memory Y.Doc, appended to Durable Object
 * SQLite storage and only then broadcast (output gates hold the sends until the write is durable).
 * Sockets use the hibernation API, so an idle board costs no compute.
 */
export class BoardRoom extends DurableObject<Env> {
  readonly store: BoardStore;
  readonly sql: SqlStorage;
  readonly testHooks: boolean;
  doc: Y.Doc | null = null;
  private phase: RoomPhase = 'loading';
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.sql = ctx.storage.sql;
    this.testHooks = env.TEST_HOOKS === '1';
    ctx.blockConcurrencyWhile(async () => { this.loadFromStorage(); });
  }

  get state(): RoomState {
    if (this.phase === 'load-failed') return 'load-failed';
    if (this.phase === 'storage-failed') return 'storage-failed';
    return 'ready';
  }

  /** (Re)loads the doc from storage; a failure puts the room in load-failed (never an empty doc). */
  loadFromStorage(): void {
    this.phase = 'loading';
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    if (!result.ok) {
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      doc.destroy();
      this.doc = null;
      this.loadFailedAt = Date.now();
      this.phase = nextRoomState('loading', { type: 'load-error' });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.phase = nextRoomState('loading', { type: 'loaded' });
  }

  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'storage-failed', error: e instanceof Error ? e.message : String(e) }));
      this.failStorage();
      return;
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== origin) this.send(ws, msg);
    }
    this.phase = nextRoomState(this.phase, { type: 'compact-start' });
    const ok = this.store.compactIfNeeded(doc);
    this.phase = nextRoomState(this.phase, { type: ok ? 'compact-done' : 'compact-failed' });
  }

  /** The unsaved change is never broadcast: close everyone and discard the doc; clients re-send on reconnect. */
  private failStorage(): void {
    this.phase = nextRoomState(this.phase, { type: 'append-failed' });
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) this.close(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
  }

  private send(ws: WebSocket, msg: Uint8Array): void {
    try { ws.send(msg); } catch { /* socket already gone */ }
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  /** RPC: marks a new board as existing. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize();
  }

  /** RPC: read-only existence check. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    const hook = await handleTestHook(this, req);
    if (hook) return hook;
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    if (!this.store.existsReadOnly()) return new Response('Not Found', { status: 404 });
    if (this.phase === 'storage-failed') {
      this.phase = nextRoomState(this.phase, { type: 'reset' });
      this.loadFromStorage();
    } else if (this.phase === 'load-failed') {
      const since = Date.now() - this.loadFailedAt;
      if (nextRoomState(this.phase, { type: 'connect', sinceLoadFailedMs: since }) === 'loading') {
        this.loadFromStorage();
      }
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    if (this.state === 'load-failed' || !this.doc) {
      this.close(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    } else {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.send(server, encoding.toUint8Array(enc));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const doc = this.doc;
    if (this.state === 'load-failed') { this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded'); return; }
    if (this.state === 'storage-failed' || !doc) { this.close(ws, CLOSE_STORAGE_FAILURE, 'storage failure'); return; }
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'invalid':
        this.close(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
        return;
      case 'query-awareness':
        return; // no awareness state is kept
      case 'awareness':
        // Relayed verbatim to everyone, including the sender, so idle clients keep receiving traffic.
        for (const s of this.ctx.getWebSockets()) this.send(s, new Uint8Array(data as ArrayBuffer));
        return;
      case 'sync': {
        try {
          this.validate(decoded.payload);
          const decoder = decoding.createDecoder(decoded.payload);
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, ws);
          if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
        } catch {
          this.close(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
        }
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // Echo the close so the socket leaves getWebSockets(); 1005/1006 cannot be sent.
    this.close(ws, code === 1005 || code === 1006 || code === 1015 ? 1000 : code, 'closing');
  }

  webSocketError(ws: WebSocket): void {
    this.close(ws, 1011, 'error');
  }

  /** Yjs swallows malformed updates while applying them, so reject them up front. */
  private validate(payload: Uint8Array): void {
    const d = decoding.createDecoder(payload);
    const type = decoding.readVarUint(d);
    if (type === syncProtocol.messageYjsSyncStep2 || type === syncProtocol.messageYjsUpdate) {
      Y.decodeUpdate(decoding.readVarUint8Array(d));
    } else if (type === syncProtocol.messageYjsSyncStep1) {
      decoding.readVarUint8Array(d);
    } else {
      throw new Error('unknown sync message');
    }
  }
}
