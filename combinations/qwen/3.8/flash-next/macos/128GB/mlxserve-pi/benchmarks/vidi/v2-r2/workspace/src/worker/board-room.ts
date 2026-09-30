// One BoardRoom per board address: the board's Y.Doc in memory, y-websocket sync
// relayed between every socket on this board, and - new in story 4 - the board's
// own SQLite storage.
//
// What persistence changes about this file
//   - Saving is continuous and invisible. Every update the room applies is
//     appended to `updates` before anyone is told about it, so there is no save
//     button to forget (persist.automatic) and a change nobody else has seen yet
//     is still already on disk (persist.seen_is_saved).
//   - The board outlives the people looking at it. The document is loaded in the
//     object's constructor and re-loaded whenever the object wakes, so the last
//     person leaving and the process restarting loses nothing
//     (persist.restart, persist.reopen).
//   - Sockets use the hibernating accept (`ctx.acceptWebSocket`) and the handlers
//     are the Durable Object's `webSocketMessage`/`webSocketClose`/`webSocketError`
//     callbacks, with `ctx.getWebSockets()` as the source of truth for who is
//     connected. An idle board therefore costs no compute: nothing here runs
//     between events.
//   - Failure is honest. A board whose storage cannot be read is never served as
//     an empty board: the room refuses the socket with CLOSE_BOARD_LOAD_FAILED and
//     retries at most every LOAD_RETRY_MIN_INTERVAL_MS (persist.load_failure). A
//     storage write that fails is never broadcast, the room discards its document
//     and every socket is closed with CLOSE_STORAGE_FAILURE, so each page keeps
//     its own copy of the change and re-sends it on reconnect (persist.save_failure).
//
// Test seams in this file are named and commented as such (`store`, `doc`,
// `loadFailedAt`, `loadNow`, `diagnostics`, and the test-only routes in
// `fetch`). Production behaviour never depends on them.

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, shouldCompact } from './board-store';
import { handleTestHook } from './test-hooks';
import { isServing, nextRoomState, type RoomState } from './room-state';
import type { Env } from './index';

/** How the room came to load, recorded in the log line. */
type LoadReason = 'construct' | 'wake' | 'retry';

/** What the room would tell an observer about itself (tests, and the test hooks). */
export interface RoomDiagnostics {
  state: RoomState;
  serving: boolean;
  loaded: boolean;
  sockets: number;
  /** Un-compacted log rows and bytes, straight from the store. */
  updates: number;
  bytes: number;
  /** Seq the stored snapshot covers (0 when there is no snapshot). */
  snapshotThrough: number;
  /** Ms since the last load failure, null when the last load worked. */
  sinceLoadFailureMs: number | null;
  /** Why the last load failed, null when the last load worked. */
  lastLoadError: string | null;
}

export class BoardRoom extends DurableObject<Env> {
  /**
   * This board's SQLite storage. Public and read-only: the integration tests
   * inject SQL failures through `store.beforeStatement`, which is how a write or
   * a read is made to fail the way a real database fails (TC-11, TC-14, TC-26).
   */
  readonly store: BoardStore;

  /**
   * The room's document while it is loaded, `null` when it holds no document the
   * room is willing to serve - before the first load finishes, and after a load
   * or storage failure discarded it. Integration tests read it directly.
   */
  doc: Y.Doc | null = null;

  /**
   * When a load last failed, and the knob the load-failure e2e and integration
   * tests rewind to move the retry window into the past (TC-16, TC-24).
   */
  loadFailedAt = 0;

  private state: RoomState = 'loading';
  private lastLoadError: string | null = null;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Nothing may be served, and no socket may be accepted, before the board has
    // been read back out of storage: a board is never presented empty.
    void this.ctx.blockConcurrencyWhile(async () => {
      this.load('construct');
    });
  }

  /**
   * WebSocket upgrade only; every other request is a programming error.
   * `TEST-ONLY` routes (`/__test/...`) are handled first and only when
   * `TEST_HOOKS` is set, which the production configuration never does.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__test/')) {
      // TEST-ONLY: answers only when `TEST_HOOKS` is `'1'`, which production never sets.
      return handleTestHook(
        {
          enabled: this.env.TEST_HOOKS === '1',
          storage: this.ctx.storage,
          store: this.store,
          doc: () => this.doc,
          reload: () => this.loadNow(),
          diagnostics: () => this.diagnostics(),
        },
        request,
      );
    }
    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    // A room that could not load, or could not save, is given a chance to recover
    // by this very connection; the state machine decides whether the retry is due.
    this.admit();
    if (!isServing(this.state)) {
      if (this.state === 'load-failed') {
        // The interval rule itself lives in `nextRoomState`; this is the same number
        // reported, so an operator can see how long a board has been refusing and how
        // often it is allowed to try again.
        this.log('board_load_refused', {
          elapsedMs: Date.now() - this.loadFailedAt,
          retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
        });
      } else {
        this.log('board_refused', { state: this.state });
      }
      return this.rejectUpgrade(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.binaryType = 'arraybuffer';
    // The hibernating accept: the socket survives the object going idle, so the
    // object holds no state a wake could not rebuild from storage.
    this.ctx.acceptWebSocket(server);
    this.state = nextRoomState(this.state, { type: 'client-connected' });
    this.greet(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- hibernating WebSocket callbacks -------------------------------------
  //
  // These replace story 3's `addEventListener` wiring. They may be called on a
  // freshly reconstructed object whose only memory is what storage holds, so
  // every one of them goes through `this.state` / `this.doc` rather than
  // assuming an earlier turn happened.

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.doc === null) {
      // Nothing to apply an update to: the board is either known to be unreadable or
      // known to be unwritable. Either way the socket goes with the truth rather
      // than with a board that has quietly forgotten things.
      if (this.state === 'load-failed') {
        this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      } else {
        this.log('board_load_no_doc', {});
        this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'storage is unavailable');
      }
      return;
    }
    if (!isServing(this.state) || this.doc === null) {
      // `storage-failed` is transient - only until the next connection reloads the
      // board - but until then this socket cannot be promised a save.
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'board storage is unavailable');
      return;
    }

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, the sender included: relaying to the
      // sender is what keeps idle y-websocket clients under their reconnect
      // watchdog. Awareness is ephemeral, so none of it is stored.
      for (const socket of this.ctx.getWebSockets()) this.send(socket, decoded.payload);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // ignored: the room keeps no awareness state to answer a query with
    }

    // A sync message. `readSyncMessage` may apply an update, which fires the
    // doc's `update` handler - and that handler is what stores and broadcasts.
    const doc = this.doc;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let rejected = false;
    let failed: unknown = null;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      decoding.readVarUint(decoder); // consume the messageSync type byte
      syncProtocol.readSyncMessage(decoder, reply, doc, ws, (error: Error) => {
        rejected = true;
        failed = error;
      });
    } catch (error) {
      failed = error;
    }
    if (rejected || failed !== null) {
      // Only this socket is at fault; the board and everyone else on it is fine.
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, `update rejected: ${errorMessage(failed)}`);
      return;
    }
    // `reply` always carries the messageSync type byte we wrote; only send when
    // readSyncMessage added real content to it.
    if (encoding.length(reply) > 1) this.send(ws, encoding.toUint8Array(reply));
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Nothing to release: the room keeps no per-socket state, which is exactly
    // what lets it go idle. The board stays in storage either way.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Same as a close; a socket that broke is simply no longer in
    // `ctx.getWebSockets()` for the next broadcast.
  }

  // --- test seams ----------------------------------------------------------

  /**
   * `TEST-ONLY` Load the board again as a wake does, keeping whatever sockets are
   * open. TC-18 uses it to reproduce a hibernation wake: the object forgets its
   * document, rebuilds it from storage and must then serve the sockets that
   * connected before it went idle.
   */
  loadNow(): RoomState {
    // First put the room into the state a load begins from: `hibernated` if it was
    // serving, since going back to storage is what forgetting memory means; and for
    // a room that failed to load, `load-retry` with an elapsed time beyond the
    // interval, because the caller of this seam has chosen the moment rather than
    // waiting for one.
    if (this.state === 'load-failed') {
      this.state = nextRoomState(this.state, {
        type: 'load-retry',
        elapsedMs: Number.POSITIVE_INFINITY,
      });
    } else if (this.state === 'storage-failed') {
      this.state = nextRoomState(this.state, { type: 'client-connected' });
    } else if (this.state === 'ready') {
      this.state = nextRoomState(this.state, { type: 'hibernated' });
    }
    // And now, exactly as on a wake, the object starts reading: the transition that
    // stands between "the memory is gone" and "nothing can be served yet".
    this.state = nextRoomState(this.state, { type: 'woken' });
    this.load('wake');
    return this.state;
  }

  /** A read-only picture of the room, for test assertions and log lines. */
  diagnostics(): RoomDiagnostics {
    const pending = this.store.pending();
    return {
      state: this.state,
      serving: isServing(this.state),
      loaded: this.doc !== null,
      sockets: this.ctx.getWebSockets().length,
      updates: pending.count,
      bytes: pending.bytes,
      snapshotThrough: this.store.snapshotThrough(),
      sinceLoadFailureMs: this.loadFailedAt === 0 ? null : Date.now() - this.loadFailedAt,
      lastLoadError: this.lastLoadError,
    };
  }

  // --- loading -------------------------------------------------------------

  /**
   * Read the board back out of storage into a fresh document. Never throws and
   * never leaves a half-trusted document behind: on any failure the document is
   * discarded and the room refuses to serve until a later retry works.
   *
   * The caller owns the transition into `loading` - whoever asks for a load is the
   * one that knows why - so this body always runs with the room already unable to
   * serve, and ends by moving to `ready` or to a failure state.
   */
  private load(reason: LoadReason): void {
    const started = Date.now();
    console.assert(this.state === 'loading', 'a load must start from the loading state');
    this.discardDoc();

    const doc = new Y.Doc();
    // The handler is bound to *this* document, so an update arriving through a
    // document the room has already thrown away can never be stored or broadcast.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.doc === doc) this.onUpdate(update, origin);
    });

    try {
      this.store.migrate();
      const result = this.store.load(doc);
      if (!result.ok) {
        this.failLoad(`${result.reason}: ${result.error}`);
        return;
      }
      this.doc = doc;
      this.lastLoadError = null;
      this.state = nextRoomState(this.state, { type: 'loaded' });
      if (result.quarantined > 0) {
        console.warn(
          JSON.stringify({
            event: 'board_loaded_with_damage',
            reason,
            quarantined: result.quarantined,
            notes: countNotes(doc),
          }),
        );
      }
      this.log('board_loaded', { reason, durationMs: Date.now() - started, quarantined: result.quarantined });
      // Sockets that were open across a wake (or a retry) are behind us now; ask
      // each of them for its state so what they hold is sent back to us.
      this.greetAll();
    } catch (error) {
      this.failLoad(`storage threw during load: ${errorMessage(error)}`);
    }
  }

  /**
   * A connection asks to be served. A healthy room says yes unchanged; a room
   * that failed to load retries only once the retry interval has passed; a room
   * that failed to save reloads now, because the client reconnecting is the
   * chance to store what its page still holds.
   */
  private admit(): void {
    if (this.state === 'load-failed') {
      // The transition function is the retry rule; this only supplies the elapsed
      // time. Inside the interval the state does not move, and the connection is
      // refused with the load-failure code.
      this.state = nextRoomState(this.state, { type: 'load-retry', elapsedMs: Date.now() - this.loadFailedAt });
      if (this.state !== 'loading') return;
      this.load('retry');
      return;
    }
    if (this.state === 'storage-failed') {
      // A client reconnecting after a failed write is the chance to store what its
      // page still holds; read the board back first.
      this.state = nextRoomState(this.state, { type: 'client-connected' });
      this.load('wake');
      return;
    }
    if (this.state === 'hibernated') {
      this.state = nextRoomState(this.state, { type: 'woken' });
      this.load('wake');
    }
  }

  /** The room cannot serve this board; refuse the socket rather than show it an empty board. */
  private rejectUpgrade(code: number, reason: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    try {
      server.close(code, reason);
    } catch {
      // the socket was already gone
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private failLoad(detail: string): void {
    this.loadFailedAt = Date.now();
    this.lastLoadError = detail;
    this.state = nextRoomState(this.state, { type: 'load-failed' });
    this.discardDoc();
    console.error(JSON.stringify({ event: 'board_load_failed', detail }));
    // Anyone watching is told the truth rather than left holding a board that has
    // silently forgotten its contents.
    this.closeAll(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
  }

  // --- updates: store first, then broadcast --------------------------------

  /**
   * The document changed. What came out of storage is neither stored again nor
   * broadcast; everything else is written to the log before a single byte of it
   * leaves this object.
   */
  private onUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || origin === undefined) return;
    try {
      this.store.append(update);
    } catch (error) {
      // Nothing was saved, so nothing is broadcast: a change nobody is allowed to
      // lose must never be shown as saved (persist.save_failure).
      this.failStorage(`append: ${errorMessage(error)}`);
      return;
    }
    this.state = nextRoomState(this.state, { type: 'update-stored' });
    this.broadcast(update, origin);
    this.compactIfDue();
  }

  /** Fold the log into a chunked snapshot once it has grown past a threshold. */
  private compactIfDue(): void {
    const pending = this.store.pending();
    if (!shouldCompact(pending.count, pending.bytes)) return;
    const doc = this.doc;
    if (doc === null) return;
    this.state = nextRoomState(this.state, { type: 'log-exceeds-threshold' });
    const compacted = this.store.compactIfNeeded(doc);
    this.state = nextRoomState(this.state, { type: compacted ? 'compacted' : 'compaction-failed' });
    if (compacted) {
      this.log('board_compacted', { snapshotThrough: this.store.snapshotThrough() });
    }
  }

  private failStorage(detail: string): void {
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    console.error(JSON.stringify({ event: 'board_storage_failed', detail }));
    // 1011 on every socket: each page keeps its own copy of the change, and the
    // reconnecting clients re-send what this room lacks (see the design's
    // save-failure sequence). The document goes with the failure: the room will
    // not keep serving from memory it could not write down.
    this.closeAll(CLOSE_STORAGE_FAILURE, 'board storage failed');
    this.discardDoc();
  }

  // --- sockets -------------------------------------------------------------

  /** Ask one socket for the state it holds (a SyncStep2 answering it fills us in). */
  private greet(ws: WebSocket): void {
    const doc = this.doc;
    if (doc === null) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private greetAll(): void {
    for (const ws of this.ctx.getWebSockets()) this.greet(ws);
  }

  /** Forward one applied update to every socket except the one it came from. */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const socket of sockets) {
      if (socket === origin) continue; // the sender already has it (no echo)
      this.send(socket, message);
    }
  }

  /** Send raw bytes; a socket that throws is dropped rather than fatal. */
  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch {
      // the socket was already gone; it is not in ctx.getWebSockets() next time
    }
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // the socket was already gone
    }
  }

  private closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) this.closeSocket(ws, code, reason);
  }

  /**
   * Forget the in-memory document. `destroy()` is deliberately not called: this
   * document may still be handed to a client's retransmission in the same turn,
   * and dropping the reference is what the garbage collector is for.
   */
  private discardDoc(): void {
    this.doc = null;
  }

  private log(event: string, fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ event, ...fields }));
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function countNotes(doc: Y.Doc): number {
  return (doc.getMap('objects').size ?? 0) as number;
}
