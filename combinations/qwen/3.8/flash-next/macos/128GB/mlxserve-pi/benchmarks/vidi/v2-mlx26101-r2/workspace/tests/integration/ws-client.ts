/**
 * A client for the integration tests: a real `WebSocket` out of the Workers
 * runtime, a real `Y.Doc`, and the same `y-protocols` framing the browser
 * provider uses — so the room is tested against the protocol rather than
 * against a mock of it.
 *
 * It is deliberately *not* `WebsocketProvider`: the assertions are about the
 * wire (which bytes arrive on which socket, in what order, with which close
 * code), and a test built on the browser provider could not see that. Where the
 * room's behaviour is the same either way, the handshake below mirrors
 * `WebsocketProvider`'s `readMessage`/`onopen` exactly, so the room cannot tell
 * the difference.
 */

import { SELF, env } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeSyncStep1,
  writeSyncStep2,
  writeUpdate,
} from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';

import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model.js';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol.js';

/** How long a wait for a message gives up after. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** What a received frame turned out to be. */
export type FrameKind =
  | 'sync-step1'
  | 'sync-step2'
  | 'update'
  | 'awareness'
  | 'query-awareness'
  | 'invalid';

export interface Client {
  /** The runtime's WebSocket. */
  ws: WebSocket;
  /** The client's document, kept in step with the room. */
  doc: Y.Doc;
  /** Awareness of this client (the room relays it back, and to everyone else). */
  awareness: Awareness;
  /** Every frame received so far, oldest first — the received-message log. */
  readonly received: Uint8Array[];
  /** Why the socket closed, once it has. */
  readonly closed: { code: number; reason: string } | undefined;
  /** Send raw bytes (a malformed frame, a text frame, whatever a test needs). */
  send(data: Uint8Array | ArrayBuffer | string): void;
  /** Pop the next frame nobody has claimed yet, waiting up to `ms` for one. */
  expectMessage(ms?: number): Promise<Uint8Array>;
  /** The next frame, and nothing else may have arrived in the meantime. */
  expectFrame(kind: FrameKind, ms?: number): Promise<Uint8Array>;
  /** Fail if anything arrives within `ms`; resolve if the line stays quiet. */
  expectNothing(ms: number): Promise<void>;
  /** Wait for the socket to close and check the close code. */
  expectClose(code?: number, ms?: number): Promise<void>;
  /** Wait for the socket to *stay* open. */
  expectOpen(ms: number): Promise<void>;
  /** Finish the sync handshake: both sides have sent what the other lacked. */
  waitForSync(ms?: number): Promise<void>;
  /** Stop sending local changes and keep them for `flush` (concurrent edits). */
  mute(): void;
  /** Start sending local changes again. */
  unmute(): void;
  /** Send what was captured while muted, one update frame each, in order. */
  flush(ms?: number): Promise<void>;
  /** The board as this client sees it. */
  snapshot(): readonly StickySnapshot[];
  /** Frames received since the last `since` (or from the start), as kinds. */
  kinds(since?: number): FrameKind[];
  /** Ignore everything received so far: the next frame to look at is a new one. */
  mark(): number;
  /** Close from this side. */
  close(code?: number, reason?: string): void;
  /** Every frame received since the mark `since`, as bytes. */
  framesSince(since: number): Uint8Array[];
}

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The body of a frame, without its outer message-type varuint. */
export function bodyOf(frame: Uint8Array): Uint8Array {
  return frame.subarray(1);
}

/** A `y-protocols/sync` frame: `[MESSAGE_SYNC, <sync message>]`. */
export function syncFrame(write: (body: encoding.Encoder) => void): Uint8Array {
  const body = encoding.encode(write);
  const frame = new Uint8Array(body.byteLength + 1);
  frame[0] = MESSAGE_SYNC;
  frame.set(body, 1);
  return frame;
}

/** An awareness update frame, exactly as the browser provider writes it. */
export function awarenessFrame(awareness: Awareness, clients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
}

/** An awareness query frame: the message type and nothing else. */
export function queryAwarenessFrame(): Uint8Array {
  return new Uint8Array([MESSAGE_QUERY_AWARENESS]);
}

/** A frame as the runtime wants it to be sent: a buffer or a string. */
function asSendable(data: Uint8Array | ArrayBuffer | string): ArrayBuffer | string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  return (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.slice().buffer) as ArrayBuffer;
}

/** A standalone copy of a frame's bytes, which is what a WebSocket message holds. */
function bufferOf(frame: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(frame.byteLength);
  copy.set(frame);
  return copy.buffer;
}

/** What a frame is, without applying it. Never throws. */
export function classify(frame: Uint8Array): FrameKind {
  const decoded = decodeMessage(bufferOf(frame));
  if (decoded.kind !== 'sync') return decoded.kind === 'invalid' ? 'invalid' : decoded.kind;
  const inner = decoding.createDecoder(decoded.payload);
  try {
    switch (decoding.readVarUint(inner)) {
      case messageYjsSyncStep1:
        return 'sync-step1';
      case messageYjsSyncStep2:
        return 'sync-step2';
      case messageYjsUpdate:
        return 'update';
      default:
        return 'invalid';
    }
  } catch {
    return 'invalid';
  }
}

class FakeClient implements Client {
  readonly received: Uint8Array[] = [];
  readonly awareness: Awareness;

  private cursor = 0;
  private readonly waiters: ((message: Uint8Array) => void)[] = [];
  private readonly closers: ((ok: boolean) => void)[] = [];
  private synced = false;
  private syncPromise: Promise<void> | undefined;
  private muted = false;
  private captured: Uint8Array[] = [];
  private readonly onLocalUpdate: (update: Uint8Array, origin: unknown) => void;

  closed: { code: number; reason: string } | undefined;

  constructor(
    readonly ws: WebSocket,
    readonly doc: Y.Doc,
  ) {
    this.awareness = new Awareness(doc);
    ws.binaryType = 'arraybuffer';
    // The provider's `bindState`: a change made here goes to the room as one
    // update frame, and a change that arrived from the room does not go back out.
    this.onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === 'remote') return;
      if (this.muted) this.captured.push(update);
      else this.send(updateFrame(update));
    };
    doc.on('update', this.onLocalUpdate);
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      const frame =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : new Uint8Array(data as ArrayBuffer);
      this.received.push(frame);
      this.waiters.shift()?.(frame);
      // The provider's `onmessage`: every frame is read into the document, during
      // the handshake and afterwards — an update that arrives while nobody is
      // waiting for it is exactly what a live board is made of.
      try {
        this.read(frame);
      } catch {
        // A frame this client cannot read is the room's problem, not this one's.
      }
    });
    ws.addEventListener('close', (event: Event) => {
      // workerd reports the peer's close code on the close event; the socket's
      // own `closeCode` stays unset on this path.
      const close = event as CloseEvent & { code?: number; reason?: string };
      this.closed = {
        code:
          typeof close.code === 'number'
            ? close.code
            : ((ws as WebSocket & { closeCode?: number }).closeCode ?? 0),
        reason:
          typeof close.reason === 'string'
            ? close.reason
            : ((ws as WebSocket & { closeReason?: string }).closeReason ?? ''),
      };
      this.closers.splice(0).forEach((done) => done(true));
    });
    // The socket from a `SELF.fetch` upgrade is one end of a WebSocket pair, and
    // workerd wants it accepted before it carries traffic. The listeners are
    // already on, so nothing that arrives is missed.
    if (typeof (ws as WebSocket & { accept?: () => void }).accept === 'function') {
      (ws as WebSocket & { accept: () => void }).accept();
    }
  }

  send(data: Uint8Array | ArrayBuffer | string): void {
    this.ws.send(asSendable(data));
  }

  expectMessage(ms = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
    if (this.received.length > this.cursor) {
      return Promise.resolve(this.received[this.cursor++]);
    }
    return new Promise((resolve, reject) => {
      const take = (message: Uint8Array): void => {
        clearTimeout(timer);
        this.cursor += 1;
        resolve(message);
      };
      const timer = setTimeout(() => {
        const at = this.waiters.indexOf(take);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(
          new Error(
            `no message within ${ms}ms (${this.received.length} received, ` +
              `${JSON.stringify(this.received.map((f) => classify(f)))})`,
          ),
        );
      }, ms);
      this.waiters.push(take);
    });
  }

  async expectFrame(kind: FrameKind, ms = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
    const frame = await this.expectMessage(ms);
    const actual = classify(frame);
    if (actual !== kind) {
      throw new Error(`expected a ${kind} frame, got ${actual} (${JSON.stringify(Array.from(frame.slice(0, 8)))})`);
    }
    return frame;
  }

  async expectNothing(ms: number): Promise<void> {
    // Polled rather than queued, so it never steals a message from a waiting
    // expectMessage: "nothing arrived" is a statement about the whole window.
    const before = this.received.length;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (this.received.length > before) {
        throw new Error(
          `expected silence for ${ms}ms, but got ${JSON.stringify(
            this.received.slice(before).map((f) => classify(f)),
          )}`,
        );
      }
    }
  }

  expectClose(code?: number, ms = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.closed !== undefined) return this.checkClose(code);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `socket still open after ${ms}ms (readyState ${this.ws.readyState}, ` +
                `${this.received.length} frame(s) received)`,
            ),
          ),
        ms,
      );
      this.closers.push((closed) => {
        clearTimeout(timer);
        if (!closed) reject(new Error('socket did not close'));
        else void this.checkClose(code).then(resolve, reject);
      });
    });
  }

  async expectOpen(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (this.closed !== undefined) {
        throw new Error(`socket closed with ${this.closed.code} (${this.closed.reason})`);
      }
    }
    if (this.ws.readyState !== WebSocket.READY_STATE_OPEN) {
      throw new Error(`socket is not open (readyState ${this.ws.readyState})`);
    }
  }

  private checkClose(code?: number): Promise<void> {
    if (code !== undefined && this.closed?.code !== code) {
      throw new Error(`closed with code ${this.closed?.code}, expected ${code}`);
    }
    return Promise.resolve();
  }

  /**
   * The y-websocket handshake, and then wait until it is complete.
   *
   * Like the browser provider, this does not wait for the room's SyncStep1
   * before sending its own: both sides ask, both sides answer, and the exchange
   * is over once a SyncStep2 has come back. Every frame that arrives in the
   * meantime is read the way the provider reads it, so replies are written back
   * on the same socket.
   */
  waitForSync(ms = DEFAULT_TIMEOUT_MS): Promise<void> {
    this.syncPromise ??= new Promise<void>((resolve, reject) => {
      // Our own SyncStep1, straight away — the provider does not wait for the
      // room's question before asking its own, and that is what lets a restarted
      // room be refilled by whoever connects first.
      this.send(syncFrame((body) => writeSyncStep1(body, this.doc)));
      const timer = setTimeout(() => {
        clearInterval(looked);
        reject(new Error(`not synced within ${ms}ms (${this.received.length} frames seen)`));
      }, ms);
      const looked = setInterval(() => {
        if (!this.synced) return;
        clearInterval(looked);
        clearTimeout(timer);
        // Everything of the handshake has been read into the document by the
        // message listener; a test's assertions start from what comes after it.
        this.cursor = this.received.length;
        resolve();
      }, 10);
    });
    return this.syncPromise;
  }

  /**
   * Read one frame into this client's document — `readSyncMessage` for a sync
   * frame, `applyAwarenessUpdate` for an awareness one — and return the reply to
   * send back, or `null` when there is nothing to say. This is the provider's
   * `readMessage`, and it is what makes the two documents converge.
   */
  read(frame: Uint8Array): Uint8Array | null {
    const decoded = decodeMessage(bufferOf(frame));
    if (decoded.kind === 'invalid') return null;
    if (decoded.kind === 'awareness') {
      try {
        applyAwarenessUpdate(this.awareness, decoded.payload, 'remote');
      } catch {
        // A malformed awareness update is not this client's document's problem.
      }
      return null;
    }
    if (decoded.kind === 'query-awareness') return null;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const type = readSyncMessage(
      decoding.createDecoder(decoded.payload),
      encoder,
      this.doc,
      'remote',
    );
    if (type === messageYjsSyncStep2 && !this.synced) this.synced = true;
    if (encoding.length(encoder) <= 1) return null;
    const reply = encoding.toUint8Array(encoder);
    this.send(reply);
    return reply;
  }

  mute(): void {
    this.muted = true;
  }

  unmute(): void {
    this.muted = false;
  }

  async flush(ms = 50): Promise<void> {
    const pending = this.captured;
    this.captured = [];
    for (const update of pending) {
      this.send(updateFrame(update));
      await nextTick();
    }
    // Let the room answer them, so the next assertion is not a race.
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  kinds(since = 0): FrameKind[] {
    return this.received.slice(since).map(classify);
  }

  /**
   * Where the assertions start: everything received up to now is behind the test,
   * so the next `expectMessage` is a frame that arrives after this point rather
   * than one the document has already absorbed.
   */
  mark(): number {
    this.cursor = this.received.length;
    return this.cursor;
  }

  framesSince(since: number): Uint8Array[] {
    return this.received.slice(since);
  }

  close(code?: number, reason?: string): void {
    // The provider's `destroy`: this client stops caring about the document, so a
    // client built on the same document afterwards (a reconnection) is the only
    // one left sending.
    this.doc.off('update', this.onLocalUpdate);
    if (this.ws.readyState === WebSocket.READY_STATE_CLOSED) return;
    this.ws.close(code, reason);
    // A socket closed from this side is gone for the test's purposes too.
    this.closed ??= { code: code ?? 1005, reason: reason ?? '' };
  }
}

/**
 * Make a board with exactly this id, the way `POST /api/boards` does it: the same
 * `initialize()` RPC, on the same object the socket will reach.
 *
 * Story 5 is why these tests need it. Until then a board came into being when a
 * client connected to its address, so a test could invent an id and connect to it;
 * now the room refuses a board nobody created — which is the whole of
 * `share.not_found` — and a test that wants a room has to create the board first,
 * exactly as the home page does. The id still comes from the test, because these
 * tests are about which room answers, not about who picked the address.
 */
export async function createBoard(boardId: string): Promise<'created' | 'exists'> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).initialize();
}

/**
 * Connect to a board through the Worker entry the way a browser does — an
 * `Upgrade: websocket` fetch of `/api/rooms/:boardId` — with a document that is
 * set up the way `useBoardDoc` sets its own up.
 *
 * The board is created first, because a browser could not connect to a board that
 * was never created and a test that pretended otherwise would be testing a 404.
 */
export async function connectClient(boardId: string, doc?: Y.Doc): Promise<Client> {
  const boardDoc = doc ?? new Y.Doc();
  if (doc === undefined) initDoc(boardDoc);
  await createBoard(boardId);
  const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = response.webSocket;
  if (response.status !== 101 || ws === null || ws === undefined) {
    throw new Error(`expected 101 from /api/rooms/${boardId}, got ${response.status}`);
  }
  return new FakeClient(ws, boardDoc);
}

/**
 * Connect and finish the handshake, which is the state a browser provider is in
 * once it can see the board: most tests start here.
 */
export async function syncedClient(boardId: string, doc?: Y.Doc): Promise<Client> {
  const client = await connectClient(boardId, doc);
  await client.waitForSync();
  return client;
}

/** A connection to a board that is not upgraded (for the 426 and 400 cases). */
export function requestRoom(boardId: string, upgrade = false): Promise<Response> {
  return SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: upgrade ? { Upgrade: 'websocket' } : {},
  });
}

/** An update frame carrying `update`, as a client sends it after a local change. */
export function updateFrame(update: Uint8Array): Uint8Array {
  return syncFrame((body) => writeUpdate(body, update));
}

/** A SyncStep1 frame for `doc` (what a client sends when it opens). */
export function syncStep1Frame(doc: Y.Doc): Uint8Array {
  return syncFrame((body) => writeSyncStep1(body, doc));
}

/** A SyncStep2 frame with everything `doc` has that `stateVector` lacks. */
export function syncStep2Frame(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  return syncFrame((body) => writeSyncStep2(body, doc, stateVector));
}

/** Wait until `check` stops throwing, or give up and rethrow it. */
export async function eventually<T>(
  check: () => T | Promise<T>,
  { ms = 5_000, every = 25, what = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) throw new Error(`${what} not met within ${ms}ms: ${String(last)}`);
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

/** The text of a note, by id, from a board snapshot. */
export function textOf(
  board: readonly { id: string; text: string }[],
  id: string,
): string | undefined {
  return board.find((note) => note.id === id)?.text;
}

/** A frame that is well-framed sync but whose Yjs update cannot be applied. */
export function brokenUpdateFrame(): Uint8Array {
  return syncFrame((body) => {
    encoding.writeVarUint(body, messageYjsUpdate);
    encoding.writeVarUint8Array(body, new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02]));
  });
}

export { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC };
