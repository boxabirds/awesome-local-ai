// BoardRoom Durable Object (persist.room).
//
// One object per board id (routed by `idFromName` in ./index.ts). The room
// holds the board's Y.Doc in memory AND keeps every update in its SQLite
// storage, so the board outlives the object:
//
//   * on construction (first event after a wake, a restart or an eviction) the
//     document is reloaded from storage inside `blockConcurrencyWhile`, so no
//     message is ever handled against a half-loaded document;
//   * an incoming update is APPLIED first (garbage that Yjs rejects is never
//     stored), then WRITTEN to storage, then broadcast — a change is durable
//     before anyone else can see it (PRD persist.seen_is_saved);
//   * a failed write resets the room: every socket is closed with 1011 and the
//     in-memory document is discarded. Reconnecting clients re-send whatever
//     the room lacks through the story 3 SyncStep1/SyncStep2 exchange, so work
//     is never shown to a second person while it is unsaved, and never lost
//     (PRD persist.save_failure);
//   * an unreadable snapshot (or a failed read) puts the room into
//     `load-failed`: it accepts the socket and immediately closes it with
//     CLOSE_BOARD_LOAD_FAILED (4500) instead of serving a misleading empty
//     board, and retries the load at most once per LOAD_RETRY_MIN_INTERVAL_MS
//     (PRD persist.load_failure).
//
// Sockets use the hibernation API: `ctx.acceptWebSocket(server)` plus the
// class-level webSocketMessage/Close/Error handlers, and broadcasts iterate
// `ctx.getWebSockets()` — the runtime's list, which survives hibernation
// (story 3's in-memory Set did not).

import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, type LoadResult, type StorageLike } from './board-store';
import { canServe, nextRoomState, type RoomState } from './room-state';
import { handleRoomTestRequest } from './test-hooks';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  /** The board document, or null while it cannot be trusted (load failure, or
   * just discarded after a storage failure). */
  private doc: Y.Doc | null = null;

  private store: BoardStore | null = null;

  /** Lifecycle state (see room-state.ts). */
  private state: RoomState = 'loading';

  /** When the current load failure was recorded (drives the retry throttle). */
  private loadFailedAt = 0;

  /** Test-only injected storage failures (armed through test-hooks.ts). */
  private failNextRead = 0;
  private failNextWrite = 0;

  /** Which SELECT the injected read failure matches (default: the snapshot
   * read). Set through armFailuresForTest. */
  private failReadPrefix = 'SELECT data FROM snapshot_chunks';

  /** Diagnostics: how many loads this object has attempted. */
  private loadAttempts = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Everything the wake-time load needs happens before the first event is
    // handled: the runtime holds requests and socket messages until this
    // settles, so the document is never half-loaded.
    ctx.blockConcurrencyWhile(async () => {
      this.reload();
    });
  }

  // --- loading --------------------------------------------------------------

  /** Build a fresh store + document from storage. Synchronous (the Durable
   * Object SQL API is); `blockConcurrencyWhile` only needs to know when the
   * wake-time work is over. */
  private reload(): void {
    this.loadAttempts += 1;
    if (this.state === 'storage-failed') {
      // Coming back from a storage failure: this attempt is a load again.
      this.state = nextRoomState('storage-failed', { type: 'reload' });
    }
    const store = new BoardStore(this.storageForTest, {
      failStatement: (query) => this.shouldFailStatement(query),
    });
    const doc = new Y.Doc({ gc: true });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.handleDocUpdate(doc, update, origin);
    });

    let result: LoadResult;
    try {
      store.migrate();
      result = store.load(doc);
    } catch (error) {
      // Anything that throws outside the store's own error handling is still a
      // load failure, never a crash that leaves the object serving a partial
      // document.
      result = { ok: false, reason: 'sql-error', error: String(error) };
    }

    if (!result.ok) {
      this.doc = null;
      this.store = null;
      this.state = nextRoomState('loading', { type: 'load-failed' });
      this.loadFailedAt = Date.now();
      console.error(
        JSON.stringify({ event: 'board.load-failed', reason: result.reason, error: result.error }),
      );
      return;
    }

    this.store = store;
    this.doc = doc;
    this.state = nextRoomState('loading', { type: 'loaded', quarantined: result.quarantined });
  }

  /** Test seam: which statement throws, and how often (0 = never). */
  private shouldFailStatement(query: string): boolean {
    if (this.failNextRead > 0 && query.startsWith(this.failReadPrefix)) {
      this.failNextRead -= 1;
      return true;
    }
    if (this.failNextWrite > 0 && query.startsWith('INSERT INTO updates')) {
      this.failNextWrite -= 1;
      return true;
    }
    return false;
  }

  // --- document updates: store, then broadcast ------------------------------

  private handleDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    // Bytes that came OUT of storage are not going back IN, and are never
    // echoed to sockets.
    if (origin === LOAD_ORIGIN) return;
    const store = this.store;
    if (store === null) return; // a load-failed room stores nothing (TC-15)

    try {
      store.append(update);
    } catch (error) {
      this.failStorage(error, update.byteLength);
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeUint8(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    const except = typeof origin === 'object' && origin !== null ? (origin as WebSocket) : null;
    this.broadcast(frame, except);

    // Bound the replay work for the next wake (never throws, rolls back).
    this.state = nextRoomState(this.state, { type: 'compact-start' });
    const compacted = store.compactIfNeeded(doc);
    this.state = nextRoomState(this.state, { type: 'compact-done', ok: compacted });
  }

  /** A storage write failed: stop showing unsaved work, reset the room. */
  private failStorage(error: unknown, bytes: number): void {
    this.state = nextRoomState(this.state, { type: 'store-failed' });
    this.doc = null;
    this.store = null;
    console.error(
      JSON.stringify({
        event: 'board.store-write-failed',
        bytes,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    );
    // Close everyone (the sender included): no client is shown a change it
    // cannot rely on. The next connection reloads from storage, and each
    // client re-sends what the room is missing.
    for (const ws of this.ctx.getWebSockets()) {
      this.closeWith(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
    }
  }

  // --- sockets --------------------------------------------------------------

  /** Send a copy of `bytes` to `ws`. Returns false for dead sockets. */
  private sendTo(ws: WebSocket, bytes: Uint8Array): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      // Fresh copy per send: the runtime detaches the buffer it consumes.
      ws.send(bytes.slice());
      return true;
    } catch {
      return false;
    }
  }

  /** Relay to every open, accepted socket except `except`. Dead and closed
   * sockets are skipped; ctx.getWebSockets() is the runtime's own list, so
   * this keeps working after hibernation. */
  private broadcast(bytes: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.sendTo(ws, bytes);
    }
  }

  private closeWith(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__test/')) {
      if (this.env.TEST_HOOKS !== '1') return new Response('Not found', { status: 404 });
      return handleRoomTestRequest(this, request);
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // A room without a document (load failure, or a reset after a storage
    // failure) gets one reload attempt per connection — throttled, so a broken
    // board is not re-read from storage on every reconnect attempt.
    if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      if (nextRoomState('load-failed', { type: 'retry-load', elapsedMs: elapsed }) === 'loading') {
        this.state = 'loading';
        this.reload();
      }
    } else if (this.state === 'storage-failed') {
      this.reload();
    }

    const doc = this.doc;
    if (doc === null) {
      // Accept, then immediately close with the load-failure code: the client
      // must be able to tell "this board is broken" from "the network is down",
      // and it must never be shown a misleading empty board.
      this.ctx.acceptWebSocket(server);
      this.closeWith(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);

    // Push our own SyncStep1 first, so a reconnecting client whose history the
    // room lost answers with SyncStep2 and repopulates it.
    const encoder = encoding.createEncoder();
    encoding.writeUint8(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    this.sendTo(server, encoding.toUint8Array(encoder));

    // Return the CLIENT end on the 101 response; the runtime pipes it to the
    // upgraded connection (the server end is the room's event source).
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // State first: a room without a trustworthy document stores nothing and
    // shows nothing.
    if (this.state === 'load-failed') {
      this.closeWith(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.state === 'storage-failed') {
      this.closeWith(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    let doc = this.doc;
    if (doc === null) {
      // Woken without a document (evicted between events): load now.
      this.reload();
      doc = this.doc;
      if (doc === null) {
        this.closeWith(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
        return;
      }
    }

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      // Text frames, undecodable bytes, unknown types, truncation → close the
      // offending socket only. Other sockets and the document are untouched,
      // and nothing is written (PRD persist.partial_damage / TC-17).
      this.closeWith(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
      return;
    }

    if (decoded.kind === 'query-awareness') return; // no stored awareness to answer

    if (decoded.kind === 'awareness') {
      // Relay verbatim to ALL open sockets, including the sender (idle
      // keepalive). The sender's own client ignores it (equal clocks).
      this.broadcast(new Uint8Array(message as ArrayBuffer), null);
      return;
    }

    // Sync channel: step1 gets a step2 reply, step2/update get applied (and,
    // through the document's update handler, stored and broadcast). The
    // transaction origin is the sender socket, so the broadcast skips it. A
    // throwing apply closes the sender and stores nothing.
    const encoder = encoding.createEncoder();
    encoding.writeUint8(encoder, MESSAGE_SYNC);
    let failed = false;
    try {
      readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        doc,
        ws,
        () => {
          failed = true;
        },
      );
    } catch {
      failed = true;
    }
    if (failed) {
      this.closeWith(ws, CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.sendTo(ws, encoding.toUint8Array(encoder));
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Nothing to release: broadcasts iterate ctx.getWebSockets(), which the
    // runtime keeps up to date — that is what makes hibernation safe here.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // A broken socket is dropped by the runtime; the next broadcast skips it.
  }

  // --- test-only surface (used by ./test-hooks.ts only) ---------------------

  /** Whether the room would serve document traffic right now. */
  get serving(): boolean {
    return canServe(this.state);
  }

  /** Lifecycle + bookkeeping snapshot for the test hooks. */
  testState(): {
    state: RoomState;
    serving: boolean;
    loadAttempts: number;
    retryInMs: number;
    storeStats: { logCount: number; logBytes: number; snapshotThroughSeq: number } | null;
  } {
    return {
      state: this.state,
      serving: this.serving,
      loadAttempts: this.loadAttempts,
      retryInMs:
        this.state === 'load-failed'
          ? Math.max(0, LOAD_RETRY_MIN_INTERVAL_MS - (Date.now() - this.loadFailedAt))
          : 0,
      storeStats: this.store ? this.store.stats : null,
    };
  }

  /** Open (possibly hibernated) sockets — how the hooks detect hibernation. */
  webSocketCountForTest(): number {
    return this.ctx.getWebSockets().length;
  }

  /** The live document (null while untrusted). */
  get documentForTest(): Y.Doc | null {
    return this.doc;
  }

  /** The live store (null while untrusted). */
  get storeForTest(): BoardStore | null {
    return this.store;
  }

  /** Raw storage handle (also what BoardStore was built with). */
  get storageForTest(): StorageLike {
    return this.ctx.storage as unknown as StorageLike;
  }

  /** The key-value side of the object's storage (test hooks park bytes here).
   * Deliberately separate from `storageForTest`, which is the SQL view. */
  get kvForTest(): DurableObjectStorage {
    return this.ctx.storage;
  }

  /** Drop the current document and load a fresh one from storage (the
   * `/repair` hook): a broken board must be able to recover inside this object
   * instead of waiting for a new one. */
  reloadForTest(): void {
    this.doc = null;
    this.store = null;
    this.state = 'loading';
    this.reload();
  }

  /** Load a fresh document from storage and swap it in (the "seed" hook). */
  seedDocumentForTest(update: Uint8Array): boolean {
    this.doc = null;
    this.store = null;
    this.state = 'loading';
    this.reload();
    const doc = this.doc;
    if (doc === null) return false;
    // Applied with the LOAD origin on purpose: seeding a fixture must not go
    // through the store path (the bytes come from the test, not from a client)
    // and must not be broadcast.
    Y.applyUpdate(doc, update, LOAD_ORIGIN);
    return true;
  }

  /** Force compaction of the current document (test fixtures only). */
  compactForTest(): boolean {
    if (this.doc === null || this.store === null) return false;
    return this.store.forceCompact(this.doc);
  }

  /** Arm injected SQL failures for the next reads / writes. `select` replaces
   * the read-matching rule (an exact SQL prefix, as used by BoardStore). */
  armFailuresForTest(reads: number, writes: number, select?: string): void {
    this.failNextRead = reads;
    this.failNextWrite = writes;
    this.failReadPrefix = select ?? 'SELECT data FROM snapshot_chunks';
  }
}
