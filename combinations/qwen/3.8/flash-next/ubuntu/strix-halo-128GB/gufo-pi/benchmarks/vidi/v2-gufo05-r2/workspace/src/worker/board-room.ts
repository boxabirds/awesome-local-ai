/**
 * One live board, and the owner of its durable state.
 *
 * The object holds the board's `Y.Doc` in memory and relays Yjs sync and
 * awareness frames between every WebSocket connected to it, exactly as in story
 * 3, plus one rule that changes everything else: **a change is written before it
 * is broadcast**. Nothing anyone else sees on the board exists before it is in
 * storage, so a board can be left at any moment and found as it was left
 * (persist.automatic, persist.propagated_saved, persist.restart, persist.reopen).
 *
 *  - the document is read from this object's SQLite storage while the object is
 *    constructed, inside `blockConcurrencyWhile`, so no message is handled against
 *    a half-loaded board (`board-store.ts` owns what reading means);
 *  - storage failure is honest failure: the document is discarded and everyone is
 *    closed with `CLOSE_STORAGE_FAILURE`. A reconnecting page re-sends what it has,
 *    so the change that could not be written is written on the next attempt
 *    instead of being shown to others as saved (persist.save_failure);
 *  - a board that cannot be read at all is never presented as an empty board: the
 *    room is `load-failed`, every socket is accepted and immediately closed with
 *    `CLOSE_BOARD_LOAD_FAILED`, and the page says so (persist.damaged_board). A new
 *    connection retries the load, but no more often than LOAD_RETRY_MIN_INTERVAL_MS.
 *
 * WebSockets use the *hibernation* API (`ctx.acceptWebSocket`): the socket set is
 * the runtime's, so an idle board costs no compute even while people hold their
 * tabs open, and the document — which now lives in storage — can be reread when a
 * message or a new connection wakes the object.
 *
 * No awareness state is kept and no participants are counted: presence is story
 * 6, and MAX_CONCURRENT_EDITORS is a soft target, never a limit.
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import type { Env } from './index';
import { handleTestHook, TEST_HOOK_PREFIX, type HookedRoom } from './test-hooks';
import { loadRetryAllowed, nextRoomState, type RoomEvent, type RoomState } from './room-state';

/** Why a join was turned away, spelled for the log and the close reason. */
const LOAD_FAILED_REASON = 'board could not be loaded';

export class BoardRoom extends DurableObject<Env> implements HookedRoom {
  /** This board's storage. One instance per object; `load` seeds its counters. */
  readonly store: BoardStore;

  /**
   * This board's document. Replaced whenever the board is read again (a wake, a
   * reload, or after a storage failure), always with its update listener attached.
   */
  private doc = this.newDoc();

  /** Where this room is in its lifecycle; every change goes through `transition`. */
  private state: RoomState = 'loading';

  /** When a load was last attempted, so a broken board retries at a sane rate. */
  private lastLoadAttemptAt = 0;

  /** Most recent load failure, for the status hook and the logs. */
  private lastLoadFailure = '';


  /** Test hooks only: make the next N writes / reads fail. Never set in production. */
  private appendFailuresLeft = 0;

  private loadFailuresLeft = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.store = new BoardStore(state.storage);
    // A text frame of 'PING' is answered with 'PONG' by the runtime, without
    // waking this object: keepalive traffic must not be compute.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
    // The board is read before anything else may run, so the first person to
    // arrive is answered with the real board rather than an empty one.
    state.blockConcurrencyWhile(async () => {
      this.loadNow();
    });
  }

  /* ------------------------------------------------------------------ * *
   * Joining
   * ------------------------------------------------------------------ */

  /**
   * WebSocket upgrade for this board: 101 with the client half of a fresh pair,
   * accepted into the runtime's hibernating socket set.
   *
   * A room that lost its document (storage failure) or could never read it reads
   * storage again first; a board that still cannot be read is accepted and closed
   * with CLOSE_BOARD_LOAD_FAILED, because the page needs the close code, not a
   * connection to an empty board.
   */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (this.env.TEST_HOOKS === '1' && pathname.startsWith(TEST_HOOK_PREFIX)) {
      return handleTestHook(this, request, pathname);
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    this.transition({ type: 'connection', now: Date.now(), lastLoadAttemptAt: this.lastLoadAttemptAt });
    if (this.needsLoad) this.loadNow();

    const [client, server] = Object.values(new WebSocketPair());
    server.binaryType = 'arraybuffer';
    this.ctx.acceptWebSocket(server);

    if (this.state === 'load-failed') {
      console.error(
        JSON.stringify({
          event: 'board_join_load_failed',
          board: this.ctx.id.toString(),
          sockets: this.socketCount(),
          error: this.lastLoadFailure,
        }),
      );
      try {
        server.close(CLOSE_BOARD_LOAD_FAILED, LOAD_FAILED_REASON);
      } catch {
        // Already gone: the page will retry on its own.
      }
      return new Response(null, { status: 101, webSocket: client } as Response);
    }

    // Ask the newcomer for its state vector: the answer (SyncStep2) contains
    // everything this room is missing, which is how a room that just woke up (or
    // just lost a write) gets back everything a page is still holding.
    trySend(server, syncStep1(this.doc));
    return new Response(null, { status: 101, webSocket: client } as Response);
  }

  /* ------------------------------------------------------------------ * *
   * Hibernating WebSocket handlers
   * ------------------------------------------------------------------ */

  webSocketMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    // A message is traffic, and traffic means this object is awake again.
    this.transition({ type: 'message' });
    if (this.needsLoad) this.loadNow();

    if (this.state === 'load-failed') {
      // Nothing was read, so nothing can be applied or stored: the page keeps
      // saying the board could not be loaded.
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, LOAD_FAILED_REASON);
      return;
    }
    if (this.state === 'storage-failed') {
      // The document is gone until the next connection reloads it; holding a
      // change here would mean accepting one that cannot be written.
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'board storage was unreachable');
      return;
    }

    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // `readSyncMessage` swallows errors from a broken Yjs update (it only
        // reports them to the optional handler), so both paths end the same way.
        let updateError: Error | undefined;
        try {
          syncProtocol.readSyncMessage(
            decoding.createDecoder(decoded.payload),
            encoder,
            this.doc,
            socket,
            (error: unknown) => {
              updateError = error instanceof Error ? error : new Error(String(error));
            },
          );
        } catch (error) {
          // Not a sync message at all: drop this socket, nobody else. Nothing was
          // applied, so nothing was stored.
          this.reject(socket, `unreadable sync message: ${describe(error)}`);
          return;
        }
        if (updateError) {
          this.reject(socket, `unreadable yjs update: ${describe(updateError)}`);
          return;
        }
        // More than the one-byte frame header means there is a reply
        // (SyncStep2 for a SyncStep1, an update for a SyncStep2).
        if (encoding.length(encoder) > 1 && !trySend(socket, encoding.toUint8Array(encoder))) {
          this.closeSocket(socket, 1000, 'socket closed');
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every socket *including the sender*: idle clients
        // stay alive because they keep receiving traffic. Interpreting awareness
        // (who is here) is story 6.
        const frame = awarenessFrame(decoded.payload);
        for (const target of this.ctx.getWebSockets()) {
          if (!trySend(target, frame)) this.closeSocket(target, 1000, 'socket closed');
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: no awareness state is stored to answer with.
        return;
      case 'invalid':
        this.reject(socket, decoded.reason);
    }
  }

  /**
   * The last person leaving does not destroy anything: the board is in storage,
   * and the room goes quiet. Sockets may still be open (a page that is merely
   * offline), so the runtime can wake this object on traffic.
   */
  webSocketClose(_socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    if (this.state === 'ready' && this.socketCount() === 0) {
      console.log(
        JSON.stringify({
          event: 'board_idle',
          board: this.ctx.id.toString(),
          code,
          reason: reason.slice(0, 80),
          wasClean,
        }),
      );
      this.transition({ type: 'hibernate' });
    }
  }

  webSocketError(_socket: WebSocket, error: unknown): void {
    // The runtime drops the socket either way; a broken pipe is not board damage.
    console.log(
      JSON.stringify({
        event: 'board_socket_error',
        board: this.ctx.id.toString(),
        error: describe(error),
      }),
    );
  }

  /* ------------------------------------------------------------------ * *
   * Reading and writing
   * ------------------------------------------------------------------ */

  /** A fresh document, wired to store and broadcast everything applied to it. */
  private newDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // A document that has been replaced (a reload, a storage failure) is no
      // longer this board: changes still landing in it are neither stored nor
      // broadcast, because this room no longer answers for them.
      if (doc !== this.doc) return;
      this.onBoardUpdate(update, origin);
    });
    return doc;
  }

  /** True while a load is owed: the room was woken, lost its doc, or never read it. */
  private get needsLoad(): boolean {
    return this.state === 'loading';
  }

  /**
   * Read this board's storage into a new document.
   *
   * Called from the constructor, when a message or a connection wakes the object,
   * and when a room that could not load is due for another try. A failure keeps
   * the room in `load-failed` with the reason, so the page can be honest about it.
   */
  private loadNow(force = false): LoadResult {
    this.lastLoadAttemptAt = Date.now();
    const started = Date.now();

    if (this.loadFailuresLeft > 0) {
      this.loadFailuresLeft -= 1;
      return this.failLoad('injected read failure');
    }

    try {
      this.store.migrate();
    } catch (error) {
      return this.failLoad(`schema could not be created: ${describe(error)}`);
    }

    // Is this board known to be broken, and is it not yet time to look again? Read
    // from storage rather than from memory: a room that woke up knows nothing, and
    // reading a large damaged board on every wake is exactly what the retry
    // interval exists to prevent. `force` is an explicit reload by someone who
    // knows what they are asking for.
    const health = this.store.health();
    if (!force && health.failedAt !== null && !loadRetryAllowed(health.failedAt, Date.now())) {
      this.lastLoadAttemptAt = health.failedAt;
      return this.refuseUncopiedBoard(health.failure || 'the last read of this board failed');
    }

    const doc = this.newDoc();
    const result = this.store.load(doc);
    if (!result.ok) {
      this.doc = this.newDoc();
      this.transition({ type: 'load-failed' });
      this.lastLoadFailure = `${result.reason}: ${result.error}`;
      this.noteLoadFailure(this.lastLoadAttemptAt, this.lastLoadFailure);
      console.error(
        JSON.stringify({
          event: 'board_load_failed',
          board: this.ctx.id.toString(),
          reason: result.reason,
          error: result.error,
        }),
      );
      return result;
    }

    this.store.recordLoadSuccess();
    this.doc = doc;
    this.lastLoadFailure = '';
    this.transition({ type: 'loaded' });
    console.log(
      JSON.stringify({
        event: 'board_loaded',
        board: this.ctx.id.toString(),
        updates: this.store.summary().updateCount,
        quarantined: result.quarantined,
        ms: Date.now() - started,
        sockets: this.socketCount(),
      }),
    );
    // Whoever is already connected may be holding changes this board never got
    // (a write that failed, or edits made while the object was asleep): ask them.
    const hello = syncStep1(this.doc);
    for (const socket of this.ctx.getWebSockets()) {
      if (!trySend(socket, hello)) this.closeSocket(socket, 1000, 'socket closed');
    }
    return result;
  }

  /**
   * Storage could not even be read. Same shape as any other load failure, plus
   * closing whoever is connected: this room has nothing to serve them.
   */
  private failLoad(error: string): LoadResult {
    const result: LoadResult = { ok: false, reason: 'sql-error', error };
    this.doc = this.newDoc();
    this.transition({ type: 'load-failed' });
    this.lastLoadFailure = error;
    console.error(
      JSON.stringify({
        event: 'board_load_failed',
        board: this.ctx.id.toString(),
        reason: 'sql-error',
        error,
      }),
    );
    this.noteLoadFailure(this.lastLoadAttemptAt, error);
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, LOAD_FAILED_REASON);
    }
    return result;
  }

  /**
   * When this board's storage last refused a read, as recorded there. A refused
   * join leaves it untouched, which is the evidence that nobody read the board.
   */
  get loadFailureTime(): number | null {
    try {
      return this.store.health().failedAt;
    } catch {
      return null;
    }
  }

  /**
   * Record a failed read in storage, so that the next instance of this room — which
   * has no memory of this one — does not read this board again before the interval
   * has passed. Storage may be the thing that is broken, so this is best effort: the
   * in-memory interval still applies if the write fails.
   */
  private noteLoadFailure(at: number, error: string): void {
    try {
      this.store.recordLoadFailure(at, error);
    } catch (recordError) {
      console.error(`could not record the load failure: ${describe(recordError)}`);
    }
  }

  /**
   * This board failed to load recently and the retry interval has not passed: turn
   * people away without reading it. The recorded failure time is left alone, so
   * every refused join does not push the next look further into the future.
   */
  private refuseUncopiedBoard(failure: string): LoadResult {
    const result: LoadResult = { ok: false, reason: 'sql-error', error: failure };
    this.doc = this.newDoc();
    this.transition({ type: 'load-failed' });
    this.lastLoadFailure = failure;
    console.error(
      JSON.stringify({
        event: 'board_load_refused',
        board: this.ctx.id.toString(),
        error: failure,
        retryInMs: Math.max(0, this.lastLoadAttemptAt + LOAD_RETRY_MIN_INTERVAL_MS - Date.now()),
      }),
    );
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, LOAD_FAILED_REASON);
    }
    return result;
  }

  /**
   * One applied change: store it, then let everyone else see it.
   *
   * The order is the whole point. A broadcast that got ahead of the write would
   * show other people a change the board cannot promise to still have tomorrow.
   */
  private onBoardUpdate(update: Uint8Array, origin: unknown): void {
    // The board's own storage being read back in: neither a new change nor a
    // reason to echo anything to anyone.
    if (origin === LOAD_ORIGIN) return;

    if (this.appendFailuresLeft > 0) {
      this.appendFailuresLeft -= 1;
      this.storageFailed(new Error('injected write failure'));
      return;
    }

    try {
      this.store.append(update);
    } catch (error) {
      this.storageFailed(error);
      return;
    }

    const frame = syncFrame(update);
    for (const socket of this.ctx.getWebSockets()) {
      // The author already has it: Yjs must not see its own change back.
      if (socket === origin) continue;
      if (!trySend(socket, frame)) this.closeSocket(socket, 1000, 'socket closed');
    }
    this.transition({ type: 'update' });
    this.compactIfNeeded();
  }

  /** Fold the log into the snapshot once it is long enough to be worth it. */
  private compactIfNeeded(): void {
    if (!this.store.needsCompaction()) return;
    this.transition({ type: 'compact' });
    // Never throws: a failed compaction rolls back and returns false, leaving the
    // previous snapshot and the whole log to carry the board until the next try.
    const compacted = this.store.compactIfNeeded(this.doc);
    this.transition({ type: 'compacted' });
    if (compacted) {
      console.log(
        JSON.stringify({ event: 'board_compacted', board: this.ctx.id.toString(), ...this.store.summary() }),
      );
    }
  }

  /**
   * Storage refused a write. The document in this process may now disagree with
   * the board's storage, so it is dropped and everyone is closed with
   * CLOSE_STORAGE_FAILURE: a page reconnects, re-sends what it has, and the room
   * reads the board again. Nobody is shown a change that was not written.
   */
  private storageFailed(error: unknown): void {
    const sockets = this.socketCount();
    this.transition({ type: 'storage-error' });
    this.doc = this.newDoc();
    console.error(
      JSON.stringify({
        event: 'board_storage_write_failed',
        board: this.ctx.id.toString(),
        error: describe(error),
        sockets,
      }),
    );
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'board storage was unreachable');
    }
  }

  /** Close one socket with 1003 (unsupported data). Others are unaffected. */
  private reject(socket: WebSocket, reason: string): void {
    console.error(
      JSON.stringify({ event: 'board_socket_rejected', board: this.ctx.id.toString(), reason: reason.slice(0, 120) }),
    );
    this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, reason);
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason.slice(0, 120));
    } catch {
      // Already closed: nothing to do.
    }
  }

  /**
   * Move through the lifecycle. States that owe a read of storage are detected by
   * callers through `needsLoad`, because a read has to happen at a point where the
   * handler can still answer with the result.
   */
  private transition(event: RoomEvent): void {
    const next = nextRoomState(this.state, event);
    if (next === this.state) return;
    this.state = next;
  }

  /* ------------------------------------------------------------------ * *
   * Test hooks (`env.TEST_HOOKS === '1'`)
   * ------------------------------------------------------------------ */

  get roomState(): RoomState {
    return this.state;
  }

  get lastLoadError(): string {
    return this.lastLoadFailure;
  }

  get objectStorage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  socketCount(): number {
    return this.ctx.getWebSockets().length;
  }

  /** Whether a retry is due right now, so a test can assert the interval boundary. */
  retryDue(): boolean {
    return loadRetryAllowed(this.lastLoadAttemptAt, Date.now());
  }

  armAppendFailures(times: number): void {
    this.appendFailuresLeft = times;
  }

  armLoadFailures(times: number): void {
    this.loadFailuresLeft = times;
  }

  /**
   * Drop the document and read the board again from storage — the difference
   * between "it is in storage" and "this process remembers it".
   */
  reloadBoard(): LoadResult {
    this.transition({ type: 'reload' });
    // Asked for explicitly: it reads now, whatever the retry interval says.
    return this.loadNow(true);
  }

  /** Fold the log into the snapshot now, whatever its size. */
  compactBoard(): boolean {
    this.transition({ type: 'compact' });
    const compacted = this.store.compact(this.doc);
    this.transition({ type: 'compacted' });
    return compacted;
  }

  /** The board as this object currently holds it, for the seeding hook's answer. */
  noteCount(): number {
    return this.doc.getMap<Y.Map<unknown>>('objects').size;
  }

  /** Apply a prepared board as if this room had just been told about it. */
  applySeed(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, 'test-seed');
  }

  /**
   * Abandon this object, sockets and all, without a clean shutdown. Anything it
   * had not written is gone with it — which is exactly what the tests need to
   * know, and why the board is read from storage rather than remembered.
   */
  abortSelf(): void {
    this.ctx.abort('test evicted this board');
  }
}

/* ------------------------------------------------------------------ * *
 * Frames
 * ------------------------------------------------------------------ */

/**
 * One sync frame carrying a raw update, encoded exactly like the client provider
 * sends them: outer type, then a `y-protocols` update message.
 */
function syncFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** SyncStep1: "tell me what you have" — the answer fills what we are missing. */
function syncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/**
 * An awareness frame from its payload: byte-for-byte what the sender sent, so
 * everyone on the board (sender included) sees the same bytes.
 */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** `WebSocket.READYSTATE_OPEN`, spelled without relying on the runtime constant. */
const READYSTATE_OPEN = 1;

/** Send, reporting failure instead of throwing (a dead socket must not break the room). */
function trySend(socket: WebSocket, bytes: Uint8Array): boolean {
  try {
    if (socket.readyState === READYSTATE_OPEN) socket.send(bytes);
    return socket.readyState === READYSTATE_OPEN;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
