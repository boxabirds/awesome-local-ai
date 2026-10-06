/**
 * The BoardRoom Durable Object: one object per board, holding that board's
 * `Y.Doc`, keeping it in storage, and relaying messages between everyone on it.
 *
 * The order of work for a change matters and is not negotiable: **applied,
 * written, then broadcast**. The `update` event of the document is where both
 * halves happen — a change that could not be written is never sent to anybody,
 * because a client that saw a change it cannot get back is worse than one that
 * saw nothing.
 *
 * At startup the board is read back out of storage into the document before
 * anything is served, so a board that was closed an hour ago is on screen before
 * the first frame that could show an empty one. The read is synchronous — Durable
 * Object SQLite is — and it happens in the constructor, which is the one point in
 * an object's life where nothing else can interleave. If it cannot be read, the
 * room says so with close code 4500 and refuses to serve an empty document; it
 * tries again on the next connection, at most once per `LOAD_RETRY_MIN_INTERVAL_MS`.
 *
 * The sockets are accepted with `ctx.acceptWebSocket`, the hibernation API, which
 * is what lets the object go idle with sockets still open. That is safe here and
 * only here: the board lives in storage, so an object that is evicted and woken by
 * the next message loads the same board back. It was `accept()` in story 3 for the
 * opposite reason — the document was memory-only, and losing the object meant
 * losing the board.
 *
 * Still deliberately absent: participant counts (MAX_CONCURRENT_EDITORS is a
 * design and test target, never enforced), awareness state (story 6), and text
 * history beyond the last saved change (story 8).
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';

import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameMessage,
} from '../shared/protocol.js';
import { BoardStore, shouldCompact, type LoadResult } from './board-store.js';
import type { Env } from './index.js';
import {
  nextRoomState,
  wireStateOf,
  type RoomDebugState,
  type RoomEvent,
  type RoomLifecycleState,
} from './room-state.js';
import { handleTestHook, TEST_HOOK_ORIGIN } from './test-hooks.js';

/** A frame whose body is built by `write` (a `y-protocols/sync` writer). */
const syncFrame = (write: (body: encoding.Encoder) => void): Uint8Array =>
  frameMessage(MESSAGE_SYNC, encoding.encode(write));

export class BoardRoom extends DurableObject<Env> {
  /** This board's rows: snapshot, log, quarantine. Created with the object, over
   * its storage, because the first thing the object does is read them. */
  private readonly store: BoardStore;

  /** The board's document, or nothing when the room is not holding one. */
  private boardDoc: Y.Doc | undefined;

  /** Where this object is in its lifecycle; see `room-state.ts`. */
  private lifecycle: RoomLifecycleState = 'loading';

  /** When the last load failed, to hold retries back to one per interval. */
  private loadFailedAt = 0;

  /** What the last successful load had to quarantine, for `/__state`. */
  private loadQuarantined = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Nothing is served until the board has been read back. The read is synchronous
    // all the way through — Durable Object SQLite is, which is why this lives in the
    // constructor and not behind `ctx.storage.blockConcurrencyWhile`: a constructor
    // that does not return cannot interleave with anything, so the gate would buy
    // nothing here. (It is also not free: an unfinished `blockConcurrencyWhile` keeps
    // a promise pending that the test runtime reports as a teardown error.)
    this.loadBoard('wake');
  }

  // ---------------------------------------------------------------- creation

  /**
   * Make this board real (design "Board creation and existence API").
   *
   * Called over RPC by `createBoard`, once per new id. It writes the schema and
   * `created_at` and nothing else — no update rows, no document state — so a board
   * that nobody edits is an empty board rather than a board with a receipt in it.
   *
   * It answers `exists` for a board that already has a `created_at`, and it never
   * changes one that does: being asked twice is not a reason to move a board's
   * birthday, and an `exists` for a freshly minted id is how `createBoard` learns
   * that the 128 bits collided (TC-15).
   */
  async initialize(): Promise<'created' | 'exists'> {
    const had = this.store.createdAt();
    const at = this.store.markCreated(Date.now());
    if (had !== null) return 'exists';
    // The board now has storage. The room may be holding an empty document from a
    // load that ran before it existed — which is what an object that was only ever
    // *asked* about this id holds — and an empty document is the right thing for an
    // empty board, so there is nothing to reload.
    return at === had ? 'exists' : 'created';
  }

  /**
   * Does this board exist? Read-only: it writes nothing, so a link that a person
   * mistyped can be asked about as often as they like without anything appearing
   * where an empty board would have appeared (TC-06).
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Read the board into a document. Synchronous throughout: schema, snapshot,
   * then the log. On success the room holds a board; on failure it holds nothing
   * and knows why.
   */
  private loadBoard(why: 'wake' | 'retry'): void {
    this.setLifecycle('loading');
    const doc = new Y.Doc();
    doc.on('update', this.boardChanged);

    let result: LoadResult;
    try {
      // No `migrate()` here. Building the schema was how an object used to make a board
      // exist by being woken - by a link, by a probe, by anything that said its name -
      // and story 5 is about that being a thing that only `POST /api/boards` does. The
      // store reads a board with no tables as the empty board it is, and the schema is
      // made by `initialize()` or, for a board that predates `initialize()`, in front of
      // the first change that needs somewhere to go.
      result = this.store.load(doc);
    } catch (error) {
      // Storage itself was unreachable: the same honest answer, a different reason.
      result = { ok: false, reason: 'sql-error', error: String(error) };
    }

    if (!result.ok) {
      console.error('[board-room] board could not be loaded', {
        reason: result.reason,
        error: result.error,
        retry: why,
      });
      doc.off('update', this.boardChanged);
      doc.destroy();
      this.boardDoc = undefined;
      this.loadFailedAt = Date.now();
      this.setLifecycle({ type: 'load-failed' });
      return;
    }

    this.boardDoc = doc;
    this.loadQuarantined = result.quarantined;
    if (result.quarantined > 0) {
      console.warn('[board-room] board loaded with damaged changes quarantined', {
        quarantined: result.quarantined,
      });
    }
    this.setLifecycle({ type: 'loaded', quarantined: result.quarantined });
  }

  /**
   * The board this room should serve now, loading it if the object is not holding
   * one. The lifecycle decides whether a load is allowed: never while clients are
   * connected (a reload would drop changes that are only in memory), never twice
   * in a row inside the retry interval, once more after a storage failure.
   */
  private boardToServe(): Y.Doc | undefined {
    switch (this.lifecycle) {
      case 'ready':
      case 'compacting':
        return this.boardDoc;
      case 'loading':
        // Only reachable if an event arrived before the startup gate finished.
        this.loadBoard('wake');
        return this.boardDoc;
      case 'hibernated':
        this.setLifecycle({ type: 'woken' });
        // An object that was evicted has no document to hand back; one that merely
        // went idle still has it, and re-reading the board would be wasted work.
        if (this.boardDoc === undefined) this.loadBoard('wake');
        return this.boardDoc;
      case 'load-failed': {
        const next = nextRoomState(this.lifecycle, {
          type: 'connection',
          msSinceFailure: Date.now() - this.loadFailedAt,
        });
        if (next === 'load-failed') return undefined;
        this.setLifecycle(next);
        this.loadBoard('retry');
        return this.boardDoc;
      }
      case 'storage-failed':
        // The board in memory may hold a change that was never written, which is
        // why it is dropped and the board is read back.
        this.setLifecycle({ type: 'retry-load' });
        this.discardDocument();
        this.loadBoard('retry');
        return this.boardDoc;
    }
    return undefined;
  }

  /** Move to the next lifecycle state. Pure function, so the order is checkable. */
  private setLifecycle(event: RoomEvent | RoomLifecycleState): void {
    this.lifecycle =
      typeof event === 'string' ? event : nextRoomState(this.lifecycle, event);
  }

  /**
   * The room's copy of the board is gone; storage still has it. This is what an
   * eviction amounts to, and the room recovers from it on the next message or
   * connection.
   */
  private discardDocument(): void {
    const doc = this.boardDoc;
    if (doc === undefined) return;
    doc.off('update', this.boardChanged);
    doc.destroy();
    this.boardDoc = undefined;
  }

  // ------------------------------------------------------------------- events

  /**
   * A change to the board's document. Written to storage before anybody is told,
   * and not told at all if it could not be written.
   */
  /**
   * A change to the board, as opposed to the board being assembled.
   *
   * The room writes and relays an update when it came off one of its sockets: that is what
   * a change to the board means out here. A change a test route made through the model is
   * the one exception, and it says so (`TEST_HOOK_ORIGIN`) rather than pretending to be a
   * socket. Everything else is something the log already holds: the board being read back
   * in carries `LOAD_ORIGIN`, and the update Yjs fires when it at last fits together the
   * pieces it had held back - the ones behind a row it had to quarantine - carries no
   * origin at all. Writing either again would fill the log with copies of rows it has.
   *
   * The socket is asked whether it is a socket rather than whether it is still in
   * `getWebSockets()`, because those are not the same question and only one of them is
   * about where the change came from. A person who edits and closes the tab in the same
   * breath has a last change that arrives after the runtime has already hung that
   * socket up - it is delivered, it is applied, and it is the last thing anybody will
   * ever know about the board unless it is written here. `getWebSockets()` says nothing
   * holds it anymore; the message in hand says a client sent it. Skipping it would be
   * the loss this file exists to prevent: the change is on the screen of the person who
   * made it and in nobody's storage, and the next person to open the board gets a board
   * with that note missing.
   */
  private cameFromAClient(origin: unknown): boolean {
    if (origin === TEST_HOOK_ORIGIN) return true;
    if (origin instanceof WebSocket) return true;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) return true;
    }
    return false;
  }

  private readonly boardChanged = (update: Uint8Array, origin: unknown): void => {
    if (!this.cameFromAClient(origin)) return;

    try {
      this.store.append(update);
    } catch (error) {
      this.storageFailed(error);
      return;
    }

    const frame = syncFrame((body) => writeUpdate(body, update));
    for (const socket of this.ctx.getWebSockets()) {
      // Whoever made the change never sees it come back.
      if (socket === origin) continue;
      this.send(socket, frame);
    }

    this.compactLog();
  };

  /** Fold the log into a snapshot once it passes either threshold. */
  private compactLog(): void {
    if (!shouldCompact(this.store.updateCount(), this.store.updateBytes())) return;
    const doc = this.boardDoc;
    if (doc === undefined) return;

    this.setLifecycle({ type: 'compaction-start' });
    let compacted = false;
    try {
      // The store holds the transaction: chunks in, log emptied, marker moved, or
      // none of it.
      compacted = this.store.compactIfNeeded(doc);
    } catch (error) {
      this.setLifecycle({ type: 'compaction-failed' });
      this.storageFailed(error);
      return;
    }
    this.setLifecycle({ type: compacted ? 'compacted' : 'compaction-failed' });
    if (!compacted) {
      // Nothing was lost: the log is as it was and this is tried again later.
      console.error('[board-room] compaction rolled back; the log is kept as it was');
    }
  }

  /**
   * Storage could not take a change. The board in memory is now untrustworthy — it
   * holds something that was never written — so it is dropped, and everyone on the
   * board is told with 1011 rather than left believing their change was saved.
   */
  private storageFailed(error: unknown): void {
    console.error('[board-room] board could not be written', { error: String(error) });
    this.setLifecycle({ type: 'append-failed' });
    this.discardDocument();
    for (const socket of this.ctx.getWebSockets()) {
      this.close(socket, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
    }
  }

  // ------------------------------------------------------------- connections

  /**
   * A WebSocket upgrade: 101 with the new socket, 426 when the client did not ask
   * for an upgrade. A socket that cannot be given a board is accepted and closed
   * with the code that says why — the client has to be able to tell "this board
   * could not be read" from "the network is bad", and an immediate close carries
   * that code while a refused upgrade does not.
   */
  fetch(request: Request): Response | Promise<Response> {
    const hooked = handleTestHook(request, {
      hooksEnabled: this.env.TEST_HOOKS === '1',
      store: this.store,
      storage: this.ctx.storage,
      document: () => this.boardDoc,
      hibernate: () => this.hibernateNow(),
      state: () => this.debugState(),
    });
    if (hooked !== undefined) return hooked;

    const upgrade = request.headers.get('Upgrade') ?? '';
    if (upgrade.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    // Story 5: a board nobody created is not a board you can join. The question is
    // asked here, inside the object, on the object's own storage, because this is the
    // one place that can ask it without creating the thing it is asking about - and it
    // is asked before the socket is accepted, so a mistyped link leaves no trace: not a
    // row, not a table, not a board that looks like somebody's lost work.
    //
    // It is answered from what the board holds (`created_at`, or rows), not from a list
    // of boards, because there is no such list and this object is not allowed to
    // consider itself evidence: an object that was merely woken by a link is holding an
    // empty document, and an empty document is not a board that exists.
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Messages arrive as ArrayBuffers rather than Blobs.
    server.binaryType = 'arraybuffer';
    // The hibernation API: the runtime owns this socket from here, which is what
    // lets the object go idle with sockets open. It is the room's own state, not a
    // Set of its own, that has to be right — see `getWebSockets()` below.
    this.ctx.acceptWebSocket(server);

    const doc = this.boardToServe();
    if (doc === undefined) {
      const storageDown = this.lifecycle === 'storage-failed';
      this.close(
        server,
        storageDown ? CLOSE_STORAGE_FAILURE : CLOSE_BOARD_LOAD_FAILED,
        storageDown ? 'the board could not be saved' : 'the board could not be loaded',
      );
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ask the newcomer what it has. Its answer is the difference between the two
    // documents, which is the whole board for a client that has never seen it and
    // near nothing for one that is reconnecting — and either way it is why a room
    // that was never evicted does not resend a 2 MB board to a reconnecting client.
    this.send(server, syncFrame((body) => writeSyncStep1(body, doc)));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** One message from one socket. Never throws: bad input closes that socket. */
  webSocketMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      // Every message in this protocol is binary; text is not something to relay.
      this.reject(socket);
      return;
    }

    const doc = this.boardToServe();
    if (doc === undefined) {
      // A hibernated socket whose object has no board: say so, and never hand out
      // an empty document as if it were the board.
      const storageDown = this.lifecycle === 'storage-failed';
      this.close(
        socket,
        storageDown ? CLOSE_STORAGE_FAILURE : CLOSE_BOARD_LOAD_FAILED,
        'the board is not loaded',
      );
      return;
    }

    this.handleMessage(socket, data, doc);
  }

  /**
   * A socket went away. There is no set to take it out of — the runtime holds the
   * sockets — but the room being empty is what makes it allowed to go hibernant,
   * and hibernant is what makes it willing to read the board again.
   */
  webSocketClose(_socket: WebSocket, _code: number, _reason: string): void {
    if (this.lifecycle === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.setLifecycle({ type: 'hibernated' });
    }
  }

  /**
   * A socket errored. On its own that changes nothing about the board: it is the
   * room being left with nobody on it that matters, so that is what is recorded.
   */
  webSocketError(_socket: WebSocket, error: unknown): void {
    console.error('[board-room] socket error', { error: String(error) });
    if (this.lifecycle === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.setLifecycle({ type: 'hibernated' });
    }
  }

  // ------------------------------------------------------------------ messages

  /**
   * Handle a message against a document that is already loaded. The reply to a
   * sync message goes back to whoever asked; everything the message changed in the
   * document was written and relayed by `boardChanged`, which is why the bytes that
   * `readSyncMessage` produced are only ever sent to the asker.
   */
  private handleMessage(socket: WebSocket, data: ArrayBuffer | string, doc: Y.Doc): void {
    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case 'sync': {
        const body = encoding.createEncoder();
        let failure: unknown = null;
        try {
          readSyncMessage(
            decoding.createDecoder(decoded.payload),
            body,
            doc,
            socket,
            (error: Error) => {
              failure = error;
            },
          );
        } catch (error) {
          failure = error;
        }
        if (failure !== null) {
          // An undecodable or invalid Yjs update: this person's connection is
          // closed, the document is unchanged, and nobody else notices.
          this.reject(socket);
          return;
        }
        const reply = encoding.toUint8Array(body);
        if (reply.byteLength > 0) {
          this.send(socket, frameMessage(MESSAGE_SYNC, reply));
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every socket *including* the sender: the room keeps
        // no awareness state, and the copy back to the sender is what keeps an idle
        // connection's traffic flowing.
        const frame = frameMessage(MESSAGE_AWARENESS, decoded.payload);
        for (const target of this.ctx.getWebSockets()) {
          this.send(target, frame);
        }
        return;
      }
      case 'query-awareness':
        // Ignored: there is no stored awareness to answer with. Story 6 answers it.
        return;
      case 'invalid':
        this.reject(socket);
        return;
    }
  }

  // -------------------------------------------------------------- sockets, held by the runtime

  /**
   * Send on one socket. A socket that throws is gone: the runtime will report it
   * closed, and a board is never held up by a reader that has hung up.
   */
  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WebSocket.READY_STATE_OPEN) return;
    try {
      socket.send(data);
    } catch {
      // Dropping it here is the whole error path of "send to dead socket".
    }
  }

  /** Close one socket, leaving everyone else on the board alone. */
  private close(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  /** Close the one socket that sent something unreadable. */
  private reject(socket: WebSocket): void {
    this.close(socket, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
  }

  // ------------------------------------------------------------------ for tests

  /** What this room is, as data. Read by the test hook and by the integration tests. */
  debugState(): RoomDebugState {
    return {
      lifecycle: this.lifecycle,
      // What a client on the other end of a socket would be told.
      state: wireStateOf(this.lifecycle),
      hasDocument: this.boardDoc !== undefined,
      clients: this.ctx.getWebSockets().length,
      updateRows: this.store.updateCount(),
      updateBytes: this.store.updateBytes(),
      chunkRows: this.store.chunkRowCount(),
      quarantinedRows: this.store.quarantinedCount(),
      loadedQuarantined: this.loadQuarantined,
    };
  }

  /**
   * Make this object behave as if the runtime had evicted it: the board in memory
   * is gone, the sockets are not. Nothing is lost — the board is in storage, and
   * the next message or connection reads it back — which is exactly the property
   * the persistence tests are about.
   */
  hibernateNow(): void {
    this.discardDocument();
    this.setLifecycle('hibernated');
  }
}
