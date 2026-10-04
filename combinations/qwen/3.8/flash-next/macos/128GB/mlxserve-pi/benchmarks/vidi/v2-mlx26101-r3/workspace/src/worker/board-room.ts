import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './index';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type LifecycleState, type RoomEvent } from './room-state';
import { storeFaultsFor } from './store-faults';
import {
  createLegacyBoard,
  damageSnapshot,
  legacyNotesIn,
  report,
  repairSnapshot,
  roomTestStepIn,
  snapshotChunks,
  type RoomTestStep,
} from './test-hooks';

/** `WebSocket.READY_STATE_OPEN`; written out because the DOM lib calls the same state `OPEN`. */
const SOCKET_OPEN = 1;

/** How long ago the board failed to load, which is what the retry throttle is measured in. */
function since(at: number): number {
  return Date.now() - at;
}

/** One line about this board, so a log says which of thousands of boards it is about. */
function line(id: string, message: string): string {
  return `board ${id}: ${message}`;
}

/**
 * One live board: the document in memory, and everything saved about it in this object's storage.
 *
 * A change is written to storage before it is passed to anybody else, so a change nobody else saw
 * is a change that was not saved either - which is what lets the room promise that what a person
 * sees on their screen was saved (persist.seen_is_saved), and that leaving and coming back costs
 * nothing (persist.automatic). The rows are `board-store.ts`'s business; this file decides when
 * they are written and what happens when they are not.
 *
 * Merge semantics are Yjs's, and they are the product's behaviour: concurrent typing is all kept
 * (live.concurrent_text), concurrent position or colour changes settle to one value on every
 * screen (live.converge), and a delete swallows the edits that happened inside it at the same
 * moment instead of bringing the note back (live.delete_during_edit).
 *
 * ## Sockets, and going to sleep
 *
 * Sockets are accepted with `ctx.acceptWebSocket` - the hibernating API - so that this object can
 * be put to sleep without losing anybody's connection: an accepted socket outlives the object that
 * accepted it, and the room's list of who is here is the runtime's own `ctx.getWebSockets()` rather
 * than a Set of its own. The room can therefore be evicted whenever nobody is talking, which is
 * exactly what this story is about: the board has to come back from storage rather than from
 * memory, and an open socket that kept the object alive would hide it.
 *
 * ## The states it passes through
 *
 * `loading` while the board is read, before the first connection is answered: nobody is served a
 * board that has not been read, and nobody times out waiting for the read. Then `ready`. A change
 * that cannot be written moves it to `storage-failed`: it stops relaying, closes every socket with
 * the reason, and keeps the document in memory, because the people connected to it have work on
 * their screens that they have not lost. They reconnect, the room tries storage again, and whatever
 * their pages hold that the board does not comes back through the ordinary sync and is saved then
 * (persist.save_failure). A board whose own contents cannot be read moves to `load-failed` and says
 * so with a close code instead of showing an empty board (persist.load_failure), trying again no
 * sooner than LOAD_RETRY_MIN_INTERVAL_MS after the last attempt, so pressing reload ten times loads
 * the board once. The transitions are `room-state.ts`: one function, one diagram, tested apart from
 * any Durable Object.
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's document, replaced whenever the board is read out of storage. */
  private doc: Y.Doc;
  /** Where this room is in its lifecycle; see `room-state.ts`. */
  private lifecycle: LifecycleState = 'hibernated';
  /** Why the board could not be read, for the log. What a person sees is one fixed sentence. */
  private loadFailure: string | null = null;
  /** When this instance last tried to read the board, which is what the throttle counts from. */
  private lastLoadAttemptAt = 0;
  /** How many times this instance has read the board. A test counts this instead of guessing. */
  private loadAttempts = 0;
  private readonly store: BoardStore;
  /** Whether this deployment was started with the damage switches turned on; see `test-hooks.ts`. */
  private readonly testHooks: boolean;
  /** This object's own id, as the string a storage fault is armed for. */
  private readonly boardId: string;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.boardId = state.id.toString();
    this.testHooks = env.TEST_HOOKS === '1';
    this.store = new BoardStore(state.storage, {
      // Only a test arms a fault; see `store-faults.ts`. Everything through here.
      faults: storeFaultsFor(this.boardId),
      // What the store noticed about storage - a row it had to set aside, a fold-up that rolled
      // back - is worth one line, and nothing else decides what that line looks like.
      note: (message: string): void => {
        console.log(line(this.boardId, message));
      },
    });
    this.doc = new Y.Doc();
    this.listen();
    // The board is read before this object answers anybody, including the very first connection.
    // `blockConcurrencyWhile` holds the object's input gate until the returned promise settles, so
    // a connection that arrives while the read is still going waits for it rather than being
    // answered with a document that has not been read. The read is synchronous - SQLite in a
    // Durable Object is synchronous - so there is nothing to await in there; what matters is that
    // the gate is held, which makes "read before served" a property of the runtime rather than of
    // the order of two statements here.
    void this.ctx.blockConcurrencyWhile(async (): Promise<void> => {
      this.moveTo({ type: 'wake' });
      this.read();
    });
  }

  /**
   * Read the board out of storage into a document nobody has seen yet, and say whether it worked.
   *
   * Always a fresh `Y.Doc`, because a document that was half-read is not something to serve: the
   * board either comes back whole or the room says it could not be read. Must be called with the
   * room already in `loading`, which is where the lifecycle diagram puts a wake or a connection
   * that leads to a read. Returns where the room ended up, which is what a caller that asked for a
   * read - a test step, say - reports.
   */
  private read(): LifecycleState {
    this.loadAttempts += 1;
    this.lastLoadAttemptAt = Date.now();
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (error) {
      // Storage itself failed, which is a different thing from the board's contents being
      // unreadable. Nobody is connected yet when this happens on a wake, so there is nobody to
      // mislead; the room says so and tries again when somebody arrives.
      this.storageFailed(error);
      return this.lifecycle;
    }
    if (!result.ok) {
      this.loadFailure = `${result.reason}: ${result.error}`;
      this.moveTo({ type: 'load-error' });
      console.error(line(this.boardId, `could not be loaded (${this.loadFailure})`));
      return this.lifecycle;
    }
    this.doc = doc;
    this.listen();
    this.loadFailure = null;
    this.moveTo({ type: 'load-ok' });
    if (result.quarantined > 0) {
      console.error(
        line(
          this.boardId,
          `loaded with ${result.quarantined} damaged change(s) set aside; see quarantined_updates`,
        ),
      );
    }
    return this.lifecycle;
  }

  /** One listener per document, so a document that replaces another gets its own. */
  private listen(): void {
    // One listener for the whole object: whatever any client applies is saved, then forwarded to
    // the other clients of this board only, and never back to where it came from. It hangs off the
    // document rather than off the message handler because a change can arrive three ways -
    // somebody's edit, a newcomer's copy of what the board was missing, a page that was holding
    // changes while saving was broken - and every one of them has to be saved the same way.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.changed(update, origin);
    });
  }

  /**
   * Make this address a board.
   *
   * Called through Durable Object RPC by the route that makes boards (`create-board.ts`), which is
   * the only place a board begins: the tables, and the one row that says when this board was
   * created. A second call says `exists` and changes nothing - not the creation date, and not the
   * board - so an id that landed on a board that is already there cannot overwrite it, and the
   * route can say so instead of serving somebody else's work (TC-15).
   */
  async initialize(): Promise<'created' | 'exists'> {
    // A board that has content but no creation date is one from before that row existed: it is
    // already here, and this is not the thing that made it.
    if (this.store.existsReadOnly()) {
      return 'exists';
    }
    return this.store.markCreated();
  }

  /**
   * Whether a board is stored here, for the routes that have to answer before a connection is
   * accepted - the link check, and the room's own door. Reading only, so that asking a board
   * whether it exists costs that board nothing.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** WebSocket upgrade only: everything else is a misdirected request. */
  override async fetch(request: Request): Promise<Response> {
    // The test switches come first, because they are the only thing here that arrives as a plain
    // POST to a path the room owns. Without the environment saying so they are not a route at all:
    // the answer is the same one this room gives to any other request that is not a connection.
    const step = roomTestStepIn(new URL(request.url).pathname);
    if (step !== null) {
      if (!this.testHooks) {
        return new Response('Not found', { status: 404 });
      }
      // `seed-legacy` is the one step that has to be told what to write; the rest only ask the
      // room to do something it already knows how to do.
      const body = step === 'seed-legacy' ? await jsonIn(request) : null;
      return this.runTestStep(step, body);
    }
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // Nothing is served for a board that is not here: not an upgrade, not a relayed update, not a
    // table in storage. A link that was mistyped, or mangled by whatever it passed through on its
    // way to the person holding it, gets this answer and the client turns it into the Board not
    // found page (share.not_found) - and it is the same answer for "never a board" as for "not a
    // board id", because telling those apart would tell a stranger which links are real.
    if (!this.store.existsReadOnly()) {
      return new Response('Board not found', { status: 404 });
    }
    // A connection is also the moment a room that failed tries again: after a storage failure there
    // are people waiting whose work is not saved, so it goes back to storage as soon as one of them
    // arrives; after a load failure the throttle says whether it is time.
    this.retryIfFailed();
    if (this.lifecycle === 'load-failed') {
      return this.answerLoadFailed();
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    // "What do you have?" - a client answers with SyncStep2, which is everything the room is
    // missing: the board for a newcomer, and the whole document for a room that has just read its
    // board out of storage. Changes a newcomer holds that the board does not are saved on the way
    // in, which is how a change made while saving was broken gets saved once it is not.
    this.send(server, syncStep1Frame(this.doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Try storage again, now that a connection says somebody is there to serve.
   *
   * A storage failure is retried on every connection: the room has nothing to lose, since it closed
   * everybody it had, and the alternative is a board that stays broken until the object happens to
   * be restarted. A load failure is throttled, so that a person pressing reload does not make the
   * room read a board it already knows it cannot read; the throttle lives in the lifecycle diagram,
   * which is where LOAD_RETRY_MIN_INTERVAL_MS is compared against the time since the last attempt.
   */
  private retryIfFailed(): void {
    if (this.lifecycle !== 'storage-failed' && this.lifecycle !== 'load-failed') {
      return;
    }
    const waiting = since(this.lastLoadAttemptAt);
    // Where the diagram puts a connection that arrives this soon after a failure decides whether
    // the board is read again: LOAD_RETRY_MIN_INTERVAL_MS is compared there, not here.
    if (this.moveTo({ type: 'connection', msSinceLoadFailure: waiting }) === 'loading') {
      this.read();
      return;
    }
    // The load is not tried again, but the answer is still the same close code, and quickly: the
    // person pressing reload is told the board could not be loaded rather than left wondering.
    console.error(line(this.boardId, `not loaded again ${waiting}ms after the last attempt`));
  }

  /**
   * Tell the person who connected that this board could not be read, and nothing else.
   *
   * A Close frame with a code of its own rather than an error message: the client's socket goes to
   * `closed`, its attempt counter goes up and `connectBoard` retries on the schedule it already
   * has, so no client code was written for this. What the person sees is one sentence; an empty
   * board is never shown instead (persist.load_failure).
   */
  private answerLoadFailed(): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Damage this board's own storage, or undo the damage, for the browser suite. See
   * `test-hooks.ts` for what each step is for and why a suite needs a broken board at all.
   *
   * Every step reports what it found rather than assuming it worked, because the thing a test is
   * watching for is a *recovery*, and a recovery from damage that was never done proves nothing.
   */
  private runTestStep(step: RoomTestStep, body: unknown = null): Response {
    switch (step) {
      case 'compact': {
        if (this.lifecycle !== 'ready') {
          return report(false, {
            error: `the room is ${this.lifecycle}, so there is no board in memory to fold up`,
          });
        }
        this.moveTo({ type: 'compact' });
        // Forced, because the test cannot afford several hundred changes to make the log cross the
        // threshold on its own; the fold-up itself is the room's ordinary one.
        const folded = this.store.compactIfNeeded(this.doc, true);
        this.moveTo({ type: folded ? 'compact-ok' : 'compact-error' });
        const chunks = snapshotChunks(this.ctx);
        return chunks > 0
          ? report(true, { chunks, folded })
          : report(false, { chunks, error: 'the board was folded up but left no snapshot' });
      }
      case 'corrupt-snapshot': {
        try {
          return report(true, damageSnapshot(this.ctx));
        } catch (error) {
          return report(false, { error: reason(error) });
        }
      }
      case 'repair-snapshot': {
        try {
          const repaired = repairSnapshot(this.ctx);
          return report(repaired.repaired, repaired);
        } catch (error) {
          return report(false, { error: reason(error) });
        }
      }
      case 'read-again': {
        // A room that is being woken is a room nobody is looking at, and the difference matters
        // here: a room that still has sockets would keep serving them from a document it is about
        // to throw away. So the room is only asked to do this once it is on its own, which is what
        // `hibernate` and `wake` mean in the lifecycle diagram anyway.
        const connected = this.ctx.getWebSockets().length;
        if (connected > 0) {
          return report(false, {
            connected,
            error: 'somebody is still connected; a board is only read again when nobody is',
          });
        }
        this.moveTo({ type: 'hibernate' });
        this.moveTo({ type: 'wake' });
        // The room's own read: a fresh document, the snapshot and the log, and the same two ways
        // out - serving, or a load failure that every new connection is told about.
        this.read();
        return this.lifecycle === 'load-failed'
          ? report(true, { state: this.lifecycle, failure: this.loadFailure })
          : report(true, { state: this.lifecycle });
      }
      case 'seed-legacy': {
        // A board under test is a board nobody is looking at, for the same reason `read-again` is:
        // these rows would arrive after a document that does not know about them.
        const connected = this.ctx.getWebSockets().length;
        if (connected > 0) {
          return report(false, {
            connected,
            error: 'somebody is still connected; a board is only seeded when nobody is',
          });
        }
        if (this.lifecycle !== 'ready') {
          return report(false, {
            error: `the room is ${this.lifecycle}, so there is no board here to seed into`,
          });
        }
        const notes = legacyNotesIn(body);
        if (notes === null) {
          return report(false, { error: 'a legacy board is seeded from a list of notes', body });
        }
        try {
          // Log rows and no creation date: the shape a board of story 4 was left in. This room's
          // own store, so the rows are written by the same code that writes a real change.
          const seeded = createLegacyBoard({ append: (update) => this.store.append(update) }, notes);
          // The room cannot go on serving a document that has never seen the rows it just wrote,
          // so it reads its board back the way a wake does - which is also the thing that proves
          // the seeded board is readable, rather than merely present.
          this.moveTo({ type: 'hibernate' });
          this.moveTo({ type: 'wake' });
          // The read the room does when it wakes, and the state it ended in: a seeded board that
          // cannot be read back is a seeded board nobody would ever see.
          const state = this.read();
          return state === 'load-failed'
            ? report(false, {
                ...seeded,
                error: `the board was seeded but could not be read back (${this.loadFailure})`,
              })
            : report(true, { ...seeded, state, exists: this.store.existsReadOnly() });
        } catch (error) {
          return report(false, { error: reason(error) });
        }
      }
    }
  }

  /** One change, from wherever it came: save it, then pass it on. */
  private changed(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) {
      // The board being read out of storage is not a change to it.
      return;
    }
    const from = origin instanceof WebSocket ? origin : null;
    try {
      this.store.append(update);
    } catch (error) {
      // Nothing is relayed: a change that could not be saved is not shown to anybody as saved
      // (persist.save_failure), and the room stops pretending rather than carrying on with a board
      // that is quietly not being kept.
      this.storageFailed(error);
      return;
    }
    this.moveTo({ type: 'update' });
    this.broadcast(updateFrame(update), from);
    this.compact();
  }

  /** Fold the log up if it has grown enough. Never throws: a failed fold-up rolled back. */
  private compact(): void {
    this.moveTo({ type: 'compact' });
    const compacted = this.store.compactIfNeeded(this.doc);
    this.moveTo({ type: compacted ? 'compact-ok' : 'compact-error' });
  }

  /**
   * Stop saving, say why, and let everybody reconnect.
   *
   * The document stays exactly as it is: the connected people have work on their screens that
   * saving broke on, and dropping that here would turn a storage failure into a lost board. Every
   * socket is closed with a code of its own, so a client knows this was the room's fault and not a
   * network one, and `connectBoard` reconnects. When the room tries storage again and it works,
   * whatever those pages hold that the board does not comes back through the ordinary sync and is
   * written then - which is the second half of persist.save_failure.
   */
  private storageFailed(error: unknown): void {
    this.moveTo({ type: 'storage-error' });
    const waiting = this.ctx.getWebSockets().length;
    console.error(
      line(
        this.boardId,
        `could not be saved (${reason(error)}); ` +
          `${waiting} connection(s) are being asked to reconnect and nothing was relayed`,
      ),
    );
    for (const socket of this.ctx.getWebSockets()) {
      this.close(socket, CLOSE_STORAGE_FAILURE, 'storage failed');
    }
  }

  /** One frame, from one socket: text is refused, bytes are decoded. */
  override webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    this.receive(socket, message);
  }

  /** Nothing to take away: the room keeps no socket list of its own, `ctx.getWebSockets()` does. */
  override webSocketClose(): void {
    // The socket is already out of the runtime's list.
  }

  /** As above: a socket that errored is finished with. */
  override webSocketError(): void {
    // Nothing to do.
  }

  /**
   * Move to where the lifecycle diagram says this event leads, and say where that turned out to be.
   *
   * Every change of state in this file goes through here, so the diagram is the only description of
   * what the room may be doing - and a test that wants to know what the room did has one place to
   * look. The new state is returned because callers act on it, and reading the field instead would
   * have TypeScript reasoning about a value a method call just changed.
   */
  private moveTo(event: RoomEvent): LifecycleState {
    this.lifecycle = nextRoomState(this.lifecycle, event);
    return this.lifecycle;
  }

  /** One frame, now known to be bytes or text, from one socket. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync':
        this.receiveSync(socket, decoded.payload);
        return;
      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;
      case 'query-awareness':
        // The room keeps no awareness state in this story (presence is story 6), so there
        // is nothing to answer. The client's own state comes back to it as a relay.
        return;
      case 'invalid':
        this.refuse(socket, decoded.reason);
        return;
    }
  }

  /** Read a `y-protocols/sync` message into the board and reply if there is a reply. */
  private receiveSync(socket: WebSocket, payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // `readSyncMessage` catches an update that yjs cannot read, logs it and carries on as if
    // nothing happened. Here that is not a thing to log: an undecodable update belongs to the
    // socket that sent it, so the failure is collected through the handler it is offered.
    let rejected: Error | null = null;
    try {
      // origin = the socket, so the document update listener knows whose change this is and does
      // not send it back to them.
      syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        encoder,
        this.doc,
        socket,
        (error: Error) => {
          rejected = error;
        },
      );
    } catch (error) {
      this.refuse(socket, `yjs rejected the update: ${reason(error)}`);
      return;
    }
    if (rejected !== null) {
      this.refuse(socket, `yjs rejected the update: ${reason(rejected)}`);
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) {
      this.send(socket, reply);
    }
  }

  /**
   * Pass awareness bytes on verbatim, to every socket including the one they came from.
   *
   * Nobody interprets them in this story; they are the idle-connection heartbeat. A
   * y-websocket client drops a connection it has heard nothing on for 30 seconds, and a
   * room that answered its own queries would go quiet between edits.
   */
  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeUint8Array(encoder, payload);
    this.broadcast(encoding.toUint8Array(encoder), null);
  }

  /** Send to every open socket but the origin. */
  private broadcast(data: Uint8Array, origin: WebSocket | null): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== origin) {
        this.send(socket, data);
      }
    }
  }

  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== SOCKET_OPEN) {
      return;
    }
    try {
      socket.send(data);
    } catch {
      // The socket is dead: drop it here rather than let one broken client stop a board. The
      // runtime takes it out of `getWebSockets()`; there is no list of ours to remove it from.
    }
  }

  /** Close the one socket that sent something undecodable; the board carries on. */
  private refuse(socket: WebSocket, message: string): void {
    this.close(socket, CLOSE_UNSUPPORTED_DATA, message);
  }

  private close(socket: WebSocket, code: number, message: string): void {
    try {
      socket.close(code, message.slice(0, 120));
    } catch {
      // Already gone.
    }
  }
}

/** SyncStep1: "tell me what you have". */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A document update, framed the way a y-websocket client reads it. */
function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The JSON a request was sent with, or `null` when it was sent without one. The one test step that
 * has to be told what to write takes it in a body; nothing else that reaches a room carries one.
 */
async function jsonIn(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
