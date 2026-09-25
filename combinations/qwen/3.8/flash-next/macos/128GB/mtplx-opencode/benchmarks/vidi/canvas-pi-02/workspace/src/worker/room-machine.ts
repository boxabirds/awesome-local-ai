import * as Y from 'yjs';

import { FLUSH_INTERVAL_MS, FLUSH_UPDATE_THRESHOLD, MAX_MESSAGE_BYTES } from '../shared/config';
import { CLOSE_UNSUPPORTED_DATA, SYNC_STEP_ONE, decodeMessage } from '../shared/protocol';
import { syncBody, syncStep1Message, syncStep2Message, syncUpdateMessage } from './sync-frame';
import { STATE_UNREADABLE, type LoadResult } from './board-store';
import {
  freshRoomState,
  loadActionFor,
  roomStateAfter,
  shouldCheckpoint,
  type RoomHost,
  type RoomState,
} from './room-state';

/** Close code for "this room has no board to answer you from". */
export const CLOSE_LOAD_FAILED = 4006;

/** The reason that goes with it. Either half identifies the failure. */
export const LOAD_FAILED_REASON = 'load-failed';

/**
 * What to do with one frame.
 *
 * The order of the rules is the design's, and it is the reason one `switch` in
 * the room is enough: shape (rule 1) → sync (rule 2) → doc update (rule 3) →
 * awareness (rule 4) → no board (rule 5) → no write (rule 6). A text frame
 * never reaches the sync question; a room that cannot read its board never
 * reaches the doc-update question.
 *
 * Every arm says where bytes go, including "nowhere".
 */
export type RoomDecision =
  | { kind: 'close'; code: number; reason: string }
  | { kind: 'ignore'; why: string }
  /** Send to the socket that asked, and to nobody else. */
  | { kind: 'reply'; frames: readonly Uint8Array[] }
  /**
   * Relay to other members, and say what storage owes a write.
   *
   * `echo` adds the author back in. That is how an Awareness *query* and an
   * Awareness *push* are handled: a client that asked for the state of the other
   * members and got nothing back counts a dead connection, and presence echoed
   * to its author is a duplicate the receiver drops — either way the room's own
   * knowledge does not change.
   *
   * `write` is the second half of the same answer, because the room must not
   * decide it twice: presence is never written down (`none`), a relay goes out
   * first and the write happens after it (`cache`, or `await` when the sender is
   * the last member left and there is no timer to hold the bytes for), and both
   * of those are read by a room that relays without awaiting this method.
   *
   * `presence` is the awareness body when this frame is presence traffic, and
   * `null` for everything else. The room has to know which socket a person's
   * presence came from in order to take it away when that socket goes, and only
   * the frame it received can say that - so the machine, which has already
   * decoded the frame, says what it is, and the room decides what to do with it.
   */
  | {
      kind: 'relay';
      echo: boolean;
      frame: Uint8Array;
      write: 'none' | 'cache' | 'await';
      presence: Uint8Array | null;
    };

/** How many awareness updates a room replays to a socket that asks. */
const MAX_AWARENESS_HISTORY = 20;

/**
 * One board's room: the decisions, and the state they are made against.
 *
 * `BoardRoom` is where the decisions are read; this class is where they are
 * made, and it never touches a socket. That separation is what lets the state
 * be tested against a fake host, a fake clock and a fake store — TC-17 (four
 * joins, one read), TC-20 (the restart rejoin), TC-24 (the last departure
 * writes) and TC-28 (a relay does not wait for SQLite) are all in
 * `tests/unit/room-machine.test.ts`, and they run without a Durable Object.
 *
 * One instance per hibernation, rebuilt in milliseconds on wake. The document
 * is a `Y.Doc` — the `yjs` one, the same document class the browser builds and
 * the same `Y.encodeStateAsUpdate` that wrote the test fixture — so a cold room
 * reads bytes a browser wrote.
 */
export class RoomMachine {
  #state: RoomState = freshRoomState();

  /** Which sockets this room has already answered with the board. */
  #synced = new WeakSet<WebSocket>();

  /**
   * The presence the room knows, newest last.
   *
   * Kept so a socket that asks "who is here?" is answered from the room's state
   * rather than from nothing. Capped, because awareness is a hundred and sixty
   * bytes that arrives every time somebody opens a tab: uncapped, it would be
   * memory spent on the least valuable bytes in the room.
   */
  #awareness: Uint8Array[] = [];

  constructor(private readonly host: RoomHost) {}

  /** The room's state, as read by the room and by `/control/state`. */
  get state(): RoomState {
    return this.#state;
  }

  /** Everything the room knows, for the restart tests. */
  reset(): void {
    this.#state = freshRoomState();
    this.#synced = new WeakSet<WebSocket>();
    this.#awareness = [];
  }

  /** A socket that had a board is not synced to the room the room becomes next. */
  forgetSync(socket: WebSocket): void {
    this.#synced.delete(socket);
  }

  /** The room's copy of the board, for assertions. `null` while cold or failed. */
  get doc(): Y.Doc | null {
    return this.#state.doc;
  }

  /**
   * Ask one socket for its board, in the shape a client reads a SyncStep1.
   *
   * Sent after the read, because a room that cannot read its board has no
   * business asking, and a room that asks "what have you got?" from an empty
   * document is the failure this whole design is built to avoid.
   */
  requestBoard(): Uint8Array {
    const doc = this.#state.doc;
    // The room asks for the *whole* board: an empty state vector means "send me
    // everything you have", which is what a rejoin needs after a restart.
    return syncStep1Message(doc === null ? new Uint8Array(0) : Y.encodeStateVector(doc));
  }

  /**
   * Stop trusting the cache, because storage just refused to write.
   *
   * Rule 6's other half: a room that cannot write is not left caching a board it
   * cannot write, and the next join reads, finds nothing readable, and is refused
   * by rule 5. Without this the room would go on answering from a cache that has
   * run ahead of storage, which is how two browsers end up with different boards.
   */
  failWrite(reason: string): void {
    this.#fail(`write failed: ${reason}`);
  }

  /* ------------------------------------------------------------------ *
   * The one read
   * ------------------------------------------------------------------ */

  /**
   * Read the board, once per wake, before anyone is answered.
   *
   * "Before anyone is answered" is what makes it one read rather than four: the
   * four joins queue on this method, and the second, third and fourth arrive to
   * find `state.name === 'loaded'` and skip it. A room that answers a step-1 on
   * a cold document answers four joining clients with four incomplete copies of
   * the board, so this is not a performance preference.
   *
   * `loadActionFor` is the whole decision: cold reads, loaded-and-awake does
   * not, failed refuses, and *asleep reads even when it still holds a document*,
   * because "I remember a board" is not the same as "this is the board".
   *
   * A `null` read is not damage. It is a board nobody has drawn on yet: the room
   * builds an empty document and serves that, which is rule 2, and it is the
   * first-visit test's `empty-board.bin`.
   */
  load(): void {
    if (loadActionFor(this.#state) !== 'load') return;

    const started = this.host.now();
    let read: LoadResult;
    try {
      read = this.host.store.load(this.host.boardId);
    } catch (error) {
      // A throw and a short read get the same treatment, which is the reason the
      // three failures are one fixture: none of them is ever loaded as an empty
      // board, and none of them gets retried per message.
      this.#fail(`storage read threw: ${(error as Error).message}`);
      return;
    }

    const took = this.host.now() - started;
    if (took > this.host.loadTimeoutMs()) {
      this.#fail(`storage read took ${took}ms, over the ${this.host.loadTimeoutMs()}ms limit`);
      return;
    }

    if (read === STATE_UNREADABLE) {
      this.#fail('the stored state is not a board');
      return;
    }

    const doc = new Y.Doc();
    try {
      if (read !== null && read.byteLength > 0) Y.applyUpdateV2(doc, read);
    } catch (error) {
      // The room refuses the board rather than serving a half-read one: a
      // document that *partially* decoded is worse than no document, because it
      // looks like a board and is missing pieces of it.
      this.#fail(`Y.applyUpdate failed: ${(error as Error).message}`);
      return;
    }

    this.#state = roomStateAfter(this.#state, { type: 'loaded', doc });
  }

  /** A room with no board answers by refusing, and says so once. */
  #fail(reason: string): void {
    this.#state = roomStateAfter(this.#state, { type: 'failed' });
    this.host.log(`no board: ${reason}`);
  }

  /* ------------------------------------------------------------------ *
   * One frame, one decision
   * ------------------------------------------------------------------ */

  /**
   * Read a frame and say what it means.
   *
   * Synchronous by construction: the read happens here, the relay happens in the
   * room, and the write happens after the relay — which is what makes TC-28 true
   * in the code rather than in a comment.
   */
  decide(socket: WebSocket, message: ArrayBuffer | ArrayBufferView | string): RoomDecision {
    /* Rule 1: shape, then size. Both cost one connection, and neither is a
     * broadcast. A TEXT frame is refused rather than accepted and then dropped,
     * because a board whose binary shapes are known to arrive as text would be a
     * board where one client's step-1 came back as a JSON string. */
    if (typeof message === 'string') {
      return this.#refuse('text frame');
    }
    const bytes = bytesOf(message);
    if (bytes === null) return this.#refuse('frame is not bytes');
    if (bytes.byteLength === 0) return { kind: 'ignore', why: 'empty frame' };
    if (bytes.byteLength > MAX_MESSAGE_BYTES) {
      return { kind: 'close', code: CLOSE_UNSUPPORTED_DATA, reason: 'frame is too large' };
    }

    /* Rule 5, before any parsing: a room that cannot read its board refuses, and
     * does not try again per message. Checked here rather than at the top of the
     * sync branch because it has to win over rule 2 — with a board the room
     * would answer "you and I are not synced"; without one it has no answer. */
    if (loadActionFor(this.#state) === 'refuse') {
      this.#state = { ...this.#state, refused: this.#state.refused + 1 };
      return { kind: 'close', code: CLOSE_LOAD_FAILED, reason: LOAD_FAILED_REASON };
    }

    const frame = decodeMessage(bytes);
    if (frame.kind === 'invalid') return this.#refuse(frame.reason);

    if (frame.kind === 'query-awareness') {
      /* Rule 4: an Awareness *query* is answered where it came from, from the
       * room's own state — the same knowledge, served two ways. */
      const frames = this.#awareness.map((stored) => stored.slice());
      if (frames.length === 0) return { kind: 'ignore', why: 'the room knows no presence' };
      return { kind: 'reply', frames };
    }

    if (frame.kind === 'awareness') {
      /* Rule 4: presence is relayed to the members that did not write it, and
       * back to the author as well, and it is never written down. Both halves of
       * "a reply goes to the sockets that asked, and to nobody else".
       *
       * The whole frame is kept and relayed, not the body inside it: a client's
       * `readMessage` pops the message type itself and then reads one
       * length-prefixed body, so the bytes as they arrived are what its reader
       * wants back. */
      this.#remember(bytes);
      return {
        kind: 'relay',
        echo: true,
        frame: bytes,
        write: 'none',
        presence: frame.payload,
      };
    }

    // Rule 2 needs a board, and this is the only place the read happens.
    this.load();
    if (this.#state.name === 'failed') {
      this.#state = { ...this.#state, refused: this.#state.refused + 1 };
      return { kind: 'close', code: CLOSE_LOAD_FAILED, reason: LOAD_FAILED_REASON };
    }

    const doc = this.#state.doc;
    if (doc === null) {
      // Unreachable by construction — `load` leaves either a document or `failed`
      // — but a room that got here would be answering from a board it does not
      // have, so it refuses rather than serving an empty document as if it were
      // a board.
      return { kind: 'close', code: CLOSE_LOAD_FAILED, reason: LOAD_FAILED_REASON };
    }

    const newcomer = !this.#synced.has(socket);
    // The sub-type and the bytes inside a sync frame, already length-checked by
    // `decodeMessage`: `null` means the frame was not a sync frame at all.
    const body = frame.kind === 'sync' ? syncBody(frame.payload) : null;

    if (body !== null && body.step === SYNC_STEP_ONE) {
      if (!newcomer) {
        // A second SyncStep1 from a socket that has been answered is a duplicate
        // of a question that was answered. Answering it again would put another
        // copy of the board on the wire for a client that already has it.
        return { kind: 'ignore', why: 'this room already answered that question' };
      }

      /* Rule 2: the sync question, asked by a socket this room is not synced to.
       *
       * The answer is a SyncStep2 carrying what the socket is missing — computed
       * from the state vector it sent, so a client that arrived holding changes
       * gets the difference rather than a second copy of what it already has —
       * and then a SyncStep1 asking for what the *room* is missing. That is the
       * shape `y-protocols/sync` describes for a client-server sync, and it is
       * the whole restart story: without the ask, a browser that reconnects after
       * the room was torn down never hands over the changes it kept.
       *
       * Two frames, not one buffer: a client reads one message per frame, so a
       * step 2 and a step 1 glued together is a step 2 with trailing garbage.
       *
       * Nothing below this line runs for this frame. */
      this.#synced.add(socket);
      const frames: Uint8Array[] = [];
      // An empty state vector means "everything", which is exactly right for a
      // client that arrived with nothing; a board with nothing on it has no
      // answer to give, and an empty update on the wire is noise.
      if (Y.encodeStateVector(doc).byteLength > 0) {
        const missing = Y.encodeStateAsUpdate(doc, body.bytes);
        if (missing.byteLength > 0) frames.push(syncStep2Message(missing));
      }
      frames.push(syncStep1Message(Y.encodeStateVector(doc)));
      return { kind: 'reply', frames };
    }

    /* A second SyncStep1, or a frame that is not board content at all. Nothing
     * here guesses at an unknown shape: rule 1 already refused what it could not
     * read, and what is left is a frame the protocol has no use for. */
    if (body === null) {
      return { kind: 'ignore', why: `${frame.kind} is not board content` };
    }

    /* Rule 3: a doc update. It goes to the other members and into the buffered
     * write, and it never consults rule 2 on the way.
     *
     * A socket the room is not synced to *is* treated as synced by this frame —
     * that is what makes a rejoin work: the update arrives, is applied, is passed
     * on, and is written down. */
    const update = body.bytes;
    try {
      // Applied to the room's own copy *before* it is relayed or buffered: a
      // frame that cannot be applied here cannot be applied anywhere, and writing
      // it down would put damage in storage.
      Y.applyUpdate(doc, update);
    } catch (error) {
      return this.#refuse(`the update cannot be applied: ${(error as Error).message}`);
    }

    this.#synced.add(socket);
    this.#state = roomStateAfter(this.#state, {
      type: 'update',
      bytes: update.byteLength,
      at: this.host.now(),
    });

    // The last member's update is written immediately: after it goes there is
    // nobody to relay to, no timer, and in about ten seconds no instance.
    const alone = this.host.members().length <= 1;
    const due = shouldCheckpoint(this.#state, this.host.now(), {
      updates: FLUSH_UPDATE_THRESHOLD,
      intervalMs: FLUSH_INTERVAL_MS,
    });
    // A document update is never sent back to the socket it came from: the author
    // applied it locally a moment ago, and a change echoing to the person who
    // made it is how two browsers end up with three copies of one keystroke.
    return {
      kind: 'relay',
      echo: false,
      frame: syncUpdateMessage(update),
      write: alone || due ? 'await' : 'cache',
      presence: null,
    };
  }

  /** The presence to hand a socket that asks who is here. */
  get awareness(): readonly Uint8Array[] {
    return this.#awareness;
  }

  /** Whether the room owes storage a write, and whether the wait has passed. */
  writeDue(force = false): boolean {
    return shouldCheckpoint(this.#state, this.host.now(), {
      updates: FLUSH_UPDATE_THRESHOLD,
      intervalMs: FLUSH_INTERVAL_MS,
    }, force);
  }

  /**
   * Write what the room is holding.
   *
   * One call, throwing to say it did not work, and everything that goes wrong
   * inside it happens here — including the thing rule 6 is really about: a room
   * is not allowed to keep caching a board it cannot write. The throw reaches
   * `BoardRoom`, which puts the room in `failed` and refuses the next join, which
   * is how a relay that fails to write is not a silent success.
   */
  write(): void {
    const doc = this.#state.doc;
    if (doc === null || this.#state.pendingUpdates === 0) return;
    const bytes = Y.encodeStateAsUpdateV2(doc);
    this.host.store.save(this.host.boardId, bytes);
    this.#state = roomStateAfter(this.#state, { type: 'flushed' });
    this.host.log(`wrote ${bytes.byteLength} bytes to board ${this.host.boardId}`);
  }

  #remember(update: Uint8Array): void {
    if (this.#awareness.length >= MAX_AWARENESS_HISTORY) this.#awareness.shift();
    this.#awareness.push(update);
  }

  /** Rule 1's answer, which is the same whatever the shape turned out to be. */
  #refuse(why: string): RoomDecision {
    this.host.log(`refused a frame: ${why}`);
    return { kind: 'close', code: CLOSE_UNSUPPORTED_DATA, reason: `bad frame: ${why}` };
  }
}

/** Copy a frame's bytes into one contiguous array. `null` means "not bytes". */
function bytesOf(message: ArrayBuffer | ArrayBufferView): Uint8Array | null {
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength));
  }
  if (message instanceof ArrayBuffer) return new Uint8Array(message.slice(0));
  return null;
}
