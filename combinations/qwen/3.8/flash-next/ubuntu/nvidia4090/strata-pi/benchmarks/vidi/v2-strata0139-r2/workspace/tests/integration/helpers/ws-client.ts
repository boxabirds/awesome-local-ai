/**
 * Integration helpers for the live board's WebSocket layer.
 *
 * These tests run inside workerd, so they use the runtime's own `WebSocket`
 * (handed back from a real upgrade through `SELF.fetch`) and real
 * `y-protocols`/`yjs` documents — never a Node-only library like `ws`. The
 * framing they speak is exactly `shared/protocol.ts`: a varuint message type
 * followed by the y-protocols body.
 */

import { abortAllDurableObjects, createExecutionContext, env, runInDurableObject, SELF } from "cloudflare:test";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { snapshot, type StickySnapshot } from "../../../src/shared/board-model";
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from "../../../src/shared/protocol";
import { newBoardId, isValidBoardId } from "../../../src/shared/board-id";
import type { BoardRoom } from "../../../src/worker/board-room";
import type { Env } from "../../../src/worker";
import worker from "../../../src/worker";

/** `y-protocols` sync step types. */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

export interface ReceivedFrame {
  /** `"sync" | "awareness" | "query-awareness" | "invalid"`. */
  kind: Decoded["kind"];
  /** The varuint message type byte, or -1 when the frame has none. */
  type: number;
  /** Body after the message type byte. */
  payload: Uint8Array;
  /** Raw bytes as they arrived. */
  bytes: Uint8Array;
  /** For sync frames: the sync step type, else undefined. */
  syncStep?: number;
}

export interface ClosedInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface ConnectOptions {
  /**
   * Document this socket keeps in sync. When set (the default is a fresh
   * `Y.Doc`), every sync frame is applied to it and any reply `y-protocols`
   * produces — a SyncStep2 answer to the room's SyncStep1, for instance — is
   * sent back, which is what a real client does. Pass `null` to observe the
   * room without taking part in the sync.
   */
  doc?: Y.Doc | null;
  /** Send an awareness frame right after connecting. */
  awareness?: Record<string, unknown>;
  /** Extra request headers, e.g. a missing `Upgrade`. */
  headers?: Record<string, string>;
  /** Override the request URL, e.g. to hit `/api/rooms` with no id. */
  path?: string;
  /** Set to false to send a request that is *not* a WebSocket upgrade. */
  upgrade?: boolean;
}

/**
 * A socket connected to `/api/rooms/<boardId>` through the real Worker fetch
 * handler, speaking the y-websocket framing.
 */
export class TestClient {
  readonly boardId: string;
  readonly doc: Y.Doc | null;
  /** Every frame received, in arrival order. */
  readonly frames: ReceivedFrame[] = [];
  /** Every awareness payload received, in arrival order. */
  readonly awareness: Uint8Array[] = [];

  #response!: Response;
  #socket!: WebSocket;
  #closedPromise!: Promise<ClosedInfo>;
  /** Origin tag for changes applied from the wire: they are never echoed back. */
  readonly #remote = Symbol("room-frame");
  readonly #pending: { frame: ReceivedFrame }[] = [];
  readonly #waiters: {
    resolve: (frame: ReceivedFrame) => void;
    reject: (error: Error) => void;
  }[] = [];
  #closed = false;

  /** Prefer `connectBoard(boardId)`; the constructor is the low-level half. */
  constructor(boardId: string, response: Response, doc: Y.Doc | null) {
    this.boardId = boardId;
    this.doc = doc;
    this.#attach(response);

    if (doc !== null) {
      // What a real provider does: anything the socket did not bring in is sent
      // out as an update frame. Registered once, so a reconnect reuses it.
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === this.#remote) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.sendRaw(encoding.toUint8Array(encoder));
      });
    }
  }

  /** Wires a freshly upgraded socket to this client. */
  #attach(response: Response): void {
    const socket = response.webSocket;
    if (socket === null) throw new Error("upgrade response carried no WebSocket");
    socket.accept();

    this.#response = response;
    this.#socket = socket;
    this.#closed = false;
    this.#pending.length = 0;
    this.#closedPromise = new Promise<ClosedInfo>((resolve) => {
      socket.addEventListener("close", (event: CloseEvent) => {
        this.#closed = true;
        resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      });
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      this.#onFrame(event.data as ArrayBuffer | string);
    });
    socket.addEventListener("error", () => {
      // Nothing to do: the close event follows, and `closed` is what tests await.
    });

    if (this.doc !== null) {
      // y-websocket asks the room for its state as soon as it connects.
      this.sendSyncStep1();
    }
  }

  get response(): Response {
    return this.#response;
  }

  /** Resolves with the close frame of the socket this client is on now. */
  get closed(): Promise<ClosedInfo> {
    return this.#closedPromise;
  }

  /**
   * Opens a second socket to the same board and keeps this client's document —
   * what a browser tab does when the room it was talking to goes away.
   */
  async reconnect(): Promise<void> {
    if (!this.#closed) {
      try {
        this.#socket.close();
      } catch {
        // Already gone.
      }
    }
    const response = await requestRoom(this.boardId);
    if (response.status !== 101) throw new Error(`reconnect refused with ${response.status}`);
    this.frames.length = 0;
    this.#attach(response);
  }

  get socket(): WebSocket {
    return this.#socket;
  }

  get readyState(): number {
    return this.#socket.readyState;
  }

  /** How far this socket has synced with the room. */
  get synced(): boolean {
    return this.frames.some((frame) => frame.kind === "sync" && frame.syncStep === SYNC_STEP_2);
  }

  /**
   * Count of remote document updates. Only `Update` frames count: the
   * `SyncStep2` answers exchanged while connecting are the initial hand-shake,
   * not changes.
   */
  get updateCount(): number {
    return this.frames.filter((frame) => frame.kind === "sync" && frame.syncStep === SYNC_UPDATE).length;
  }

  /** Count of `Update` frames carrying `text` — used to prove no echoes. */
  updatesOf(text: string): number {
    return this.frames.filter(
      (frame) => frame.kind === "sync" && frame.syncStep === SYNC_UPDATE && bytesContain(frame.payload, text),
    ).length;
  }

  /** Resolves when the room has answered this socket's `SyncStep1`. */
  async waitForSync(timeoutMs = 5_000): Promise<void> {
    await waitUntil(() => this.synced, timeoutMs);
  }

  /**
   * Waits until at least `count` document updates have arrived since the last
   * `resetFrames()`. Absolute rather than relative, so a test may call it after
   * the change it waits for has already landed.
   */
  async waitForUpdates(count: number, timeoutMs = 5_000): Promise<void> {
    await waitUntil(() => this.updateCount >= count, timeoutMs);
  }

  /** Drops the recorded frames, so a test can count only what follows. */
  resetFrames(): void {
    this.frames.length = 0;
    this.awareness.length = 0;
    this.#pending.length = 0;
  }

  get notes(): readonly StickySnapshot[] {
    return this.doc === null ? [] : snapshot(this.doc);
  }

  /** A frame this socket has not consumed yet, or the next one to arrive. */
  nextFrame(timeoutMs = 5_000): Promise<ReceivedFrame> {
    const queued = this.#pending.shift();
    if (queued) return Promise.resolve(queued.frame);

    return new Promise<ReceivedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(new Error(`no frame within ${timeoutMs}ms`));
      }, timeoutMs);
      this.#waiters.push({
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject,
      });
    });
  }

  /** Waits until the room's document contains `count` notes. */
  async waitForRoomNotes(count: number, timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await roomSnapshot(this.boardId);
      if (state !== null && state.length === count) return;
      if (Date.now() > deadline) throw new Error(`room did not reach ${count} notes in time`);
      await sleep(25);
    }
  }

  /** Sends raw bytes — used for the malformed-traffic cases. */
  sendRaw(bytes: Uint8Array | string): void {
    this.#socket.send(bytes);
  }

  /** Sends a sync frame whose body is `body`. */
  sendSync(body: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeUint8Array(encoder, body);
    this.sendRaw(encoding.toUint8Array(encoder));
  }

  /** Sends a `SyncStep1` request for this client's own document. */
  sendSyncStep1(): void {
    if (this.doc === null) throw new Error("no document to sync");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.sendRaw(encoding.toUint8Array(encoder));
  }

  /** Sends an awareness frame whose body is exactly `payload`. */
  sendAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    this.sendRaw(encoding.toUint8Array(encoder));
  }

  /** Sends a `QueryAwareness` frame. */
  sendQueryAwareness(): void {
    this.sendRaw(new Uint8Array([MESSAGE_QUERY_AWARENESS]));
  }

  /** Applies a local change to this client's document and broadcasts it. */
  transact<T>(write: (doc: Y.Doc) => T): T {
    if (this.doc === null) throw new Error("no document to change");
    const doc = this.doc;
    return Y.transact(doc, () => write(doc));
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  /** True once this socket has closed, whoever asked for it. */
  get isClosed(): boolean {
    return this.#closed;
  }

  /** Waits for the close frame of the socket this client is on now. */
  async waitForClose(timeoutMs = 6_000): Promise<ClosedInfo> {
    const info = await Promise.race([this.#closedPromise, sleep(timeoutMs).then(() => null)]);
    if (info === null) throw new Error(`socket did not close within ${timeoutMs}ms`);
    return info;
  }

  /** This socket's document, for tests that need to write to it directly. */
  requireDoc(): Y.Doc {
    if (this.doc === null) throw new Error("this socket has no document");
    return this.doc;
  }

  #onFrame(data: ArrayBuffer | string): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    const decoded = decodeMessage(bytes);

    const frame: ReceivedFrame = {
      kind: decoded.kind,
      type: messageType(bytes),
      payload: decoded.kind === "sync" || decoded.kind === "awareness" ? decoded.payload : new Uint8Array(),
      bytes,
    };

    if (decoded.kind === "sync") {
      frame.syncStep = decoded.payload.length > 0 ? decoded.payload[0] : undefined;

      // Act like a client: apply what the room sent, and send the reply
      // `y-protocols` produced (SyncStep2 for a SyncStep1 request).
      if (this.doc !== null) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, this.doc, this.#remote);
        if (encoding.length(encoder) > 1) this.sendRaw(encoding.toUint8Array(encoder));
      }
    } else if (decoded.kind === "awareness") {
      this.awareness.push(decoded.payload);
    }

    this.frames.push(frame);

    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve(frame);
    else this.#pending.push({ frame });
  }
}

/** The varuint message type of a frame, or -1 if there is no readable one. */
function messageType(bytes: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(bytes));
  } catch {
    return -1;
  }
}

/** True when `text` appears in `bytes` (updates store strings as UTF-8). */
function bytesContain(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---- opening sockets ------------------------------------------------------

/** Requests `/api/rooms/...` and returns whatever the Worker answered. */
export async function requestRoom(boardId: string, options: ConnectOptions = {}): Promise<Response> {
  const path = options.path ?? `/api/rooms/${boardId}`;
  const headers: Record<string, string> = { ...options.headers };
  if (options.upgrade !== false) headers["Upgrade"] = "websocket";
  return SELF.fetch(`http://board.test${path}`, { headers });
}

/**
 * The Worker's own fetch handler, optionally with a Durable Object namespace
 * that records which board ids it was asked to route — that is how "no object
 * instance was created" is asserted.
 */
export function namespaceSpy(): { namespace: DurableObjectNamespace<BoardRoom>; names: string[] } {
  const names: string[] = [];
  const real = env.BOARD_ROOM;
  const namespace = new Proxy(real, {
    get(target, property: string | symbol) {
      if (property === "idFromName") {
        return (name: string) => {
          names.push(name);
          return target.idFromName(name);
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { namespace, names };
}

export function fetchFromWorker(
  request: Request,
  namespace?: DurableObjectNamespace<BoardRoom>,
  overrides: Partial<Env> = {},
): Promise<Response> {
  return worker.fetch(
    request,
    { ...env, BOARD_ROOM: namespace ?? env.BOARD_ROOM, ...overrides },
    createExecutionContext(),
  );
}

/** Opens a board socket, failing with the status if the upgrade was refused. */
export async function connectBoard(boardId: string, options: ConnectOptions = {}): Promise<TestClient> {
  const response = await requestRoom(boardId, options);
  if (response.status !== 101) {
    throw new Error(`upgrade refused with ${response.status}: ${await response.text()}`);
  }
  const doc = options.doc === null ? null : (options.doc ?? new Y.Doc());
  const client = new TestClient(boardId, response, doc);
  if (options.awareness) client.sendAwareness(new TextEncoder().encode(JSON.stringify(options.awareness)));
  return client;
}

/** A fresh board id for a test, so board isolation is real isolation. */
export function testBoardId(): string {
  return newBoardId();
}

// ---- the board API (story 5) ---------------------------------------------

/**
 * Creates a board the way the product does — `POST /api/boards` through the real
 * Worker — and returns its id.
 *
 * From story 5 on, a board has to exist before anyone can connect to it, so
 * every test that opens a socket asks for a board first. `testBoardId()` remains
 * for the cases that need an id that is *not* a board.
 */
export async function createTestBoard(): Promise<string> {
  const response = await requestBoards({ method: "POST" });
  if (response.status !== 201) {
    throw new Error(`POST /api/boards answered ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !isValidBoardId(body.id)) {
    throw new Error(`POST /api/boards returned no usable id: ${JSON.stringify(body)}`);
  }
  return body.id;
}

/** A request to `/api/boards` or `/api/boards/:id`. */
export function requestBoards(init: RequestInit = {}, path = "/api/boards"): Promise<Response> {
  return SELF.fetch(`http://board.test${path}`, init);
}

/** `GET /api/boards/:id` — the existence check the client performs. */
export function checkBoardApi(boardId: string): Promise<Response> {
  return requestBoards({ method: "GET" }, `/api/boards/${boardId}`);
}

/** Runs `work` with a namespace whose `initialize()` RPC throws (TC-12). */
export function namespaceWithFailingInitialize(): DurableObjectNamespace<BoardRoom> {
  const real = env.BOARD_ROOM;
  const failingGet = (id: DurableObjectId) => {
    const stub = real.get(id);
    return new Proxy(stub, {
      get(target, property: string | symbol) {
        if (property === "initialize") {
          return async (): Promise<"created"> => {
            throw new Error("injected RPC failure");
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as unknown as BoardRoom;
  };

  return new Proxy(real, {
    get(target, property: string | symbol) {
      if (property === "get") return failingGet;
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as DurableObjectNamespace<BoardRoom>;
}

// ---- looking inside the room ---------------------------------------------

export function roomStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Runs `work` inside the board's BoardRoom instance. */
export function inRoom<T>(boardId: string, work: (room: BoardRoom) => T | Promise<T>): Promise<T> {
  return runInDurableObject(roomStub(boardId), (instance) => work(instance as BoardRoom));
}

/** The room's own document as board-model snapshots, or `null` if it has none. */
export function roomSnapshot(boardId: string): Promise<readonly StickySnapshot[] | null> {
  return inRoom(boardId, (room) => (room.doc === null ? null : snapshot(room.doc)));
}

/** The room's document state vector, for "identical document" assertions. */
export function roomStateVector(boardId: string): Promise<Uint8Array | null> {
  return inRoom(boardId, (room) => (room.doc === null ? null : Y.encodeStateVector(room.doc)));
}

/** True when the room's document holds exactly the same notes as `doc`. */
export function roomDocEquals(boardId: string, doc: Y.Doc): Promise<boolean> {
  return inRoom(boardId, (room) => {
    if (room.doc === null) return false;
    return JSON.stringify(snapshot(room.doc)) === JSON.stringify(snapshot(doc));
  });
}

/**
 * Simulates a room restart: the BoardRoom instance is torn down together with
 * every socket it accepted.
 *
 * From story 4 onward the *board* survives that — it is in storage and a new
 * instance reads it back — so what this proves is that the instance is new:
 * `BoardRoom.instanceId` differs before and after. Before story 4 the same proof
 * was "the room has no document", which is now exactly what must not be true.
 *
 * Aborting is the supported way in the Vitest pool to get "instance gone, sockets
 * closed, storage untouched" in one call. The hibernation path, where sockets stay
 * open across the instance going away, is exercised with `evictAllDurableObjects`
 * in `board-room-persistence.test.ts`. See NOTES.md.
 */
export async function restartRoom(boardId: string): Promise<void> {
  const before = await inRoom(boardId, (room) => room.instanceId);
  await abortAllDurableObjects();
  const after = await inRoom(boardId, (room) => room.instanceId);
  if (after === before) throw new Error("room instance survived the restart");
}

// ---- waiting -------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `condition` until it holds; frames arrive on their own, so polling is enough. */
export async function waitUntil(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await sleep(20);
  }
}

/** Asynchronous-predicate form of `waitUntil`. */
export async function waitUntilAsync(condition: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await sleep(25);
  }
}

/** Polls until every client and the room hold the same notes, and returns them. */
export async function expectConverged(
  boardId: string,
  clients: TestClient[],
  timeoutMs = 15_000,
): Promise<readonly StickySnapshot[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const room = await roomSnapshot(boardId);
    const first = JSON.stringify(clients[0]?.notes ?? null);
    const allEqual =
      room !== null &&
      JSON.stringify(room) === first &&
      clients.every((client) => JSON.stringify(client.notes) === first);
    if (allEqual && room !== null) return room;
    if (Date.now() > deadline) {
      throw new Error(
        `board did not converge: ${clients.map((client) => JSON.stringify(client.notes)).join("\n")}\nroom: ${JSON.stringify(room)}`,
      );
    }
    await sleep(25);
  }
}
