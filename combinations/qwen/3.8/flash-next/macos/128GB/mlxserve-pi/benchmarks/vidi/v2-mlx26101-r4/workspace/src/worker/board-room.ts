/**
 * The room a board lives in: one Durable Object per board, which is also the only place
 * that board is ever held in memory.
 *
 * It is a relay, not an authority: Yjs decides how changes merge (which is why two people
 * typing in the same note keep both people's typing), and this file moves bytes between
 * sockets and keeps them. Two boards are two objects, so nothing a person does here can ever
 * be seen on another board.
 *
 * Two things are load-bearing about that. **A change is written before it is repeated**: the
 * update goes into this board's SQLite storage and only then goes out to everybody else, so
 * a change another person can see is a change that would survive this object being shut down
 * — which is the whole promise of "come back and everything is here". And **nothing is
 * remembered about a board nobody is looking at**: the sockets are accepted with the
 * hibernation API, and when the last one closes the document is thrown away rather than held
 * until the runtime gets around to evicting this object. An idle board costs nothing, and a
 * board that was idle is read back from storage by whoever opens it next.
 *
 * The consequence of writing before repeating is that a write which fails cannot be ignored.
 * It means the board in memory and the board on disk have started to differ, and the two
 * things a room could do about that are tell people or lie to them — so it closes every
 * socket with `CLOSE_STORAGE_FAILURE` and discards the document. The people still holding the
 * change are not told they lost it, because they have not: their documents still hold it, and
 * the next connection carries it out again through the ordinary handshake.
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
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { initDoc } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN, type StoreOperation } from './board-store';
import { seedBoard } from './test-seed';
import { INITIAL_ROOM_LIFECYCLE, nextRoomState, roomStateOf, type RoomEvent, type RoomLifecycle, type RoomState } from './room-state';

/** Bindings the Worker gives this object (see `src/worker/index.ts`). */
export interface Env {
  /** This class, so the Worker can open the room for a board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, for everything that is not a board connection. */
  ASSETS: Fetcher;
  /** Test-only routes, present only when the test build asks for them. */
  TEST_HOOKS?: string;
}

/** What the room tells a connection about itself. */
export type { RoomState };

export class BoardRoom extends DurableObject<Env> {
  /** This board's tables. Made before anything else, because everything else needs them. */
  readonly store: BoardStore;

  /**
   * The board as Yjs holds it, while anybody is looking at it.
   *
   * `null` is not an error: it is what an empty room holds, and what this object holds after
   * the last person leaves. The board itself is in `store` the whole time.
   */
  private document: Y.Doc | null = null;

  /** Where this room is in its own life; the policy for that is in `room-state.ts`. */
  private lifecycle: RoomLifecycle = INITIAL_ROOM_LIFECYCLE;

  /** When a load last failed, which is what throttles the next attempt. */
  private lastLoadFailure = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // SQLite-backed Durable Objects want their tables created here, synchronously, before
    // anything else runs: a board that was never opened gets its tables the first time
    // anybody opens it, and nothing else.
    this.store = new BoardStore(ctx.storage, (line) => {
      console.error(`[board ${ctx.id.toString().slice(0, 8)}] ${line}`);
    });
    this.store.migrate();
    // The board is read back before this object is allowed to do anything else, so that no
    // connection is ever answered from a document that has not been loaded yet — and so that
    // "this board could not be read" is known before the first person is told anything.
    ctx.blockConcurrencyWhile(async () => {
      this.loadBoard('wake');
    });
  }

  // --- lifecycle -------------------------------------------------------------

  /** What a connection would be told if it asked who this room is. */
  get state(): RoomState {
    return roomStateOf(this.lifecycle);
  }

  /**
   * Do what the lifecycle table says, and take note of the time when a load failed.
   *
   * The table is in `room-state.ts` and is tested on its own (TC-27); this is the only place
   * that feeds events into it, which is why every state change in this file goes through here
   * rather than assigning a field.
   */
  private transition(event: RoomEvent): void {
    const next = nextRoomState(this.lifecycle, event);
    if (next === 'load-failed' && this.lifecycle !== 'load-failed') this.lastLoadFailure = Date.now();
    this.lifecycle = next;
  }

  /**
   * Read the board back into a document of its own.
   *
   * The document the store fills is a new one, and the old one is thrown away: a room that
   * could not read its board must not be left holding a document that is half a board, which
   * is how a board starts being quietly shown as empty.
   */
  private loadBoard(event: RoomEvent): void {
    this.transition(event);
    const doc = new Y.Doc();
    // The board's schema version is recorded before the stored board is applied to it, so
    // that a board created before this document had a version still says it has one. It is
    // not stored as a change: a board nobody has edited must not gain a row just because
    // somebody opened it.
    initDoc(doc);
    const result = this.store.load(doc);
    if (!result.ok) {
      doc.destroy();
      this.document = null;
      this.transition('load-failed');
      console.error(
        `[board ${this.ctx.id.toString().slice(0, 8)}] load-failed: ${result.reason}: ${result.error}`,
      );
      return;
    }
    // One listener does the storing and the sharing. Its `origin` is the socket a change
    // arrived on, which is the only honest way to tell "somebody changed the board" from
    // "the board was read back from disk" and "this document was set up": the first is
    // written down and repeated, the other two are neither.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.onChange(update, origin);
    });
    this.document = doc;
    this.transition(result.quarantined > 0 ? 'loaded-quarantined' : 'loaded');
  }

  /**
   * Another try at a board that could not be read.
   *
   * The wait is not politeness. A board that cannot be read is read again by every person who
   * opens it, and if it cannot be read because the storage behind it is unhappy, retrying once
   * a second for as long as people are curious is how it stays unhappy. The client is already
   * dialling on its own backoff; this is the server refusing to try harder than that.
   */
  private retryLoad(): void {
    if (this.lifecycle !== 'load-failed') return;
    if (Date.now() - this.lastLoadFailure < LOAD_RETRY_MIN_INTERVAL_MS) return;
    this.loadBoard('retry');
  }

  // --- connections -----------------------------------------------------------

  /**
   * The routes a test uses, and nothing else does.
   *
   * They are reachable only from inside this Worker: `src/worker/index.ts` routes board
   * connections here by path and mounts `src/worker/test-hooks.ts` in front of them only when
   * `TEST_HOOKS` is set, so a browser has no address that reaches any of this and a production
   * Worker does not have the addresses at all.
   *
   * Everything here is synchronous, like the storage it reads and writes.
   */
  private handleInternal(url: URL, request: Request): Response {
    const route = url.pathname.slice(3);
    const json = (value: unknown, status = 200): Response => Response.json(value, { status });
    const post = (name: string): boolean => request.method === 'POST' && route === name;

    if (request.method === 'GET') {
      if (route === 'stats') return json(this.store.stats());
      if (route === 'lines') return json({ lines: this.store.lines });
      if (route === 'state') {
        // `sockets` is the runtime's own list, which is the thing hibernation is judged on: after
        // this object has been put away and rebuilt, it is the only record of who is here.
        return json({ state: this.state, lifecycle: this.lifecycle, sockets: this.ctx.getWebSockets().length });
      }
    }

    if (post('corrupt-snapshot')) {
      this.store.corruptSnapshot();
      return json({ corrupted: true, unreadable: this.store.unreadable !== null });
    }
    if (post('repair')) {
      // Put back the bytes `corrupt-snapshot` overwrote. The board is then a board again, and
      // the next connection reads it — which is the half of the story that says a broken board
      // is not a board that stays broken.
      return json({ restored: this.store.restoreSnapshot() });
    }
    if (post('compact')) {
      // A test asks for this because waiting for 500 changes in a browser is not a test, and
      // because damaging a snapshot needs a snapshot to exist.
      const doc = this.holdDocument();
      const compacted = doc === null ? false : this.store.compactIfNeeded(doc, true);
      if (this.document === null) doc?.destroy();
      return json({ compacted, snapshot: this.store.stats().snapshot });
    }
    if (post('seed')) {
      // A board filled with notes for the tests that need a big one. See `test-seed.ts`:
      // written through the model into the same storage a person's changes go into, one row
      // per note, so the thing being measured is opening a board and not making one.
      const count = Number(url.searchParams.get('notes') ?? '0');
      const doc = this.holdDocument();
      if (doc === null) return json({ error: 'this board could not be read' }, 409);
      const seeded = seedBoard(doc, this.store, Number.isFinite(count) ? count : 0);
      if (this.document === null) doc.destroy();
      // The whole of the store's account of itself, so a test can poll this until the
      // board it asked for is really on disk.
      return json({ seeded, stats: this.store.stats() });
    }
    if (post('fail-next')) {
      const operation = url.searchParams.get('operation') ?? '';
      const through = Number(url.searchParams.get('through') ?? '0');
      this.store.injectFailure(operation as StoreOperation, through);
      return json({ injected: operation, through });
    }

    return json({ error: `no such test route: ${request.method} ${url.pathname}` }, 404);
  }

  /**
   * A document to read the board into when the room is not holding one, and the room's own
   * when it is. The caller decides whether to throw it away.
   */
  private holdDocument(): Y.Doc | null {
    if (this.document !== null) return this.document;
    const doc = new Y.Doc();
    initDoc(doc);
    return this.store.load(doc).ok ? doc : null;
  }

  /**
   * Accept a connection to this board.
   *
   * Every connection — the first, a late joiner, and every reconnection after a drop or a
   * restart — starts the same way: the room asks the newcomer what it is missing
   * (SyncStep1), and the newcomer answers with everything the room does not have (SyncStep2).
   * That one rule is what fills a room back in from the first person who comes back, and what
   * carries an update that failed to be saved the first time.
   */
  override fetch(request: Request): Response {
    const url = new URL(request.url);
    // A test asking this board about itself, or asking it to do the thing a test cannot make
    // happen any other way. See `handleInternal`.
    if (url.pathname.startsWith('/x/')) return this.handleInternal(url, request);

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      // The room speaks one thing; the Worker answers this for normal page requests.
      return new Response('The board room accepts WebSocket connections only.', { status: 426 });
    }

    // A room that is not holding a board has to become one before it can answer anybody:
    // because it was woken, because it is empty, or because a board it could not read is due
    // another try. The read is synchronous, so nobody is kept waiting for it.
    if (this.lifecycle === 'load-failed') this.retryLoad();
    if (this.document === null && this.lifecycle !== 'load-failed') this.loadBoard('wake');
    if (this.lifecycle === 'load-failed') return this.refuse();

    const doc = this.document as Y.Doc;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Binary frames have to arrive as an ArrayBuffer rather than as a Blob; without this,
    // every frame looks undecodable and every connection is closed as though the sender had
    // sent garbage.
    server.binaryType = 'arraybuffer';
    // Hibernated on purpose: the board is in storage, so this object can be shut down while
    // its sockets stay open, and be woken by the next frame. `ctx.getWebSockets()` is the
    // list of who is here, not a set of our own, because a set of our own would not survive
    // being woken.
    this.ctx.acceptWebSocket(server);

    this.send(server, this.syncStep1(doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A board that could not be read is not served as an empty board.
   *
   * The socket is accepted and then closed with a code of its own, because the alternative is
   * a connection that succeeds: a client that is told it is connected and then shown nothing
   * has been told this board is empty, which is the one thing this board is never allowed to
   * say without knowing it is true.
   */
  private refuse(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Something arrived on a connection. */
  override webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): void {
    // A room that cannot read the board cannot answer a message about it. Note that this is
    // not the same as refusing the connection: this socket was accepted while the board was
    // readable, and the board stopped being readable afterwards.
    if (this.lifecycle === 'load-failed') {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return;
    }
    if (this.lifecycle === 'storage-failed') {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
      return;
    }
    // This object has been woken by this message and has thrown its document away when the
    // last person left; the board comes back from storage before the message is answered.
    if (this.document === null) this.loadBoard('wake');
    if (this.document === null) {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return;
    }

    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Data that cannot be read is that connection's problem only, and nothing of it is
      // written down: it is closed with the code that says "unsupported data" and the board
      // carries on.
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // Nobody is counted and no presence is kept yet (story 6), so there is nothing to
      // answer. The connection stays open: the room was asked, and does not know who is here.
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relayed exactly as it arrived, to everyone including whoever sent it. That last part
      // matters: an idle browser expects to hear something on an open connection, and its own
      // presence coming back is what stops it declaring the board dead.
      this.relay(decoded.payload);
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // Yjs reports a bad update by calling this rather than throwing, so a connection that
    // sent garbage is identifiable here and is the only thing closed.
    let rejected: unknown = null;
    const onError = (error: unknown): void => {
      rejected = error;
    };

    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.document as Y.Doc,
        socket,
        onError,
      );
    } catch (error) {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, error instanceof Error ? error.message : String(error));
      return;
    }
    if (rejected !== null) {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'the board rejected this update');
      return;
    }

    // A reply is only worth sending if it holds more than its type byte: a message that was
    // merely stored is already on its way to everyone else as an update.
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) this.send(socket, reply);
  }

  /** A connection closed. The socket itself is the runtime's to forget. */
  override webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    // A person closing a tab and a network dying look the same from here, and either way the
    // board is already in storage — so there is nothing to do but notice that the room may
    // now be empty.
    if (!wasClean) console.warn(`board connection ended uncleanly: code=${code} reason=${reason} readyState=${socket.readyState}`);
    this.setIdle();
  }

  /** A connection failed. There is nothing to recover, and nothing else to say. */
  override webSocketError(socket: WebSocket, error: unknown): void {
    console.warn(`board connection failed: readyState=${socket.readyState} error=${error instanceof Error ? error.message : String(error)}`);
    this.setIdle();
  }

  /**
   * Put the board down when nobody is looking at it.
   *
   * The sockets are the room's only reason to hold a document: every change is in storage
   * before it is repeated, so an empty room holding a copy of its board is a cost with nothing
   * on the other side of it. The next connection reads the board back.
   */
  private setIdle(): void {
    if (this.ctx.getWebSockets().length > 0) return;
    if (this.document === null) return;
    this.document.destroy();
    this.document = null;
    this.transition('idle');
  }

  // --- a change to the board -------------------------------------------------

  /**
   * Somebody changed the board: write it down, then tell everyone else.
   *
   * In that order, synchronously, in that order. `storage.sql` writes are confirmed by the
   * runtime before this turn ends and it holds messages sent afterwards, so a change another
   * person can see is a change that is already on disk — which is what "seen is saved" means,
   * and why there is no save button anywhere in this product.
   *
   * Anything that did not arrive on a socket is not a change to the board: the document being
   * read back from storage, and the document being set up, both come through here as updates
   * too, and writing either of them down would be the board copying itself forever.
   */
  private onChange(update: Uint8Array, origin: unknown): void {
    if (!(origin instanceof WebSocket)) return;
    if (this.lifecycle === 'load-failed') return;

    const doc = this.document;
    if (doc === null) return;

    try {
      this.store.append(update);
    } catch (error) {
      // The change was applied to this document and could not be written. It is not sent to
      // anybody — broadcasting it would be telling other people their board has something
      // this board cannot keep.
      this.storageFailed();
      return;
    }

    this.broadcast(update, origin);
    // Only after the change is safe: folding the log away is a write like any other and is
    // allowed to fail, and it is allowed to fail *after* the change that triggered it was
    // stored, because a compaction that did not happen is a board with a longer log.
    this.store.compactIfNeeded(doc);
  }

  /**
   * This board could not be written, so this room stops pretending.
   *
   * Every socket is closed with the storage code and the document is discarded, which means
   * the room cannot serve a board that is missing the change nobody could save, and cannot
   * accept another change into a document that has already diverged from its own storage.
   * Nobody is told their change is lost, because it is not lost: it is in their document, and
   * the handshake on the way back in is what brings it here.
   */
  private storageFailed(): void {
    if (this.lifecycle === 'storage-failed') return;
    this.transition('storage-failed');
    const doc = this.document;
    this.document = null;
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
    }
    doc?.destroy();
  }

  // --- sending ---------------------------------------------------------------

  /** Send a document update to every connection on this board but its author's. */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      this.send(socket, frame);
    }
  }

  /** Send presence bytes to every connection, the sender's included. */
  private relay(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) this.send(socket, frame);
  }

  private syncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Write to one socket. A socket that cannot be written to is gone: it is closed here, so a
   * half-closed connection cannot stop a change reaching the people who are still there, and
   * the runtime drops it from `getWebSockets()` for everybody after this.
   */
  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(data);
    } catch (error) {
      // 1001, "going away": this is not the board's fault and not the sender's. The socket is
      // unusable, and the people still connected must not be made to wait for it.
      this.closeSocket(socket, 1001, 'the board could not be sent');
      console.warn(`dropping a board connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Close one connection, and put the board down if it was the last one. */
  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason.slice(0, 120));
    } catch {
      // Already closed: there is nothing left to do about it.
    }
    this.setIdle();
  }
}

/** The origin a board was read back under, re-exported for tests that assert on it. */
export { LOAD_ORIGIN };
