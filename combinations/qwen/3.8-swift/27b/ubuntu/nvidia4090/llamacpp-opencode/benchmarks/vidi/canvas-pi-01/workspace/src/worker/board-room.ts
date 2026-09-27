// BoardRoom Durable Object (see spec: persist.room, sync.room).
//
// One object per board. It loads the persisted board into its in-memory Y.Doc
// on construct (write-before-broadcast), relays y-websocket sync + awareness
// between all connected clients, and switches to the WebSocket hibernation
// API so idle boards cost no compute (ctx.getWebSockets() is the source of
// truth for sockets; they survive hibernation).
//
// Lifecycle (state diagram in src/worker/room-state.ts):
// - The constructor runs `load` (read-only; missing tables = empty board)
//   inside blockConcurrencyWhile, so the first fetch only ever sees a loaded
//   (or load-failed) room. Story 5: migrate() is no longer run here —
//   initialize() (board creation) and the first append() own schema creation,
//   and fetch() rejects boards that do not exist with 404 (share.board_api).
// - Append: every update is stored before it is broadcast; an insert that
//   throws resets the room (all sockets closed 1011, doc discarded) and the
//   next connection reloads from storage (persist.save_failure).
// - Load failure: the room refuses to serve an empty doc; sockets are closed
//   with CLOSE_BOARD_LOAD_FAILED (4500). A new connection retries the load
//   only once LOAD_RETRY_MIN_INTERVAL_MS has passed (persist.load_failure,
//   TC-16).
// - Compaction: when the log reaches a threshold the store compacts it into
//   a chunked snapshot; a failed compaction rolls back (persist.board_store).
// - Decode/apply failures close only the offending socket with
//   CLOSE_UNSUPPORTED_DATA (story 3, TC-17).

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrameMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, type BoardStorage, type LoadResult } from './board-store';
import { nextRoomState, type RoomState } from './room-state';
import { seedLegacyUpdates } from './test-hooks';

type RoomSocket = WebSocket;

export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore;
  private doc: Y.Doc;
  private state: RoomState = 'loading';
  private lastLoadAttemptMs = 0;
  private boardId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.boardId = ctx.id.toString();
    this.store = new BoardStore(ctx.storage as unknown as BoardStorage);
    this.doc = this.createDoc();
    // Load before the first fetch can arrive: fetches are blocked until this
    // settles, so a (re)constructed room never serves a half-loaded doc.
    // Story 5: no migrate here — probing an unknown link must not write
    // storage. The schema is created by initialize() (board creation) or
    // lazily before the first append().
    this.ctx.blockConcurrencyWhile(async () => {
      this.tryLoad();
    });
  }

  // ---- board creation / existence RPC (story 5) ----

  /**
   * Create the board's storage: migrate the schema and record created_at
   * exactly once (share.board_api). Returns 'exists' when the board was
   * already created (a colliding id is never re-initialised: TC-11, TC-15)
   * and 'error' when storage itself fails — never throws: an unhandled
   * rejection inside the DO breaks workerd's input gate for the object.
   */
  async initialize(): Promise<'created' | 'exists' | 'error'> {
    let created = false;
    let failed = false;
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        created = this.store.initializeBoard();
      } catch {
        failed = true;
      }
    });
    if (failed) return 'error';
    return created ? 'created' : 'exists';
  }

  /**
   * Read-only existence check (share.board_api): created_at, or any
   * legacy update/snapshot row. Never writes (TC-06 negative).
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  // ---- Durable Object surface ----

  fetch(req: Request): Response | Promise<Response> {
    // Test-only maintenance routes (spec task 9). The worker forwards
    // /__test/boards/:id/<action> here only when env.TEST_HOOKS === '1'; the
    // production build never sets that, so these routes are unreachable there.
    const pathname = new URL(req.url).pathname;
    if (req.method === 'POST' && pathname.startsWith('/__test/boards/')) {
      if (pathname.endsWith('/compact')) {
        const ok = this.store.compactForTests(this.doc);
        return Promise.resolve(Response.json({ ok }));
      }
      if (pathname.endsWith('/corrupt-snapshot')) {
        const ok = this.store.corruptSnapshotForTests();
        return Promise.resolve(Response.json({ ok }));
      }
      if (pathname.endsWith('/repair')) {
        const ok = this.store.repairSnapshotForTests();
        return Promise.resolve(Response.json({ ok }));
      }
      if (pathname.endsWith('/reconstruct')) {
        // Simulate eviction + reconstruct: forget the in-memory doc and
        // re-run the load path over the current storage (TC-24 needs the room
        // to re-read a snapshot that was corrupted while it was idle).
        const result = this.reconstructForTests();
        return Promise.resolve(Response.json({ ok: result.ok }));
      }
      if (pathname.endsWith('/seed-legacy')) {
        // Story 5 TC-31: seed a pre-story-5 board (updates, no created_at),
        // then reload the doc so the seeded notes are in the live doc that
        // the next connection's sync serves (waking the room loads an empty
        // doc; the seed only reaches storage).
        const seeded = this.seedLegacyForTests(3);
        this.tryLoad();
        return Promise.resolve(Response.json({ ok: true, notes: seeded }));
      }
    }
    // Story 5: unknown boards are rejected before anything is accepted or
    // written — rooms can no longer be created implicitly by connecting.
    // A storage read failure is not "not found": proceed to the normal
    // accept path, where a LoadFailed room closes the socket with 4500.
    let exists = true;
    try {
      exists = this.store.existsReadOnly();
    } catch {
      exists = true;
    }
    if (!exists) {
      return Promise.resolve(new Response('Board not found', { status: 404 }));
    }
    const headers = new Headers(req.headers);
    if (headers.get('Upgrade') !== 'websocket') {
      return Promise.resolve(new Response('Expected Upgrade: websocket', { status: 426 }));
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    headers.set('Set-Cookie', `yjs-session=${Math.random().toString(36).slice(2)}`);
    // acceptWebSocket accepts the socket and registers it for wake-on-
    // message (hibernation API); a second accept() would throw.
    this.ctx.acceptWebSocket(server);
    this.onConnect(server);
    return Promise.resolve(new Response(null, { status: 101, headers, webSocket: client }));
  }

  webSocketMessage(ws: RoomSocket, message: string | ArrayBuffer): void {
    if (this.state !== 'ready') {
      // A LoadFailed room must not store incoming updates or serve an empty
      // doc (TC-15); a storage-failed room reloads on the next connect.
      if (this.state === 'load-failed') {
        this.closeLoadFailed(ws);
      } else {
        this.closeStorageFailed(ws);
      }
      return;
    }
    this.handleMessage(ws, message);
  }

  webSocketClose(_ws: RoomSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // No per-socket state: ctx.getWebSockets() is the source of truth.
  }

  webSocketError(ws: RoomSocket, error: unknown): void {
    console.error({ event: 'board-socket-error', boardId: this.boardId, error: String(error), ws: ws === null });
  }

  // ---- connection handling ----

  private onConnect(ws: RoomSocket): void {
    if (this.state === 'load-failed') {
      const elapsedMs = Date.now() - this.lastLoadAttemptMs;
      if (elapsedMs < LOAD_RETRY_MIN_INTERVAL_MS) {
        // Too soon after the last attempt: no reload, close 4500 (TC-16).
        this.closeLoadFailed(ws);
        return;
      }
      this.state = nextRoomState(this.state, { type: 'retry-load', elapsedMs });
      if (!this.tryLoad()) {
        this.closeLoadFailed(ws);
        return;
      }
    } else if (this.state === 'storage-failed') {
      this.state = nextRoomState(this.state, { type: 'wake' });
      if (!this.tryLoad()) {
        this.closeLoadFailed(ws);
        return;
      }
    }
    // Ready: send our state vector (sync step 1).
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.safeSend(ws, encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
  }

  private handleMessage(ws: RoomSocket, data: string | ArrayBuffer): void {
    // A text (string) frame, or anything that is not binary, is unsupported
    // data: close only this socket (spec TC-15/TC-17).
    if (typeof data === 'string') {
      this.closeUnsupportedData(ws);
      return;
    }
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupportedData(ws);
      return;
    }
    if (decoded.kind === 'sync') {
      let rejected = false;
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // y-protocols swallows Yjs update errors unless an errorHandler is
        // given; use it to close the offending socket.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws, () => {
          rejected = true;
          this.closeUnsupportedData(ws);
        });
        if (!rejected && encoding.length(encoder) > 0) {
          this.safeSend(ws, encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
        }
      } catch {
        this.closeUnsupportedData(ws);
      }
    } else if (decoded.kind === 'awareness') {
      // Relayed verbatim to every socket including the sender: this is what
      // keeps idle clients alive against the y-websocket 30 s watchdog.
      const frame = encodeFrameMessage(MESSAGE_AWARENESS, decoded.payload);
      for (const socket of this.ctx.getWebSockets()) {
        this.safeSend(socket, frame);
      }
    }
    // 'query-awareness' is ignored: this room stores no awareness state.
  }

  // ---- doc, storage, lifecycle ----

  /** Create a doc whose update handler does write-before-broadcast. */
  private createDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(update, origin));
    return doc;
  }

  /**
   * Write-before-broadcast (spec: persist.room): store first; if the insert
   * throws, reset the room and broadcast nothing.
   */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (this.state !== 'ready') return; // loads apply with no storage writes
    try {
      this.store.append(update);
    } catch (err) {
      this.state = nextRoomState(this.state, { type: 'append-failed' });
      console.error({ event: 'board-append-failed', boardId: this.boardId, error: String(err) });
      this.resetForStorageFailure();
      return;
    }
    this.broadcastExcept(update, origin);
    if (this.store.needsCompaction()) {
      this.state = nextRoomState(this.state, { type: 'compact-start' });
      const committed = this.store.compactIfNeeded(this.doc);
      this.state = nextRoomState(
        this.state,
        committed ? { type: 'compact-done' } : { type: 'compact-rollback' },
      );
    }
  }

  /**
   * (Re)load the board into a fresh doc. On success the new doc replaces
   * `this.doc` and the room is ready; on failure the room is load-failed
   * and the old (empty) doc is kept — it is never served.
   */
  private tryLoad(): boolean {
    const doc = this.createDoc();
    this.state = 'loading';
    this.lastLoadAttemptMs = Date.now();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (err) {
      result = { ok: false, reason: 'sql-error', error: String(err) };
    }
    this.state = nextRoomState(this.state, result.ok ? { type: 'load-ok' } : { type: 'load-failed' });
    if (result.ok) {
      this.doc = doc;
      return true;
    }
    console.error({ event: 'board-load-failed', boardId: this.boardId, reason: result.reason });
    return false;
  }

  /** Append failure: close every socket with 1011 and discard the doc. */
  private resetForStorageFailure(): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // already closed
      }
    }
    this.doc = this.createDoc(); // discarded; reloaded on the next connect
  }

  // ---- sockets ----

  /** Broadcast a doc update to every socket except its origin. */
  private broadcastExcept(update: Uint8Array, except: unknown): void {
    // Wrap as a y-protocols UPDATE sync message (type prefix + update), as
    // y-websocket expects; a bare update byte string is not a sync message.
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frame = encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.safeSend(socket, frame);
    }
  }

  private closeUnsupportedData(ws: RoomSocket): void {
    this.closeWith(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
  }

  private closeLoadFailed(ws: RoomSocket): void {
    this.closeWith(ws, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
  }

  private closeStorageFailed(ws: RoomSocket): void {
    this.closeWith(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
  }

  private closeWith(ws: RoomSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** Send, swallowing sockets whose send throws (they are gone). */
  private safeSend(ws: RoomSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      // socket is closing; getWebSockets() will drop it
    }
  }

  // ---- test-only (spec persist.room Tests, TC-14 / TC-26) ----

  /** Test-only: the room's store (so tests can wrap its SQL surface). */
  storeForTests(): BoardStore {
    return this.store;
  }

  /** Test-only: run the load path now and return its result. */
  reloadForTests(): LoadResult {
    this.state = 'loading';
    this.lastLoadAttemptMs = Date.now();
    let result: LoadResult;
    try {
      result = this.store.load(this.doc);
    } catch (err) {
      result = { ok: false, reason: 'sql-error', error: String(err) };
    }
    this.state = nextRoomState(this.state, result.ok ? { type: 'load-ok' } : { type: 'load-failed' });
    return result;
  }

  /**
   * Test-only: simulate eviction + reconstruction — the runtime forgets all
   * in-memory state and the constructor's load path runs again over the same
   * storage (spec TC-13 / TC-18, where real eviction timing is not
   * controllable in the test pool). Accepted sockets survive in
   * ctx.getWebSockets(), exactly as under hibernation.
   */
  reconstructForTests(): LoadResult {
    this.doc.destroy();
    this.doc = this.createDoc();
    return this.reloadForTests();
  }

  /** Test-only: how many sockets the hibernation runtime is tracking. */
  socketCountForTests(): number {
    return this.ctx.getWebSockets().length;
  }

  /**
   * Test-only (story 5 TC-31): seed a legacy board — real update rows with
   * no created_at, as pre-story-5 boards had (share.legacy_boards).
   */
  seedLegacyForTests(notes: number): number {
    return seedLegacyUpdates(this.store, notes);
  }
}
