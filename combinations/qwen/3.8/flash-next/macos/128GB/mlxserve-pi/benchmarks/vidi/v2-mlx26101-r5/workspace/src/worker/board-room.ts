/**
 * One board's room: a Durable Object that keeps the board's `Y.Doc` in memory, relays
 * `y-websocket` traffic between everybody on that board, and writes every change down to its
 * own SQLite storage before it lets anybody else see it.
 *
 * The story this file tells is the one from "come back tomorrow and it is still here":
 *
 * - **Written before it is shown.** A change is applied, appended to storage, and only then
 *   broadcast. Once a change has appeared on somebody's screen it is in the database — that
 *   is the guarantee the product makes, and it is why a failed write stops the broadcast
 *   rather than following it.
 * - **Assembled on wake.** The object keeps no copy of the board in its own memory any more
 *   than it has to: on construction (or on waking, or after a write failed) it reads the
 *   snapshot and the log back. So the sockets are handed to the runtime
 *   (`ctx.acceptWebSocket`) rather than held here, which lets the object be evicted while
 *   people are connected: an idle board costs storage, not compute.
 * - **Honest when it cannot read the board.** A board whose storage cannot be read is
 *   refused, not served empty: the socket is accepted and immediately closed with
 *   `CLOSE_BOARD_LOAD_FAILED`, which is how the client comes to say "This board couldn't be
 *   loaded. Retrying…" and how it keeps retrying.
 * - **One bad change, one lost change.** A log row that Yjs cannot read is quarantined and
 *   the rest of the board loads.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  encodeAwarenessMessage,
  encodeUpdateFrame,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, shouldCompact, type LoadResult } from './board-store';
import { runRoomTestHook, testHooksEnabled } from './test-hooks';
import { loadRetryEvent, nextRoomState, type RoomEvent, type RoomState } from './room-state';
import type { Env } from './index';

/** Longest close reason the WebSocket protocol allows. */
const MAX_CLOSE_REASON_BYTES = 123;

/** Why a socket is being closed, in the client's terms. */
const CLOSE_REASON = {
  loadFailed: 'this board could not be loaded',
  storageFailed: 'the board could not be saved',
  malformed: 'undecodable message',
} as const;

/** A frame that asks a client for everything the room is missing. */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A close reason is a short diagnostic string, never the payload. */
function closeReason(reason: string): string {
  return reason.length <= MAX_CLOSE_REASON_BYTES ? reason : reason.slice(0, MAX_CLOSE_REASON_BYTES);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A frame as the runtime delivered it. With `binaryType = 'arraybuffer'` a binary frame is an
 * `ArrayBuffer`; a text frame is passed through so `decodeMessage` can reject it as the
 * malformed input it is. A Blob (the default `binaryType` in the runtime) or a view is
 * normalised to a copy of its bytes.
 */
async function frameData(data: unknown): Promise<ArrayBuffer | string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new ArrayBuffer(data.byteLength);
    new Uint8Array(copy).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy;
  }
  if (data instanceof Blob) return data.arrayBuffer();
  return new ArrayBuffer(0);
}

/** Ready to be served, or the reason it is not. */
type Serving = { ok: true; doc: Y.Doc } | { ok: false; closeCode: number; reason: string };

/**
 * The room behind `/api/rooms/:boardId`: WebSocket upgrades only.
 *
 * Every change it applies is written to its own storage before it is forwarded, so a board
 * looks the same the next time anybody opens it, and a change another person has seen is
 * never the one that got away.
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's durable storage (SQLite, one database per board). */
  private readonly store: BoardStore;

  /** Where the board is; see `room-state.ts` for what may happen in each state. */
  private phase: RoomState = 'loading';

  /** The board in memory, or null when there is nothing to serve from. */
  private board: Y.Doc | null = null;

  /** When this room last failed to read the board, so retries stay `LOAD_RETRY_MIN_INTERVAL_MS` apart. */
  private loadFailedAt = 0;

  /**
   * How long this room waits between attempts to read a board it could not read.
   *
   * The config value is the product's answer and is never changed in a running board; a test
   * that has to watch both sides of that boundary sets it rather than waiting five seconds for
   * one and a minute for the other.
   */
  retryIntervalMs = LOAD_RETRY_MIN_INTERVAL_MS;

  /** The load the constructor started; every entry point waits for it. */
  private readonly loaded: Promise<void>;

  /** Broadcasts whatever this document just gained. Bound so it can be detached with the doc. */
  private readonly onBoardUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return; // our own reading-back, not a change
    const board = this.board;
    if (board === null) return;
    try {
      this.store.append(update);
    } catch (error) {
      // This change is not kept, so it does not get to be seen: the people on the board hear
      // "Reconnecting…", not this change, and the board is reloaded on the next connection.
      this.storageFailed(error);
      return;
    }
    this.phase = nextRoomState(this.phase, 'update-applied');
    const frame = encodeUpdateFrame(update);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue; // nobody is echoed their own keystroke
      this.send(socket, frame);
    }
    // Folding the log into a snapshot happens here, once, on the way out of the change that
    // filled it — never on a timer, so an idle board stays as idle as it looks. The room notes
    // the state it is in while that happens, because the diagram says it passes through it.
    this.compact();
  };

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.store = new BoardStore(state.storage);
    // Nothing is served until the board has been read back. `blockConcurrencyWhile` is how
    // the runtime is told that: no message, and no other event, runs against a document that
    // is not there yet.
    this.loaded = state.blockConcurrencyWhile(async () => {
      this.reload();
    });
  }

  /** The board's storage, for the tests that have to look at what was written down. */
  get boardStore(): BoardStore {
    return this.store;
  }

  /** What this room is doing, for the tests that assert on the state machine's edges. */
  get roomState(): RoomState {
    return this.phase;
  }

  /** The board in memory, when there is one; null after a wake, an eviction or a bad write. */
  get boardDoc(): Y.Doc | null {
    return this.board;
  }

  /** Accepts a WebSocket upgrade; anything else is a 426. */
  override async fetch(request: Request): Promise<Response> {
    await this.loaded;

    // The test-only storage hooks (see `test-hooks.ts`), which need to reach *this* board's
    // storage and its in-memory document. Never routed unless the deployment says so.
    const hook = new URL(request.url).pathname;
    if (testHooksEnabled(this.env) && hook.startsWith('/__test/')) {
      const action = hook.slice('/__test/'.length);
      const done = this.roomHook(action);
      if (done) return done;
      return runRoomTestHook(this.ctx.storage, action, () => {
        this.forgetBoard();
        this.phase = 'load-failed';
        this.loadFailedAt = Date.now();
        for (const socket of this.ctx.getWebSockets()) {
          this.close(socket, CLOSE_BOARD_LOAD_FAILED, CLOSE_REASON.loadFailed);
        }
      });
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { 'x-vidi6-error': 'upgrade_required' },
      });
    }

    // A connection is answered from the board as it is now: reloaded if the room lost it (it
    // was evicted, or a write failed), retried if it is past the retry interval, and refused
    // with 4500 if it still cannot be read.
    const serving = this.answerConnection();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Read binary frames as ArrayBuffers rather than as Blobs (the runtime default), so a
    // frame can be decoded the moment it arrives.
    server.binaryType = 'arraybuffer';
    // Hibernating accept: the sockets belong to the runtime now, so this object may be
    // evicted between events and find them again on `ctx.getWebSockets()`. This stands in
    // for `server.accept()` rather than going with it — the runtime refuses to
    // `acceptWebSocket` a socket that has already been accepted.
    this.ctx.acceptWebSocket(server);

    if (!serving.ok) {
      // Accepted and closed at once, so the client learns the board is unreadable rather
      // than being handed an empty one it would happily edit.
      try {
        server.close(serving.closeCode, closeReason(serving.reason));
      } catch {
        // already gone
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ask the newcomer for its state: whatever it holds that the board has not been told
    // (a change made while saving was failing, a room that was rebuilt) arrives with the
    // answer and is stored before it is shown to anybody else.
    this.send(server, syncStep1Frame(serving.doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** One frame from one socket. */
  override async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    await this.loaded;

    // The state of the room comes before anything the message could mean.
    if (this.phase === 'load-failed') {
      this.close(ws, CLOSE_BOARD_LOAD_FAILED, CLOSE_REASON.loadFailed);
      return;
    }
    if (this.phase === 'storage-failed') {
      this.close(ws, CLOSE_STORAGE_FAILURE, CLOSE_REASON.storageFailed);
      return;
    }
    const serving = this.wake();
    if (!serving.ok) {
      this.close(ws, serving.closeCode, serving.reason);
      return;
    }

    const decoded = decodeMessage(await frameData(data));
    if (decoded.kind === 'invalid') {
      this.close(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relayed verbatim to everybody, sender included: an idle client renews its awareness
      // clock every 15 seconds, and that traffic is what keeps the provider from deciding the
      // connection is dead — and what reconciles a board this object reloaded from storage
      // after a wake. Interpreting it is story 6.
      const frame = encodeAwarenessMessage(decoded.payload);
      for (const other of this.ctx.getWebSockets()) this.send(other, frame);
      return;
    }

    if (decoded.kind === 'query-awareness') return; // no awareness state is kept yet

    // A sync message: SyncStep1 is answered with SyncStep2 (the whole board for a newcomer),
    // SyncStep2 and single updates are applied — which is what stores and broadcasts them —
    // and anything Yjs refuses closes just this socket, having been written nowhere.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        serving.doc,
        ws,
        () => {
          throw new Error('undecodable sync message');
        },
      );
    } catch {
      this.close(ws, CLOSE_UNSUPPORTED_DATA, CLOSE_REASON.malformed);
      return;
    }

    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1) this.send(ws, reply); // longer than the type byte = there is a reply
  }

  /**
   * A socket went away.
   *
   * The echo close is not ceremony: with the hibernation API the runtime owns the socket, and
   * a socket that is closed from the other end is dropped without a Close frame being sent
   * back, so the client's own `close` event reports 1006 ("no Close frame") instead of the
   * code it used. Passing the code straight back is what lets a client — and a test — tell
   * "I closed this connection" apart from "the room closed it", which is the difference
   * between "I left the board" and "this board couldn't be loaded".
   */
  override webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed, or closing on us: nothing to echo to.
    }
    if (this.phase !== 'ready') return;
    if (this.ctx.getWebSockets().some((socket) => socket.readyState <= WebSocket.OPEN)) return;
    // Hibernated: the document may be dropped at any point after this, so it is treated as
    // gone and read back when somebody comes. The board is in storage; that is the whole
    // point of story 4.
    this.phase = nextRoomState(this.phase, 'idle');
  }

  /** A socket errored. Story 3's room dropped it from its set; the runtime does that here. */
  override webSocketError(_ws: WebSocket, error: unknown): void {
    console.error(JSON.stringify({ event: 'socket-error', error: describe(error) }));
  }

  /**
   * Reads the board back from storage. Synchronous, because the SQLite API is: the room is
   * serving, or refusing, before the first frame is handled.
   */
  private reload(): void {
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (error) {
      result = { ok: false, reason: 'sql-error', error: describe(error) };
    }
    if (!result.ok) {
      // Say so, and refuse to serve. An empty board here would be a lie with a text box in it.
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      this.board = null;
      this.loadFailedAt = Date.now();
      this.phase = nextRoomState('loading', 'load-error');
      return;
    }
    doc.on('update', this.onBoardUpdate);
    this.board = doc;
    this.phase = nextRoomState('loading', result.quarantined > 0 ? 'load-quarantined' : 'load-ok');
    if (result.quarantined > 0) {
      console.error(
        JSON.stringify({ event: 'board-loaded-with-damage', quarantined: result.quarantined }),
      );
    }
  }

  /**
   * Gives up the in-memory board, and keeps everything else: the sockets stay connected and
   * the storage is untouched, so the next message reads the board back and carries on serving
   * the connections that were already there.
   *
   * Public because a test cannot make the runtime evict this object, and "the room lost its
   * memory" is a state story 4 has to answer. It is also what a storage failure does.
   */
  forgetBoard(): void {
    const board = this.board;
    this.board = null;
    if (board) board.off('update', this.onBoardUpdate);
  }

  /**
   * The two hooks that are about what this room is *holding* rather than what its storage
   * contains: fold the log now, and be where going idle would have put the room. Together with
   * the storage hooks in `test-hooks.ts` they let a test build a board, fold it, break it and
   * mend it, without a click in sight — which is the only way to have a broken board on a
   * schedule. Nothing here is reachable unless `TEST_HOOKS` is set, which nothing in the
   * production configuration sets.
   */
  private roomHook(action: string): Response | null {
    if (action === 'compact') {
      const board = this.board;
      if (board === null) {
        return hookJson(409, { ok: false, reason: 'this room is not holding a board to fold' });
      }
      const folded = this.store.compactNow(board);
      return hookJson(200, { ok: true, folded, ...this.store.snapshotInfo() });
    }
    if (action === 'hibernate') {
      // Exactly what an idle period does to a room: the document goes, the connections stay
      // open, and the next thing anybody asks is answered by reading the board back.
      this.forgetBoard();
      this.phase = nextRoomState(this.phase, 'idle');
      return hookJson(200, { ok: true, state: this.phase });
    }
    return null;
  }

  /**
   * Folds the log into a snapshot if it has grown enough, noting the state the room is in
   * while it happens. The folding itself is the store's business; this is only the room being
   * truthful about what it is doing.
   */
  private compact(): void {
    const store = this.store;
    const board = this.board;
    if (board === null || !shouldCompact(store.pendingRows, store.pendingBytes)) return;
    this.phase = nextRoomState(this.phase, 'compact-needed');
    const folded = store.compactIfNeeded(board);
    this.phase = nextRoomState(this.phase, folded ? 'compact-ok' : 'compact-error');
  }

  /**
   * A change could not be written down. Nothing that happened after the last successful
   * write may be presented as saved, so the board is discarded and everybody is told to come
   * back — and each of them brings the change it has, which is how a change that could not
   * be saved gets saved on the second try.
   */
  private storageFailed(error: unknown): void {
    console.error(JSON.stringify({ event: 'storage-failed', error: describe(error) }));
    this.phase = nextRoomState(this.phase, 'append-error');
    this.forgetBoard();
    for (const socket of this.ctx.getWebSockets()) {
      this.close(socket, CLOSE_STORAGE_FAILURE, CLOSE_REASON.storageFailed);
    }
  }

  /**
   * Decides, on a new connection, whether the room is in a state to look at storage again:
   * after a storage failure or an eviction the document is simply gone, and a board that
   * could not be loaded is retried no more often than `LOAD_RETRY_MIN_INTERVAL_MS`.
   */
  private answerConnection(): Serving {
    if (this.phase === 'storage-failed') return this.reloadBy('reconnect');
    if (this.phase === 'hibernated') return this.reloadBy('wake');
    if (this.phase === 'load-failed') {
      // Too soon since the board could not be read? The connection is answered from the
      // state we are in — refused with 4500, and no read attempted, which is the point: a
      // board whose storage is down is not poked once per arriving client.
      const event = loadRetryEvent(Date.now(), this.loadFailedAt, this.retryIntervalMs);
      if (event === 'reject-load') return this.serving();
      this.phase = nextRoomState('load-failed', event);
      this.reload();
      return this.serving();
    }
    // Say "ready" but hold nothing: this object has lost the board without saying so in its
    // state, and a connection must not be refused for that. Reading it back is what a message
    // would get; a newcomer gets the same.
    if (this.board === null) return this.reloadBy('wake');
    return this.serving();
  }

  /** The board to serve from, reloading first if this object has lost it. */
  private wake(): Serving {
    if (this.phase === 'hibernated' || this.phase === 'storage-failed') return this.reloadBy('wake');
    if (this.phase === 'ready' && this.board === null) return this.reloadBy('wake');
    return this.serving();
  }

  /**
   * Reads the board back, having first moved the room into `loading` by the edge that got us
   * here — so every reload in the room is a state the state machine knows about.
   */
  private reloadBy(event: RoomEvent): Serving {
    this.phase = nextRoomState(this.phase, event);
    if (this.phase !== 'loading') this.phase = 'loading';
    this.reload();
    return this.serving();
  }

  /** What a socket would get right now: the board, or the close code that explains why not. */
  private serving(): Serving {
    const board = this.board;
    if (this.phase === 'ready' && board !== null) return { ok: true, doc: board };
    if (this.phase === 'storage-failed') {
      return { ok: false, closeCode: CLOSE_STORAGE_FAILURE, reason: CLOSE_REASON.storageFailed };
    }
    return { ok: false, closeCode: CLOSE_BOARD_LOAD_FAILED, reason: CLOSE_REASON.loadFailed };
  }

  /** Sends bytes. A socket that cannot be written to is not the board's problem. */
  private send(socket: WebSocket, bytes: Uint8Array): void {
    try {
      socket.send(bytes);
    } catch {
      // The peer is gone. With the hibernation API the runtime owns the socket, so there is
      // nothing here to tidy up; one dead socket must not stop the board for anybody else.
    }
  }

  /** Closes one socket with a code that says why. */
  private close(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, closeReason(reason));
    } catch {
      // already closed
    }
  }
}

/** An answer a test hook can read. */
function hookJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
