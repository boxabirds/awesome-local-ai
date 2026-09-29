import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeSyncStep1,
  encodeUpdate,
  readSync,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { Env } from './index';
import { type RoomEvent, type RoomState, nextRoomState } from './room-state';
import {
  type TestHookAction,
  corruptSnapshotChunk,
  repairSnapshotChunk,
  testHooksEnabled,
} from './test-hooks';

/**
 * One board's room: loads the board's Y.Doc from its SQLite storage, stores every applied
 * update before relaying it to the other sockets, and relays y-websocket sync and awareness
 * messages between every socket on the board.
 *
 * Sockets use the hibernation API: an idle board costs no compute, the sockets stay open, and
 * the object reloads the doc from storage when it is woken.
 */
export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = { name: 'loading' };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => this.load());
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  /** Builds the doc from storage: `ready`, or `load-failed` (never an empty stand-in doc). */
  private load(): void {
    this.state = { name: 'loading' };
    this.doc?.destroy();
    this.doc = null;
    const doc = new Y.Doc();
    let result;
    try {
      // Reads only: an unknown board's storage stays empty (tables are created on initialize/append).
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false as const, reason: 'sql-error' as const, error: String(e) };
    }
    if (!result.ok) {
      doc.destroy();
      console.error(JSON.stringify({ event: 'board-room.load-failed', ...result }));
      this.transition({ type: 'load-failed', at: Date.now() });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(doc, update, origin));
    this.doc = doc;
    this.transition({ type: 'loaded', quarantined: result.quarantined });
  }

  /** Store first; only a stored update is relayed (and the output gate holds it until durable). */
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || doc !== this.doc) return;
    try {
      this.store.append(update);
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-room.append-failed', error: String(e) }));
      this.resetAfterStorageFailure();
      return;
    }
    const frame = encodeUpdate(update);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== origin) this.send(ws, frame);
    }
    if (this.state.name !== 'ready') return;
    this.transition({ type: 'compaction-started' });
    const compacted = this.store.compactIfNeeded(doc);
    this.transition({ type: 'compaction-finished', ok: compacted });
  }

  /**
   * An update could not be stored: nobody may see it. Drop the doc and every socket; clients
   * reconnect and re-send what storage lacks, which reloads the doc from storage.
   */
  private resetAfterStorageFailure(): void {
    this.transition({ type: 'append-failed' });
    this.doc?.destroy();
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) this.close(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
  }

  /** RPC: creates the board (tables and `created_at`) unless it already exists. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize();
  }

  /** RPC: whether the board exists (created, or saved before explicit creation). Reads only. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  private existsForConnection(): boolean {
    try {
      return this.store.existsReadOnly();
    } catch (e) {
      // Storage unreadable: let the load-failed path explain it rather than "not found".
      console.error(JSON.stringify({ event: 'board-room.exists-failed', error: String(e) }));
      return true;
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    // Connecting never creates a board.
    if (!this.existsForConnection()) return new Response('Board not found', { status: 404 });
    const before = this.state;
    this.transition({ type: 'connection', at: Date.now() });
    if (this.state !== before && this.state.name === 'loading') this.load();

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    if (!this.doc || this.state.name === 'load-failed') {
      this.close(server, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
    } else {
      // Ask the newcomer for everything the room lacks (e.g. changes that failed to save).
      this.send(server, encodeSyncStep1(this.doc));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Test builds only (TEST_HOOKS): `corrupt-snapshot` compacts, damages the snapshot and reloads
   * (so the room is load-failed and closes every socket with 4500); `repair` restores it, and
   * the next connection after LOAD_RETRY_MIN_INTERVAL_MS loads the board again.
   */
  async testHook(action: TestHookAction): Promise<boolean> {
    if (!testHooksEnabled(this.env)) return false;
    const sql = this.ctx.storage.sql;
    if (action === 'repair') return repairSnapshotChunk(sql);
    if (this.doc) this.store.compactIfNeeded(this.doc, true);
    if (!corruptSnapshotChunk(sql)) return false;
    this.load();
    for (const ws of this.ctx.getWebSockets()) {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
    }
    return true;
  }

  /**
   * Test builds only (TEST_HOOKS): stores `update` as a board saved before boards were created
   * explicitly (update rows, no `created_at`) and reloads the room from storage.
   */
  async seedLegacy(update: Uint8Array): Promise<boolean> {
    if (!testHooksEnabled(this.env)) return false;
    this.store.migrate();
    this.store.append(update);
    this.load();
    return true;
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.state.name === 'load-failed') {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return;
    }
    const doc = this.doc;
    if (!doc || this.state.name === 'storage-failed') {
      this.close(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
      return;
    }
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        let reply: Uint8Array | null;
        try {
          reply = readSync(doc, msg.payload, ws);
        } catch {
          this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
          return;
        }
        // Storing the update may have failed and reset the room meanwhile.
        if (reply && this.doc === doc) this.send(ws, reply);
        return;
      }
      case 'awareness': {
        // Relayed verbatim to everyone, sender included: keeps idle clients' connections alive.
        const frame = new Uint8Array(data as ArrayBuffer);
        for (const other of this.ctx.getWebSockets()) this.send(other, frame);
        return;
      }
      case 'query-awareness':
        // No awareness state is kept.
        return;
      case 'invalid':
        this.close(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
        return;
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    // Complete the closing handshake (1005/1006 cannot be sent back).
    this.close(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  webSocketError(ws: WebSocket, _err: unknown): void {
    this.close(ws, 1011, 'Socket error');
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private send(ws: WebSocket, frame: Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      // Closing or closed: its close handler follows.
    }
  }
}
