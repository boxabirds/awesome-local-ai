/**
 * WebSocket clients for the integration tests.
 *
 * `RoomSocket` is the raw end of a real upgrade: `SELF.fetch` is the Worker's own
 * service binding, so an upgrade goes through the real route handler, the real
 * Durable Object and workerd's real WebSocket implementation. Nothing is mocked.
 *
 * `WsClient` is a stand-in browser tab on top of it: a real `Y.Doc` plus exactly the
 * frames a real `y-websocket` client sends, in the same framing — but with no
 * reconnect timers, so a test can hold a message back, send a hand-made frame, or go
 * offline and know precisely what the room saw.
 */

import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { newBoardId } from '../../../src/shared/board-id';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import {
  MESSAGE_SYNC,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeMessage,
  encodeAwarenessMessage,
  encodeVarUint,
  encodeVarUint8Array,
} from '../../../src/shared/protocol';

/** The origin the tests address the Worker by. */
export const ORIGIN = 'https://vidi6.test';

/** One binary frame as it crossed the wire. */
export type Frame = Uint8Array;

/** The runtime exposes the ready states as numbers, not as constants. */
export const READY_STATES = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } as const;

/** How a socket ended. */
export interface SocketClose {
  code: number;
  reason: string;
  wasClean: boolean;
}

/** A call waiting for the next frame. */
interface Waiter {
  resolve(frame: Frame): void;
  reject(error: Error): void;
}

/**
 * A raw WebSocket to `/api/rooms/<boardId>`, recording every frame it receives so a
 * test can assert on exactly what the room sent to whom.
 */
export class RoomSocket {
  /** The board this socket is connected to. */
  readonly boardId: string;
  /** The client end of the connection. */
  readonly socket: WebSocket;
  /** Every frame received from the room, in order. */
  readonly frames: Frame[] = [];

  private consumed = 0;
  private waiters: Waiter[] = [];
  private closePromise: Promise<SocketClose>;
  private closedWith: SocketClose | null = null;

  private constructor(boardId: string, socket: WebSocket) {
    this.boardId = boardId;
    this.socket = socket;
    this.closePromise = new Promise<SocketClose>((resolve) => {
      socket.addEventListener('close', (event) => {
        const close = {
          code: (event as CloseEvent).code,
          reason: (event as CloseEvent).reason,
          wasClean: (event as CloseEvent).wasClean,
        };
        this.closedWith = close;
        resolve(close);
        // Nobody should have to wait for a frame that can no longer arrive.
        for (const waiter of this.waiters) {
          waiter.reject(new Error(`socket closed (${close.code} ${close.reason})`));
        }
        this.waiters = [];
      });
    });
    socket.addEventListener('message', (event) => {
      const frame = toFrame((event as MessageEvent).data);
      const index = this.frames.length;
      this.frames.push(frame);
      const waiter = this.waiters.shift();
      if (waiter) {
        // This frame is spoken for now: do not hand it out again from `received()`.
        this.consumed = Math.max(this.consumed, index + 1);
        waiter.resolve(frame);
      }
    });
  }

  /** Opens a WebSocket to `/api/rooms/<boardId>` through the Worker. */
  static async connect(boardId: string = newBoardId()): Promise<RoomSocket> {
    const response = await SELF.fetch(
      new Request(`${ORIGIN}/api/rooms/${boardId}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    );
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      throw new Error(`websocket upgrade to board ${boardId} failed: ${response.status}`);
    }
    socket.binaryType = 'arraybuffer';
    const room = new RoomSocket(boardId, socket);
    socket.accept();
    return room;
  }

  /** True while the socket is still open. */
  get isOpen(): boolean {
    return this.closedWith === null && this.socket.readyState <= READY_STATES.OPEN;
  }

  /** True once the socket is closed. */
  get isClosed(): boolean {
    return this.closedWith !== null || this.socket.readyState > READY_STATES.OPEN;
  }

  /** Sends one frame. Throws when the socket is gone, which tests rely on. */
  send(bytes: Uint8Array): void {
    this.socket.send(bytes);
  }

  /** Sends a text frame, which this protocol has no meaning for. */
  sendText(text: string): void {
    this.socket.send(text);
  }

  /** Closes the socket from this side. */
  close(code?: number, reason?: string): void {
    if (this.socket.readyState <= READY_STATES.CLOSING) this.socket.close(code, reason);
  }

  /** How the socket ended; resolves even when the room closed it. */
  closed(): Promise<SocketClose> {
    return this.closePromise;
  }

  /**
   * The next frame from the room, waiting for it if none has arrived yet. Pass 0 to
   * wait as long as the socket is open: a quiet connection is not a dead one, and the
   * close event rejects the wait either way.
   */
  nextFrame(timeoutMs = 5000): Promise<Frame> {
    const pending = this.frames.slice(this.consumed);
    if (pending.length > 0) {
      const first = pending[0] as Frame;
      this.consumed += 1;
      return Promise.resolve(first);
    }
    return new Promise<Frame>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (frame) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(frame);
        },
        reject,
      };
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.waiters = this.waiters.filter((pending) => pending !== waiter);
        reject(new Error(`no frame from the room within ${timeoutMs}ms (board ${this.boardId})`));
      }, timeoutMs) : undefined;
      this.waiters.push(waiter);
    });
  }

  /** Frames received since the last call, in order. */
  received(): Frame[] {
    const fresh = this.frames.slice(this.consumed);
    this.consumed = this.frames.length;
    return fresh;
  }

  /**
   * Waits until no frame has arrived for `quietMs`. The room has no timers and no
   * batching, so whatever a frame causes comes back in one round trip; after this the
   * socket is genuinely quiet.
   */
  async settle(quietMs = 40): Promise<void> {
    let seen = this.frames.length;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, quietMs));
      if (this.frames.length === seen || this.isClosed) return;
      seen = this.frames.length;
    }
  }
}

/** Indexes a list a test knows the length of. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected at least ${index + 1} items, got ${items.length}`);
  return item;
}

/** Opens `count` sockets on one board. */
export async function connectSockets(boardId: string, count: number): Promise<RoomSocket[]> {
  const sockets: RoomSocket[] = [];
  for (let index = 0; index < count; index++) sockets.push(await RoomSocket.connect(boardId));
  return sockets;
}

/** What a `WsClient` got from the room, as the client understood it. */
export type ReceivedMessage =
  | { kind: 'sync-step-1' }
  | { kind: 'sync-step-2' }
  | { kind: 'update'; update: Uint8Array }
  | { kind: 'awareness'; update: Uint8Array };

/**
 * A browser tab, minus the timers: a real `Y.Doc` that speaks the real protocol with
 * the room. Frames it receives are applied with the client as the transaction
 * origin, so nothing is ever echoed back — the same guard `y-websocket` uses.
 */
export class WsClient {
  /** The board this client is on. */
  boardId: string;
  /** The raw socket behind this client, for frame-level assertions. */
  get rawSocket(): RoomSocket {
    const socket = this.socket;
    if (!socket) throw new Error(`client for board ${this.boardId} is not connected`);
    return socket;
  }
  /** This client's copy of the board. */
  readonly doc = new Y.Doc();
  /** Everything the room has sent, in order. */
  readonly received: ReceivedMessage[] = [];
  /** Everything sent to the room, in order. */
  readonly sent: Frame[] = [];
  /** Resolves once the current connection is open. */
  connected: Promise<void>;

  private socket: RoomSocket | null = null;
  #online = false;

  private constructor(boardId: string) {
    this.boardId = boardId;
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this && this.#online) this.sendUpdate(update);
    });
    this.connected = this.open(boardId);
  }

  /** Connects a client to `boardId` and starts answering the room. */
  static async connect(boardId: string = newBoardId()): Promise<WsClient> {
    const client = new WsClient(boardId);
    await client.connected;
    return client;
  }

  /** True while the client has a live socket. */
  get online(): boolean {
    return this.#online;
  }

  /**
   * Completes a sync with the room: asks what the room has that we do not, and waits
   * for the answer. After this the client's board matches the room's, because Yjs
   * did the merging.
   */
  async waitForSync(): Promise<void> {
    this.sendSyncStep1();
    await this.settle();
  }

  /** The board as this client sees it. */
  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Runs `edit` as one local transaction, which sends it to the room. */
  transact(edit: (doc: Y.Doc) => void): void {
    this.doc.transact(() => edit(this.doc), this);
  }

  /** Ends the connection; the doc and everything in it survive. */
  disconnect(): void {
    this.#online = false;
    this.socket?.close();
  }

  /** Comes back with the same doc — how a tab that was away returns. */
  async reconnect(): Promise<void> {
    this.connected = this.open(this.boardId);
    await this.connected;
  }

  /**
   * Comes back on a different room instance with the same doc. A client cannot tell a
   * restarted room from its own board — same URL, same protocol, an empty document on
   * the other side — so this is how a test drives the restart case.
   */
  async reconnectTo(boardId: string): Promise<void> {
    this.boardId = boardId;
    this.connected = this.open(boardId);
    await this.connected;
  }

  /** Forgets what has been received so far, to count only what comes next. */
  clearReceived(): void {
    this.received.length = 0;
  }

  /** Sends a SyncStep1 for this client's current state. */
  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Sends a Yjs update as a `sync`/`update` frame. */
  sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Sends an awareness frame; the room only ever relays these. */
  sendAwareness(update: Uint8Array): void {
    this.send(encodeAwarenessMessage(update));
  }

  /** Sends bytes a real client could never have produced. */
  sendRaw(bytes: Uint8Array): void {
    this.send(bytes);
  }

  /** Waits until this client has processed everything the room sent. */
  async settle(quietMs = 40): Promise<void> {
    for (;;) {
      const socket = this.socket;
      if (!socket) return;
      await socket.settle(quietMs);
      if (this.socket === socket) return;
    }
  }

  /** Opens the connection; resolves once it is up, while the read loop keeps running. */
  private async open(boardId: string): Promise<void> {
    const socket = await RoomSocket.connect(boardId);
    this.socket = socket;
    this.#online = true;
    void this.readLoop(socket);
  }

  /** Reads frames until the connection ends, answering each one as we go. */
  private async readLoop(socket: RoomSocket): Promise<void> {
    for (;;) {
      let frame: Frame;
      try {
        // No timeout here: this loop is the client's whole life on the wire, and it
        // ends when the socket ends.
        frame = await socket.nextFrame(0);
      } catch {
        if (socket.isClosed && this.socket === socket) this.#online = false;
        return; // closed: offline until the next `reconnect()`
      }
      if (!this.#online || this.socket !== socket) return;
      let message: ReceivedMessage | null = null;
      try {
        message = this.handle(frame);
      } catch {
        // A frame this client cannot make sense of is skipped; the room is the one
        // that decides whether the sender of that frame gets closed.
        continue;
      }
      if (message) this.received.push(message);
    }
  }

  /** Applies one frame to this client's doc and answers it if the protocol says so. */
  private handle(frame: Frame): ReceivedMessage | null {
    const decoded = decodeMessage(copyBuffer(frame));
    if (decoded.kind === 'invalid') return null;
    if (decoded.kind === 'awareness') return { kind: 'awareness', update: decoded.payload };
    if (decoded.kind === 'query-awareness') return null;

    const subType = readSyncSubType(decoded.payload);
    if (subType !== SYNC_STEP_1 && subType !== SYNC_STEP_2 && subType !== SYNC_UPDATE) return null;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    if (subType === SYNC_STEP_1) {
      // The room wants to know what we have; we answer with everything it is missing.
      // This is also how a client that was away delivers what it changed while away.
      const stateVector = readBody(decoded.payload);
      if (stateVector.byteLength === 0) {
        // A state vector is never empty in this protocol, and Yjs throws on one. "I
        // have nothing" is answered with a full update, which merges the same way.
        encoding.writeVarUint(encoder, SYNC_UPDATE);
        encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(this.doc));
      } else {
        syncProtocol.writeSyncStep2(encoder, this.doc, stateVector);
      }
    } else {
      // Applied with this client as the origin, so it is not sent back out again.
      syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, this.doc, this);
    }

    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1) this.send(reply);

    if (subType === SYNC_STEP_1) return { kind: 'sync-step-1' };
    if (subType === SYNC_STEP_2) return { kind: 'sync-step-2' };
    return { kind: 'update', update: readBody(decoded.payload) };
  }

  private send(bytes: Uint8Array): void {
    this.sent.push(bytes);
    try {
      this.socket?.send(bytes);
    } catch {
      // Offline. A real client keeps the change in its doc too, and the next
      // SyncStep1 carries it to the room.
    }
  }
}

/** Builds a `sync` frame of a given sub-type around a body. */
export function syncFrame(subType: number, body: Uint8Array): Frame {
  return new Uint8Array([
    ...encodeVarUint(MESSAGE_SYNC),
    ...encodeVarUint(subType),
    ...encodeVarUint8Array(body),
  ]);
}

/** Builds a `sync`/`update` frame around a Yjs update. */
export function updateFrame(update: Uint8Array): Frame {
  return syncFrame(SYNC_UPDATE, update);
}

/** Builds an awareness frame around an opaque awareness update. */
export function awarenessFrame(update: Uint8Array): Frame {
  return encodeAwarenessMessage(update);
}

/** The `y-protocols/sync` sub-type of a decoded sync payload, or -1. */
function readSyncSubType(payload: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return -1;
  }
}

/** The body inside a SyncStep1 (state vector) or SyncStep2/update (update) payload. */
function readBody(payload: Uint8Array): Uint8Array {
  try {
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder); // sub-type
    return decoding.readVarUint8Array(decoder);
  } catch {
    return new Uint8Array(0);
  }
}

/** A copy of a frame in its own `ArrayBuffer`, as `decodeMessage` wants it. */
function copyBuffer(frame: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(frame.byteLength);
  copy.set(frame);
  return copy.buffer;
}

/** A frame's bytes as they arrived, from whatever shape the runtime delivered. */
function toFrame(data: unknown): Frame {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}
