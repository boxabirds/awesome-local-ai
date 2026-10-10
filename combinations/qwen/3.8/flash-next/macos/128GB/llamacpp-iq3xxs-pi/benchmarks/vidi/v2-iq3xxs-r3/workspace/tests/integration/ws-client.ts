/**
 * A test participant of one board: a real `WebSocket` into the real BoardRoom,
 * plus a real `Y.Doc` speaking the y-websocket framing byte for byte (sync and
 * awareness), so the room cannot tell this client from a browser.
 *
 * It is deliberately *not* `y-websocket`'s provider: workerd gives a test no way
 * to dial an arbitrary `ws://` URL, and a mocked socket would stop testing the
 * room. The framing is `y-protocols` plus the same `decodeMessage` the room
 * uses, so a byte the room would refuse is a byte this client refuses too.
 */
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { createDecoder, readVarUint, readVarUint8Array } from "lib0/decoding";
import {
  createEncoder,
  length as encodedLength,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from "lib0/encoding";
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeSyncStep1,
} from "y-protocols/sync";
import { env, runInDurableObject, SELF } from "cloudflare:test";

import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  OBJECTS_KEY,
  setStickyColor,
  snapshot,
} from "../../src/shared/board-model";
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from "../../src/shared/protocol";

import type { StickySnapshot } from "../../src/shared/board-model";
import type { StickyColor } from "../../src/shared/config";

/** The Yjs origin of everything that arrives over the wire (never re-sent). */
const REMOTE: unique symbol = Symbol("remote");
/** The origin of a test's own edits, so they are never confused with remote ones. */
const LOCAL_EDIT: unique symbol = Symbol("local edit");

/** `/api/rooms/<boardId>` on the worker under test. */
export function roomUrl(boardId: string): string {
  return `http://permitted.invalid/api/rooms/${boardId}`;
}

/** Everything the room has ever sent this client. */
export interface ReceivedLog {
  /** Total binary frames received. */
  frames: number;
  /** Sync frames by step — the room's SyncStep1 always comes first. */
  step1: number;
  step2: number;
  /** Document updates received: what one change of another client costs. */
  updates: number;
  awareness: number;
  /** Awareness bodies in arrival order, for the verbatim-relay test (TC-16). */
  awarenessBytes: Uint8Array[];
  /** Frames `decodeMessage` refused (the room closes the sender, not us). */
  invalid: number;
}

/** How the connection ended, as this client saw it. */
export interface SocketClose {
  readonly code: number;
  readonly reason: string;
}

/**
 * One participant. `doc` is the board as this client sees it, and every local
 * change goes out immediately as one update frame, exactly like a browser.
 */
export class BoardClient {
  readonly received: ReceivedLog = {
    frames: 0,
    step1: 0,
    step2: 0,
    updates: 0,
    awareness: 0,
    awarenessBytes: [],
    invalid: 0,
  };

  /** Frames this client sent, by kind. */
  readonly sent = { step1: 0, step2: 0, updates: 0, awareness: 0 };

  #close: SocketClose | undefined;
  #open = false;
  #saidHello = false;
  #pending: Promise<void> = Promise.resolve();
  readonly #awareness: awarenessProtocol.Awareness;

  private constructor(
    readonly socket: WebSocket,
    readonly doc: Y.Doc,
  ) {
    this.#awareness = new awarenessProtocol.Awareness(doc);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return; // came from the room, never goes back to it
      if (!this.#open) return; // offline: the document keeps the change (TC-18)
      this.sendUpdate(update);
    });
    socket.addEventListener("open", () => this.#hello());
    socket.addEventListener("message", (event) => {
      // Frames of one socket are handled one after another: reading a Blob is
      // async, and two frames must not race through the document.
      this.#pending = this.#pending.then(() => this.#receive(event.data));
    });
    socket.addEventListener("close", (event) => {
      const close = event as unknown as { code: number; reason: string };
      this.#open = false;
      this.#close ??= { code: close.code, reason: close.reason };
    });
    socket.addEventListener("error", () => {
      this.#close ??= { code: 1006, reason: "socket error" };
    });
  }

  /**
   * Open a connection to `boardId`'s room. Nothing is waited for beyond the
   * handshake: the caller decides whether it wants the sync exchange
   * (`waitForSync`) or a close code (`expectClosed`).
   */
  static async join(
    boardId: string,
    doc: Y.Doc = new Y.Doc(),
  ): Promise<BoardClient> {
    initDoc(doc);
    const response = await SELF.fetch(roomUrl(boardId), {
      headers: { Upgrade: "websocket" },
    });
    const socket = response.webSocket;
    if (!socket) {
      throw new Error(`no websocket on the ${response.status} response`);
    }
    const client = new BoardClient(socket, doc);
    // `accept()` completes the client side of the handshake. The listeners are
    // attached first: workerd has already finished the handshake by now, so an
    // `open` event may have come and gone without us (see `#hello`).
    socket.accept();
    client.#hello();
    return client;
  }

  /**
   * Ask the room for its state, once. The client half of a `fetch` upgrade is
   * open the moment `accept()` returns and its `open` event is not replayed, so
   * this is called from `join()` and — if the runtime does fire it — from the
   * listener, and must stay idempotent.
   */
  #hello(): void {
    if (this.#saidHello) return;
    this.#saidHello = true;
    this.#open = true;
    this.sendSyncStep1();
  }

  /** Every frame the room has sent, awaited (used before asserting on counts). */
  async flushed(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.#pending;
      await pending;
    } while (pending !== this.#pending);
  }

  /** The board as this client sees it. */
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** The `objects` map, for comparing structure rather than the render view. */
  objects(): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
  }

  get close(): SocketClose | undefined {
    return this.#close;
  }

  get open(): boolean {
    return this.#open;
  }

  get awareness(): awarenessProtocol.Awareness {
    return this.#awareness;
  }

  get frames(): number {
    return this.received.frames;
  }

  #send(frame: Uint8Array): void {
    this.socket.send(frame);
  }

  sendSyncStep1(): void {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc);
    this.sent.step1 += 1;
    this.#send(toUint8Array(encoder));
  }

  /** One document update — what `doc.on('update')` gives for a transaction. */
  sendUpdate(update: Uint8Array): void {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeVarUint(encoder, messageYjsUpdate);
    writeVarUint8Array(encoder, update);
    this.sent.updates += 1;
    this.#send(toUint8Array(encoder));
  }

  /** Awareness as `y-websocket` writes it: type byte, then a length-prefixed body. */
  sendAwareness(): void {
    const payload = awarenessProtocol.encodeAwarenessUpdate(this.#awareness, [
      this.doc.clientID,
    ]);
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_AWARENESS);
    writeVarUint8Array(encoder, payload);
    this.sent.awareness += 1;
    this.#send(toUint8Array(encoder));
  }

  sendQueryAwareness(): void {
    this.sent.awareness += 1;
    this.#send(Uint8Array.from([MESSAGE_QUERY_AWARENESS]));
  }

  /** Traffic no well-behaved client sends: the garbage of TC-15. */
  sendRaw(frame: Uint8Array | string): void {
    this.socket.send(frame);
  }

  /** Leave; the default is an ordinary goodbye, not an error. */
  /** Hang up, and stop the timers this client started inside the test process. */
  leave(code = 1000, reason = "bye"): void {
    try {
      this.socket.close(code, reason);
    } catch {
      /* already closed by the room */
    }
    // `Awareness` owns an interval of its own; without this the process outlives
    // the test that created it.
    this.awareness.destroy();
  }

  /** One local change, in one transaction, so it travels as one update. */
  edit<T>(run: () => T): T {
    return this.doc.transact(run, LOCAL_EDIT);
  }

  async #receive(data: unknown): Promise<void> {
    const buffer = await frameBuffer(data);
    const decoded = decodeMessage(buffer);
    this.received.frames += 1;
    if (decoded.kind === "invalid") {
      this.received.invalid += 1;
      return;
    }
    if (decoded.kind === "awareness") {
      this.received.awareness += 1;
      // The body carries its own length prefix (`writeVarUint8Array` in
      // y-websocket), which is what the room relays verbatim; the awareness
      // protocol wants the bytes inside it.
      this.received.awarenessBytes.push(
        copy(readVarUint8Array(createDecoder(decoded.payload))),
      );
      return;
    }
    if (decoded.kind === "query-awareness") return;
    // Peek at the sync step before handing the frame to y-protocols: the
    // exchange is then counted without a second copy of the decoding logic.
    const step = readVarUint(createDecoder(copy(decoded.payload)));
    const reply = createEncoder();
    writeVarUint(reply, MESSAGE_SYNC);
    readSyncMessage(createDecoder(decoded.payload), reply, this.doc, REMOTE);
    if (step === messageYjsSyncStep1) this.received.step1 += 1;
    if (step === messageYjsSyncStep2) this.received.step2 += 1;
    if (step === messageYjsUpdate) this.received.updates += 1;
    // Only SyncStep1 is answered — echoing an update back would be wasted bytes.
    if (encodedLength(reply) > 1) {
      if (step === messageYjsSyncStep1) this.sent.step2 += 1;
      this.#send(toUint8Array(reply));
    }
  }
}

/** Wait until a condition holds, then complain loudly if it never does. */
export async function waitFor(
  what: string,
  when: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (when()) return;
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(5);
  }
}

/** The full sync exchange of a new connection, then quiet. */
export async function synced(
  client: BoardClient,
  timeoutMs = 3_000,
): Promise<void> {
  await waitFor(
    `the sync exchange (received=${JSON.stringify(client.received)})`,
    () =>
      client.received.step1 >= 1 &&
      client.received.step2 >= 1 &&
      client.sent.step2 >= 1,
    timeoutMs,
  );
  await settle(client);
}

/**
 * Wait until nothing arrives any more, so a count of what came in means "what
 * the room sent" rather than "what the room has sent so far".
 */
export async function settle(
  client: BoardClient,
  quietMs = 40,
  rounds = 2,
): Promise<void> {
  await client.flushed();
  let last = -1;
  let quiet = 0;
  while (quiet < rounds) {
    await delay(quietMs);
    if (client.received.frames === last) quiet += 1;
    else {
      quiet = 0;
      last = client.received.frames;
    }
  }
}

/**
 * Wait for this client's connection to end, and report the close it got. Only a
 * close the *room* started shows up here: a socket the room refuses ends with
 * `CLOSE_UNSUPPORTED_DATA` and nobody else on the board notices (TC-15). A
 * client that hung up (`leave()`) is not reported to itself — under the
 * hibernation API workerd keeps the close on the room's side, which is where
 * `roomSockets` looks.
 */
export async function closed(
  client: BoardClient,
  timeoutMs = 3_000,
): Promise<SocketClose> {
  await waitFor(
    "the socket to close",
    () => client.close !== undefined,
    timeoutMs,
  );
  return client.close as SocketClose;
}

/**
 * How many sockets the room itself believes are open on `boardId`. Since story
 * 4 the room does not keep a `Set` of sockets — `ctx.getWebSockets()` is the
 * list, and hibernated sockets are in it — so "who is on this board" is only
 * answerable by asking the object. Asking it also wakes it, which is exactly
 * what a test about a room coming back wants to know.
 */
export function roomSockets(boardId: string): Promise<number> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(
    stub,
    (_room, state) => state.getWebSockets().length,
  );
}

/** Wait until the room's own list of sockets is `count` long. */
export async function roomHolds(
  boardId: string,
  count: number,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await roomSockets(boardId)) === count) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for the room to hold ${count} socket(s)`,
      );
    }
    await delay(10);
  }
}

/** A note through the real model, centred on a world point; returns its id. */
export function createNote(
  client: BoardClient,
  at: { x: number; y: number },
): string {
  const id = client.edit(() => createSticky(client.doc, at));
  if (typeof id !== "string")
    throw new Error(`createSticky refused ${JSON.stringify(at)}`);
  return id;
}

/** Move a note to a world point (top-left, as the model stores it). */
export function moveNote(
  client: BoardClient,
  id: string,
  x: number,
  y: number,
): void {
  client.edit(() => moveObject(client.doc, id, x, y));
}

/** Give a note another of the colours the product offers. */
export function recolourNote(
  client: BoardClient,
  id: string,
  color: StickyColor,
): void {
  client.edit(() => setStickyColor(client.doc, id, color));
}

/** Delete a note; `false` means it was not there (already deleted elsewhere). */
export function deleteNote(client: BoardClient, id: string): boolean {
  return client.edit(() => deleteObject(client.doc, id));
}

/** Type at a position of a note's text (default: the end). */
export function typeInNote(
  client: BoardClient,
  id: string,
  text: string,
  at?: number,
): void {
  client.edit(() => {
    const yText = getStickyText(client.doc, id);
    if (!yText) throw new Error(`no text on note ${id}`);
    yText.insert(at ?? yText.length, text);
  });
}

/**
 * The payload of one incoming frame as an `ArrayBuffer`. workerd delivers binary
 * frames as a `Blob`; the other shapes are what the type of the event allows, so
 * all of them are handled instead of assumed, and nothing at all becomes an
 * empty frame (which `decodeMessage` reports as invalid).
 */
async function frameBuffer(data: unknown): Promise<ArrayBuffer> {
  if (data instanceof Blob) return data.arrayBuffer();
  if (data instanceof ArrayBuffer) return data;
  if (typeof data === "string" || ArrayBuffer.isView(data)) {
    const bytes =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data.buffer as ArrayBuffer);
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
  }
  return new ArrayBuffer(0);
}

function copy(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
