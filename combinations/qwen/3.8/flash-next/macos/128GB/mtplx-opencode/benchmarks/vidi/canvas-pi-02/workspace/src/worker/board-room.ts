import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';

import { FLUSH_INTERVAL_MS, LOAD_TIMEOUT_MS } from '../shared/config';
import { queryAwarenessMessage } from '../shared/protocol';
import { RoomStore } from './board-store';
import { frameShape, frameToReply } from './board-protocol';
import {
  clientsFromAttachment,
  encodeAwarenessRemoval,
  mergeTracked,
  readOwnAnnouncement,
} from './awareness-tracker';
import { CLOSE_LOAD_FAILED, RoomMachine } from './room-machine';
import type { RoomHost } from './room-state';
import type { Env } from './env';

/**
 * The board room: one Durable Object per board, one SQLite file per object.
 *
 * A room is a cache of one `Y.Doc` plus the sockets attached to it. Everything
 * here follows from the fact that the cache can be empty while the sockets are
 * still open: the runtime hibernates a room once its sockets have been idle for
 * about ten seconds, tears the instance down, and the next message has to be
 * answered from whatever the object's SQLite says. So the room re-reads on every
 * wake rather than trusting its memory, it never answers a client from a board it
 * has not read, and it writes on the edge cases rather than on every message.
 *
 * ## The WebSocket API, and why it changed
 *
 * Story 3 accepted sockets the non-hibernating way: `socket.accept()` plus
 * `message`/`close` listeners. That is exactly the API that cannot support this
 * story. A room whose document lives only in memory has to stay awake to be
 * useful, and listeners do not survive the instance being torn down.
 *
 * So sockets are accepted with `ctx.acceptWebSocket(server, [BOARD_TAG])` and
 * handled by `webSocketMessage` / `webSocketClose` / `webSocketError`, which the
 * runtime calls whether or not the instance was asleep. Membership is
 * `ctx.getWebSockets(BOARD_TAG)`, never a `Set` the room maintains: a set is a
 * copy of the truth that goes stale while the room sleeps, and "who is here" is
 * what every relay is built from.
 *
 * ## What lives where
 *
 * The *decision* — what a frame is, who hears it, whether it is worth writing
 * down, whether the sender is closed — is `room-machine.ts`, and it is testable
 * with a fake host and a seeded document. This file performs: send the reply,
 * relay the frame, write the buffer, close the socket. A client's `handleMessage`
 * wants a message, not its contents, so a relay copies the frame it received and
 * does not rebuild one.
 *
 * ## The one thing that is not a relay
 *
 * A failed read is a *refusal*, never an empty board. A room that cannot read its
 * board closes the joiner with 4006 `load-failed` and stays that way until the
 * state is cleared, because serving an empty document to somebody who asked for
 * their board is how work is destroyed quietly.
 */

/** The tag every accepted socket carries, so `getWebSockets` can find them. */
const BOARD_TAG = 'board';

/** This board's stored state. One board per object, so one key. */
const BOARD_STATE_KEY = 'board';

/** How long a wedged storage read takes, for the tests that need one. */
const SPIN_MS = LOAD_TIMEOUT_MS + 1;

/**
 * What a socket carries with it, and what survives the room going to sleep.
 *
 * `awareness` is the presence this socket speaks for: the client ids it announced
 * and the last clock seen for each, which is what a removal has to be sent at.
 * The object is spread rather than replaced when it is rewritten, because a
 * socket's attachment is shared with whatever else the room learns to remember
 * (story 13's sync counter), and a room that rewrites presence by building a
 * fresh object would silently drop it.
 */
interface SocketAttachment {
  awareness?: Record<string, number>;
}

export class BoardRoom extends DurableObject<Env> {
  /** What makes `this.state.storage.sql` exist at all. */
  static sqlite = 'allowed';

  #store: RoomStore;

  #machine: RoomMachine;

  /** Test and development support: how the next board read should behave. */
  #failure: 'none' | 'unreadable' | 'timeout' | 'throw' = 'none';

  /** Whether the room is pretending to be down, for the outage tests. */
  #outage = false;

  /** How many board reads this instance has done, for the one-read assertions. */
  #reads = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void env;
    this.#store = new RoomStore(state.storage.sql);

    const host: RoomHost = {
      boardId: BOARD_STATE_KEY,
      store: {
        load: () => {
          this.#reads += 1;
          switch (this.#failure) {
            // Manufactured damage, for the tests that have to prove a room can
            // tell a broken board from an empty one. Each mode reaches the machine
            // as the thing it is: damaged, late, or thrown — through the store's
            // own test hook, so "late" really costs the clock rather than pretending
            // to. A short blob is manufactured with `/control/damaged`, which writes
            // real bytes rather than faking a read.
            case 'unreadable':
              this.#store.failAs('unreadable');
              return this.#store.read(BOARD_STATE_KEY);
            case 'timeout': {
              this.#store.failAs('timeout', SPIN_MS);
              return this.#store.read(BOARD_STATE_KEY);
            }
            case 'throw':
              this.#store.failAs('throw');
              return this.#store.read(BOARD_STATE_KEY);
            default:
              return this.#store.read(BOARD_STATE_KEY);
          }
        },
        save: (_boardId, bytes) => this.#store.write(BOARD_STATE_KEY, bytes),
      },
      members: () => this.#members(),
      now: () => Date.now(),
      loadTimeoutMs: () => LOAD_TIMEOUT_MS,
      log: (line) => console.log(`[room ${this.ctx.id.toString()}] ${line}`),
    };

    this.#machine = new RoomMachine(host);
  }

  /* ------------------------------------------------------------------ *
   * Board existence
   * ------------------------------------------------------------------ */

  /**
   * Make this board exist. Called only by `POST /api/boards`.
   *
   * Answers `exists` for a board that already has a `created_at` *or* already has
   * bytes, and writes nothing in that case: the difference between "this id is
   * free" and "somebody is already working here" is the whole reason creation
   * retries, and a retry that overwrote the first board would be worse than no
   * retry at all.
   */
  async initialize(): Promise<'created' | 'exists'> {
    if (this.#store.existsReadOnly(BOARD_STATE_KEY)) return 'exists';
    this.#store.migrate();
    // Stamped before any bytes exist: a board is created by being asked for, not
    // by being written to, and an empty board is a board somebody started.
    const created = this.#store.markCreated(BOARD_STATE_KEY, Date.now());
    return created ? 'created' : 'exists';
  }

  /**
   * Does this board exist? Reads only.
   *
   * True for a created board and for a legacy one that has bytes but predates
   * `created_at` (PRD share.legacy_boards) — somebody's work is in there, and
   * showing them a blank board instead would be the quiet kind of data loss.
   */
  async exists(): Promise<boolean> {
    return this.#store.existsReadOnly(BOARD_STATE_KEY);
  }

  /* ------------------------------------------------------------------ *
   * Requests
   * ------------------------------------------------------------------ */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Test and development support. The Worker entry never routes here, and a
    // request that is not an upgrade is refused below.
    if (url.pathname.startsWith('/control/')) {
      return this.#control(url.pathname.slice('/control/'.length), request);
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    // A room that does not know this board refuses the socket rather than
    // accepting it and serving an empty document. The Worker entry has usually
    // answered this already; it is checked again here because the object is the
    // one that could answer without being asked, and a wake-up from sleep must
    // not become a way to talk to a board that was never made.
    if (!this.#store.existsReadOnly(BOARD_STATE_KEY)) {
      return new Response('Not Found', { status: 404 });
    }

    if (this.#outage) {
      // An outage is a 503, not a socket that is opened and then dropped: a
      // client refused at the HTTP level retries exactly like a client whose
      // socket died, and the log says which of the two happened.
      return new Response('Board storage is unavailable', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) {
      return new Response('Internal Server Error', { status: 500 });
    }

    // Accepted *before* anything is read, and tagged, so a room that sleeps and
    // wakes still knows which of its sockets are board members.
    this.ctx.acceptWebSocket(server, [BOARD_TAG]);

    // No greeting. The client opens the sync, exactly as `y-protocols/sync`
    // describes for a client-server model, and the room's answer to its step-1
    // carries the ask for what the *room* is missing — which is how a browser
    // that reconnects after the room was torn down hands back the changes it kept.
    // A greeting sent here instead would be answered twice by every client: once
    // for the greeting and once for its own step-1, which is how one keystroke
    // ends up on the board three times.

    // Everybody already here is asked who they are. A client never asks the room
    // "who is here?" — `y-websocket` sends its own state on connect and then only
    // when it changes — so without this a newcomer would see an empty board until
    // somebody's cursor happened to move. The answers come back as ordinary
    // presence traffic a turn later, and are relayed like any other frame.
    this.#askAboutNewcomer(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The test-only control surface: arm a failure, force a restart, look inside. */
  #control(name: string, request: Request): Response {
    if (name === 'state') {
      return Response.json({
        state: this.#machine.state.name,
        slept: this.#machine.state.slept,
        members: this.socketCount(),
        pending: this.#machine.state.pendingUpdates,
        refused: this.#machine.state.refused,
        reads: this.#reads,
        outage: this.#outage,
        failure: this.#failure,
        bytes: this.#store.footprint(BOARD_STATE_KEY).bytes,
      });
    }
    if (name === 'restart') {
      // The whole state, not just the cached board: a restart that left
      // "already failed" behind would test nothing.
      this.#machine.reset();
      this.#reads = 0;
      return Response.json({ ok: true, state: this.#machine.state.name });
    }
    if (name === 'outage') {
      this.#outage = !this.#outage;
      return Response.json({ ok: true, outage: this.#outage });
    }
    if (name === 'failure') {
      this.#failure = this.#failure === 'none' ? 'unreadable' : 'none';
      this.#machine.reset();
      return Response.json({ ok: true, failure: this.#failure });
    }
    if (name === 'timeout') {
      // A wedged storage read: the room's deadline is what has to notice.
      this.#failure = 'timeout';
      this.#machine.reset();
      return Response.json({ ok: true, failure: this.#failure });
    }
    if (name === 'clear-failure') {
      this.#failure = 'none';
      this.#machine.reset();
      return Response.json({ ok: true, failure: this.#failure });
    }
    if (name === 'damaged') {
      // Real damaged bytes, for the test that wants storage to hold something
      // that is not a board: four bytes are not a state, and the room has to tell
      // that apart from "nobody has drawn on this board yet".
      const body = new Uint8Array([0x00, 0x01, 0x02]);
      this.#store.writeDamaged(BOARD_STATE_KEY, body);
      this.#machine.reset();
      return Response.json({ ok: true, damaged: body.byteLength });
    }
    void request;
    return new Response('Unknown control', { status: 404 });
  }

  /* ------------------------------------------------------------------ *
   * Hibernatable WebSocket handlers
   *
   * The runtime calls these whether or not the instance was asleep, which is the
   * only reason a room can be torn down and still hand the same board back.
   * ------------------------------------------------------------------ */

  /**
   * One frame from one member: ask the machine, then perform what it said.
   *
   * The relay happens before the write, and that ordering is the whole of TC-28:
   * a person watching a board should not wait for SQLite, and when there is
   * nobody to relay to, the write is what is left, not the relay.
   */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const decision = this.#machine.decide(socket, message);
    const shape = frameShape(message) ?? 'text';

    switch (decision.kind) {
      case 'close': {
        // Costs one connection, not the board: the frame is not relayed and not
        // written, and the other members are not told anything happened.
        this.#close(socket, decision.code, decision.reason);
        return;
      }
      case 'ignore': {
        return;
      }
      case 'reply': {
        // A step-1 request is a question. Answering it is one reply to one
        // socket; broadcasting it would make every member reply to every other
        // and put three copies of the board on the wire.
        for (const frame of decision.frames) this.#send(socket, frame, shape);
        return;
      }
      case 'relay': {
        // The bytes the machine says go out, framed the way they arrived.
        const frame = frameToReply(shape, decision.frame);
        if (decision.presence !== null) this.#notePresence(socket, decision.presence);
        const members = this.#members();
        for (const member of members) {
          // A document update is never sent back to the socket it came from: the
          // author applied it locally a moment ago, and a change echoing to the
          // person who made it is how two browsers end up with three copies of one
          // keystroke. Presence is the one traffic that is not a duplicate, and
          // `echo` is how the machine says so.
          if (member === socket && !decision.echo) continue;
          this.#sendRaw(member, frame);
        }

        if (decision.write === 'none') return;
        if (decision.write === 'await') {
          // Nobody left to relay to: the write is what is left.
          await this.#flush();
          return;
        }
        // The buffer still has a deadline: an update that arrives 400 ms later
        // should not be the reason the first one is never written.
        this.ctx.waitUntil(this.#delayedFlush());
        return;
      }
    }
  }

  /**
   * A member left.
   *
   * If it was the last one, the buffered changes are written down before this
   * returns: after the last socket goes there is nobody to relay to, no timer,
   * and in about ten seconds no instance. This is the write a page refresh or a
   * crash relies on, and it is the reason one instance per board is not a
   * performance preference.
   */
  async webSocketClose(socket: WebSocket): Promise<void> {
    this.#announceDeparture(socket);
    this.#machine.forgetSync(socket);
    if (this.socketCount() <= 1) await this.#flush();
  }

  /**
   * A hibernated socket failed: nobody can speak for its presence any more.
   *
   * The runtime guarantees the socket is already off the member list, so the
   * removal that goes out here has nowhere to be swallowed: the people still
   * connected are exactly the ones who still have the ghost on screen. A socket
   * that dies mid-flight is the common way somebody leaves — a laptop lid, a
   * dropped radio, a phone locked in a pocket — and a room that only cleans up on
   * a *clean* close is a room where half the avatars are decoration.
   */
  webSocketError(socket: WebSocket): void {
    this.#announceDeparture(socket);
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  /** How many sockets the runtime is holding for this board. */
  socketCount(): number {
    return this.#members().length;
  }

  /**
   * What each member's socket has been told about who is here, one entry per
   * socket, in the order they joined.
   *
   * This exists for the tests, and it reads the sockets rather than a field
   * because that is where the answer lives: a room that kept its presence book in
   * instance memory would answer `[]` here while still removing people correctly,
   * and would start answering wrongly the first time it slept.
   */
  presenceSnapshot(): Record<string, number>[] {
    return this.#members().map((member) => this.#presenceOf(member));
  }

  /**
   * What this socket has told the room about who is here.
   *
   * Read from the attachment, not from a field on the instance: the whole point of
   * keeping it on the socket is that a room which slept, was torn down and woke up
   * on a message still knows whose presence to take away. An in-memory `Map`
   * would be empty at exactly the moment it mattered.
   */
  #presenceOf(socket: WebSocket): Record<string, number> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    return attachment?.awareness ?? {};
  }

  /**
   * Remember the presence a socket announced.
   *
   * Only what a socket says about *itself* is charged to it — see
   * {@link readOwnAnnouncement}. A frame that cannot be read is relayed and left
   * alone: the room has no basis for removing anybody on the strength of bytes it
   * could not parse, and it has no basis for believing them either.
   */
  #notePresence(socket: WebSocket, update: Uint8Array): void {
    const announced = readOwnAnnouncement(update);
    if (announced === null) return;
    const attachment = (socket.deserializeAttachment() as SocketAttachment | null) ?? {};
    const known = attachment.awareness ?? {};
    const merged = mergeTracked(known, announced);
    try {
      socket.serializeAttachment({ ...attachment, awareness: merged });
    } catch {
      // The socket is on its way out: serialising to a socket the runtime has
      // already dropped is the one way this call can throw, and a person whose
      // avatar goes stale in thirty seconds is a better outcome than a relay that
      // stopped on a `TypeError`.
    }
  }

  /**
   * Tell the members still here that this socket's people have gone.
   *
   * One frame for everybody the socket was the only voice for, at the clocks they
   * were last seen: `y-protocols` treats a `null` state at a known clock as a
   * removal, and at any other clock as an old message it can drop. Sending one
   * frame instead of one per person keeps a five-person board's departure at one
   * relay rather than four, and every receiver either has the person or does not,
   * which is a decision it makes for itself.
   */
  #announceDeparture(socket: WebSocket): void {
    const gone = clientsFromAttachment(this.#presenceOf(socket));
    if (gone.size === 0) return;
    const frame = encodeAwarenessRemoval(gone);
    for (const member of this.#members()) this.#send(member, frame);
  }

  /**
   * Ask the members already here who they are.
   *
   * The newcomer is excluded: it has nothing to report yet, and answering itself
   * would be a round trip that returns its own cursor to itself.
   */
  #askAboutNewcomer(newcomer: WebSocket): void {
    for (const member of this.#members()) {
      if (member === newcomer) continue;
      this.#send(member, queryAwarenessMessage());
    }
  }

  /**
   * The members to count and to relay to.
   *
   * `getWebSockets` is the runtime's list, and a socket the room closed a
   * moment ago is still on it while it sits in CLOSING. Counting it would make
   * "who is here" a question with a stale answer — a relay to a socket that is
   * on its way out, and a "nobody is left" check that never becomes true.
   */
  #members(): WebSocket[] {
    return this.ctx.getWebSockets(BOARD_TAG).filter((member) => member.readyState === WebSocket.OPEN);
  }

  /**
   * The room's copy of the board, for the tests' assertions.
   *
   * `null` while the room is cold or failed is not an error to hide: an empty
   * document here means "this room is not holding anybody's board", which is the
   * difference the failure tests assert on.
   */
  get doc(): Y.Doc | null {
    return this.#machine.doc;
  }

  /**
   * This board's storage, for the tests that have to speak to it directly.
   *
   * Seed-and-then-open cases need to put a board into a state no client can put
   * it in — bytes with no `created_at`, which is what a story-4 board looks like
   * to a story-5 link check. The Worker never routes to this.
   */
  get store(): RoomStore {
    return this.#store;
  }

  /** Write what the room is holding. A failure here is logged, not thrown. */
  async #flush(): Promise<void> {
    if (!this.#machine.writeDue(true)) return;
    try {
      this.#machine.write();
    } catch (error) {
      // Rule 6: a board we cannot write is still a board people can use, for
      // now — but not a board the room keeps caching. The room stops trying, says
      // so once, and the next join reads, finds nothing, and is refused by rule 5.
      console.error(`[room ${this.ctx.id.toString()}] write failed: ${(error as Error).message}`);
      this.#machine.failWrite((error as Error).message);
      for (const member of this.#members()) {
        this.#close(member, CLOSE_LOAD_FAILED, 'board storage failed');
      }
    }
  }

  /** Give the buffer its chance to fill, then write whatever is left. */
  async #delayedFlush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, FLUSH_INTERVAL_MS));
    await this.#flush();
  }

  /** Send bytes to one socket, in the shape its peer writes in. */
  #send(socket: WebSocket, bytes: Uint8Array, shape: 'binary' | 'text' = 'binary'): void {
    this.#sendRaw(socket, frameToReply(shape, bytes));
  }

  /** Send to one socket, forgetting it if it has already gone. */
  #sendRaw(socket: WebSocket, data: ArrayBuffer | string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (typeof data === 'string' ? data.length === 0 : data.byteLength === 0) return;
    try {
      socket.send(data);
    } catch {
      // The peer is gone. Nothing else in the room should notice: an earlier
      // relay to a socket that has since closed is not a reason to stop relaying
      // to the members that are still here.
    }
  }

  /** Close one socket, if it is still there. */
  #close(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already gone, which is the same outcome: the room is not required to know
      // that a socket died between the runtime handing it over and this line.
    }
  }
}
