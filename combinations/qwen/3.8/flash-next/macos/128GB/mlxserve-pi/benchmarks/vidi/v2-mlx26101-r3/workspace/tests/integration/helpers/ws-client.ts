import * as Y from 'yjs';
import { env as testEnv, SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { BoardRoom } from '../../../src/worker/board-room';
import type { Env } from '../../../src/worker/index';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../../src/shared/protocol';

/**
 * Integration fixtures: real `Y.Doc`s speaking the y-protocols framing over real
 * WebSockets obtained from upgrade responses - the same bytes the browser's
 * `WebsocketProvider` sends, and no mocks anywhere below the socket.
 */

/** The Worker's own bindings (`BOARD_ROOM`, `ASSETS`), as the real ones. */
export const env: Env = testEnv as unknown as Env;

/** Origin of updates that came from the room; a client must not echo them back. */
const FROM_ROOM = Symbol('from-room');

export const DEFAULT_TIMEOUT_MS = 5_000;

/** One frame as a socket saw it. `text` is set for a text frame, `type` for a known one. */
export interface ReceivedFrame {
  readonly type: number | null;
  readonly bytes: readonly number[];
  readonly text: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait until `predicate` holds, with a clear failure message. */
export async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

/** The y-websocket message type a frame carries, or null when it is undecodable. */
function frameTypeOf(bytes: Uint8Array): number | null {
  switch (decodeMessage(bytes.buffer as ArrayBuffer).kind) {
    case 'sync':
      return MESSAGE_SYNC;
    case 'awareness':
      return MESSAGE_AWARENESS;
    case 'query-awareness':
      return MESSAGE_QUERY_AWARENESS;
    case 'invalid':
      return null;
  }
}

/** A frame written the way the room and the browser provider write them. */
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** The bytes of a `y-protocols/sync` message, ready to go inside a MESSAGE_SYNC frame. */
export function encodeSync(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/**
 * One WebSocket, recorded. Nothing is interpreted beyond the frame type: this is the tool
 * the malformed-traffic tests use to send garbage and see what comes back.
 */
export class SocketLog {
  readonly frames: ReceivedFrame[] = [];
  readonly socket: WebSocket;
  private readonly hooks: ((frame: ReceivedFrame) => void)[] = [];
  private notify: (() => void) | null = null;
  private closedWith: { code: number; reason: string } | null = null;

  constructor(response: Response) {
    const socket = response.webSocket;
    if (socket === null || socket === undefined) {
      throw new Error(`expected a 101 upgrade, got status ${response.status}`);
    }
    this.socket = socket;
    socket.accept();
    socket.addEventListener('message', (event: MessageEvent) => {
      const received: ReceivedFrame =
        typeof event.data === 'string'
          ? { type: null, bytes: [], text: event.data }
          : (() => {
              const bytes = new Uint8Array(event.data as ArrayBuffer);
              return {
                type: frameTypeOf(bytes),
                bytes: Array.from(bytes),
                text: null,
              };
            })();
      if (trace.on) {
        console.log(
          '  <- recv',
          received.text ?? `${received.bytes.length}B type=${received.type} bytes=[${received.bytes.join(',')}]`,
        );
      }
      this.frames.push(received);
      for (const hook of [...this.hooks]) {
        hook(received);
      }
      this.wake();
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closedWith = { code: event.code, reason: event.reason };
      this.wake();
    });
    socket.addEventListener('error', () => {
      this.wake();
    });
  }

  /** True once the socket has closed (however it closed). */
  get closed(): boolean {
    return this.closedWith !== null;
  }

  /** How the socket ended, or null while it is still open. */
  get closeWith(): { code: number; reason: string } | null {
    return this.closedWith;
  }

  send(data: Uint8Array | string): void {
    if (trace.on) {
      console.log('  -> send', typeof data === 'string' ? `text ${data}` : `binary ${(data as Uint8Array).byteLength}B`);
    }
    this.socket.send(data);
  }

  /** Called for every frame that arrives, in the order they arrive. */
  onFrame(hook: (frame: ReceivedFrame) => void): void {
    this.hooks.push(hook);
  }

  framesOfType(type: number): ReceivedFrame[] {
    return this.frames.filter((frame) => frame.type === type);
  }

  /** Wait for at least `count` frames to have arrived (or the socket to close). */
  async waitForFrames(count: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    while (this.frames.length < count && this.closedWith === null) {
      await new Promise<void>((resolve) => {
        this.notify = resolve;
        setTimeout(resolve, timeoutMs);
      });
    }
    if (this.frames.length < count) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${count} frame(s); saw ${this.frames.length}`,
      );
    }
  }

  /** Wait for the room to close the socket (the error path of every rejected message). */
  async waitForClose(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ code: number; reason: string }> {
    await waitFor(() => this.closedWith !== null, 'the socket to close', timeoutMs);
    const closed = this.closedWith;
    if (closed === null) {
      throw new Error('not closed');
    }
    return closed;
  }

  close(): void {
    this.socket.close();
  }

  private wake(): void {
    const resolve = this.notify;
    this.notify = null;
    resolve?.();
  }
}

/** Open a socket through the Worker route and record it, without speaking any protocol. */
export async function rawSocket(boardId: string): Promise<SocketLog> {
  await createBoardNamed(boardId);
  const response = await SELF.fetch(
    new Request(`http://localhost/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } }),
  );
  return new SocketLog(response);
}

/**
 * Which `y-protocols/sync` message a frame carries (step 1, step 2, an update), or null when
 * it is not a sync frame. This is how a test says "exactly one update, no echoes".
 */
export function syncSubtype(frame: ReceivedFrame): number | null {
  if (frame.type !== MESSAGE_SYNC) {
    return null;
  }
  const payload = framePayload(frame);
  if (payload === null || payload.byteLength === 0) {
    return null;
  }
  return decoding.readVarUint(decoding.createDecoder(payload));
}

/** The payload of a frame (everything after the y-websocket message type), or null. */
export function framePayload(frame: ReceivedFrame): Uint8Array | null {
  if (frame.text !== null) {
    return null;
  }
  const decoded = decodeMessage(new Uint8Array(frame.bytes).buffer as ArrayBuffer);
  return decoded.kind === 'sync' || decoded.kind === 'awareness' ? decoded.payload : null;
}

/** Set to true to print every frame each participant sends and receives. */
export const trace: { on: boolean } = { on: false };

/** A participant: a real document on a real socket, syncing the way the browser does. */
export class Participant {
  readonly doc = new Y.Doc();

  constructor() {
    // Everything this document learns locally goes to the room, as an update frame -
    // exactly what `WebsocketProvider` does. Updates the room sent are not echoed back,
    // and while muted the edits stay in the document until {@link unmute}.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === FROM_ROOM || this.mutedVector !== null) {
        return;
      }
      this.logValue?.send(
        encodeFrame(
          MESSAGE_SYNC,
          encodeSync((encoder) => {
            syncProtocol.writeUpdate(encoder, update);
          }),
        ),
      );
    });
  }

  private logValue: SocketLog | null = null;
  /** True once the room answered this connection's SyncStep1 with a SyncStep2. */
  private syncedValue = false;
  /** Non-null while local edits are held back: the state vector the room already has. */
  private mutedVector: Uint8Array | null = null;

  get log(): SocketLog {
    const log = this.logValue;
    if (log === null) {
      throw new Error('this participant is not connected');
    }
    return log;
  }

  get frames(): ReceivedFrame[] {
    return this.log.frames;
  }

  /** True once the room answered this connection's SyncStep1 with a SyncStep2. */
  get synced(): boolean {
    return this.syncedValue;
  }

  /** Connect to `boardId` through the Worker route, as a browser does. */
  async connect(boardId: string): Promise<this> {
    await createBoardNamed(boardId);
    const response = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${boardId}`, {
        headers: { Upgrade: 'websocket' },
      }),
    );
    return this.attach(new SocketLog(response));
  }

  /**
   * Connect - or reconnect, when this document already had a socket - to the Durable Object
   * instance for `name`. TC-18 passes a name never used before, which is what the same board
   * looks like after a runtime restart: the reconnecting client is the only copy of it.
   */
  async connectStub(namespace: DurableObjectNamespace<BoardRoom>, name: string): Promise<this> {
    const stub = namespace.get(namespace.idFromName(name));
    await stub.initialize();
    const response = await stub.fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    return this.attach(new SocketLog(response));
  }

  /** Hang up; the room forgets this socket. */
  close(): void {
    if (this.logValue !== null) {
      this.logValue.close();
      this.logValue = null;
    }
  }

  /** Reuse this document on a new socket - a reconnection, not a new participant. */
  private attach(log: SocketLog): this {
    this.close();
    this.logValue = log;
    this.syncedValue = false;
    log.onFrame((received) => {
      // A frame that arrives after this participant hung up belongs to a socket nobody is
      // reading any more - the room may still be saying goodbye. Drop it instead of throwing
      // inside the socket's handler.
      if (this.logValue === log) {
        this.receive(log, received);
      }
    });
    this.sendSyncStep1();
    return this;
  }

  private sendSyncStep1(): void {
    this.log.send(
      encodeFrame(
        MESSAGE_SYNC,
        encodeSync((encoder) => {
          syncProtocol.writeSyncStep1(encoder, this.doc);
        }),
      ),
    );
  }

  private receive(log: SocketLog, received: ReceivedFrame): void {
    if (received.text !== null) {
      return; // the room closes on text frames; there is nothing to apply
    }
    const bytes = new Uint8Array(received.bytes);
    const decoded = decodeMessage(bytes.buffer as ArrayBuffer);
    if (decoded.kind !== 'sync') {
      return; // awareness frames are recorded by the socket and applied by nobody here
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let type: number;
    try {
      type = syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.doc,
        FROM_ROOM,
      );
    } catch (error) {
      throw new Error(`the room sent an update this client cannot read: ${describeError(error)}`);
    }
    if (type === syncProtocol.messageYjsSyncStep2) {
      this.syncedValue = true;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) {
      log.send(reply);
    }
  }

  /** Hold local edits back (they stay in the document), as a disconnected tab does. */
  mute(): void {
    this.mutedVector = Y.encodeStateVector(this.doc);
  }

  /** Send everything edited while muted, as a client catching up after an outage does. */
  unmute(): void {
    const vector = this.mutedVector;
    this.mutedVector = null;
    if (vector !== null) {
      const update = Y.encodeStateAsUpdate(this.doc, vector);
      if (update.byteLength > 1) {
        this.log.send(
          encodeFrame(
            MESSAGE_SYNC,
            encodeSync((encoder) => {
              syncProtocol.writeUpdate(encoder, update);
            }),
          ),
        );
      }
    }
  }

  /** Every frame the room sent of a given y-websocket message type. */
  framesOfType(type: number): ReceivedFrame[] {
    return this.log.framesOfType(type);
  }

  /** The frames carrying a document update - the ones a relay forwards. */
  updateFrames(): ReceivedFrame[] {
    return this.log.frames.filter(
      (frame) => syncSubtype(frame) === syncProtocol.messageYjsUpdate,
    );
  }

  /** The frames carrying awareness. */
  awarenessFrames(): ReceivedFrame[] {
    return this.log.framesOfType(MESSAGE_AWARENESS);
  }

  waitForFrames(count: number, timeoutMs?: number): Promise<void> {
    return this.log.waitForFrames(count, timeoutMs);
  }

  waitForClose(timeoutMs?: number): Promise<{ code: number; reason: string }> {
    return this.log.waitForClose(timeoutMs);
  }

  waitFor(predicate: () => boolean, what: string, timeoutMs?: number): Promise<void> {
    return waitFor(predicate, what, timeoutMs);
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /**
   * True when `text` is reachable somewhere in this client's document - as a note's text, a
   * property, or an object that is off the board but still in the document. A note that was
   * deleted while somebody typed in it must not leave that text anywhere reachable.
   */
  textMentions(text: string): boolean {
    const mentions = (value: unknown): boolean => {
      if (typeof value === 'string') {
        return value.includes(text);
      }
      if (value instanceof Y.Text) {
        return value.toString().includes(text);
      }
      if (value instanceof Y.Map) {
        for (const [, child] of value) {
          if (mentions(child)) {
            return true;
          }
        }
        return false;
      }
      if (value instanceof Y.Array) {
        for (const child of value) {
          if (mentions(child)) {
            return true;
          }
        }
        return false;
      }
      return false;
    };
    for (const shared of this.doc.share.values()) {
      if (mentions(shared)) {
        return true;
      }
    }
    return false;
  }

  /** Send an awareness frame, as a client's periodic awareness renewal does. */
  sendAwareness(payload: Uint8Array): void {
    this.log.send(encodeFrame(MESSAGE_AWARENESS, payload));
  }

  /** Send anything: how a test hands the room a frame no client would send. */
  sendBytes(data: Uint8Array | string): void {
    this.log.send(data);
  }

  sendQueryAwareness(): void {
    this.log.send(encodeFrame(MESSAGE_QUERY_AWARENESS, new Uint8Array(0)));
  }
}

/** A board id nobody has used before; the tests never hand-write ids. */
export function boardId(): string {
  return newBoardId();
}

/**
 * Give a board its storage, by a name the test chose.
 *
 * Story 5: a board is made before anybody can join one, and joining a link that is not a board is
 * the Board not found answer (share.not_found). Most tests here want a board to work on and choose
 * its name themselves, so that they can also reach into its storage - so they ask for this first.
 * It is the same call `POST /api/boards` makes, for an id the test picked instead of one the
 * service generated; for a board that is already there it changes nothing.
 */
export async function createBoardNamed(
  name: string,
  namespace: DurableObjectNamespace<BoardRoom> = env.BOARD_ROOM,
): Promise<'created' | 'exists'> {
  return namespace.get(namespace.idFromName(name)).initialize();
}

/** Two boards, in the order they should be compared. */
export function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Wait until every participant's board looks the same. */
export async function waitForConvergence(
  participants: readonly Participant[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(() => {
    const [first, ...rest] = participants;
    if (first === undefined) {
      return true;
    }
    return rest.every((participant) => sameBoard(first.snapshot(), participant.snapshot()));
  }, `${participants.length} participants to converge`, timeoutMs);
}

/** A participant's board as one comparable string, for failure messages. */
export function boardState(participant: Participant): string {
  return JSON.stringify(participant.snapshot());
}
