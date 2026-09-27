/**
 * A second editor for the Durable Object tests: a real `Y.Doc` plus a real
 * WebSocket to the room, speaking the framed y-websocket protocol
 * (design "sync.wire").
 *
 * Deliberately *not* a `WebsocketProvider`: the provider hides the exact-frame
 * assertions the room tests are made of (TC-08 counts the frames one client
 * receives), coalesces and re-frames messages on its own schedule, and would let
 * a change to the wire format pass by accident. Everything the provider would do
 * is spelled out here.
 *
 * The socket comes from `fetch()` with an upgrade header: the 101 response carries
 * the client half of the pair the room created, and `accept()` starts it. Its peer
 * really is the object's socket, so worker -> object -> worker is the production
 * path rather than a mock of it.
 *
 * A well-formed message must never cost a connection (design "Framing, and what
 * a malformed message is"). So a close that arrives while a test is waiting is
 * turned into a failure that names the close code and reason rather than a
 * timeout: `closed with 1003 (malformed message)` says what happened, where
 * `timed out` would not.
 */

import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP_1,
  SYNC_STEP_2,
  awarenessMessage,
  decodeMessage,
  frameMessage,
} from '../../../src/shared/protocol';
import {
  type StickySnapshot,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';

/** How long a test waits for one frame before giving up. */
const FRAME_TIMEOUT_MS = 3_000;

/** What the room closed with, once that happens. */
export interface SocketClose {
  code: number;
  reason: string;
}

/**
 * The frames a socket has received, taken one at a time.
 *
 * `next` returns the oldest frame, waiting up to its budget, or `null` when the
 * budget runs out *or* the socket is closed — the caller tells those apart with
 * `closeInfo`, because a close is never an answer to a well-formed message.
 */
class FrameQueue {
  /** Every frame that arrived, so a test can count what was sent even if it has
   *  not consumed all of it yet. */
  readonly arrived: Uint8Array[] = [];

  #closed: SocketClose | null = null;
  #buffered: Uint8Array[] = [];
  #waiters: ((frame: Uint8Array | null) => void)[] = [];

  constructor(
    socket: WebSocket,
    readonly label: string,
  ) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event: MessageEvent) => {
      const frame = new Uint8Array(event.data as ArrayBuffer);
      this.arrived.push(frame);
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#buffered.push(frame);
      else waiter(frame);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.#closed = { code: event.code, reason: event.reason };
      for (const waiter of this.#waiters.splice(0)) waiter(null);
    });
    socket.addEventListener('error', () => {
      this.#closed ??= { code: -1, reason: 'socket error' };
      for (const waiter of this.#waiters.splice(0)) waiter(null);
    });
  }

  get closeInfo(): SocketClose | null {
    return this.#closed;
  }

  get isClosed(): boolean {
    return this.#closed !== null;
  }

  async next(timeoutMs = FRAME_TIMEOUT_MS): Promise<Uint8Array | null> {
    const buffered = this.#buffered.shift();
    if (buffered !== undefined) return buffered;
    if (this.#closed !== null) return null;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (frame: Uint8Array | null): void => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(frame);
      };
      timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter !== done);
        done(null);
      }, timeoutMs);
      this.#waiters.push(done);
    });
  }
}

/**
 * One connection to a board room: the document it syncs into, the frames it has
 * been sent, and the `knownByRoom` state vector that decides what is worth
 * sending (design "sync.confirmed" — the client's own `doc.on('update')` is not a
 * sufficient rule, because a frame the room just applied is an update too).
 */
export class RoomClient {
  #socket: WebSocket | null = null;
  #frames: FrameQueue | null = null;
  /** What the room is known to hold; what we send is the difference. */
  #knownByRoom: Uint8Array | undefined;

  private constructor(
    readonly boardId: string,
    readonly doc: Y.Doc,
  ) {}

  /** A client with a document of its own and no connection yet.
   *
   *  Edits made before `connect` stay local, exactly as they do in a browser tab
   *  with no connection: they go out with the handshake, which is how a room that
   *  lost its document is rebuilt. */
  static prepared(boardId: string): RoomClient {
    const doc = new Y.Doc();
    // The same schema seed the app does on load, so a test document is a real one.
    initDoc(doc);
    return new RoomClient(boardId, doc);
  }

  static async connect(boardId: string): Promise<RoomClient> {
    const client = RoomClient.prepared(boardId);
    await client.open();
    return client;
  }

  /**
   * Connect, and wait until the room has answered our SyncStep1 — the point at
   * which this client holds what the room has.
   */
  async open(): Promise<void> {
    await this.#open();
    await this.#awaitHandshake();
  }

  /** The board as the app sees it: one snapshot per sticky note. */
  get notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** One note's text, or `undefined` when this client has no such note. */
  text(id: string): string | undefined {
    return getStickyText(this.doc, id)?.toString();
  }

  /** One field of one note, or `undefined` when this client has no such note. */
  value<K extends 'x' | 'y' | 'z' | 'color'>(id: string, field: K): unknown {
    return this.notes.find((note) => note.id === id)?.[field];
  }

  /** How many notes this client holds. */
  get count(): number {
    return this.notes.length;
  }

  /** How the connection ended, if it did. */
  get closed(): SocketClose | null {
    return this.#queue.closeInfo;
  }

  /** Every frame the room has sent, oldest first, applied or not. */
  get received(): readonly Uint8Array[] {
    return this.#queue.arrived;
  }

  /** How many frames have arrived so far, for counting what comes next. */
  get frameCount(): number {
    return this.#queue.arrived.length;
  }

  // ---- sending -------------------------------------------------------------

  /**
   * Send one framed message. While there is no connection at all the message is
   * dropped — an offline editor's state goes out with its next handshake. A socket
   * that was open and then closed is a failure worth naming, because a good message
   * must never be the thing that closed it.
   */
  send(bytes: Uint8Array): void {
    if (this.#socket === null) return;
    if (this.#queue.isClosed) {
      throw new Error(
        `${this.#label}: send failed, the socket was closed with ` +
          `${String(this.closed?.code)} (${this.closed?.reason})`,
      );
    }
    this.#socket.send(bytes);
  }

  /** Ask the room who else is here. The room answers with what it knows. */
  queryAwareness(): void {
    this.send(new Uint8Array([MESSAGE_QUERY_AWARENESS]));
  }

  /** A text edit: insert at the start of a note's text, then send what changed. */
  editText(id: string, text: string): void {
    const yText = getStickyText(this.doc, id);
    if (yText === undefined) throw new Error(`${this.#label}: no note ${id} here to edit`);
    this.doc.transact(() => yText.insert(0, text), 'local');
    this.#sendOurUpdate();
  }

  /** A concurrent write of the note's colour. */
  setColor(id: string, color: StickyColor): void {
    if (!setStickyColor(this.doc, id, color)) {
      throw new Error(`${this.#label}: could not recolour ${id}`);
    }
    this.#sendOurUpdate();
  }

  /** A concurrent write of the note's position. */
  move(id: string, x: number, y: number): void {
    if (!moveObject(this.doc, id, x, y)) {
      throw new Error(`${this.#label}: could not move ${id}`);
    }
    this.#sendOurUpdate();
  }

  /** A delete, for the CRDT cases in TC-08. */
  remove(id: string): void {
    if (!deleteObject(this.doc, id)) throw new Error(`${this.#label}: no note ${id} here`);
    this.#sendOurUpdate();
  }

  /**
   * A note of our own, sent like any other edit. Tests use it so that a document
   * is never empty and two tests can never collide on a note id.
   */
  seedNote(name: string): string {
    const id = createSticky(this.doc, { x: 0, y: 0 });
    getStickyText(this.doc, id)?.insert(0, name);
    this.#sendOurUpdate();
    return id;
  }

  // ---- receiving -----------------------------------------------------------

  /**
   * Wait until `check` passes against the local document, applying frames as they
   * arrive. This is the test's "wait for propagation".
   */
  async waitFor<T>(check: () => T | undefined | null, timeoutMs = FRAME_TIMEOUT_MS): Promise<T> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value !== undefined && value !== null) return value;
      const left = until - Date.now();
      if (left <= 0) throw new Error(this.#describeWait('the condition to become true'));
      const frame = await this.#queue.next(left);
      if (frame === null) throw new Error(this.#describeWait('the condition to become true'));
      this.#applyFrame(frame);
    }
  }

  /**
   * Everything the room sends within `waitMs`, plus the frames consumed to satisfy
   * `check`. Used to assert that something is *not* sent: a connection that stays
   * quiet is the whole point of TC-08's "no echo" half.
   */
  async collect(waitMs = 400): Promise<Uint8Array[]> {
    const found: Uint8Array[] = [];
    for (;;) {
      const frame = await this.#queue.next(waitMs);
      if (frame === null) return found;
      found.push(frame);
      this.#applyFrame(frame);
      waitMs = 100;
    }
  }

  /**
   * Send a presence update of our own. The room does not interpret these, so the
   * tests use them to check that what goes in is what comes out (TC-09), and to
   * give the room a presence to remember and later announce as removed (TC-11).
   */
  sendAwareness(state: unknown, clock = 1): void {
    this.send(awarenessMessage(awarenessUpdate(Number(this.doc.clientID), clock, state)));
  }

  /** The client id this connection's presence is filed under. */
  get clientId(): number {
    return Number(this.doc.clientID);
  }

  /**
   * Apply at most one incoming frame, waiting up to `timeoutMs`. Returns whether
   * a frame arrived — the way a test drives two connections towards convergence
   * without either one blocking on a message that will never come.
   */
  async pump(timeoutMs = 200): Promise<boolean> {
    const frame = await this.#queue.next(timeoutMs);
    if (frame === null) return false;
    this.#applyFrame(frame);
    return true;
  }

  /** Read the next frame without applying it. `null` on timeout or close. */
  async rawReceive(timeoutMs = FRAME_TIMEOUT_MS): Promise<Uint8Array | null> {
    return this.#queue.next(timeoutMs);
  }

  /**
   * Wait for the room to close this connection, discarding whatever else arrives
   * first. What comes back is the close code and reason, which is how a malformed
   * input test names what it got.
   */
  async untilClosed(timeoutMs = 2_000): Promise<SocketClose> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const close = this.closed;
      if (close !== null) return close;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`${this.#label}: still open after ${String(timeoutMs)}ms`);
      await this.#queue.next(left);
    }
  }

  /** Close the connection. The room's close handler runs whichever side starts it. */
  async close(code = 1000, reason = ''): Promise<void> {
    const socket = this.#socket;
    if (socket === null || this.#queue.isClosed) return;
    socket.close(code, reason);
    // Let the room notice before the test moves on.
    await this.#queue.next(1_000);
  }

  // ---- protocol plumbing ---------------------------------------------------

  get #queue(): FrameQueue {
    if (this.#frames === null) throw new Error(`${this.#label}: not connected`);
    return this.#frames;
  }

  get #label(): string {
    return `room client for ${this.boardId}`;
  }

  async #open(): Promise<void> {
    // `SELF` is the worker under test, so this is the same request a browser
    // makes: routing in the worker, then the object it points at.
    const response = await SELF.fetch(`https://whiteboard.example.com/api/rooms/${this.boardId}`, {
      headers: { upgrade: 'websocket' },
    });
    const socket = (response as Response & { webSocket?: WebSocket }).webSocket;
    if (socket === undefined) {
      throw new Error(
        `${this.#label}: expected an upgrade, got HTTP ${String(response.status)}`,
      );
    }
    socket.accept();
    this.#socket = socket;
    this.#frames = new FrameQueue(socket, this.#label);
    // "Tell me what you have." The room does the same to us the moment the socket
    // is accepted, so both directions are asked for and answered at once.
    this.send(syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc)));
  }

  /**
   * The opening handshake. The room asks what we have, we answer with everything;
   * the room's answer to *our* SyncStep1 is the point at which we hold what the
   * room has, so the client is connected-and-synced there (spec "Synced in the
   * normal case", design "sync.confirmed").
   */
  async #awaitHandshake(timeoutMs = FRAME_TIMEOUT_MS): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const left = until - Date.now();
      if (left <= 0) throw new Error(this.#describeWait('the sync handshake'));
      const frame = await this.#queue.next(left);
      if (frame === null) throw new Error(this.#describeWait('the sync handshake'));
      const answered = syncKind(frame) === SYNC_STEP_2;
      this.#applyFrame(frame);
      if (answered) return;
    }
  }

  /** Apply one frame to the local document, answering a SyncStep1 if there is one. */
  #applyFrame(frame: Uint8Array): void {
    const kind = syncKind(frame);
    if (kind < 0) return; // awareness and anything else: not our document
    const body = syncBody(frame);
    if (kind === SYNC_STEP_1) {
      // The room is asking what it is missing. Answer with our whole state, which
      // is never wrong, and is only ever asked at the start.
      this.#knownByRoom = body ?? undefined;
      // Everything we hold: the room asked, and answering in full is never wrong.
      this.send(syncFrame((encoder) => syncProtocol.writeSyncStep2(encoder, this.doc)));
      return;
    }
    if (body === null || body.byteLength === 0) return;
    Y.applyUpdate(this.doc, body, 'remote');
    // Anything the room sent is by definition something the room has.
    this.#knownByRoom = Y.encodeStateVector(this.doc);
  }

  /** Send whatever the room has never been told about. */
  #sendOurUpdate(): void {
    this.send(
      syncFrame((encoder) =>
        syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc, this.#knownByRoom)),
      ),
    );
  }

  #describeWait(what: string): string {
    const close = this.closed;
    return close === null
      ? `${this.#label}: timed out waiting for ${what}`
      : `${this.#label}: the room closed the socket with ${String(close.code)} ` +
          `(${close.reason}) while waiting for ${what}`;
  }
}

/** Wrap a sync body in the `MESSAGE_SYNC` frame y-websocket expects. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, MESSAGE_SYNC);
  write(frame);
  return encoding.toUint8Array(frame);
}

/** The inner sync kind of a frame: 0, 1, 2, or -1 when it is not a sync message. */
function syncKind(frame: Uint8Array): number {
  const decoded = decodeMessage(frame);
  if (decoded.kind !== 'sync') return -1;
  try {
    return decoding.readVarUint(decoding.createDecoder(decoded.payload));
  } catch {
    return -1;
  }
}

/** The length-prefixed body of a sync message, without the kind byte. */
function syncBody(frame: Uint8Array): Uint8Array | null {
  const decoded = decodeMessage(frame);
  if (decoded.kind !== 'sync') return null;
  try {
    const reader = decoding.createDecoder(decoded.payload);
    decoding.readVarUint(reader);
    const length = decoding.readVarUint(reader);
    return decoding.readUint8Array(reader, length);
  } catch {
    return null;
  }
}

/**
 * One client's presence entry, in the awareness wire format: a count, then
 * client id, clock and the JSON state. Built here rather than with
 * `y-protocols/awareness` because that module's `Awareness` class keeps a
 * three-second timer running, which is exactly the kind of thing a test suite
 * should not have to wait for or clean up.
 */
export function awarenessUpdate(clientId: number, clock: number, state: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return encoding.toUint8Array(encoder);
}

/** The presence update carried by an awareness frame, or `null` for other frames. */
export function awarenessUpdateOf(frame: Uint8Array): Uint8Array | null {
  const decoded = decodeMessage(frame);
  if (decoded.kind !== 'awareness') return null;
  try {
    const reader = decoding.createDecoder(decoded.payload);
    return decoding.readUint8Array(reader, decoding.readVarUint(reader));
  } catch {
    return null;
  }
}

export interface AwarenessEntry {
  readonly clientId: number;
  readonly clock: number;
  /** `null` is a removal: this client's presence is gone. */
  readonly state: unknown;
}

/** The client ids, clocks and states named in an awareness update. */
export function readAwarenessEntries(update: Uint8Array): AwarenessEntry[] {
  const entries: AwarenessEntry[] = [];
  try {
    const reader = decoding.createDecoder(update);
    const count = decoding.readVarUint(reader);
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(reader);
      const clock = decoding.readVarUint(reader);
      const raw = decoding.readVarString(reader);
      entries.push({ clientId, clock, state: raw === 'null' ? null : (JSON.parse(raw) as unknown) });
    }
  } catch {
    // A truncated update names nobody, which is all a test needs to know.
  }
  return entries;
}

/** The client ids named in an awareness update, and the state each one carries. */
export function readAwarenessUpdate(update: Uint8Array): Map<number, unknown> {
  const states = new Map<number, unknown>();
  for (const entry of readAwarenessEntries(update)) states.set(entry.clientId, entry.state);
  return states;
}

/** Connect a client that is synced with the room. */
export async function connectRoom(boardId: string): Promise<RoomClient> {
  return RoomClient.connect(boardId);
}

/**
 * A board id that is valid, and different for every call in the file: two tests
 * sharing one id would share one room, and one test's notes would read as another
 * test's propagation.
 */
let counter = 0;
export function boardId(): string {
  counter += 1;
  const bytes = crypto.randomUUID().replaceAll('-', '');
  const id = new Uint8Array(16);
  for (let i = 0; i < 16; i++) id[i] = Number.parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
  // A unique, valid id for each counter value rather than a fresh random UUID, so
  // a failing room can be named exactly in the log.
  id[12] = 0;
  id[13] = (counter >>> 16) & 0xff;
  id[14] = (counter >>> 8) & 0xff;
  id[15] = counter & 0xff;
  return base64Url(id);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
