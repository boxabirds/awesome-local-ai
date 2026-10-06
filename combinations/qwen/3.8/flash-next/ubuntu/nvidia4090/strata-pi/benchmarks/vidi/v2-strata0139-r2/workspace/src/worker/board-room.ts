/**
 * BoardRoom — one Durable Object per board (`sync.room`, `persist.room`).
 *
 * The room is still a relay, not a server with its own opinions, but from
 * story 4 onward the board it relays is *saved*:
 *
 * - on construction (which is what a wake from hibernation or a restart looks
 *   like) the room reads snapshot + log into a document inside
 *   `blockConcurrencyWhile`, so no handler runs against a board that has not
 *   been read yet;
 * - every update the room applies is appended to the log **before** it is
 *   broadcast, so a change a person can see is a change that is stored
 *   (`persist.seen_is_saved`);
 * - a board whose storage cannot be read answers every connection with
 *   `CLOSE_BOARD_LOAD_FAILED` (4500) and never accepts edits — an empty board
 *   is not offered as a substitute;
 * - a change that cannot be written closes every socket with
 *   `CLOSE_STORAGE_FAILURE` (1011) and discards the document, so no screen
 *   keeps an unsaved board (`persist.storage_failure`);
 * - WebSockets use the hibernation API (`ctx.acceptWebSocket`,
 *   `ctx.getWebSockets`), so an idle board uses no compute while its sockets
 *   stay open, and the sockets — not this instance's memory — are the list of
 *   who is connected.
 *
 * The lifecycle edges are not ad-hoc: every state change goes through
 * `nextRoomState` from `room-state.ts`, the file that `TC-27` tests edge by
 * edge.
 */

import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from "../shared/protocol";
import { BoardStore, LOAD_ORIGIN, shouldCompact, type LoadResult } from "./board-store";
import {
  ROOM_LOAD_RETRY_MIN_INTERVAL_MS as LOAD_RETRY_MIN_INTERVAL_MS,
  nextRoomState,
  roomServes,
  type RoomLifecycleState,
} from "./room-state";
import type { Env } from "./index";

/** `WebSocket.OPEN`. */
const SOCKET_OPEN = 1;

/** Re-exported so the room's own contract names the states clients can observe. */
export type { RoomLifecycleState, RoomState } from "./room-state";

export class BoardRoom extends DurableObject<Env> {
  /**
   * The board's document, loaded from storage. `null` means the room has nothing
   * trustworthy in memory: it is `null` while loading, after a load failure and
   * after a storage failure. Public so tests (and `runInDurableObject`) can read
   * the room's own state.
   */
  doc: Y.Doc | null = null;

  /** The board's storage. Public so tests can read what the room believes it wrote. */
  store: BoardStore | null = null;

  /** Where this room is in its lifecycle; every change goes through `nextRoomState`. */
  state: RoomLifecycleState = "loading";

  /**
   * When this room last failed to load, in milliseconds. Public so a test can
   * move it: simulating the passage of `LOAD_RETRY_MIN_INTERVAL_MS` is a clock
   * reading, not a product switch.
   */
  loadFailedAtMs: number | null = null;

  /** Identifies *this instance*, so a test can prove a room was reconstructed. */
  readonly instanceId = crypto.randomUUID();

  /** The construction-time load. Handlers wait for it. */
  readonly #ready: Promise<RoomLifecycleState>;

  /** Set while a reload triggered by a connection is in flight. */
  #reloading: Promise<RoomLifecycleState> | null = null;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    // Nothing else runs until the board has been read: a handler must never see
    // a room that is holding half a document.
    this.#ready = ctx.blockConcurrencyWhile(async () => await this.#loadBoard());
  }

  /** WebSocket upgrade only; anything else is answered with 426. */
  async fetch(request: Request): Promise<Response> {
    if (!isUpgradeRequest(request)) {
      return new Response("Upgrade Required", { status: 426 });
    }

    const state = await this.#awaitServingState();
    const [client, server] = Object.values(new WebSocketPair());

    if (roomServes(state) && this.doc !== null) {
      const socket = server;
      this.ctx.acceptWebSocket(socket, [newConnectionTag()]);
      this.#send(socket, this.#syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc!)));
      return new Response(null, { status: 101, webSocket: client });
    }

    // A board that could not be read is accepted and closed immediately, so the
    // person sees 4500 rather than a connection that pretends the board is empty.
    this.ctx.acceptWebSocket(server, [newConnectionTag()]);
    server.close(CLOSE_BOARD_LOAD_FAILED, "this board could not be loaded");
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernation socket handlers ---------------------------------------

  /**
   * A frame on an accepted socket. The state gate comes first: a room that
   * failed to load stores nothing from a socket it is about to close, and a room
   * that failed to store takes no further edits.
   */
  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    switch (this.state) {
      case "load-failed":
        this.#closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, "this board could not be loaded");
        return;
      case "storage-failed":
        this.#closeSocket(socket, CLOSE_STORAGE_FAILURE, "this board could not be saved");
        return;
      case "loading":
        // Cannot happen: `blockConcurrencyWhile` holds handlers back until the
        // load settles. Guarded rather than trusted.
        this.#closeSocket(socket, CLOSE_STORAGE_FAILURE, "this board is still loading");
        return;
      default:
        break;
    }

    if (this.doc === null) {
      this.#closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, "this board could not be loaded");
      return;
    }

    const decoded = decodeMessage(message);

    switch (decoded.kind) {
      case "sync":
        this.#onSync(socket, decoded.payload);
        return;
      case "awareness":
        // Verbatim, including back to the sender.
        this.#broadcast(this.#awarenessFrame(decoded.payload), null);
        return;
      case "query-awareness":
        // No awareness state is stored in this story (presence is story 6).
        return;
      case "invalid":
        this.#reject(socket, decoded.reason);
        return;
    }
  }

  /**
   * A socket went away. When the last one does, the room has nothing holding the
   * board open and the runtime is free to hibernate this instance — the next
   * connection or frame reconstructs it and loads the board again.
   */
  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    if (roomServes(this.state) && this.ctx.getWebSockets().length === 0) {
      this.state = nextRoomState(this.state, { type: "hibernated" });
    }
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    this.#closeSocket(socket, CLOSE_STORAGE_FAILURE, "socket error");
  }

  // ---- load ---------------------------------------------------------------

  /**
   * The state a new connection should be answered with, reloading first when
   * this room has nothing to serve: after a storage failure, after hibernation,
   * or after a load failure whose retry interval has passed.
   */
  async #awaitServingState(): Promise<RoomLifecycleState> {
    await this.#ready;

    if (roomServes(this.state) && this.doc !== null) return this.state;

    // `load-failed` is the only state that refuses to try again, and the only
    // thing it waits for is the retry interval; `loadFailedAtMs === null` means
    // this room has never failed a load, so the interval is not what holds it.
    const sinceFailureMs =
      this.loadFailedAtMs === null
        ? LOAD_RETRY_MIN_INTERVAL_MS
        : Date.now() - this.loadFailedAtMs;

    this.state = nextRoomState(this.state, { type: "new-connection", sinceFailureMs });

    if (this.state === "loading") return await this.#reload();
    return this.state;
  }

  /** Serialises reloads, so two clients reconnecting at once read the board once. */
  async #reload(): Promise<RoomLifecycleState> {
    this.#reloading ??= this.#loadBoard().finally(() => {
      this.#reloading = null;
    });
    return await this.#reloading;
  }

  /** Reads snapshot + log into a new document and settles the room's state. */
  async #loadBoard(): Promise<RoomLifecycleState> {
    const store = new BoardStore(this.ctx.storage);
    this.store = store;

    let result: LoadResult;
    const doc = new Y.Doc();
    try {
      // Registered before anything is applied, so a loaded update is recognisable
      // by its origin and is neither stored nor broadcast.
      doc.on("update", (update: Uint8Array, origin: unknown) => this.#onUpdate(update, origin));
      result = store.load(doc);
    } catch (error) {
      // A `load` that throws instead of reporting is still a load failure: the
      // room refuses to serve rather than serving an empty board.
      result = { ok: false, reason: "sql-error", error: errorMessage(error) };
    }

    if (!result.ok) {
      this.doc = null;
      this.store = null;
      this.state = nextRoomState(this.state, { type: "load-failed" });
      this.loadFailedAtMs = Date.now();
      logError("board-load-failed", { reason: result.reason, error: result.error });
      return this.state;
    }

    this.doc = doc;
    this.state = nextRoomState(this.state, { type: "load-succeeded", quarantined: result.quarantined });
    this.loadFailedAtMs = null;
    return this.state;
  }

  // ---- stored, then broadcast --------------------------------------------

  /**
   * The room's document changed.
   *
   * Storage first: the log row is written before anything is sent, so a change
   * another screen can see is already saved. Compaction follows the broadcast —
   * it is the one storage operation whose failure is survivable.
   */
  #onUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;

    const store = this.store;
    const doc = this.doc;
    if (store === null || doc === null) {
      // A room with no working storage has nothing to credit this change to.
      this.#storageFailed(new Error("no storage available for this board"));
      return;
    }

    try {
      store.append(update, doc);
    } catch (error) {
      this.#storageFailed(error);
      return;
    }

    this.#broadcast(this.#syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)), origin);
    this.#compact(doc);
  }

  /**
   * Compaction, which the store reports as a boolean: it attempted nothing, or
   * it attempted something and either committed or rolled back. A rolled back
   * compaction leaves the board exactly as it was, so the room keeps serving.
   */
  #compact(doc: Y.Doc): void {
    const store = this.store;
    if (store === null) return;

    // The store reports a no-op and a rolled-back failure the same way, so the
    // room asks the threshold question itself before naming the attempt.
    const { logRows, logBytes } = store.state();
    if (!shouldCompact(logRows, logBytes)) return;

    this.state = nextRoomState(this.state, { type: "compact-started" });
    const compacted = store.compactIfNeeded(doc);
    this.state = nextRoomState(this.state, {
      type: compacted ? "compacted" : "compaction-failed",
    });
  }

  /**
   * Storage failed on a change: the board is no longer trustworthy in memory, so
   * every socket is closed with 1011 and the document is discarded. The next
   * connection reads the board back from what storage still has.
   */
  #storageFailed(error: unknown): void {
    logError("board-storage-failed", { error: errorMessage(error) });
    this.state = nextRoomState(this.state, { type: "append-failed" });
    this.doc = null;
    this.store = null;
    for (const socket of this.#sockets()) {
      this.#closeSocket(socket, CLOSE_STORAGE_FAILURE, "this board could not be saved");
    }
  }

  // ---- y-protocols sync ---------------------------------------------------

  #onSync(socket: WebSocket, body: Uint8Array): void {
    const doc = this.doc;
    if (doc === null) {
      this.#closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, "this board could not be loaded");
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const decoder = decoding.createDecoder(body);

    // The connection tag is the transaction origin: the update listener uses it
    // to skip the sender, so nobody receives their own change back. Tags survive
    // hibernation, which a per-instance socket object would not.
    const origin = this.#tagOf(socket);

    // `readSyncMessage` reports a body Yjs cannot apply through this handler
    // instead of throwing: that one socket is closed, the room is untouched, and
    // nothing is written.
    let rejected = false;
    const onError = (error: Error): void => {
      rejected = true;
      this.#reject(socket, error.message);
    };

    try {
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin, onError);
    } catch (error) {
      this.#reject(socket, error instanceof Error ? error.message : "invalid sync message");
      return;
    }

    // `length > 1` means readSyncMessage wrote an actual reply.
    if (!rejected && encoding.length(encoder) > 1) this.#send(socket, encoding.toUint8Array(encoder));
  }

  // ---- framing ------------------------------------------------------------

  #syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    return encoding.toUint8Array(encoder);
  }

  #awarenessFrame(body: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeUint8Array(encoder, body);
    return encoding.toUint8Array(encoder);
  }

  // ---- sockets ------------------------------------------------------------

  /** The room's sockets, as the runtime sees them — including hibernated ones. */
  #sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  /**
   * Sends to every open socket except `except` (compared by connection tag;
   * `null` sends to all). A socket that cannot be written to is left to the
   * runtime: the hibernation API owns the list.
   */
  #broadcast(bytes: Uint8Array, except: unknown): void {
    const exceptTag = typeof except === "string" ? except : null;
    for (const socket of this.#sockets()) {
      if (exceptTag !== null && this.#tagOf(socket) === exceptTag) continue;
      this.#send(socket, bytes);
    }
  }

  /** The connection tag stored in the socket when it was accepted. */
  #tagOf(socket: WebSocket): string {
    try {
      return this.ctx.getTags(socket)[0] ?? "";
    } catch {
      // A socket that is closing has no tags to read.
      return "";
    }
  }

  #send(socket: WebSocket, bytes: Uint8Array): void {
    if (socket.readyState !== SOCKET_OPEN) return;
    try {
      socket.send(bytes);
    } catch {
      // The runtime closes the socket and calls `webSocketClose`.
    }
  }

  /** A frame the room understood badly: close *this* socket, spare the rest. */
  #reject(socket: WebSocket, reason: string): void {
    this.#closeSocket(socket, CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
  }

  #closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already closing.
    }
  }
}

/** One tag per connection, stored in the socket so it survives hibernation. */
function newConnectionTag(): string {
  return crypto.randomUUID();
}

function isUpgradeRequest(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...fields }));
}
