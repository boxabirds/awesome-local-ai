/**
 * One board, live and durable (anchor `persist.room`).
 *
 * The room holds the board's `Y.Doc` in memory and relays y-websocket frames
 * between the sockets connected to it, exactly as in story 3, and now also
 * stores it:
 *
 * - **persist.automatic** - every update the room applies is appended to this
 *   object's own SQLite storage in the same turn it is applied, before it is
 *   sent to anyone else. Nothing depends on anyone pressing save.
 * - **persist.restart / persist.reopen** - the document is rebuilt from storage
 *   whenever this object starts up, with nobody connected, so a board that was
 *   left as it was comes back as it was.
 * - **persist.load_failure** - a board that cannot be read is never presented
 *   as an empty board. New sockets are accepted and closed immediately with
 *   `CLOSE_BOARD_LOAD_FAILED`, and the retry is rate limited to one attempt per
 *   `LOAD_RETRY_MIN_INTERVAL_MS`.
 * - **persist.save_failure** - a board that cannot be written is not served
 *   either: all sockets close with `CLOSE_STORAGE_FAILURE`, the in-memory
 *   document is discarded, and the next connection rebuilds the room from what
 *   was last saved.
 *
 * Room lifecycle (`nextRoomState`, `persist.room`) is kept in one field, so the
 * failure rules are testable as pure logic in `room-state.ts`:
 *
 * ```text
 * loading -> ready | load-failed
 * ready -> compacting -> ready          (compaction, success or rollback)
 * ready -> storage-failed -> loading    (a write failed; reload on next open)
 * ready -> hibernated -> loading        (no sockets; a message or open wakes it)
 * load-failed -> loading                (only after LOAD_RETRY_MIN_INTERVAL_MS)
 * ```
 *
 * Sockets are accepted with `ctx.acceptWebSocket`, which lets the object
 * hibernate while people are still connected: `ctx.getWebSockets()` is the
 * source of truth, so a rebuilt instance reaches the sockets that were open
 * before it was gone.
 *
 * Awareness bytes are still relayed verbatim to every socket including the one
 * that sent them: y-websocket clients close a connection that has received
 * nothing for a while, and who is on the board is story 6's business.
 */

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { BoardStore, LOAD_ORIGIN, type LoadResult, type SqlValue, type StoreStats } from './board-store';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { snapshot } from '../shared/board-model';
import type { StickySnapshot } from '../shared/board-model';
import { nextRoomState, type RoomEvent, type RoomLifecycleState } from './room-state';
import type { Env } from './index';

/** One line of structured log per room event worth reading in a log tail. */
const log = (fields: Record<string, unknown>): void => {
  console.log(JSON.stringify(fields));
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** What a room that could not read its board remembers about why. */
interface LoadFailure {
  readonly reason: string;
  readonly error: string;
  /** `Date.now()` at the moment the failure happened, for the retry interval. */
  readonly at: number;
}

/** A frame as it arrived, decoded from whichever container workerd used. */
type RawFrame = ArrayBuffer | ArrayBufferView | string;

export class BoardRoom extends DurableObject<Env> {
  /** Swappable for tests that inject storage failures (`testUseStore`). */
  private store: BoardStore;
  /** Null while loading, and after a storage failure until the next open. */
  private doc: Y.Doc | null = null;
  private state: RoomLifecycleState = 'loading';
  private failure: LoadFailure | null = null;
  /** The socket being served, so an update is never echoed to its author. */
  private origin: WebSocket | null = null;
  /** How many times this instance has tried to read the board. */
  private loadAttempts = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // An object can wake with sockets already open, so the board has to be
    // readable before any of them is served. Everything the load does is
    // synchronous SQLite and Yjs work; `blockConcurrencyWhile` is what keeps an
    // incoming message from being handled against a half-built document.
    ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Rebuild the document from this board's storage.
   *
   * Nothing is written here: opening a board that nobody has edited must not
   * create rows, and the board's `schemaVersion` marker is written by the
   * client's own `initDoc` (`src/client/board/useBoardDoc.ts`) and stored like
   * any other change. Reading first also keeps every writer's row sequence
   * contiguous, because the document holds no items of its own while stored
   * updates are applied.
   */
  private load(): void {
    this.transition('reload');
    this.state = 'loading';
    this.loadAttempts += 1;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Everything read from storage is neither stored again nor broadcast.
      if (origin === LOAD_ORIGIN) {
        return;
      }
      this.storeThenBroadcast(update);
    });

    let result: LoadResult;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (error) {
      this.loadFailed('sql-error', describe(error));
      return;
    }
    if (!result.ok) {
      this.loadFailed(result.reason, result.error);
      return;
    }

    this.doc = doc;
    this.failure = null;
    this.transition(result.quarantined > 0 ? 'load-quarantined' : 'load-succeeded');
    log({
      event: 'board-loaded',
      board: this.ctx.id.toString(),
      state: this.state,
      snapshot_bytes: result.snapshotBytes,
      log_rows: result.applied,
      log_bytes: result.logBytes,
      quarantined: result.quarantined,
    });
  }

  private loadFailed(reason: string, error: string): void {
    this.doc = null;
    this.failure = { reason, error, at: Date.now() };
    this.state = 'load-failed';
    console.error(
      JSON.stringify({ event: 'board-load-failed', board: this.ctx.id.toString(), reason, error }),
    );
    // A room that cannot read its board cannot serve it, to anyone, including
    // the sockets it already accepted. They close with 4500 and keep retrying.
    for (const ws of this.ctx.getWebSockets()) {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
    }
  }

  /**
   * A write failed. The room cannot serve a board it cannot save: the document
   * goes with the failure, so the log never ends up missing rows that people
   * were shown. Everyone reconnects, and a reconnecting person who still holds
   * the unsaved change brings it back with them.
   */
  private storageFailed(error: unknown): void {
    this.transition('storage-failed');
    this.doc = null;
    console.error(
      JSON.stringify({ event: 'board-storage-failed', board: this.ctx.id.toString(), error: describe(error) }),
    );
    for (const ws of this.ctx.getWebSockets()) {
      this.close(ws, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
    }
  }

  /**
   * Store what a person did, then show it to everyone else (TC-12: the row is
   * there before another socket sees the change; TC-14: an update that could
   * not be stored is never broadcast).
   */
  private storeThenBroadcast(update: Uint8Array): void {
    const doc = this.doc;
    if (doc === null) {
      // Nothing to store into: this room is already refusing to serve.
      return;
    }
    try {
      this.store.append(update);
    } catch (error) {
      this.storageFailed(error);
      return;
    }
    this.broadcastUpdate(update, this.origin);
    this.compact(doc);
  }

  /** Fold the log when it has outgrown either threshold. Never throws. */
  private compact(doc: Y.Doc): void {
    this.transition('compact-start');
    const compacted = this.store.compactIfNeeded(doc);
    this.transition(compacted ? 'compact-succeeded' : 'compact-failed');
    if (compacted) {
      log({ event: 'board-compacted', board: this.ctx.id.toString(), state: this.state });
    }
  }

  /**
   * Move the lifecycle through `event`, keeping `room-state.ts` as the single
   * definition of what is allowed rather than a second copy of it here.
   */
  private transition(event: RoomEvent): void {
    const move = nextRoomState(this.state, event, {
      sinceFailedMs: this.failure === null ? 0 : Date.now() - this.failure.at,
    });
    this.state = move.state;
  }

  // -------------------------------------------------------------------------
  // Sockets
  // -------------------------------------------------------------------------

  /** Accept the upgrade and start relaying. Plain HTTP is not expected here. */
  fetch(req: Request): Response {
    const upgrade = (req.headers.get('upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    if (this.state === 'load-failed') {
      this.retryLoad();
    } else if (this.doc === null || this.state !== 'ready') {
      // A room that failed to write, one that is holding only its sockets, or
      // one that has no document in memory, rebuilds from what was last saved
      // before anyone is served.
      this.load();
    }

    if (this.state !== 'ready' || this.doc === null) {
      this.acceptThenClose(server, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    this.send(server, this.syncStep1(this.doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A room that could not load its board tries again at most once per
   * `LOAD_RETRY_MIN_INTERVAL_MS`: reloading is expensive, and a board full of
   * reconnecting clients would otherwise reload on every attempt. Until then
   * the socket is closed with 4500, which is what keeps the client retrying.
   */
  private retryLoad(): void {
    const move = nextRoomState(this.state, 'retry-load', {
      sinceFailedMs: this.failure === null ? 0 : Date.now() - this.failure.at,
    });
    if (!move.changed) {
      return;
    }
    this.load();
  }

  webSocketMessage(ws: WebSocket, messages: RawFrame | RawFrame[]): void {
    if (this.doc === null) {
      if (this.state === 'load-failed') {
        this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
        return;
      }
      // A message woke this object: rebuild the board before serving it.
      this.load();
      if (this.doc === null) {
        this.close(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
        return;
      }
    }
    const frames = Array.isArray(messages) ? messages : [messages];
    if (this.state === 'hibernated') {
      // A message reached a room that was holding only its sockets, so it is
      // serving again: wake, then report the board as loaded.
      this.transition('wake');
      this.transition('load-succeeded');
    }
    for (const frame of frames) {
      this.serve(ws, frame);
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    log({ event: 'board-socket-close', board: this.ctx.id.toString(), code, reason, clean: wasClean });
    // A hibernatable socket does not answer the close handshake by itself: the
    // echo is what lets the other side know the connection is really over.
    this.close(ws, code === 1005 ? 1000 : code, reason);
    this.idleIfEmpty();
  }

  webSocketError(_ws: WebSocket, error: unknown): void {
    log({ event: 'board-socket-error', board: this.ctx.id.toString(), error: describe(error) });
    this.idleIfEmpty();
  }

  /** With the last socket gone there is nothing to do; hibernation can take us. */
  private idleIfEmpty(): void {
    if (this.state === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.transition('hibernate');
    }
  }

  private serve(ws: WebSocket, data: RawFrame): void {
    const doc = this.doc;
    if (doc === null) {
      return;
    }
    const frame = frameBytes(data);
    if (frame === null) {
      this.close(ws, CLOSE_UNSUPPORTED_DATA, 'text frames are not supported');
      return;
    }

    const message = decodeMessage(frame);
    if (message.kind === 'invalid') {
      // Only this socket is closed: everyone else keeps working (TC-17).
      this.close(ws, CLOSE_UNSUPPORTED_DATA, message.reason);
      return;
    }

    if (message.kind === 'awareness') {
      for (const socket of this.ctx.getWebSockets()) {
        this.send(socket, frame);
      }
      return;
    }

    if (message.kind === 'query-awareness') {
      return; // no awareness state is kept in this story
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let failure: Error | null = null;
    this.origin = ws;
    try {
      syncProtocol.readSyncMessage(decoding.createDecoder(message.payload), encoder, doc, ws, (error: Error) => {
        failure = error;
      });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.origin = null;
    }
    if (failure !== null) {
      // `applyUpdate` parses before it writes, so bytes that are not a Yjs
      // update leave both the document and the log untouched (TC-17).
      this.close(ws, CLOSE_UNSUPPORTED_DATA, failure.message);
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.send(ws, encoding.toUint8Array(encoder));
    }
  }

  /** SyncStep1: "what do you have?" - the reply carries the missing state. */
  private syncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  private broadcastUpdate(update: Uint8Array, from: WebSocket | null): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== from) {
        this.send(socket, frame);
      }
    }
  }

  /**
   * Send, and forget the socket if sending fails: workerd drops a socket that
   * cannot take the frame, and one gone socket must not break the room.
   */
  private send(ws: WebSocket, payload: Uint8Array): void {
    try {
      ws.send(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer);
    } catch {
      this.close(ws, CLOSE_STORAGE_FAILURE, 'send failed');
    }
  }

  /**
   * Accept first, then close: a socket that was never accepted leaves the
   * client with a failed request instead of a close code, and 4500 is the
   * difference between "reconnect" and "this board could not be loaded".
   */
  private acceptThenClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.accept();
    } catch {
      // Already accepted or already gone.
    }
    this.close(ws, code, reason);
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason.slice(0, 100));
    } catch {
      // A socket that cannot be closed is already gone.
    }
  }

  // -------------------------------------------------------------------------
  // Test-only views. Reachable through `runInDurableObject`, never by HTTP.
  // -------------------------------------------------------------------------

  /** The room's own document as a snapshot. */
  inspectDoc(): readonly StickySnapshot[] {
    return this.doc === null ? [] : snapshot(this.doc); }

  /** A `BoardStore` over this object's own storage, for the storage tests. */
  testStore(): BoardStore {
    return this.store;
  }

  /** The raw storage, so a test can wrap it and inject failures. */
  testStorage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  /** A read or write against the board's own tables. */
  testSql(query: string, values: SqlValue[] = []): Record<string, SqlValue>[] {
    return this.ctx.storage.sql.exec(query, ...values).toArray();
  }

  /** Replace the store this room writes through, with a failing one. */
  testUseStore(store: BoardStore): void {
    this.store = store;
  }

  /** Re-run the load path and report what it returned. */
  testLoad(): LoadResult {
    this.load();
    const failure = this.failure;
    if (failure !== null) {
      return { ok: false, reason: failure.reason as 'snapshot-unreadable' | 'sql-error', error: failure.error };
    }
    const stats = this.store.stats();
    return { ok: true, applied: stats.updateRows, quarantined: 0, snapshotBytes: stats.snapshotBytes, logBytes: stats.updateBytes };
  }

  /** The lifecycle state, as the room currently sees it. */
  testState(): { state: RoomLifecycleState; failure: LoadFailure | null; loadAttempts: number } {
    return { state: this.state, failure: this.failure, loadAttempts: this.loadAttempts };
  }

  /** Make this room's load failure old enough to retry without waiting. */
  testAgeLoadFailure(ms: number): void {
    if (this.failure !== null) {
      this.failure = { ...this.failure, at: this.failure.at - ms };
    }
  }

  /** How many sockets this room is holding (hibernation keeps these). */
  testSocketCount(): number {
    return this.ctx.getWebSockets().length;
  }

  /** Fold the log now, whatever its size (a test wants the Snapshotted state). */
  testCompactNow(): boolean {
    const doc = this.doc;
    if (doc === null) {
      return false;
    }
    return this.store.compactIfNeeded(doc, { force: true });
  }

  /**
   * Damage this board's snapshot, as the test hook does.
   *
   * The room also lets go of the board it was holding: a test that damages a
   * snapshot is asking what a visitor meets when the board is read again, and a
   * room still holding a good document in memory would answer from memory.
   */
  async testCorruptSnapshot(damage?: Uint8Array): Promise<{ ok: boolean; reason?: string; bytes?: number }> {
    const result = this.store.corruptSnapshot(damage);
    if (result.ok) {
      this.doc = null;
      this.state = 'hibernated';
      log({ event: 'board-test-snapshot-corrupted', board: this.ctx.id.toString(), bytes: result.bytes });
    }
    return result;
  }

  /** Undo that damage. */
  async testRepairSnapshot(): Promise<{ ok: boolean; reason?: string }> {
    return this.store.repairSnapshot();
  }

  /** Row counts and byte totals for this board's tables. */
  testStats(): StoreStats {
    return this.store.stats();
  }

  /**
   * Forget the in-memory document while keeping the sockets, which is what
   * hibernation does to a room: the next event has to rebuild it from storage
   * and reach the sockets that were open all along.
   */
  testForgetDoc(): void {
    this.doc = null;
    this.state = 'hibernated';
  }
}

/** The frame's bytes, detached from whatever container workerd used. */
function frameBytes(data: RawFrame): Uint8Array | null {
  if (typeof data === 'string') {
    return null;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy;
  }
  const view = data as ArrayBufferView;
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy;
}
