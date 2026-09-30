// Copyright 2026 Board Room contributors. All rights reserved.
//
// The live room for one board: a Y.Doc holding the board as storage holds it
// plus everything accepted since, and the WebSockets of the people looking at
// it now. This object belongs to one board id, so its storage and its memory
// belong to each other — which is the whole of story 4: coming back is the same
// thing as never having left.
//
// The room's connections are hibernatable (`ctx.acceptWebSocket`), the only way
// a board nobody is interacting with costs nothing: the runtime keeps the open
// connections and may evict the object, and the next event constructs it again —
// constructor, load, handle. That is also why the room keeps no socket list of
// its own any more: `ctx.getWebSockets()` is the list, and it survives the
// object not being in memory.
//
// Story 3's job is unchanged: it relays what it received and holds no lock. It
// validates nothing beyond what y-protocols/sync does, sets no rate limits and
// has no participant cap — `live.over_capacity` and `live.rate_limit` are not
// built here on purpose.
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
// design.md (the protocol) and
// spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/design.md
// (when a board is loaded, saved, and refused).
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type BoardStorage } from './board-store';
import {
  nextRoomState,
  type RoomEvent,
  type RoomPhase,
  type RoomState,
} from './room-state';
import { corruptSnapshot, repairSnapshot, type TestHookKind } from './test-hooks';
import type { Env } from './index';

/** Wrap a y-protocols/sync message in the y-websocket frame prefix. */
const syncFrame = (write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

/**
 * One board's room. Its state and its document live in memory and are rebuilt
 * from storage after hibernation, exactly like the board itself.
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's storage. The tests reach it with a cast, like the document. */
  readonly store: BoardStore;

  /** The board as storage holds it plus everything stored since. Null when the
   * room holds no copy of it: never read, given back because the board went
   * idle, or a board that could not be read. */
  private doc: Y.Doc | null = null;

  /** Where this room is in design.md's state machine, transient phases included:
   * the room can be woken or refused in the middle of a load. */
  private phase: RoomPhase = 'loading';

  /** When the load last failed, so the load is not attempted more than once per
   * LOAD_RETRY_MIN_INTERVAL_MS (TC-16, TC-25). 0 when not in LoadFailed. */
  private loadFailedAt = 0;

  /** The updates applied while one frame is being read. Nothing is stored or
   * broadcast until that frame has been read to the end without an error: a
   * frame that fails halfway must leave no storage row (TC-17), and the room is
   * the only place that knows the difference. */
  private reading: { socket: WebSocket; updates: Uint8Array[] } | null = null;

  /** The room is constructed on a new connection *and* on every wake out of
   * hibernation, and the board has to be in memory before the events that woke
   * us are handled — `blockConcurrencyWhile` holds those back until the load
   * returns. The load itself is synchronous (Durable Object SQLite is
   * synchronous); the wrapper is what tells the runtime to wait for it. */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(this.ctx.storage as unknown as BoardStorage);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.move({ type: 'construct' });
      this.loadRoom();
    });
  }

  /** The room's state machine in one place: it moves and reports where it moved,
   * so the code that has to act on a state never guesses at one. */
  private move(event: RoomEvent): RoomPhase {
    this.phase = nextRoomState(this.phase, event);
    return this.phase;
  }

  /** The room's state as anything outside it sees it (design: persist.room). The
   * transient phases never outlast a synchronous block, so a room that is asked
   * where it is between two requests is in one of the three. */
  get state(): RoomState | 'loading' {
    return this.phase === 'compacting' || this.phase === 'hibernated'
      ? 'ready'
      : this.phase;
  }

  /** How long ago the load failed, for the retry interval and the tests. */
  get sinceLoadFailed(): number {
    return this.loadFailedAt === 0 ? Infinity : Date.now() - this.loadFailedAt;
  }

  /**
   * Read the board out of storage into a fresh document. Called from the
   * constructor — i.e. on every wake — and from `fetch` when somebody arrives at
   * a room that holds no copy.
   *
   * A board that cannot be read puts the room in LoadFailed with the time it
   * failed recorded. It is never presented as an empty board: the document that
   * half loaded is thrown away, because a room must not serve a board it is not
   * sure of.
   */
  private loadRoom(): void {
    // Going through Loading even when the room was already Ready: a load that
    // fails lands in LoadFailed, which design.md reaches from Loading.
    this.move({ type: 'start-load' });
    this.store.migrate();
    const doc = new Y.Doc();
    // The listener goes on before the load, and the loaded bytes are applied
    // under LOAD_ORIGIN: what came out of storage is by definition already in
    // storage, so it is neither written back nor relayed to anybody.
    doc.on('update', (update: Uint8Array, origin: unknown): void => {
      this.applied(doc, update, origin);
    });
    const result = this.store.load(doc);
    if (!result.ok) {
      this.doc = null;
      this.move({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      console.error('[vidi6] board could not be loaded; connections will be refused', {
        reason: result.reason,
        error: result.error,
      });
      return;
    }
    this.doc = doc;
    this.loadFailedAt = 0;
    this.move({ type: result.quarantined > 0 ? 'load-ok-quarantined' : 'load-ok' });
    if (result.quarantined > 0) {
      console.error('[vidi6] board opened with unreadable updates quarantined', {
        quarantined: result.quarantined,
      });
    }
  }

  /** A new person arriving at the board, or an existing page reconnecting. */
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    // A connection is the event that decides: a room holding no copy reads the
    // board, and a room that failed to read it tries again at most once per
    // LOAD_RETRY_MIN_INTERVAL_MS.
    const since = this.sinceLoadFailed;
    const moved = this.move({ type: 'connection', msSinceLoadFailed: since });
    if (moved === 'load-failed') {
      // Either the retry interval has not passed, and this is the same answer we
      // already gave without touching storage, or the reload below failed again.
      return this.refuse(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
    }
    if (this.doc === null) {
      // Never read, idle, or a room that dropped its unsaved changes and its
      // connections: the board comes back out of storage now. Whoever is
      // reconnecting holds whatever the room is missing, and the ordinary
      // SyncStep1/SyncStep2 exchange below is how they hand it over.
      this.loadRoom();
      if (this.phase !== 'ready') {
        return this.refuse(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      }
    }

    const doc = this.doc as Y.Doc | null;
    if (doc === null) {
      return this.refuse(CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
    }

    const [client, server] = Object.values(new WebSocketPair());
    // Hibernatable, so this board costs nothing while nobody is interacting with
    // it: the runtime holds the connection open across an eviction, the object
    // is constructed again, reads the board, and nobody notices. Story 3's
    // non-hibernating accept was deliberate while the document was all there
    // was; persistence replaced that reason.
    this.ctx.acceptWebSocket(server);

    // Story 3's opening move, unchanged: ask the newcomer for the state this
    // room does not have.
    this.send(server, syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, doc)));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Accept the upgrade and close it immediately with the code that says why.
   * Accepting rather than answering with an HTTP status is what lets the page
   * show a *reason* rather than a failed request, and both codes the room uses
   * here are ones the provider retries by itself — the page keeps trying without
   * anybody pressing reload (PRD persist.load_failure, persist.save_failure).
   */
  private refuse(code: number, reason: string): Response {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.closeSocket(server, code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A message from one of the room's connections, hibernated or not. */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.phase === 'load-failed') {
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
      return;
    }
    if (this.phase === 'storage-failed') {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
      return;
    }
    this.receive(ws, message);
  }

  /** One frame from one socket: story 3's handling, same framing and same
   * answers. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    if (this.doc === null) {
      // Only reachable if a message woke an object that has no board: the load
      // in the constructor ran and did not succeed.
      this.loadRoom();
      if (this.phase !== 'ready') {
        this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'this board could not be loaded');
        return;
      }
    }
    const doc = this.doc as Y.Doc | null;
    if (doc === null) return;

    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
      return;
    }
    if (decoded.kind === 'query-awareness') return; // no stored awareness in this room
    if (decoded.kind === 'awareness') {
      // Presence and cursor bytes, relayed verbatim to everyone *including* the
      // sender — an idle client that stops hearing anything would conclude the
      // connection is dead. Never applied to the document, so nothing of it is
      // ever stored.
      for (const target of this.ctx.getWebSockets()) this.send(target, decoded.payload);
      return;
    }

    const encoder = encoding.createEncoder();
    // The reply is a y-websocket frame too: same prefix as the message we got.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let rejected: unknown = null;
    // Collect what this one frame applies: see `reading`.
    this.reading = { socket, updates: [] };
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      decoding.readVarUint(decoder); // the y-websocket message type prefix
      syncProtocol.readSyncMessage(decoder, encoder, doc, socket, (error: Error) => {
          // Yjs swallows the error internally; re-raise it here so a sender's
          // malformed update cannot sit in the middle of a live board. Returning
          // false tells y-protocols it is handled, so it does not log it instead.
          rejected = error;
          return false;
        },
      );
    } catch (error) {
      rejected = error;
    }
    const collected = this.reading.updates;
    this.reading = null;

    if (rejected !== null) {
      // Nothing from this frame is stored and nothing was broadcast: the person
      // who sent it is the one with the bad frame, and they are the only one
      // affected.
      console.error('[vidi6] closing a connection that sent a frame it could not apply', {
        error: String(rejected),
      });
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
      return;
    }
    // The frame read cleanly, so this is the moment whatever it carried becomes
    // part of the board: stored, and then told to everyone else. An update that
    // arrives in a later part of this same frame is stored in the order it was
    // applied, which is the order everyone else sees it in.
    for (const update of collected) this.stored(update, socket);

    // A reply (SyncStep2, or the state a newcomer was missing) goes back to the
    // socket that asked for it — and only to it. It is built from the document,
    // so it is the same bytes whether the board arrived from a snapshot, from a
    // log, or from both laid out however compaction left them.
    if (encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
  }

  /**
   * Something was applied to this room's document. Store it, then let everyone
   * else see it: that order *is* PRD persist.save_failure, because an update that
   * could not be stored is never broadcast, so no screen ever shows a change
   * that would not come back.
   */
  private stored(update: Uint8Array, origin: unknown): void {
    try {
      this.store.append(update);
    } catch (error) {
      // Storing the change and telling everyone is one decision, and it is
      // storage's. Closing every connection is how each page learns at once
      // rather than at its next reload, and the document goes with them: a
      // change the room could not store must not stay in memory either.
      this.move({ type: 'storage-write-failed' });
      console.error('[vidi6] a change could not be stored; dropping every connection', {
        error: String(error),
      });
      for (const socket of this.ctx.getWebSockets()) {
        this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'the board could not be saved');
      }
      this.doc = null;
      return;
    }
    this.move({ type: 'update-applied' });

    const frame = syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update));
    // The person who made the change has it already. Everyone else is whoever
    // the runtime still has open for us, hibernated or not.
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      this.send(socket, frame);
    }

    // Compaction is the room's own housekeeping, not part of anybody's change, so
    // it runs once the change is stored and on its way.
    if (this.store.compactionDue) {
      this.move({ type: 'compaction-due' });
      const doc = this.doc;
      const compacted = doc === null ? false : this.store.compactIfNeeded(doc);
      this.move({ type: compacted ? 'compaction-done' : 'compaction-failed' });
    }
  }

  /** The document's `update` listener: collect while a frame is being read, act
   * on it once the frame has read cleanly. Loaded bytes are not changes. */
  private applied(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    if (this.doc !== doc) return; // a change to a document we already threw away
    if (this.reading !== null) {
      // The room does not store a half-read frame: if the rest of it fails to
      // decode, nothing was applied and nothing is written.
      this.reading.updates.push(update);
      return;
    }
    this.stored(update, origin);
  }

  /**
   * A connection went away. The runtime already removed it from the list, so
   * there is no bookkeeping left — except that a board nobody is looking at
   * keeps no copy in memory: with nothing open and nothing in flight the room
   * gives its document back and costs its storage alone (PRD constraints), and
   * the next connection reads the board again.
   */
  /**
   * A connection went away. The runtime has already removed it from the list, so
   * there is no bookkeeping left — except two things.
   *
   * One: answer the closing handshake. A connection accepted through
   * `ctx.acceptWebSocket` does not get it answered for us the way a plain
   * `Response({webSocket})` one does: without this call the page that closed its
   * tab sits in CLOSING until the browser gives up half a minute later. Story 3
   * did not need it, because story 3 did not hibernate.
   *
   * Two: a board nobody is looking at keeps no copy in memory. With nothing open
   * and nothing in flight the room gives its document back and costs its storage
   * alone (PRD constraints), and the next connection reads the board again.
   */
  webSocketClose(socket: WebSocket): void {
    this.closeSocket(socket, 1000, 'goodbye');
    if (this.phase === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.move({ type: 'hibernate' });
      this.doc = null;
    }
  }

  /** Story 3's `error` listener, same answer: an error on one connection drops
   * that connection quietly. The runtime has already taken it out of the list,
   * so there is nothing to remove and nobody else is touched. */
  webSocketError(_ws: WebSocket, error: unknown): void {
    console.error('[vidi6] a board connection errored', { error: String(error) });
  }

  /** Write one frame to one of the room's connections. A connection that cannot
   * be written to is dropped and the room goes on relaying to everyone else
   * (TC-31): nothing here is allowed to take a board down. */
  private send(socket: WebSocket, payload: Uint8Array): void {
    try {
      socket.send(payload);
    } catch (error) {
      console.error('[vidi6] dropping a connection that could not be written to', {
        error: String(error),
      });
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'the connection is gone');
      } catch {
        // A socket that cannot be closed is already gone.
      }
    }
  }

  /** Close one connection with a reason. The room calls this from inside the
   * runtime's own callbacks, where closing a socket that is already closed is
   * normal and worth nothing. */
  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch (error) {
      console.error('[vidi6] a board connection could not be closed', {
        error: String(error),
      });
    }
  }

  /**
   * Story 4's test hooks: damage a snapshot, put it back, or compact a board too
   * small to reach the thresholds (see ./test-hooks.ts, which owns the HTTP
   * route). The route only exists when the Worker runs with TEST_HOOKS=1, which
   * no production configuration sets. The methods themselves are compiled in: a
   * Worker reads its environment at run time, not at build time, so there is no
   * build a hook could be left out of — what production lacks is the route.
   */
  async testHook(kind: TestHookKind): Promise<{ ok: boolean; reason?: string }> {
    const storage = this.ctx.storage as unknown as BoardStorage;
    switch (kind) {
      case 'compact': {
        const doc = this.doc;
        if (doc === null) return { ok: false, reason: 'this room holds no board to compact' };
        return this.store.compact(doc)
          ? { ok: true }
          : { ok: false, reason: 'compaction failed' };
      }
      case 'corrupt-snapshot':
        // Damaging storage alone is not enough: the room still holds a healthy
        // document and would go on serving from it. The room finds out the way
        // anybody else does — by reading the board again.
        return corruptSnapshot(storage, () => {
          this.loadRoom();
        });
      case 'repair-snapshot':
        return repairSnapshot(storage, () => {
          this.loadRoom();
        });
    }
  }
}
