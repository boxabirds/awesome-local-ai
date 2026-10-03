/**
 * One board, one object: the document, its storage, and the connections carrying it.
 *
 * The object holds the authoritative `Y.Doc` for one board id. Every update it
 * accepts is written to storage before anybody else is told about it, and the object
 * is woken by storage rather than by a socket: on a cold start it reads the snapshot
 * and the update log, and until that has finished it neither accepts a connection nor
 * relays a message, because a room that answered from an empty document would tell
 * everyone the board had been cleared.
 *
 * The connections are the Durable Object's *hibernating* kind. `ctx.acceptWebSocket`
 * hands the socket to the runtime, which holds it while the object is asleep and
 * delivers the next message to a fresh instance; nothing is kept in this class that
 * could not be rebuilt from storage. Two consequences worth knowing while reading:
 * `getWebSockets()` is the list of sockets (there is no `Set` of our own), and idle
 * connections are kept alive by `setWebSocketAutoResponse` instead of by waking the
 * object every thirty seconds — the client answers that keepalive, see
 * `src/client/sync/connectBoard.ts`.
 *
 * The protocol is y-websocket's: a binary message is one varuint message type
 * followed by a payload. `MESSAGE_SYNC` payloads go to `y-protocols/sync`, whose
 * reply — if any — goes back to the socket that asked. `MESSAGE_AWARENESS` payloads
 * are relayed to every other socket as-is. Anything else closes the connection: the
 * room cannot serve what it cannot read.
 *
 * Story 3 covers the relaying; story 4 adds storage to it:
 * - the doc's `update` event stores, then broadcasts, with one exception: the update
 *   origin is the socket that sent it, except while the board is being read back in,
 *   which is marked with `LOAD_ORIGIN` (a unique symbol, not a value that could turn
 *   up in a message).
 * - a write that fails closes the connection that made it with 1011 and puts the room
 *   into `storage-failed`, where it stays: a room that has lost one update cannot
 *   promise the next one arrives.
 * - a board that cannot be read closes every connection attempt with 4500, which is
 *   the code the client reads as "the board is not empty, it is unreadable".
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';

import { BOARD_LOAD_BUDGET_MS, STORAGE_WRITE_BUDGET_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, shouldCompact, type LoadResult } from './board-store';
import type { Env } from './index';
import {
  corruptSnapshot,
  parseTestHook,
  repairSnapshot,
  testHooksEnabled,
  type SnapshotDamage,
  type TestHook,
} from './test-hooks';
import { nextRoomState, type RoomEvent, type RoomState } from './room-state';

/**
 * The hibernation keepalive, in the room's own words: the runtime sends
 * `WS_KEEPALIVE_REQUEST` as a text message over an idle connection and the client
 * answers with `WS_KEEPALIVE_RESPONSE`, all without this object being woken. The
 * client's half of it is in `src/client/sync/connectBoard.ts`, because nothing in a
 * browser answers a text message on its own; the answer arrives here as a message the
 * room ignores rather than drops.
 */
export const WS_KEEPALIVE_REQUEST = 'ping';
export const WS_KEEPALIVE_RESPONSE = 'pong';

/** What a failure looks like in a log line: the name and message, nothing else. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class BoardRoom extends DurableObject<Env> {
  private readonly store: BoardStore;
  /** The board in memory, or `null` between a failure/discarded board and its reload. */
  private ydoc: Y.Doc | null = null;
  /** The load in flight, or the outcome of the last one. `null`: nothing has asked yet. */
  private loaded: Promise<Y.Doc | null> | null = null;
  /**
   * A fresh instance is by definition reading the board: the constructor hands the
   * read to `blockConcurrencyWhile`, so nothing else in this object runs before it has
   * finished. 'hibernated' is what the previous instance left behind, and the only
   * honest way to say it from here is that this one was woken and is now loading.
   */
  private state: RoomState = nextRoomState('hibernated', { type: 'woken' });
  /** When the last read was attempted, for the floor on retrying a board that failed. */
  private lastLoadAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // An idle connection is the runtime's business, not this object's: the pair below
    // is sent as a text message at intervals and answered by the client, so keeping
    // the board's connections alive does not need the object awake.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(WS_KEEPALIVE_REQUEST, WS_KEEPALIVE_RESPONSE),
    );
    // Nothing else in this object runs before the board has been read. Without the
    // block, a message that arrived during the read would be applied to a document
    // that does not know what the board contains yet.
    this.loaded = ctx.blockConcurrencyWhile(() => this.readBoard());
  }

  // --- reading the board -------------------------------------------------

  /**
   * The document to serve, or `null` when the board could not be read.
   *
   * While the first read is running the caller waits with it: a connection that
   * arrives mid-load gets the board, not an empty document and not an error. A board
   * that failed to load is read again when someone comes back, at most once per
   * LOAD_RETRY_MIN_INTERVAL_MS — the client has its own reconnect loop and a storage
   * that is down does not need the help.
   */
  private async board(): Promise<Y.Doc | null> {
    if (this.loaded === null) {
      this.loaded = this.readBoard();
      return this.loaded;
    }
    if (this.state === 'load-failed') {
      const next = nextRoomState(this.state, {
        type: 'retry-load',
        msSinceLastAttempt: Date.now() - this.lastLoadAt,
      });
      if (next === 'loading') {
        this.state = next;
        this.loaded = this.readBoard();
      }
    }
    return this.loaded;
  }

  /**
   * Read the board: schema, snapshot, update log. `null` means it could not be read,
   * and every caller turns that into a refusal rather than an empty board.
   *
   * The load is also the only moment this room measures its own log, because it is
   * the only moment that reads it anyway — which is what the compaction threshold is
   * compared against on the next update.
   */
  private async readBoard(): Promise<Y.Doc | null> {
    const startedAt = Date.now();
    this.lastLoadAt = startedAt;
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      // The tables belong to this object alone, so creating them is part of reading
      // the board rather than a step that has to have happened earlier.
      this.store.migrate();
      result = this.store.load(doc);
    } catch (error) {
      // `load()` reports its own failures; this is for the ones it cannot foresee.
      console.error(JSON.stringify({ event: 'board-load-threw', error: describeError(error) }));
      doc.destroy();
      this.transition({ type: 'load-failed' });
      return null;
    }
    if (!result.ok) {
      // The reason goes in the log and nowhere else: the person on the board gets one
      // sentence on screen, and this is where the difference between an unreadable
      // snapshot and SQL that will not answer is written down.
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      doc.destroy();
      this.transition({ type: 'load-failed' });
      return null;
    }
    this.ydoc = doc;
    this.observe(doc);
    this.transition({ type: 'loaded', quarantined: result.quarantined });
    const ms = Date.now() - startedAt;
    const log = this.store.logStats();
    console.log(
      JSON.stringify({
        event: 'board-loaded',
        updates: log.rows,
        bytes: log.bytes,
        quarantined: result.quarantined,
        ms,
        // The budget a 2000-note board is meant to fit in. Past it the board still
        // opens — that is the point of the budget — but the log says so, because a
        // five-second board is a bug nobody can see from the client.
        overBudget: ms > BOARD_LOAD_BUDGET_MS,
      }),
    );
    return doc;
  }

  /**
   * Forget the board in memory, so the next person to ask gets it read from storage.
   *
   * This is not an event in the room's diagram — events move a room from one state to
   * another, this one puts the object back where a cold object starts. It is what a
   * test hook does after damaging a snapshot, and what a storage failure does to the
   * next handshake: both need a read from storage rather than the document in memory,
   * which is the only way back to a board that is known to match what was kept.
   */
  private discardBoard(): void {
    this.ydoc?.destroy();
    this.ydoc = null;
    this.loaded = null;
    this.state = 'loading';
  }

  /** Move along the diagram, and keep the state where the table says it should be. */
  private transition(event: RoomEvent): RoomState {
    this.state = nextRoomState(this.state, event);
    return this.state;
  }

  // --- connections -------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const hook = parseTestHook(new URL(request.url).pathname);
    if (hook !== null) return this.handleTestHook(hook);

    // The only thing this object serves over HTTP is an upgrade request.
    if (!(request.headers.get('upgrade') ?? '').toLowerCase().includes('websocket')) {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    // A room whose last write failed still has its connections and its document, but
    // a document that is not what storage holds. The next arrival gets it read again.
    if (this.state === 'storage-failed') this.discardBoard();

    const doc = await this.board();
    const pair = new WebSocketPair();
    if (doc === null) {
      // The board could not be read, and that is told rather than shown as an empty
      // board: the client says so on screen and refuses edits that would look like the
      // board had been cleared. 4500 is the code for it, and it is in the range the
      // client's provider retries, so a board that is only briefly unreadable comes
      // back on its own.
      console.error(JSON.stringify({ event: 'board-open-refused', state: this.state }));
      pair[1].accept();
      pair[1].close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Hibernating socket: the runtime owns it while this object sleeps.
    this.ctx.acceptWebSocket(pair[1]);
    // Binary frames as `ArrayBuffer`. The room treats a text frame as a protocol
    // violation, so this is the difference between a sync message and a dropped
    // connection.
    pair[1].binaryType = 'arraybuffer';
    // Ask the newcomer what it has. Its answer is whatever this room is missing, which
    // is also how a board recovers when the last person to leave had a change that
    // never reached storage.
    this.sendTo(pair[1], this.syncStep1(doc));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const doc = await this.board();
    if (doc === null) {
      // Only possible if the board went unreadable after this socket connected, or if
      // a message reaches a socket that was opened before a failed reload.
      this.drop(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return;
    }

    if (typeof message === 'string') {
      // The one text message this room answers instead of dropping: the client
      // replying to the runtime's hibernation keepalive.
      if (message === WS_KEEPALIVE_RESPONSE) return;
      this.drop(ws, CLOSE_UNSUPPORTED_DATA, 'text frames are not supported');
      return;
    }

    // `decodeMessage` judges a frame without throwing: a message the room cannot use
    // is a closed socket, never an exception in a handler the runtime cannot answer.
    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      this.drop(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Verbatim, to everyone including the sender: `y-protocols/awareness` needs a
      // client to see its own update to answer its queries, and an idle client that
      // receives nothing times its connection out. Awareness is presence, not board
      // state, so it is never stored.
      this.broadcast(message);
      return;
    }
    if (decoded.kind === 'query-awareness') return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // Applies the update to the document - firing the listener that stores it and
      // then relays it - and writes the reply (a SyncStep2 for a newcomer) into
      // `encoder`. The socket is the update's origin, which is how the listener knows
      // who to blame if storing it fails.
      //
      // `y-protocols` logs an update Yjs refuses and carries on, which is right for a
      // library that cannot know who to blame. The room can: these bytes came from this
      // socket, so the handler turns the swallow back into a throw and this one
      // connection closes instead of a client quietly diverging.
      readSyncMessage(new decoding.Decoder(decoded.payload), encoder, doc, ws, (error) => {
        throw error;
      });
    } catch (error) {
      this.drop(ws, CLOSE_UNSUPPORTED_DATA, `rejected sync message: ${describeError(error)}`);
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    // More than the lone message-type byte means there is a reply to send.
    if (reply.byteLength > 1) this.sendTo(ws, reply);
  }

  /**
   * Nothing to tidy when a socket goes: the runtime has already forgotten it, and
   * this room keeps no per-connection state. The board stays in memory (and in
   * storage) whether the last person leaves or the process does.
   */
  override webSocketClose(
    _ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): void {
    console.log(JSON.stringify({ event: 'socket-closed', code, reason }));
  }

  /**
   * A hibernated socket that stopped answering — a dropped cable, a laptop closed.
   * The runtime has taken the socket away; the board keeps whatever was last stored.
   */
  override webSocketError(ws: WebSocket, error: unknown): void {
    console.error(
      JSON.stringify({ event: 'socket-error', readyState: ws.readyState, error: describeError(error) }),
    );
  }

  // --- storing and relaying ----------------------------------------------

  /**
   * Watch the document for changes. Two things arrive here: updates read back from a
   * peer, and updates this room made itself (there are none — it only ever applies
   * what it is given). The origin tells them apart, and `LOAD_ORIGIN` keeps the board
   * being read back from being written back out as though it were new.
   */
  private observe(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      this.storeUpdate(update, origin);
    });
  }

  /**
   * Write one update before anyone else hears about it, so that a board which was
   * changed is a board which was saved.
   *
   * A write that throws takes the connection that made the change with it and closes
   * the board to further writes: the update is in this room's memory and nowhere else,
   * and telling the rest of the board about it would leave everyone agreeing about
   * something storage has never heard of. The room does not recover inside this
   * object's life — the next handshake reads the board from storage again.
   */
  private storeUpdate(update: Uint8Array, origin: unknown): void {
    if (this.state === 'storage-failed') {
      console.error(JSON.stringify({ event: 'update-refused', reason: 'storage-failed' }));
      if (origin instanceof WebSocket) {
        this.drop(origin, CLOSE_STORAGE_FAILURE, 'this board can no longer be written');
      }
      return;
    }

    const startedAt = Date.now();
    try {
      this.store.append(update);
    } catch (error) {
      this.transition({ type: 'storage-error' });
      console.error(JSON.stringify({ event: 'storage-failure', error: describeError(error) }));
      if (origin instanceof WebSocket) {
        this.drop(origin, CLOSE_STORAGE_FAILURE, 'this board could not be saved');
      }
      return;
    }
    const ms = Date.now() - startedAt;
    if (ms > STORAGE_WRITE_BUDGET_MS) {
      // The write landed, so the update is broadcast and the board stays open; a log
      // line is the only place this can be seen, and it is the symptom a slow storage
      // shows before it shows anything else.
      console.error(JSON.stringify({ event: 'storage-write-slow', ms }));
    }
    this.transition({ type: 'update-stored' });

    if (origin instanceof WebSocket) {
      this.relay(origin, this.encodeSync(update));
    } else {
      // An update with no connection behind it has nobody to withhold it from.
      for (const socket of this.ctx.getWebSockets()) this.sendTo(socket, this.encodeSync(update));
    }

    // Folding the log happens after the change is live, and `waitUntil` keeps this
    // object alive until the fold has finished or failed - which is the point: the fold
    // may be the last thing this object does before it goes to sleep, and a fold that
    // never completed would be a board that reads back slowly forever.
    this.ctx.waitUntil(Promise.resolve().then(() => this.compactLog()));
  }

  /**
   * Fold the update log into a snapshot when it has grown enough to be worth it.
   *
   * The store guarantees the all-or-nothing part; this decides whether to bother and
   * records which way it went. A fold that fails leaves the log exactly as it was, so
   * the room keeps serving and tries again at the next update.
   */
  private compactLog(): void {
    const doc = this.ydoc;
    if (doc === null) return;
    const log = this.store.logStats();
    if (!shouldCompact(log.rows, log.bytes)) return;
    this.transition({ type: 'compaction-started' });
    const committed = this.store.compactSnapshot(doc);
    this.transition({ type: committed ? 'compaction-committed' : 'compaction-rolled-back' });
  }

  /** Pass a message to every socket but the one it came from. */
  private relay(from: WebSocket, payload: Uint8Array | ArrayBuffer): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === from) continue;
      this.sendTo(socket, payload);
    }
  }

  /** Pass a message to every live socket, the sender included. */
  private broadcast(payload: Uint8Array | ArrayBuffer): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.sendTo(socket, payload);
    }
  }

  private encodeSync(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  private syncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  /**
   * A socket that will not take a message is gone, not a board problem: the runtime
   * closes it and the person's client reconnects.
   */
  private sendTo(socket: WebSocket, payload: Uint8Array | ArrayBuffer): void {
    try {
      socket.send(payload);
    } catch (error) {
      console.error(JSON.stringify({ event: 'send-failed', error: describeError(error) }));
    }
  }

  private drop(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason.slice(0, 120));
    } catch {
      // Already closed, or the code is one the runtime will not send. Either way the
      // connection is over, which is all this was asked to do.
    }
  }

  // --- test hooks --------------------------------------------------------

  /**
   * `/__test/boards/:boardId/corrupt-snapshot` and `…/repair-snapshot`, live only
   * when `TEST_HOOKS=1`. Both damage or undo damage to the *stored* snapshot and then
   * discard the board in memory, so the next handshake is a real read of whatever the
   * storage now holds. See `src/worker/test-hooks.ts`.
   */
  private async handleTestHook(hook: TestHook): Promise<Response> {
    if (!testHooksEnabled(this.env)) {
      return new Response('test hooks are disabled', { status: 404 });
    }
    if (hook.action === 'corrupt-snapshot') {
      const doc = await this.board();
      // The damage has to land on a snapshot, so the log is folded first whatever its
      // size; a board that has never been folded has nothing to damage.
      const compacted = doc !== null && this.store.compactSnapshot(doc);
      const result = compacted
        ? corruptSnapshot(this.ctx.storage)
        : { corrupted: false, chunkBytes: 0, reason: 'no snapshot to damage' } satisfies SnapshotDamage;
      if (result.corrupted) this.discardBoard();
      console.error(JSON.stringify({ event: 'test-snapshot-corrupted', ...result }));
      return Response.json(result);
    }
    const result = repairSnapshot(this.ctx.storage);
    // Whether or not there was damage, the next connection should read the board that
    // is in storage now rather than the one this object remembers.
    this.discardBoard();
    console.error(JSON.stringify({ event: 'test-snapshot-repaired', ...result }));
    return Response.json(result);
  }
}
