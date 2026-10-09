/**
 * A test participant: a real `Y.Doc` speaking y-protocols over a real WebSocket that
 * `SELF.fetch` upgraded on the Worker.
 *
 * The framing is identical to `y-websocket`'s (`varUint(type)`, then the y-protocols
 * message, awareness length-prefixed), but nothing else is: there is no reconnect
 * backoff, no awareness renewal and no watchdog, so a test can hold a socket open,
 * watch every frame, edit while disconnected (TC-09 to TC-11) and send bytes no browser
 * would ever send (TC-15).
 */
import { env, SELF } from 'cloudflare:test';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../../src/shared/board-model';
import type { StickySnapshot } from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../src/shared/protocol';

/** One frame as it arrived on the socket. */
export interface ReceivedFrame {
  type: number;
  /** The y-protocols message inside the frame, with any length prefix removed. */
  payload: Uint8Array;
  /** The frame exactly as it arrived, for asserting the room relayed it verbatim. */
  raw: Uint8Array;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

/** `varUint(type) + payload`: the y-websocket framing of a y-protocols message. */
export function syncFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** A y-protocols `SyncStep1` for `doc`, ready to put on a socket. */
export function syncStep1Frame(doc: Y.Doc): Uint8Array {
  return syncFrame(write((encoder) => syncProtocol.writeSyncStep1(encoder, doc)));
}

/** The update `update` wrapped as a y-protocols `Update` message. */
export function updateFrame(update: Uint8Array): Uint8Array {
  return syncFrame(write((encoder) => syncProtocol.writeUpdate(encoder, update)));
}

/**
 * `varUint(MESSAGE_AWARENESS) + varUint(length) + update`: the framing `y-protocols`'
 * `writeAwarenessMessage` uses, which is what `y-websocket` puts on the wire.
 */
export function awarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function queryAwarenessFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

/**
 * A well-formed `y-protocols` awareness update: one added client with a clock and a
 * user field, nothing changed and nothing removed. Written out rather than encoded by
 * `y-protocols` because an `Awareness` needs a `Y.Doc` to hang its lifecycle on, and a
 * relay test has no use for one.
 */
export function awarenessUpdate(clientId: number, clock: number, name: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // clients added
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify({ user: { name } }));
  encoding.writeVarUint(encoder, 0); // clients changed
  encoding.writeVarUint(encoder, 0); // clients removed
  return encoding.toUint8Array(encoder);
}

function write(write_: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write_(encoder);
  return encoding.toUint8Array(encoder);
}

function concat(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
}

export class TestClient {
  readonly frames: ReceivedFrame[] = [];
  readonly closes: CloseInfo[] = [];
  readonly doc = new Y.Doc();
  readonly log: string[] = [];
  /** Index into `frames` a test can mark, to count only what came after. */
  private since = 0;
  private socket: WebSocket | null = null;
  private boardId = '';
  private next: (() => void)[] = [];

  private constructor() {
    // Everything this doc does goes to the room, the way `y-websocket` forwards it.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'from-room') return;
      this.send(updateFrame(update));
    });
  }

  /**
   * Open a socket to the room for `boardId` through the Worker and shake hands.
   *
   * Story 5 turned a board into something that has to exist before its room answers, so
   * a test's board is created the way a person's is — one `initialize()` RPC on its own
   * room object — unless the test is precisely about a board nobody created, which says
   * `{ create: false }`.
   */
  static async connect(
    boardId: string,
    options: { create?: boolean } = {},
  ): Promise<TestClient> {
    const client = new TestClient();
    if (options.create !== false) await createBoardRoom(boardId);
    await client.open(boardId);
    return client;
  }

  /** Upgrade a socket. Re-opening after `close()` reuses this client's document. */
  async open(boardId = this.boardId): Promise<void> {
    if (this.socket !== null) throw new Error('this client already has a socket open');
    this.boardId = boardId;
    const response = await SELF.fetch(`http://vc.test/api/rooms/${boardId}`, {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    if (response.status !== 101) {
      throw new Error(`expected the room to answer 101, got ${response.status}`);
    }
    const socket = response.webSocket;
    if (!socket) throw new Error('the 101 carried no WebSocket');
    // workerd hands the socket over unaccepted, and an unaccepted socket can neither
    // send nor deliver messages, so the client side accepts it first.
    socket.accept();
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent) => {
      this.receive(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closes.push({ code: event.code, reason: event.reason });
      this.socket = null;
      this.wake();
    });
    socket.addEventListener('error', () => {
      this.log.push('socket error');
      this.wake();
    });
    // The room opens with its own SyncStep1; answering it is the full handshake, and
    // answering is what puts this client's local state into the room (TC-18).
    this.send(syncStep1Frame(this.doc));
  }

  send(bytes: Uint8Array | string): void {
    const socket = this.socket;
    if (socket === null) {
      this.log.push('send dropped: no socket (offline on purpose)');
      return;
    }
    try {
      if (typeof bytes === 'string') {
        socket.send(bytes);
        return;
      }
      // Always hand over a standalone ArrayBuffer, never a view into a longer buffer.
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      socket.send(copy.buffer as ArrayBuffer);
    } catch (error) {
      this.log.push(`send failed: ${String(error)}`);
    }
  }

  /** Raw bytes, including text frames and bytes that do not decode (TC-15). */
  sendRaw(bytes: Uint8Array | string): void {
    this.send(bytes);
  }

  get readyState(): number {
    return this.socket?.readyState ?? WebSocket.CLOSED;
  }

  get isOpen(): boolean {
    return this.readyState === WebSocket.OPEN;
  }

  /** Close the socket and wait for the close event, so the next step is not a race. */
  async close(): Promise<void> {
    if (this.socket === null) return;
    const socket = this.socket;
    const closes = this.closes.length;
    socket.close();
    try {
      await this.waitUntil('the socket to close', () => this.closes.length > closes, 2000);
    } catch {
      // The local runner does not send the close-frame echo for a hibernatable socket
      // (the Cloudflare edge and every real browser do, and the room side has already
      // removed the socket — asserted directly in TC-31). The connection is gone
      // either way, so forget the socket and let the test reopen.
    }
    if (this.socket === socket) this.socket = null;
  }

  /** Abrupt hang-up, the way a dropped connection looks to the room (TC-31). */
  terminate(): void {
    // A close code the room never expects, which is the closest a client socket gets to
    // pulling the cable: the room learns about it from the socket, not from us.
    this.socket?.close(1011, 'client went away');
  }

  /** Remember where the frame log is now, so `updates()` counts only what comes next. */
  mark(): void {
    this.since = this.frames.length;
  }

  /** `y-protocols Update` messages received since the last `mark()`. */
  updates(): number {
    return this.frames
      .slice(this.since)
      .filter(
        (frame) =>
          frame.type === MESSAGE_SYNC && frame.payload[0] === syncProtocol.messageYjsUpdate,
      )
      .length;
  }

  countFrames(type: number): number {
    return this.frames.filter((frame) => frame.type === type).length;
  }

  /** The awareness updates this client received, in order. */
  awarenessUpdates(): Uint8Array[] {
    return this.frames
      .filter((frame) => frame.type === MESSAGE_AWARENESS)
      .map((frame) => frame.payload);
  }

  /** Every awareness frame relayed to this client, concatenated: verbatim checks. */
  relayedAwareness(): Uint8Array {
    return concat(
      this.frames.filter((frame) => frame.type === MESSAGE_AWARENESS).map((frame) => frame.raw),
    );
  }

  /** The board as the model sees it, straight from this client's replica. */
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** The replica's version vector, for "identical snapshots" assertions. */
  stateVector(): string {
    return Array.from(Y.encodeStateVector(this.doc), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }

  /** Everything a test compares: notes plus the version vector that produced them. */
  convergence(): string {
    return `${this.stateVector()}\n${JSON.stringify(this.notes())}`;
  }

  get lastClose(): CloseInfo | undefined {
    return this.closes[this.closes.length - 1];
  }

  get awareness(): awarenessProtocol.Awareness {
    return this.doc.awareness;
  }

  /**
   * Wait until `predicate` holds, checking after every frame. Nothing here sleeps and
   * hopes: a test either sees the traffic or times out with the log of what happened.
   */
  async waitUntil(what: string, predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error(
          `timed out waiting for ${what}\nframes: ${this.frames
            .map((frame) => `${frame.type}:${frame.raw.length}`)
            .join(',')}\nlog: ${this.log.join('; ')}`,
        );
      }
      await this.nextFrame(Math.min(500, deadline - Date.now()));
    }
  }

  /** Wait until the socket is gone, for the cases where a close is the assertion. */
  async waitForClose(timeoutMs = 10_000): Promise<CloseInfo> {
    const before = this.closes.length;
    await this.waitUntil('the room to close the socket', () => this.closes.length > before, timeoutMs);
    return this.lastClose as CloseInfo;
  }

  private receive(data: ArrayBuffer | Uint8Array): void {
    const buffer = data instanceof Uint8Array ? data.slice().buffer : data;
    const raw = new Uint8Array(buffer);
    const decoder = decoding.createDecoder(new Uint8Array(buffer));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const payload = decoding.readTailAsUint8Array(decoder);
      this.frames.push({ type, payload, raw });
      this.readSync(payload);
    } else if (type === MESSAGE_AWARENESS) {
      const update = decoding.readUint8Array(decoder, decoding.readVarUint(decoder));
      this.frames.push({ type, payload: update, raw });
      try {
        awarenessProtocol.update(this.doc.awareness, decoding.createDecoder(update), 'from-room');
      } catch (error) {
        // A frame this client cannot read is recorded, not fatal: otherwise the runtime
        // closes the socket and the next assertion is about the wrong thing.
        this.log.push(`unreadable awareness update: ${String(error)}`);
      }
    } else {
      this.frames.push({ type, payload: decoding.readTailAsUint8Array(decoder), raw });
    }
    this.wake();
  }

  /** Answer a sync message the same way `y-websocket` does, frame byte included. */
  private readSync(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(decoding.createDecoder(payload), encoder, this.doc, 'from-room');
    } catch (error) {
      this.log.push(`room sent an unreadable sync message: ${String(error)}`);
      this.wake();
      return;
    }
    if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
    this.wake();
  }

  private wake(): void {
    const waiting = this.next;
    this.next = [];
    for (const resolve of waiting) resolve();
  }

  private nextFrame(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.next.push(resolve);
      setTimeout(resolve, timeoutMs);
    });
  }
}

/**
 * Create `boardId` for real (`POST /api/boards`' one RPC, story 5), so its room will
 * answer a socket. Called by `connect`/`connectClients`; a board that already exists is
 * left exactly as it was (`created_at` unchanged), which is what lets a test reconnect.
 */
const createdHere = new Set<string>();

export async function createBoardRoom(boardId: string): Promise<'created' | 'exists'> {
  // Once per board per test process: a test that reconnects — or whose storage has since
  // been damaged on purpose (TC-15, TC-26) — must not run creation over it again.
  if (createdHere.has(boardId)) return 'exists';
  const outcome = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).initialize();
  if (outcome !== 'created' && outcome !== 'exists') {
    throw new Error(`unexpected initialize() outcome: ${String(outcome)}`);
  }
  createdHere.add(boardId);
  return outcome;
}

/** Open `count` clients on one board, one after another. */
export async function connectClients(boardId: string, count: number): Promise<TestClient[]> {
  const clients: TestClient[] = [];
  for (let index = 0; index < count; index += 1) clients.push(await TestClient.connect(boardId));
  return clients;
}

/** Close every client, so a test never leaks a socket into the next one. */
export async function disconnectClients(clients: TestClient[]): Promise<void> {
  for (const client of clients) {
    try {
      await client.close();
    } catch {
      // Already gone.
    }
  }
}

/**
 * A short settle window. Only ever used to let a *handshake* finish, or to prove that
 * something does not arrive — never to wait for a change a test could wait for
 * properly with `waitUntil`.
 */
export async function settle(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until every client reports the same notes and the same version vector. */
export async function waitForConvergence(clients: TestClient[], timeoutMs = 10_000): Promise<void> {
  const [first] = clients;
  if (!first) throw new Error('no clients to converge');
  const rest = clients.slice(1);
  await first.waitUntil(
    'every replica to agree',
    () => rest.every((client) => client.convergence() === first.convergence()),
    timeoutMs,
  );
}
