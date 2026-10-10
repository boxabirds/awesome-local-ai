import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import { createDecoder } from 'lib0/decoding';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomLifecycleState } from './room-state';
import type { Env } from './index';

// One BoardRoom per board (routed by idFromName in the Worker entry). The
// board's Y.Doc is reloaded from SQLite-backed Durable Object storage on
// wake; every applied update is appended before it is broadcast, so a change
// another person can see is already saved (persist.seen_is_saved). Sockets
// use the hibernation API (ctx.acceptWebSocket + getWebSockets), so idle
// boards with open sockets consume no compute (persist.restart, cost).
export class BoardRoom extends DurableObject<Env> {
  private state: RoomLifecycleState = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private lastLoadFailedAt = 0;
  private loadAttempts = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Load before any event handler runs; blockConcurrencyWhile holds off
    // incoming events until the doc is ready or the room is load-failed.
    this.ctx.waitUntil(this.ctx.blockConcurrencyWhile(() => this.loadRoom()));
  }

  // ---- board existence / creation RPC (story 5: share.board_api) ----
  // Callable directly on the Durable Object stub from the Worker entry.
  // initialize() creates the schema and records created_at exactly once; an
  // existing board is never re-initialised (TC-15). exists() is read-only and
  // never creates tables, so probing an unknown id leaves no storage (TC-06).

  async initialize(): Promise<'created' | 'exists'> {
    return this.store.markCreated() ? 'created' : 'exists';
  }

  async exists(): Promise<boolean> {
    try {
      return this.store.existsReadOnly();
    } catch {
      // A broken SQL store is a storage problem (handled by the load-failure
      // path), not a "does not exist" answer.
      return true;
    }
  }

  // ---- lifecycle ----

  private async loadRoom(): Promise<void> {
    this.loadAttempts += 1;
    this.state = 'loading';
    const doc = new Y.Doc();
    this.attachDocHandler(doc);
    let result: LoadResult;
    try {
      // Story 5: migrate() no longer runs here — loading a board with no
      // tables is a clean empty state, and the schema is created on
      // initialize() (board creation) or lazily on the first append.
      result = this.store.load(doc);
    } catch (error) {
      result = {
        ok: false,
        reason: 'sql-error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (result.ok) {
      this.doc = doc;
      this.state = nextRoomState('loading', {
        type: result.quarantined > 0 ? 'load-ok-quarantined' : 'load-ok'
      });
    } else {
      // Never serve an empty board for an unreadable one (persist.load_failure).
      this.state = nextRoomState('loading', { type: 'load-failed' });
      this.lastLoadFailedAt = Date.now();
      console.error(
        JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error })
      );
    }
  }

  private attachDocHandler(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Updates applied while loading are already stored; never re-store or
      // broadcast them back out.
      if (origin === LOAD_ORIGIN) return;
      try {
        // Store before broadcast (persist.seen_is_saved). The DO output gate
        // holds outgoing messages until the write is durable.
        this.store.append(update);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'storage-write-failed',
            error: error instanceof Error ? error.message : String(error)
          })
        );
        this.storageFailed();
        return;
      }
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const frame = toUint8Array(encoder);
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === origin) continue;
        this.send(socket, frame);
      }
      // Bounded replay for the next load (persist.large_board); never throws.
      this.store.compactIfNeeded(doc);
    });
  }

  // An insert failed: the change is not broadcast, every socket is closed and
  // the in-memory doc is discarded. Reconnecting clients re-send what the
  // room lacks via SyncStep2, so unsaved changes are retried from open pages
  // (persist.save_failure).
  private storageFailed(): void {
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE);
      } catch {
        // already closing
      }
    }
    this.doc = null;
  }

  // ---- WebSocket endpoints (hibernation API) ----

  async fetch(_request: Request): Promise<Response> {
    // Story 5: unknown or never-created boards are rejected before any socket
    // is accepted, so connecting can no longer create a board implicitly
    // (share.not_found). A storage trouble is not "unknown": fall through to
    // the load-failure handling below rather than claiming not-found.
    let exists: boolean;
    try {
      exists = this.store.existsReadOnly();
    } catch {
      exists = true;
    }
    if (!exists) {
      return new Response('Board not found\n', { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (this.state === 'load-failed') {
      const retryAllowed = Date.now() - this.lastLoadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS;
      this.state = nextRoomState(this.state, { type: 'connection', retryAllowed });
      if (retryAllowed) await this.loadRoom();
      if (this.state === 'load-failed') {
        // Honest failure: accept so the client observes the close code, then
        // close 4500 without serving an empty doc.
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED);
        return new Response(null, { status: 101, webSocket: client });
      }
    } else if (this.state === 'storage-failed') {
      await this.loadRoom();
    }

    const doc = this.doc;
    if (doc === null) {
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_BOARD_LOAD_FAILED);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    // SyncStep1 on accept: a reconnecting client answers with SyncStep2
    // containing everything the room lacks, which recovers unsaved changes
    // after a storage failure (persist.save_failure).
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(server, toUint8Array(encoder));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    const doc = this.doc;
    if (doc === null) {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    // Current workerd can hand binary frames as Blob even in the hibernation
    // handler (typed ArrayBuffer); handleMessage normalises before decoding.
    void this.handleMessage(ws, message as ArrayBuffer | string, doc);
  }

  webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): void {
    // Sockets are tracked by the runtime (ctx.getWebSockets); nothing to do.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Same: the runtime drops the socket from getWebSockets().
  }

  private async handleMessage(
    ws: WebSocket,
    data: ArrayBuffer | ArrayBufferView | Blob | string,
    doc: Y.Doc
  ): Promise<void> {
    const normalised = data instanceof Blob ? await data.arrayBuffer() : data;
    const message = decodeMessage(normalised);
    switch (message.kind) {
      case 'invalid':
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
      case 'query-awareness':
        // Ignored: no stored awareness (story 6 interprets it).
        return;
      case 'awareness':
        // Relay verbatim to all open sockets including the sender, so idle
        // y-websocket clients keep receiving traffic within their timeout
        // (and the relay keeps waking the object while people are connected).
        for (const socket of this.ctx.getWebSockets()) {
          this.send(socket, message.payload);
        }
        return;
      case 'sync': {
        let reply: Uint8Array;
        let rejected = false;
        try {
          const replyEncoder = createEncoder();
          // readSyncStep2 swallows apply errors internally; the handler lets
          // us still close the offending socket with 1003 (nothing stored:
          // the update handler only runs for updates Yjs accepted).
          syncProtocol.readSyncMessage(
            createDecoder(message.payload),
            replyEncoder,
            doc,
            ws,
            () => {
              rejected = true;
            }
          );
          reply = toUint8Array(replyEncoder);
        } catch {
          // Undecodable bytes: close this socket only; others keep working.
          ws.close(CLOSE_UNSUPPORTED_DATA);
          return;
        }
        if (rejected) {
          ws.close(CLOSE_UNSUPPORTED_DATA);
          return;
        }
        if (reply.length > 0) {
          this.send(ws, frame(MESSAGE_SYNC, reply));
        }
        return;
      }
    }
  }

  // Best-effort send; a dead socket is dropped by the runtime.
  private send(ws: WebSocket, payload: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(payload);
    } catch {
      // socket died between listing and sending
    }
  }

  // ---- test-only seams (integration tests via runInDurableObject; and the
  // TEST_HOOKS routes in test-hooks.ts). No production callers. ----

  debugState(): { state: RoomLifecycleState; loadAttempts: number } {
    return { state: this.state, loadAttempts: this.loadAttempts };
  }

  debugStore(): BoardStore {
    return this.store;
  }

  debugSetStore(store: BoardStore): void {
    this.store = store;
  }

  debugSetLastLoadFailedAt(at: number): void {
    this.lastLoadFailedAt = at;
  }

  // Simulates the object losing its in-memory doc (wake/evict) while sockets
  // stay open: everything must come back from storage.
  debugReload(): Promise<void> {
    this.doc = null;
    return this.loadRoom();
  }

  // Force a snapshot of the live doc regardless of thresholds (integration
  // tests need snapshot states without writing 4 MiB).
  async debugCompact(): Promise<boolean> {
    if (this.doc === null) await this.loadRoom();
    if (this.doc === null) throw new Error('room not ready for compaction');
    return this.store.compact(this.doc);
  }

  async testCompact(): Promise<boolean> {
    this.assertTestHooks();
    if (this.doc === null) await this.loadRoom();
    if (this.doc === null) throw new Error('room not ready for compaction');
    return this.store.compact(this.doc);
  }

  async testCorruptSnapshot(): Promise<boolean> {
    this.assertTestHooks();
    if (this.doc === null) await this.loadRoom();
    if (this.doc === null) throw new Error('room not ready for corruption');
    if (this.store.debugSnapshotChunkCount() === 0) this.store.compact(this.doc);
    this.store.debugCorruptChunk0();
    this.doc = null;
    this.state = 'load-failed';
    this.lastLoadFailedAt = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_BOARD_LOAD_FAILED);
      } catch {
        // already closing
      }
    }
    return true;
  }

  async testRepairSnapshot(): Promise<boolean> {
    this.assertTestHooks();
    this.store.debugRepairChunk0();
    this.lastLoadFailedAt = 0;
    return true;
  }

  async testRowCount(): Promise<{ updates: number; chunks: number }> {
    this.assertTestHooks();
    return this.store.debugRowCount();
  }

  // Legacy-board seed (share.legacy_boards, TC-08/TC-31): write real updates
  // with no created_at, so the board exists via data rows only. The room's
  // in-memory doc (if any) is dropped; the next load reconstructs from the
  // seeded log like any legacy board would.
  async testSeedLegacy(updatesB64: string[]): Promise<void> {
    this.assertTestHooks();
    const updates = updatesB64.map(decodeBase64Bytes);
    this.store.debugSeedUpdates(updates);
    this.doc = null;
    this.state = 'loading';
    await this.loadRoom();
  }

  private assertTestHooks(): void {
    if (this.env.TEST_HOOKS !== '1') {
      throw new Error('test hooks are disabled');
    }
  }
}

function frame(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

// base64 → bytes for the legacy-seed test hook (workerd provides atob).
function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
