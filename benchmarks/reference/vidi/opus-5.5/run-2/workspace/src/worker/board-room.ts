/**
 * One BoardRoom per board (anchors: sync.room, persist.room): holds the board's Y.Doc in
 * memory, relays y-websocket sync and awareness messages between every socket on the
 * board, and persists every applied update through BoardStore before broadcasting it.
 *
 * - Load on construct/wake inside `blockConcurrencyWhile`; a board whose snapshot cannot
 *   be read (or whose storage cannot be queried) is `load-failed`: sockets are accepted and
 *   closed with CLOSE_BOARD_LOAD_FAILED, and loading is retried by a new connection at most
 *   every LOAD_RETRY_MIN_INTERVAL_MS. It never serves an empty doc in place of a saved one.
 * - Write before broadcast: the SQL insert happens in the same turn the update is applied,
 *   and Durable Object output gates hold the broadcast until the write is durable.
 * - A failed insert resets the room (`storage-failed`): no broadcast, every socket closed
 *   with CLOSE_STORAGE_FAILURE, doc discarded. Reconnecting clients re-send what the reloaded
 *   room lacks through the SyncStep1/SyncStep2 handshake.
 * - Existence (share.board_api): `initialize()` (RPC, from board creation) is the only way a
 *   new board comes to be; `exists()` and `fetch` only read, and `fetch` answers 404 before
 *   accepting a socket for a board that does not exist.
 * - Sockets use the hibernation API; `ctx.getWebSockets()` is the list of connected sockets,
 *   so an idle board costs no compute and its sockets survive the object being evicted.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { INITIAL_ROOM_STATE, nextRoomState, type RoomEvent, type RoomLifecycle } from './room-state';
import { TestHookError, corruptSnapshot, repairSnapshot, seedLegacyBoard } from './test-hooks';
import type { Env } from './index';

const SWITCHING_PROTOCOLS = 101;
const NOT_FOUND = 404;
const UPGRADE_REQUIRED = 426;
const CLOSE_NORMAL = 1000;

/** The room state visible to connections (design contract). */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closing or closed
  }
}

export class BoardRoom extends DurableObject<Env> {
  /** Board storage; replaceable by integration tests to inject failures. */
  store: BoardStore;
  lifecycle: RoomLifecycle = INITIAL_ROOM_STATE;
  /** Clock used for the load retry interval; replaceable by integration tests. */
  now: () => number = () => Date.now();
  private doc: Y.Doc | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  get state(): RoomState {
    switch (this.lifecycle.kind) {
      case 'load-failed':
        return 'load-failed';
      case 'storage-failed':
        return 'storage-failed';
      default:
        return 'ready';
    }
  }

  private transition(event: RoomEvent): number | undefined {
    const t = nextRoomState(this.lifecycle, event);
    this.lifecycle = t.state;
    return t.close;
  }

  /** Loading: builds a fresh doc from storage, then Ready or LoadFailed. */
  load(): LoadResult {
    this.lifecycle = { kind: 'loading' };
    this.doc = null;
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (err) {
      result = { ok: false, reason: 'sql-error', error: err instanceof Error ? err.message : String(err) };
    }
    if (!result.ok) {
      doc.destroy();
      console.error(JSON.stringify({ event: 'board_room.load_failed', reason: result.reason, error: result.error }));
      this.transition({ type: 'load-error', at: this.now() });
      return result;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.transition({ type: 'loaded', quarantined: result.quarantined });
    return result;
  }

  /** RPC: turns this object into a new empty board, unless it already is a board. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize(this.now());
  }

  /** RPC: read-only existence check (created, or legacy content). */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** Existence before accepting a socket; a store that cannot be queried is left to the load path. */
  private boardExists(): boolean {
    try {
      return this.store.existsReadOnly();
    } catch {
      return true;
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: UPGRADE_REQUIRED });
    }
    if (!this.boardExists()) return new Response('Board not found', { status: NOT_FOUND });
    const refuse = this.transition({ type: 'connect', at: this.now() });
    if (this.lifecycle.kind === 'loading') this.load();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (refuse !== undefined || this.doc === null) {
      // Accepted only to deliver the close code: the board cannot be served.
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    const doc = this.doc;
    this.send(server, syncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.lifecycle.kind === 'load-failed') {
      closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return;
    }
    if (this.lifecycle.kind === 'storage-failed' || this.doc === null) {
      closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
      return;
    }
    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync':
        this.onSync(ws, this.doc, message.payload);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, the sender included: the renewal traffic keeps
        // idle y-websocket clients from timing out. Presence semantics are story 6.
        if (typeof data !== 'string') this.broadcast(new Uint8Array(data), null);
        return;
      case 'query-awareness':
        return; // no awareness is stored in this story
      case 'invalid':
        closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
        return;
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Complete the closing handshake (1005/1006 cannot be sent back, so use 1000).
    const valid = code >= CLOSE_NORMAL && code !== 1005 && code !== 1006 && code !== 1015;
    closeQuietly(ws, valid ? code : CLOSE_NORMAL, reason);
  }

  webSocketError(ws: WebSocket): void {
    closeQuietly(ws, CLOSE_NORMAL, 'error');
  }

  private onSync(ws: WebSocket, doc: Y.Doc, payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let failed = false;
    try {
      // Applied to the in-memory doc first: bytes Yjs rejects are never stored.
      syncProtocol.readSyncMessage(decoding.createDecoder(payload), encoder, doc, ws, () => {
        failed = true;
      });
    } catch {
      failed = true;
    }
    if (this.lifecycle.kind === 'storage-failed') return; // every socket is already closed
    if (failed) {
      closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
      return;
    }
    if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
  }

  /** Store, then broadcast to every socket except the origin, then compact if due. */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (err) {
      console.error(JSON.stringify({ event: 'board_room.append_failed', error: err instanceof Error ? err.message : String(err) }));
      this.failStorage();
      return;
    }
    this.broadcast(syncFrame((e) => syncProtocol.writeUpdate(e, update)), origin);
    this.store.compactIfNeeded(doc);
  }

  /** StorageFailed: nothing is broadcast, the doc is discarded, every socket reconnects. */
  private failStorage(): void {
    this.transition({ type: 'append-failed' });
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
  }

  private send(ws: WebSocket, frame: Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      // closing socket; its close handler cleans up
    }
  }

  private broadcast(frame: Uint8Array, except: unknown): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.send(ws, frame);
    }
  }

  // ---- Test hooks (only callable when env.TEST_HOOKS === '1'; see test-hooks.ts) ----

  private requireTestHooks(): void {
    if (this.env.TEST_HOOKS !== '1') throw new TestHookError('test hooks disabled');
  }

  /** Folds the log into a snapshot now. */
  testCompact(): boolean {
    this.requireTestHooks();
    if (this.doc === null) throw new TestHookError('board not loaded');
    return this.store.compact(this.doc);
  }

  /** Damages the snapshot and reloads, so the room is load-failed (TC-24). */
  testCorruptSnapshot(): RoomState {
    this.requireTestHooks();
    corruptSnapshot(this.ctx.storage);
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
    this.load();
    return this.state;
  }

  /** Stores `update` as a board saved before story 5: log rows only, no `created_at` (TC-31). */
  testSeedLegacy(update: Uint8Array): RoomState {
    this.requireTestHooks();
    seedLegacyBoard(this.ctx.storage, update);
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_NORMAL, 'reseeded');
    this.load();
    return this.state;
  }

  /** Restores the snapshot; the next connection after the retry interval loads it. */
  testRepairSnapshot(): RoomState {
    this.requireTestHooks();
    repairSnapshot(this.ctx.storage);
    return this.state;
  }
}
