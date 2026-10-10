/**
 * BoardRoom: the live room of one board (persist.room).
 *
 * One instance per board id (see `idFromName` in `index.ts`). The room holds
 * the board's `Y.Doc` in memory and relays y-websocket frames between every
 * socket connected to it, but the document is no longer the board: the
 * SQLite-backed storage behind `BoardStore` is. Two rules fall out of that and
 * neither is negotiable:
 *
 * 1. **An update is stored before it is broadcast.** The insert runs in the
 *    same turn as the apply, and the platform holds outgoing frames until
 *    pending storage writes are confirmed — so nobody can see a change that is
 *    not durably written (persist.seen_is_saved).
 * 2. **A board this room could not read is never served as a blank one.**
 *    A read that failed ends the room in `load-failed`: new sockets are
 *    accepted and closed with `CLOSE_BOARD_LOAD_FAILED`, and the room tries to
 *    read again only when `LOAD_RETRY_MIN_INTERVAL_MS` has passed.
 *
 * Sockets are accepted through the hibernation API (`ctx.acceptWebSocket`,
 * handlers on the object, `ctx.getWebSockets()` as the only list of sockets),
 * so a board that nobody is drawing on costs no compute: the runtime throws the
 * object away and reconstructs it — and the constructor reads the board back
 * from storage before anything is served.
 *
 * Frames are still handled one at a time per socket, and a frame that cannot be
 * decoded or whose update Yjs refuses closes only the socket that sent it, with
 * nothing written.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { createDecoder } from 'lib0/decoding';
import {
  createEncoder,
  length as encodedLength,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { messageYjsUpdate, readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';

import { initDoc } from '../shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore } from './board-store';
import { INITIAL_ROOM_PHASE, nextRoomState, roomGate } from './room-state';
import { seedLegacyBoard, testHooksEnabled, type SeedResult } from './test-hooks';

import type { RoomPhase, RoomState } from './room-state';
import type { Env } from './index';

/** One whole message (type varUint + body), as it goes over a socket. */
type Frame = Uint8Array;

/** A sync frame carrying one document update, exactly as the client writes it. */
function updateFrame(update: Frame): Frame {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeVarUint(encoder, messageYjsUpdate);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

/**
 * Incoming frame data as `decodeMessage` wants it. A hibernating object gets
 * the payload of a binary frame as an `ArrayBuffer`; a text frame arrives as a
 * `string` and is treated as the invalid input it is. Data that is not there at
 * all becomes an empty frame, which `decodeMessage` reports as invalid.
 */
function toFrameData(data: string | ArrayBuffer): ArrayBuffer | string {
  if (typeof data === 'string') return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data));
  return copy.buffer;
}

/**
 * The frame as it arrived, type byte included — awareness is relayed with
 * exactly these bytes, because its body is already length-prefixed inside the
 * frame and re-wrapping it would corrupt it.
 */
function frameBytes(frameData: ArrayBuffer | string): Frame {
  return typeof frameData === 'string'
    ? new TextEncoder().encode(frameData)
    : new Uint8Array(frameData);
}

export class BoardRoom extends DurableObject<Env> {
  /** One board's tables. Bound to this object's own storage, always. */
  readonly #store: BoardStore;

  /**
   * The board in memory, or nothing: dropped when a read fails (so a room can
   * only ever hold a board that matches storage) and again when a write fails
   * (so it cannot hold a board that storage does not have).
   */
  #doc: Y.Doc | undefined;

  /** Where this room is in its life; see `room-state.ts` for the diagram. */
  #phase: RoomPhase = INITIAL_ROOM_PHASE;

  /** When a read last failed, so the retry interval is honest about wall time. */
  #failedAt: number | undefined;

  /**
   * The socket whose update the document is applying right now, and the bytes
   * that apply has produced. Updates are collected here and only written and
   * relayed once the apply has returned, so a payload Yjs refuses part-way
   * cannot leave a row behind — and so "stored, then broadcast" is structural
   * rather than a property of the order Yjs happens to fire its events in.
   */
  #applying: WebSocket | undefined;
  #staged: Frame[] = [];

  constructor(
    ctx: DurableObjectState<Env>,
    env: Env,
  ) {
    super(ctx, env);
    this.#store = new BoardStore(ctx.storage);
    // Nothing this object does may answer a question about the board before
    // the board is back: `blockConcurrencyWhile` holds every event (including
    // the websocket event that woke us) until the read has finished.
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.#load();
    });
  }

  /**
   * Claim this address as a board (share.board_api): the tables, and one
   * `created_at` row saying when it started. Called by `POST /api/boards` through
   * the typed RPC, before anybody is told the id — so a board answers `GET` and
   * accepts a websocket *before* a browser is holding a link to it.
   */
  async initialize(): Promise<'created' | 'exists'> {
    return this.#store.initialize();
  }

  /**
   * Is there a board here? (share.not_found) Read-only by construction: the store
   * answers without creating a single table, which is what lets a made-up link be
   * asked about without it turning into something.
   */
  async exists(): Promise<boolean> {
    return this.#store.existsReadOnly();
  }

  /**
   * Test hook, TC-31 (see `test-hooks.ts`): put this board into the shape a board
   * from before this story is in — logged changes, no `created_at`. Refuses unless
   * `TEST_HOOKS=1`, and reads the board back afterwards so the room serves what it
   * just wrote.
   */
  async testSeedLegacy(notes: number): Promise<SeedResult> {
    if (!testHooksEnabled(this.env)) throw new Error('test hooks are not enabled');
    const seeded = seedLegacyBoard(this.#store, notes);
    await this.#load();
    return seeded;
  }

  /**
   * A websocket upgrade for a board that exists; every other request to the
   * object is refused.
   */
  override async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    // Story 5 (share.not_found): a room no longer makes the board it is asked
    // for. The Worker could only check the *shape* of the id; whether this
    // address holds a board is answerable only by the object that owns the
    // storage, and asking writes nothing — a refused link must not leave a
    // table behind (TC-09).
    //
    // Only a definite *no* is a 404. Storage that will not answer the question
    // at all is story 4's failure, not a stranger's link: fall through, let the
    // read end the room in `load-failed`, and the socket gets
    // `CLOSE_BOARD_LOAD_FAILED` and a log line rather than a bare 404 (TC-26).
    let boardIsHere = true;
    try {
      boardIsHere = this.#store.existsReadOnly();
    } catch {
      // Asked again by `#load`, and said out loud there.
    }
    if (!boardIsHere) {
      return new Response('board not found', { status: 404 });
    }
    await this.#allowConnection();

    // `pair` is a two-ended pipe: `client` is handed to the caller on the
    // response, `server` is the room's own end. It is accepted through the
    // context so it can hibernate, and so `ctx.getWebSockets()` stays the one
    // list of sockets this room has.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const gate = roomGate(this.#phase);
    if (gate !== 'ready') {
      // Accepted and then refused, so the client's own websocket exists long
      // enough to see the close code and act on it.
      this.#close(server, this.#closeCode(gate), this.#refusal(gate));
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ask the newcomer for everything it has (SyncStep1): a page that was open
    // through a storage failure still holds the change the room never wrote.
    this.#sendSyncStep1(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** One incoming frame from a hibernating socket. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.#receive(ws, message);
  }

  /**
   * Nothing to tidy up: `ctx.getWebSockets()` is the room's socket list, and it
   * is the runtime's business once a socket is gone. Logged at nothing on
   * purpose — a socket leaving is not an event worth a log line.
   */
  override webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {}

  /** A socket erroring is the same as it leaving, plus one log line. */
  override webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close();
    } catch {
      // Already gone.
    }
  }

  // --- reading the board -------------------------------------------------

  /**
   * Read the board from storage into a new document, and record where that
   * ended. Called from the constructor and from the two ways out of a failure
   * (`load-failed` after the retry interval, `storage-failed` on the next
   * connection), never during either of those.
   */
  async #load(): Promise<void> {
    const doc = this.#newDoc();
    const describe = (message: string): void => {
      // Every log line a room writes starts the same way, so a board can be
      // found from the message.
      console.error(`board could not be opened (${this.ctx.id.toString()}): ${message}`);
    };
    try {
      // Story 5: reading no longer creates the tables — `initialize` (creation)
      // and the first logged change do. A board that has never been written loads
      // as empty, which is what lets an empty board answer `state: synced,
      // updates: 0` right away (story 1) without a stranger's probe of a
      // made-up link turning into a board.
      const loaded = this.#store.load(doc);
      if (loaded.ok) {
        this.#doc = doc;
        this.#failedAt = undefined;
        this.#phase = nextRoomState(this.#phase, {
          type: loaded.quarantined > 0 ? 'loaded-damaged' : 'loaded',
        });
        if (loaded.quarantined > 0) {
          describe(`${loaded.quarantined} logged changes could not be read`);
        }
        return;
      }
      describe(loaded.reason === 'sql-error' ? loaded.error : loaded.reason);
    } catch (error) {
      // `load` reports its own failures; getting here means `migrate` could not
      // create its tables, which is the same bad news in a different shape.
      describe(error instanceof Error ? error.message : String(error));
    }
    // The half-built document is dropped, not served: an empty board on screen
    // is a lie about a board that exists.
    this.#doc = undefined;
    this.#failedAt = Date.now();
    this.#phase = nextRoomState(this.#phase, { type: 'load-failed' });
  }

  /**
   * Decide whether this room may answer a connection, reading again first when
   * its last answer was "no". A `load-failed` room reads again only once
   * `LOAD_RETRY_MIN_INTERVAL_MS` has passed, so a board whose storage is
   * unreadable is not read over and over by clients reconnecting in a loop.
   */
  async #allowConnection(): Promise<void> {
    if (this.#phase === 'load-failed') {
      const retryAllowed =
        this.#failedAt !== undefined && Date.now() - this.#failedAt >= LOAD_RETRY_MIN_INTERVAL_MS;
      this.#phase = nextRoomState(this.#phase, { type: 'connection', retryAllowed });
      if (this.#phase !== 'loading') return; // still too soon; refuse without reading
    } else if (this.#phase === 'storage-failed') {
      // The write that failed may have been a one-off; the doc this room holds
      // is not the board's future, so start from storage again.
      this.#phase = nextRoomState(this.#phase, { type: 'reload' });
    } else {
      return;
    }
    await this.#load();
  }

  /** A document whose changes this room can recognise as coming from a socket. */
  #newDoc(): Y.Doc {
    const doc = new Y.Doc();
    // The board's own schema (`meta.schemaVersion`) is created here with
    // `LOCAL_ORIGIN`, which is why it is never stored: every room writes it,
    // opening a board nobody has drawn on stays a board with no rows, and the
    // first snapshot carries it from then on.
    initDoc(doc);
    doc.on('update', (update: Frame, origin: unknown) => {
      // Everything that is not a socket's change stays out of the log: bytes
      // this room just read back (`LOAD_ORIGIN`), the schema above, anything a
      // future origin invents.
      if (origin === undefined || origin !== this.#applying) return;
      this.#staged.push(update);
    });
    return doc;
  }

  // --- one socket's frame ------------------------------------------------

  /** One incoming frame: store it, relay it, or close the socket that sent it. */
  async #receive(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const gate = roomGate(this.#phase);
    if (gate !== 'ready') {
      // A socket that was open when the room lost the board (or never got it)
      // is told again rather than left to wonder.
      this.#close(ws, this.#closeCode(gate), this.#refusal(gate));
      return;
    }
    const doc = this.#doc;
    if (doc === undefined) {
      // `ready` without a document cannot happen; if it ever did, refusing the
      // socket is the only honest answer.
      this.#close(ws, CLOSE_BOARD_LOAD_FAILED, this.#refusal('load-failed'));
      return;
    }

    const frameData = toFrameData(message);
    const decoded = decodeMessage(frameData);
    if (decoded.kind === 'invalid') {
      this.#close(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') return; // nothing stored to answer with
    if (decoded.kind === 'awareness') {
      // Verbatim to everyone including the sender (idle keep-alive).
      const frame = frameBytes(frameData);
      for (const other of this.ctx.getWebSockets()) this.#send(other, frame);
      return;
    }

    const reply = createEncoder();
    writeVarUint(reply, MESSAGE_SYNC);
    this.#staged = [];
    this.#applying = ws;
    try {
      // Passing `ws` as the Yjs transaction origin is what lets this room know
      // which changes came from this socket, so they are stored once and
      // broadcast to everybody else (and never echoed back).
      //
      // y-protocols swallows an update it cannot apply (it logs and carries
      // on), so its error handler has to object: a corrupt update costs its
      // sender the connection exactly like a frame that does not decode.
      readSyncMessage(createDecoder(decoded.payload), reply, doc, ws, (error) => {
        throw error;
      });
    } catch {
      // Yjs refused the update. Nothing was written — the bytes it produced are
      // thrown away with the document's opinion of them — and only this socket
      // is affected.
      this.#staged = [];
      this.#close(ws, CLOSE_UNSUPPORTED_DATA, 'invalid yjs sync message');
      return;
    } finally {
      this.#applying = undefined;
    }

    const staged = this.#staged;
    this.#staged = [];
    if (staged.length > 0) {
      // Written first. If the write fails, nothing is relayed, every socket on
      // this board is closed, and the in-memory board is dropped: the clients
      // hold the change and give it back on reconnect (persist.save_failure).
      if (!this.#storeAll(staged)) return;
      this.#phase = nextRoomState(this.#phase, { type: 'update' });
      for (const update of staged) {
        const frame = updateFrame(update);
        for (const other of this.ctx.getWebSockets()) {
          if (other === ws) continue; // the sender already has it (TC-08)
          this.#send(other, frame);
        }
      }
      this.#compact(doc);
    }
    // SyncStep1 answers (and nothing else) produce a reply, sent to the
    // requester alone — an echo of a client's own update would be wasted bytes.
    if (encodedLength(reply) > 1) this.#send(ws, toUint8Array(reply));
  }

  /** Every staged update, in one place so a failure has one meaning. */
  #storeAll(updates: readonly Frame[]): boolean {
    try {
      for (const update of updates) this.#store.append(update);
    } catch (error) {
      this.#storageFailed(error);
      return false;
    }
    return true;
  }

  /**
   * A write this room could not make. The room stops serving the board it has:
   * `storage-failed`, every socket closed with `CLOSE_STORAGE_FAILURE`, the
   * document discarded. Clients show "reconnecting", come back, hand the change
   * they still hold back to the room, and it is written or fails again in
   * public.
   */
  #storageFailed(error: unknown): void {
    console.error(
      `board could not be written (${this.ctx.id.toString()}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    this.#phase = nextRoomState(this.#phase, { type: 'storage-failed' });
    this.#doc = undefined;
    this.#staged = [];
    for (const socket of this.ctx.getWebSockets()) {
      this.#close(socket, CLOSE_STORAGE_FAILURE, 'board storage failure');
    }
  }

  /**
   * Fold the log into a snapshot when it is worth folding. The store decides
   * whether the threshold has been reached and reports its own failures; either
   * way the room serves the same board afterwards, which is what the
   * `compacting` phase is for (see `room-state.ts`).
   */
  #compact(doc: Y.Doc): void {
    if (!this.#store.compactionDue()) return;
    this.#phase = nextRoomState(this.#phase, { type: 'compacting' });
    const compacted = this.#store.compactIfNeeded(doc);
    this.#phase = nextRoomState(this.#phase, {
      type: compacted ? 'compacted' : 'compaction-failed',
    });
  }

  // --- sockets -----------------------------------------------------------

  /** Ask one socket for everything it has. */
  #sendSyncStep1(socket: WebSocket): void {
    const doc = this.#doc;
    if (doc === undefined) return;
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    this.#send(socket, toUint8Array(encoder));
  }

  /** Send, dropping any socket whose send throws (TC-31). */
  #send(socket: WebSocket, frame: Frame): void {
    try {
      socket.send(frame);
    } catch {
      // A socket whose send throws is half gone already: close it so the
      // runtime stops counting it, and no later broadcast is disturbed by it.
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    }
  }

  /** Close one socket, leaving the rest of the room untouched. */
  #close(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already gone: nothing left to close.
    }
  }

  /**
   * What a socket is told when the room cannot serve the board. `loading` is
   * not expected here — the constructor's read finishes before this object
   * answers anything — but a room that does not know the board yet has to give
   * the same answer as one that failed to read it, because from the socket's
   * side they are the same board.
   */
  #closeCode(gate: RoomState | 'loading'): number {
    return gate === 'storage-failed' ? CLOSE_STORAGE_FAILURE : CLOSE_BOARD_LOAD_FAILED;
  }

  /** The close reason that goes with it. */
  #refusal(gate: RoomState | 'loading'): string {
    return gate === 'storage-failed'
      ? 'the board could not be written to storage'
      : 'the board could not be loaded';
  }
}
