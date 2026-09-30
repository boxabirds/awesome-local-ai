// BoardRoom: one Durable Object per board. Holds the board's Y.Doc in memory,
// saves every applied update to SQLite (BoardStore) before relaying it, and
// relays y-websocket sync and awareness messages between the board's sockets.
//
// Sockets use the hibernation API, so an idle board costs no compute; on wake the
// constructor reloads the doc from storage.
//
// Boards exist only once created through initialize() (story 5), or when they
// already hold saved content (legacy boards). Unknown boards are refused with 404
// and nothing is written for them.
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
  encodeSyncFrame,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import type { Env } from './index';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from './room-state';
import { TEST_HOOK_PATH, runRoomTestHook } from './test-hooks';

/** The externally visible room states (design persist.room contract). */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

const NORMAL_CLOSURE = 1000;

export class BoardRoom extends DurableObject<Env> {
  private lifecycle: RoomLifecycle = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private loadFailedAt = 0;
  /** Seam for integration tests that inject storage failures. */
  createStore: (storage: DurableObjectStorage) => BoardStore = (storage) => new BoardStore(storage);
  /** How often a load was attempted (integration tests check retries are rate-limited). */
  loadAttempts = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs on first use and on every wake from hibernation or eviction.
    void ctx.blockConcurrencyWhile(async () => this.load());
  }

  get state(): RoomState | 'loading' {
    if (this.lifecycle === 'load-failed' || this.lifecycle === 'storage-failed') return this.lifecycle;
    return this.lifecycle === 'loading' ? 'loading' : 'ready';
  }

  /** RPC (board creation): creates the tables and sets created_at once. */
  async initialize(): Promise<'created' | 'exists'> {
    return new BoardStore(this.ctx.storage).initialize();
  }

  /** RPC: read-only existence check (created_at, or legacy saved content). */
  async exists(): Promise<boolean> {
    return new BoardStore(this.ctx.storage).existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      const path = new URL(req.url).pathname;
      if (this.env.TEST_HOOKS === '1' && path.startsWith(TEST_HOOK_PATH)) {
        return runRoomTestHook(req, this.ctx.storage, {
          compact: () => (this.doc && this.store ? this.store.compact(this.doc) : false),
          reload: () => {
            this.closeAll(NORMAL_CLOSURE, 'Reloading');
            this.load();
            return this.state;
          },
        });
      }
      return new Response('Upgrade Required', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    // Connecting never creates a board (share.not_found).
    if (!new BoardStore(this.ctx.storage).existsReadOnly()) return new Response('Not Found', { status: 404 });
    if (this.lifecycle === 'load-failed' || this.lifecycle === 'storage-failed') {
      // A load-failed room retries at most every LOAD_RETRY_MIN_INTERVAL_MS.
      const next = nextRoomState(this.lifecycle, { type: 'connection', sinceLoadFailureMs: Date.now() - this.loadFailedAt });
      this.lifecycle = next;
      if (next === 'loading') this.load();
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const doc = this.doc;
    if (this.lifecycle !== 'ready' || !doc) {
      // Never serve an empty board in place of one that could not be loaded.
      this.close(server, CLOSE_BOARD_LOAD_FAILED, 'Board could not be loaded');
    } else {
      // Our state vector: a reconnecting client answers with everything we lack.
      this.send(server, encodeSyncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.lifecycle === 'load-failed') {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'Board could not be loaded');
      return;
    }
    const doc = this.doc;
    if (this.lifecycle !== 'ready' || !doc) {
      this.close(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
      return;
    }
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
        return;
      case 'awareness':
        // Relayed verbatim to everyone, sender included, so idle clients keep
        // receiving traffic within the y-websocket reconnect timeout.
        this.broadcast(data as ArrayBuffer, null);
        return;
      case 'query-awareness':
        return; // No awareness state is kept.
      case 'sync': {
        const decoder = decoding.createDecoder(msg.payload);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else {
            // SyncStep2 or Update, applied directly so an invalid update closes the
            // sender (and is never stored: it is applied before it is saved). The
            // socket is the origin, so the broadcast skips it.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          }
        } catch {
          this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
          return;
        }
        if (this.lifecycle !== 'ready') return; // saving it failed; every socket was closed
        if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        return;
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    void code;
    void reason;
    void wasClean;
    this.close(ws, NORMAL_CLOSURE, 'Closed');
  }

  webSocketError(ws: WebSocket, err: unknown): void {
    void err;
    this.close(ws, NORMAL_CLOSURE, 'Error');
  }

  /** (Re)loads the doc from storage; on failure the room refuses to serve the board. */
  private load(): void {
    this.loadAttempts++;
    this.lifecycle = 'loading';
    this.doc = null;
    this.store = null;
    const doc = new Y.Doc();
    let store: BoardStore;
    let result: LoadResult;
    try {
      store = this.createStore(this.ctx.storage);
      result = store.load(doc);
    } catch (e) {
      result = { ok: false, reason: 'sql-error', error: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      console.error(JSON.stringify({ event: 'board-room.load-failed', reason: result.reason, error: result.error }));
      this.loadFailedAt = Date.now();
      this.transition({ type: 'load-error' });
      doc.destroy();
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.store = store!;
    this.transition({ type: 'loaded', quarantined: result.quarantined });
  }

  /** Store first, then broadcast: nobody sees a change that is not saved (persist.seen_is_saved). */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc || !this.store) return;
    const store = this.store;
    try {
      store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-room.append-failed', error: e instanceof Error ? e.message : String(e) }));
      this.storageFailed();
      return;
    }
    this.transition({ type: 'update-stored' });
    // Output gates hold these sends until the insert above is durable.
    const frame = encodeSyncFrame((e) => syncProtocol.writeUpdate(e, update));
    this.broadcast(frame, origin instanceof WebSocket ? origin : null);
    if (store.needsCompaction()) {
      this.transition({ type: 'compaction-start' });
      const committed = store.compactIfNeeded(doc);
      this.transition({ type: committed ? 'compaction-committed' : 'compaction-rolled-back' });
    }
  }

  /**
   * Saving failed: the change is not broadcast, the doc is discarded and every
   * socket is closed. Clients reconnect and re-send what the reloaded room lacks.
   */
  private storageFailed(): void {
    this.transition({ type: 'append-failed' });
    this.doc = null;
    this.store = null;
    this.closeAll(CLOSE_STORAGE_FAILURE, 'Storage failure');
  }

  private transition(event: RoomEvent): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  private closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) this.close(ws, code, reason);
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closing.
    }
  }

  private broadcast(frame: ArrayBuffer | Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.send(ws, frame);
    }
  }

  private send(ws: WebSocket, frame: ArrayBuffer | Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      // Closed socket; the runtime drops it from getWebSockets().
    }
  }
}
