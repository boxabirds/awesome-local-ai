import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomLifecycle } from './room-state';
import { corruptSnapshot, repairSnapshot } from './test-hooks';
import type { Env } from './index';

const WS_OPEN = 1;

type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject<Env> {
  /** Exposed (not private) so integration tests can inject storage failures around it. */
  store: BoardStore;
  doc: Y.Doc | null = null;
  state: RoomState = 'ready';
  /** When the room last failed to load; a retry needs LOAD_RETRY_MIN_INTERVAL_MS to have passed. */
  loadFailedAt = 0;
  private lifecycle: RoomLifecycle = 'loading';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => { this.load(); });
  }

  private transition(event: Parameters<typeof nextRoomState>[1]): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  private load(): void {
    this.lifecycle = 'loading';
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false, reason: 'sql-error', error: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      doc.destroy();
      this.doc = null;
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      this.transition({ type: 'load-failed' });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.state = 'ready';
    this.transition({ type: 'loaded', quarantined: result.quarantined });
  }

  /** Stores the update, and only then broadcasts it (output gates hold the send until the write is durable). */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-append-failed', error: e instanceof Error ? e.message : String(e) }));
      this.resetRoom();
      return;
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null, false);
    this.transition({ type: 'compact-start' });
    const compacted = this.store.compactIfNeeded(doc);
    this.transition({ type: compacted ? 'compact-done' : 'compact-error' });
  }

  /** Storage failed: nothing was broadcast; drop everyone so they reconnect and re-send what is unsaved. */
  resetRoom(): void {
    this.state = 'storage-failed';
    this.transition({ type: 'append-failed' });
    this.doc?.destroy();
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(CLOSE_STORAGE_FAILURE, 'storage failure'); } catch { /* already closed */ }
    }
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WS_OPEN) return;
    try { ws.send(data); } catch { /* socket gone */ }
  }

  private broadcast(data: Uint8Array, except: WebSocket | null, includeSender: boolean): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (!includeSender && ws === except) continue;
      this.send(ws, data);
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    if (this.state === 'storage-failed'
      || (this.state === 'load-failed' && Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS)) {
      this.transition({ type: 'connection', sinceLoadFailedMs: Date.now() - this.loadFailedAt });
      this.load();
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    if (this.state !== 'ready' || !this.doc) {
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(server, encoding.toUint8Array(enc));
    return new Response(null, { status: 101, webSocket: client });
  }

  private reject(ws: WebSocket, code = CLOSE_UNSUPPORTED_DATA, reason = 'unsupported data'): void {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.state === 'load-failed') return this.reject(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    const doc = this.doc;
    if (this.state === 'storage-failed' || !doc) return this.reject(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'query-awareness':
        return;
      case 'awareness':
        this.broadcast(msg.payload, null, true);
        return;
      case 'sync': {
        try {
          // Y.applyUpdate swallows decode errors (logs and ignores), so validate updates first.
          const probe = decoding.createDecoder(msg.payload);
          decoding.readVarUint(probe); // message type
          const subType = decoding.readVarUint(probe);
          if (subType === syncProtocol.messageYjsSyncStep2 || subType === syncProtocol.messageYjsUpdate) {
            Y.decodeUpdate(decoding.readVarUint8Array(probe));
          }
          const decoder = decoding.createDecoder(msg.payload);
          decoding.readVarUint(decoder); // message type
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, ws);
          if (encoding.length(enc) > 1 && this.doc === doc) this.send(ws, encoding.toUint8Array(enc));
        } catch {
          this.reject(ws);
        }
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // Complete the closing handshake (1005/1006/1015 are reserved and cannot be sent).
    const reserved = code === 1005 || code === 1006 || code === 1015;
    try { ws.close(reserved ? 1000 : code); } catch { /* already closed */ }
  }

  webSocketError(ws: WebSocket, err: unknown): void {
    console.error(JSON.stringify({ event: 'websocket-error', error: err instanceof Error ? err.message : String(err) }));
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }

  /** Test-only RPC; refuses unless the e2e worker was started with TEST_HOOKS=1. */
  testHook(op: 'corrupt-snapshot' | 'repair'): string {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    if (op === 'corrupt-snapshot') {
      if (this.doc) this.store.compactIfNeeded(this.doc, true);
      const done = corruptSnapshot(this.ctx.storage);
      if (this.state === 'ready') this.resetRoom();
      return done;
    }
    return repairSnapshot(this.ctx.storage);
  }
}
