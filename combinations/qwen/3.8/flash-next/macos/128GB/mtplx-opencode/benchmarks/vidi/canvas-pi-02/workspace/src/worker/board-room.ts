import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';

import { FLUSH_INTERVAL_MS, LOAD_TIMEOUT_MS } from '../shared/config';
import { RoomStore } from './board-store';
import { frameShape, frameToReply } from './board-protocol';
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
    this.#machine.forgetSync(socket);
    if (this.socketCount() <= 1) await this.#flush();
  }

  /** A hibernated socket failed. Nothing to rescue; the next message decides. */
  webSocketError(): void {
    // The runtime guarantees the socket is already gone, and the room keeps no
    // bookkeeping of its own to unwind — which is the point of taking membership
    // from `getWebSockets` instead of a set.
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  /** How many sockets the runtime is holding for this board. */
  socketCount(): number {
    return this.#members().length;
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
