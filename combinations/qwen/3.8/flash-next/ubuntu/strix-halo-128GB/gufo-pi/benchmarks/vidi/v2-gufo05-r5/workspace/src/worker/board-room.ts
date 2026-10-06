/**
 * One live board: its document in memory, its bytes in storage, and every browser tab
 * editing it.
 *
 * The room speaks the y-websocket wire framing (`src/shared/protocol.ts`) with plain Yjs
 * clients and adds these guarantees of its own:
 *
 * - the board is **read before anyone is served**: the constructor asks for the snapshot and
 *   the log, and input is held until that has finished. A board that cannot be read is *not*
 *   served as an empty board - the tab is closed with `CLOSE_BOARD_LOAD_FAILED` and says so;
 * - a change is **written before it is seen**: the update row is inserted before the frame
 *   carrying it goes out, so no tab can show something that a restart would lose. A write that
 *   fails stops the board rather than lying about it (`CLOSE_STORAGE_FAILURE` to everyone,
 *   document dropped, the change was never broadcast, and a client that reconnects sends it
 *   again from the copy it still holds);
 * - a frame the room cannot understand, or a payload Yjs rejects, closes *that socket only*
 *   with `CLOSE_UNSUPPORTED_DATA` and is never written to storage;
 * - sockets are hibernated. Nothing in the room is per-socket state, so the runtime may evict
 *   the object while people are connected and wake it on the next frame - which is what keeps a
 *   quiet board cheap, and what `ctx.getWebSockets()` exists for;
 * - the log of changes is folded into a snapshot when it grows, so waking a board that has been
 *   lived in for a month costs one snapshot and a handful of rows, not its whole history.
 *
 * The lifecycle itself is `src/worker/room-state.ts`: this class only asks it what comes next
 * and then does what that state allows.
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  syncFrame,
} from '../shared/protocol';
import type { Env } from './index';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { storageHookOf, testHooksEnabled, type StorageHookAction } from './test-hooks';
import { loadRetryAllowed, nextRoomState, type RoomEvent, type RoomLifecycleState } from './room-state';

/** A Yjs update as a sync message: the inner `update` type, then the bytes. */
function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** One line in the log about this board, so a broken one can be found by its event name. */
function logLine(event: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ event, ...fields });
}

/**
 * The live room of a single board.
 *
 * Created by the runtime when a socket for a board connects or a hibernated socket receives
 * something (`src/worker/index.ts` routes every address to its own object, which is what keeps
 * separate boards separate).
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's storage. Public because the tests fault it on purpose. */
  readonly store: BoardStore;

  /** The board's document, held while the room can serve changes, dropped when it cannot. */
  #doc: Y.Doc | null = null;

  /** The lifecycle state, moved only through `#transition`. */
  #state: RoomLifecycleState = 'loading';

  /** When the last load failed: how soon another attempt is worth making. */
  #loadFailedAt = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.store = new BoardStore(state.storage);
    // Nothing is served until the board has been read: a tab that connected to a room still
    // reading its log would be told the board is empty, which is the one thing this story is
    // not allowed to do.
    this.ctx.blockConcurrencyWhile(async () => {
      this.#load();
    });
  }

  /** Moves the room along its lifecycle, ignoring an event that cannot happen here. */
  #transition(event: RoomEvent): RoomLifecycleState {
    this.#state = nextRoomState(this.#state, event);
    return this.#state;
  }

  /**
   * Reads the board from storage into a fresh document, or records that it could not be read.
   *
   * Runs in the constructor, and again after a storage failure or when a load-failed board is
   * retried. Damaged log rows are handled inside `store.load`: a board can come back `ready`
   * having set a change aside.
   */
  #load(): void {
    this.#state = 'loading';
    // Whatever was held before is replaced by this read - and if the read fails it must not stay
    // either, because a room that cannot read its board must not be holding a copy of it.
    this.#doc?.destroy();
    this.#doc = null;
    const doc = new Y.Doc();
    try {
      this.store.migrate();
    } catch (error) {
      // No tables, no board. The distinction does not matter to a person waiting: their board
      // is not there, and it is not empty either.
      doc.destroy();
      this.#failedToLoad(`storage could not be opened: ${String(error)}`);
      return;
    }
    const result = this.store.load(doc);
    if (result.ok) {
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.#boardChanged(update, origin);
      });
      this.#doc = doc;
      this.#transition({ type: 'loaded' });
      return;
    }
    // A half-read document must never be served, not even for the part that did read.
    doc.destroy();
    this.#failedToLoad(`${result.reason}: ${result.error}`);
  }

  /**
   * Runs a test hook against this board's storage, and puts the room in the state its storage is
   * now really in.
   *
   * Corrupting the snapshot makes the room read its board again, which is to say: it fails, and
   * lands in `load-failed` the way any room that woke to an unreadable board does. Nothing keeps
   * serving from memory, because the point of the hook is to see what a room that cannot read its
   * board does, with nobody's memory of it left to hide the failure behind. Connections then get
   * `CLOSE_BOARD_LOAD_FAILED` until the retry interval has passed and a load succeeds; the repair
   * only puts the bytes back, so it is a later connection's attempt that brings the board back.
   */
  #runStorageHook(action: StorageHookAction): Response {
    try {
      if (action === 'corrupt-snapshot') {
        const result = this.store.corruptSnapshotForTest();
        // No shortcut through the lifecycle: the room reads its storage again, and that read now
        // fails, so it reaches `load-failed` along the same edge a room that woke to an unreadable
        // board does - which is also why the sockets are closed afterwards, not before.
        this.#load();
        for (const socket of this.ctx.getWebSockets()) {
          try {
            socket.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
          } catch {
            // already gone; the room is not serving anybody
          }
        }
        console.log(logLine('test-hook-corrupt-snapshot', result));
        return Response.json({ ok: true, ...result });
      }
      const result = this.store.repairSnapshotForTest();
      console.log(logLine('test-hook-repair-snapshot', result));
      return Response.json({ ok: true, ...result });
    } catch (error) {
      // a board with nothing of the kind to work on is the test's mistake, and should say so
      return new Response(`${String(error)}\n`, { status: 409 });
    }
  }

  /** The state and the log line of a board nobody can open. */
  #failedToLoad(description: string): void {
    this.#loadFailedAt = Date.now();
    this.#transition({ type: 'load-failed' });
    console.error(logLine('board-load-failed', { error: description }));
  }

  /** Accepts a WebSocket connection to this board and starts the initial sync. */
  async fetch(request: Request): Promise<Response> {
    // The storage hooks, before anything else: they are ordinary POSTs rather than upgrades, and
    // this room is the only thing that can reach the board's rows. `TEST_HOOKS=1` alone turns them
    // on, and no production config sets it (see `test-hooks.ts`).
    const hook = storageHookOf(request);
    if (hook !== null && testHooksEnabled(this.env)) return this.#runStorageHook(hook);

    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      // the Worker already rejects this; a direct call gets the same answer
      return new Response('426 Upgrade Required\n', { status: 426 });
    }

    if (this.#state === 'load-failed') {
      // Retrying a read that just failed would only fail again, and a popular broken board
      // would do it continuously. Until the interval has passed, the answer is still no.
      const elapsed = Date.now() - this.#loadFailedAt;
      if (loadRetryAllowed(elapsed)) {
        this.#transition({ type: 'retry-load', elapsedMs: elapsed });
        this.#load();
      }
    }
    if (this.#state === 'storage-failed') {
      // A change could not be written, so the document in memory holds something storage does
      // not. It is dropped, and this connection rebuilds it from what was actually saved;
      // whatever the clients still hold arrives with their sync.
      this.#transition({ type: 'reload' });
      this.#load();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!client || !server) throw new Error('WebSocketPair did not yield two sockets');

    if (this.#state !== 'ready') {
      // Accepted, then closed with the code the client turns into its red message. Accepting is
      // what lets the close carry a code the browser can read.
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Hibernating accept: the room keeps nothing per socket, so the runtime may evict it with
    // people still connected, and `webSocketMessage` will rebuild it on the next frame.
    this.ctx.acceptWebSocket(server);
    // Ask the newcomer for its state. On a restarted room this is what makes the first client
    // re-send everything it had, including a change the room failed to store.
    this.#send(server, syncFrame(this.#syncStep1()));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board's document, which exists whenever the room is serving a connection. */
  #document(): Y.Doc | null {
    return this.#doc;
  }

  #syncStep1(): Uint8Array {
    const doc = this.#document();
    const encoder = encoding.createEncoder();
    if (doc) syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  /**
   * What the room does with a change to its document: store it, then let everyone else see it.
   *
   * `origin` is the socket the change arrived on, or `LOAD_ORIGIN` while the store is reading
   * the board back - reading storage is not a change to it, and echoing it would send a person
   * their own board at them.
   */
  #boardChanged(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    const doc = this.#doc;
    if (doc === null || this.#state !== 'ready') {
      // The room is not in a state where it can promise this change is saved, so it must not
      // promise it is seen. Nothing was broadcast; the client keeps its own copy.
      console.error(logLine('board-change-dropped', { bytes: update.length }));
      return;
    }

    try {
      this.store.append(update);
    } catch (error) {
      this.#storageFailed(error);
      return;
    }

    const frame = syncFrame(updateMessage(update));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      try {
        socket.send(frame);
      } catch {
        // A socket that cannot be written to is gone; the runtime closes it and the next
        // `getWebSockets()` will not list it. Nobody else's board is affected.
      }
    }

    this.#transition({ type: 'update-applied' });
    if (this.store.compactionPending()) {
      this.#transition({ type: 'compaction-started' });
      const folded = this.store.compactIfNeeded(doc);
      this.#transition({ type: folded ? 'compaction-finished' : 'compaction-failed' });
    }
  }

  /**
   * A change could not be written. The board stops here, out loud: nobody is told the change
   * arrived, every connection is closed with the code that says "not saved", and the document
   * goes with them so the room cannot accumulate more that storage does not have.
   */
  #storageFailed(error: unknown): void {
    this.#transition({ type: 'storage-failed' });
    console.error(logLine('board-storage-failed', { error: String(error) }));
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'the board could not be saved');
      } catch {
        // already gone
      }
    }
    this.#doc?.destroy();
    this.#doc = null;
  }

  /**
   * Handles one frame, synchronously: a hibernated room may be evicted between events, so a
   * message handler that waits for something would have to keep the object awake, which is the
   * thing hibernation is there to avoid.
   */
  override webSocketMessage(controller: WebSocket, message: string | ArrayBuffer): void {
    if (this.#state === 'load-failed') {
      controller.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return;
    }
    if (this.#state === 'storage-failed' || this.#document() === null) {
      controller.close(CLOSE_STORAGE_FAILURE, 'the board could not be saved');
      return;
    }
    if (typeof message === 'string') {
      this.#closeUnsupported(controller, 'text frames are not supported');
      return;
    }
    if (!(message instanceof ArrayBuffer)) {
      // a hibernated socket hands over bytes, never a Blob; anything else is not this room's
      // protocol, and guessing would mean applying bytes that may be wrong
      this.#closeUnsupported(controller, 'unsupported frame shape');
      return;
    }
    this.#handleFrame(controller, new Uint8Array(message));
  }

  /** One binary frame. A bad one costs that socket its connection, and nothing else. */
  #handleFrame(socket: WebSocket, data: Uint8Array): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        const doc = this.#document();
        if (doc === null) {
          this.#closeUnsupported(socket, 'the board is not loaded');
          return;
        }
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // y-protocols catches an update it cannot apply and reports it here instead of
        // throwing, so a broken payload has to be turned into a close by hand
        let rejected: unknown;
        try {
          // applies SyncStep2 / updates and turns a SyncStep1 into a SyncStep2 reply
          syncProtocol.readSyncMessage(decoder, encoder, doc, socket, (error: Error) => {
            rejected = error;
          });
        } catch (error) {
          rejected = error;
        }
        if (rejected) {
          // A payload Yjs refused is not stored: a board's log holds changes, not attempts.
          this.#closeUnsupported(socket, 'invalid Yjs message');
          return;
        }
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 0) this.#send(socket, syncFrame(reply));
        return;
      }
      case 'awareness': {
        // relayed verbatim to everybody, sender included (see the file comment)
        for (const other of this.ctx.getWebSockets()) {
          try {
            other.send(data);
          } catch {
            // that socket is gone; the rest of the board carries on
          }
        }
        return;
      }
      case 'query-awareness':
        return; // no awareness state is kept in this story
      case 'invalid':
        this.#closeUnsupported(socket, decoded.reason);
        return;
    }
  }

  /**
   * A socket that sent something unusable. The room keeps serving everyone else: this is a
   * broken or hostile tab, not a broken board.
   */
  #closeUnsupported(socket: WebSocket, reason: string): void {
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // the socket was already gone
    }
  }

  /**
   * A socket went away. There is nothing to un-register - the runtime owns the socket list, and
   * a board with nobody on it keeps its document until the runtime evicts the object, with the
   * next visitor reading it back from storage.
   *
   * The close is echoed back, which a hibernated socket does not do by itself: a tab that closed
   * its connection should hear that it worked (and one that is about to reconnect should not have
   * to wait for a timeout to find out the connection is gone).
   */
  override webSocketClose(
    controller: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    void wasClean;
    try {
      controller.close(code, reason);
    } catch {
      // the socket is already finished; there is nothing left to close
    }
  }

  override webSocketError(controller: WebSocket, error: unknown): void {
    // The socket is already closed by the runtime. The board is in storage, so a socket error is
    // a person's tab going away and nothing else.
    void controller;
    console.error(logLine('board-socket-error', { error: String(error) }));
  }

  /**
   * Sends to one socket; a socket that refuses it is simply not part of the board any more.
   *
   * No `readyState` check: a hibernated socket's reported state is not something to trust, and
   * a socket the runtime has already dropped is not in the list it hands back anyway.
   */
  #send(socket: WebSocket, data: Uint8Array): void {
    try {
      socket.send(data);
    } catch {
      // as above
    }
  }
}
