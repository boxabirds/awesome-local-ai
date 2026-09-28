// One BoardRoom per board: keeps the board's Y.Doc, saves every change to the object's SQLite storage before
// relaying it, and reloads the board from storage whenever the object is (re)constructed.
//
// Sockets use the hibernation API: an idle board costs no compute, and after eviction the constructor reloads
// the doc from storage while the sockets (`ctx.getWebSockets()`) stay connected.
//
// Boards exist only once created through `initialize()` (or, for boards from before board creation existed,
// once they have saved content). Unknown boards are never created implicitly: `exists()` and a rejected
// connection only read storage.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeSync,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { corruptSnapshot, repairSnapshot, type TestHookAction } from './test-hooks';
import { nextRoomState, type LifecycleState, type RoomEvent } from './room-state';
import type { Env } from './index';

export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore;
  private doc: Y.Doc | null = null;
  private lifecycle: LifecycleState = 'loading';
  /** When the last load failed (ms since epoch); a new connection retries only LOAD_RETRY_MIN_INTERVAL_MS later. */
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // No message or connection is handled before the board is loaded.
    void ctx.blockConcurrencyWhile(async () => this.load());
  }

  /** The room's state as seen by connections (compaction is synchronous and never observable). */
  get state(): RoomState {
    if (this.lifecycle === 'load-failed') return 'load-failed';
    if (this.lifecycle === 'storage-failed') return 'storage-failed';
    return 'ready';
  }

  private transition(event: RoomEvent): void {
    this.lifecycle = nextRoomState(this.lifecycle, event);
  }

  /** Builds a fresh doc from storage. On failure no doc is served (never an empty board in its place). */
  private load(): void {
    this.lifecycle = 'loading';
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false, reason: 'sql-error', error: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      doc.destroy();
      this.doc = null;
      this.loadFailedAt = Date.now();
      console.error(JSON.stringify({ event: 'board_load_failed', reason: result.reason, error: result.error }));
      this.transition({ type: 'load-failed' });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.transition({ type: 'loaded', quarantined: result.quarantined });
  }

  /** Saves an applied update, then relays it to every other socket; a failed save resets the room. */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'board_append_failed', error: e instanceof Error ? e.message : String(e) }));
      this.resetAfterStorageFailure();
      return;
    }
    // Output gates hold these sends until the row above is durable, so nobody sees an unsaved change.
    this.broadcast(encodeSync((e) => syncProtocol.writeUpdate(e, update)), origin);
    if (this.store.compactIfNeeded(doc)) {
      this.transition({ type: 'compaction-started' });
      this.transition({ type: 'compaction-finished', committed: true });
    }
  }

  /**
   * Nothing unsaved may be relayed: close every socket and drop the doc. Clients reconnect, the next
   * connection reloads from storage, and each client's SyncStep2 re-sends what storage lacks.
   */
  private resetAfterStorageFailure(): void {
    this.transition({ type: 'append-failed' });
    const doc = this.doc;
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) this.close(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
    doc?.destroy();
  }

  /** RPC: creates this board (tables and `created_at`); 'exists' if it already existed, which writes nothing. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize();
  }

  /** RPC: whether this board exists (created, or legacy with saved content). Read-only. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    // Connecting never creates a board.
    if (!this.existsForConnection()) return new Response('Board not found', { status: 404 });
    this.reloadIfNeeded();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Newer compatibility dates deliver binary frames as Blob by default; the protocol needs bytes.
    server.binaryType = 'arraybuffer';
    this.ctx.acceptWebSocket(server);
    if (!this.doc) {
      // Accept, then close at once: the client learns why (4500) instead of seeing a failed upgrade.
      this.close(server, CLOSE_BOARD_LOAD_FAILED, 'Board could not be loaded');
    } else {
      // Always start with our state vector: a client that has more (e.g. after a reset) answers with it.
      this.send(server, encodeSync((e) => syncProtocol.writeSyncStep1(e, this.doc!)));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Whether a connection may proceed. If storage cannot even be read, the board is not declared missing: the
   * connection goes ahead and learns that the board cannot be loaded (4500), as in story 4.
   */
  private existsForConnection(): boolean {
    try {
      return this.store.existsReadOnly();
    } catch (e) {
      console.error(JSON.stringify({ event: 'board_exists_check_failed', error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
  }

  /** A new connection reloads a reset room, and retries a failed load at most once per interval. */
  private reloadIfNeeded(): void {
    if (this.lifecycle !== 'load-failed' && this.lifecycle !== 'storage-failed') return;
    const before = this.lifecycle;
    this.transition({ type: 'connect', now: Date.now(), failedAt: this.loadFailedAt });
    if (this.lifecycle !== before) this.load();
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const doc = this.doc;
    if (this.state === 'load-failed' || !doc) {
      this.close(ws, this.state === 'load-failed' ? CLOSE_BOARD_LOAD_FAILED : CLOSE_STORAGE_FAILURE, 'Board unavailable');
      return;
    }
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        let reply: Uint8Array | null;
        try {
          reply = this.readSync(doc, msg.payload, ws);
        } catch {
          this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
          return;
        }
        if (reply && this.doc === doc) this.send(ws, reply);
        return;
      }
      case 'awareness':
        // Relayed verbatim to everyone, the sender included: it keeps idle clients' connections alive.
        // Interpreting awareness (who is here) is story 6.
        this.broadcast(data as ArrayBuffer, null);
        return;
      case 'query-awareness':
        return; // no awareness state is kept
      case 'invalid':
        this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
        return;
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Complete the closing handshake (a no-op if the runtime already replied).
    this.close(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  webSocketError(ws: WebSocket): void {
    this.close(ws, 1011, 'Socket error');
  }

  /**
   * Same as `syncProtocol.readSyncMessage`, except that an update Yjs rejects throws here (y-protocols would
   * log and swallow it) so the sender can be closed. Applied updates carry the socket as origin, and are only
   * stored after Yjs accepted them, so garbage is never saved.
   * Returns the reply frame, if any.
   */
  private readSync(doc: Y.Doc, payload: Uint8Array, ws: WebSocket): Uint8Array | null {
    const decoder = decoding.createDecoder(payload);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case syncProtocol.messageYjsSyncStep1:
        return encodeSync((e) => syncProtocol.readSyncStep1(decoder, e, doc));
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate: {
        const update = decoding.readVarUint8Array(decoder);
        Y.decodeUpdate(update); // malformed bytes throw here, before anything reaches the doc
        Y.applyUpdate(doc, update, ws);
        return null;
      }
      default:
        throw new Error(`unknown sync message type ${type}`);
    }
  }

  private broadcast(message: ArrayBuffer | Uint8Array, except: unknown): void {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) this.send(ws, message);
  }

  private send(ws: WebSocket, message: ArrayBuffer | Uint8Array): void {
    try {
      ws.send(message as ArrayBuffer | ArrayBufferView<ArrayBuffer>);
    } catch {
      // Closed or closing: the runtime drops it from getWebSockets().
    }
  }

  /**
   * Test-only storage manipulation (e2e TC-24, TC-21), reachable only when `env.TEST_HOOKS === '1'`.
   * Returns false when hooks are disabled or the action does not apply.
   */
  async testHook(action: TestHookAction, body?: ArrayBuffer): Promise<boolean> {
    if (this.env.TEST_HOOKS !== '1') return false;
    switch (action) {
      case 'seed': {
        if (!this.doc || !body) return false;
        Y.applyUpdate(this.doc, new Uint8Array(body), null); // stored and relayed like any client update
        return this.doc !== null && this.store.compact(this.doc);
      }
      case 'seed-legacy': {
        // A board as saved before board creation existed: log rows, no created_at (e2e TC-31).
        if (!this.doc || !body || this.store.createdAt() !== null) return false;
        Y.applyUpdate(this.doc, new Uint8Array(body), null);
        return this.doc !== null;
      }
      case 'compact':
        return this.doc !== null && this.store.compact(this.doc);
      case 'corrupt-snapshot': {
        if (!corruptSnapshot(this.ctx.storage)) return false;
        // Reload now, as a restarted object would: the load fails and every client is told so.
        this.doc?.destroy();
        this.load();
        for (const ws of this.ctx.getWebSockets()) this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'Board could not be loaded');
        return true;
      }
      case 'repair':
        // The next connection after LOAD_RETRY_MIN_INTERVAL_MS reloads.
        return repairSnapshot(this.ctx.storage);
    }
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }
}
