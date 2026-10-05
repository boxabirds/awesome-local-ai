/**
 * A board client that speaks the wire protocol the browser's provider speaks, for
 * tests that run inside workerd.
 *
 * These tests are worth their cost only if they are indistinguishable from a browser
 * at the socket: same frames, same sync steps, same awareness bytes. So this is not a
 * mock of a client — it is a second implementation of the client half of `y-websocket`,
 * built from the same `y-protocols` the real provider uses, plus the real board model
 * functions for making changes. What it deliberately lacks is reconnecting: tests that
 * want to watch a reconnection close and open a client by hand.
 *
 * It also keeps a log of every frame it received, because several tests have to say
 * something about what a client was *not* sent: not its own change echoed back, not a
 * note deleted on another board, nothing at all from another board.
 */
import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';
import type { StickySnapshot } from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../../src/shared/protocol';

/** Any origin will do for a local address; this one says what it is. */
const ORIGIN = 'http://vidi6.test';

/** How long a test waits for something that should already have happened. */
const DEFAULT_WAIT_MS = 5_000;

/** How long a test waits to be sure something did *not* happen. */
export const SETTLE_MS = 250;

/** What a received frame turned out to be, in the same words the room uses. */
export type ReceivedKind =
  | 'syncStep1'
  | 'syncStep2'
  | 'update'
  | 'awareness'
  | 'query-awareness'
  | 'invalid';

export interface ReceivedFrame {
  kind: ReceivedKind;
  /** The frame exactly as it arrived, type byte included. */
  bytes: Uint8Array;
}

/**
 * Which presence states just changed, as `y-protocols/awareness` reports them. The
 * shape is exported by that package's implementation but not by its types, so it is
 * written out here rather than reached into.
 */
interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface BoardClient {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly ws: WebSocket;
  /** Every frame received, in order. */
  readonly log: readonly ReceivedFrame[];
  /** Every frame this client sent, in order: what arrived can be told from what went out. */
  readonly sent: readonly ReceivedFrame[];
  /** Set once the socket has closed; null while it is open. */
  readonly closeInfo: { code: number; reason: string } | null;
  /** True while the socket is usable. */
  readonly open: boolean;
  /** How many frames of a kind have arrived. */
  countOf(kind: ReceivedKind): number;
  /** Ask the room for what this client is missing, as a client does on connect. */
  sendSyncStep1(): void;
  /** Answer a state vector with everything this client has. */
  sendSyncStep2(): void;
  /** Send a document update, as a client does the moment it changes something. */
  sendUpdate(update: Uint8Array): void;
  /** Send this client's presence bytes. */
  sendAwareness(clientIds?: number[]): void;
  sendQueryAwareness(): void;
  /** Send bytes no client would send, to see what the room does with them. */
  sendRaw(bytes: Uint8Array | string): void;
  /** Wait until the room has answered this client's SyncStep1. */
  waitForSync(timeoutMs?: number): Promise<void>;
  /** Wait until the room has closed this connection. */
  waitForClose(timeoutMs?: number): Promise<{ code: number; reason: string }>;
  /** Wait for something to become true, waking on arrivals rather than by polling. */
  waitFor(what: string, predicate: () => boolean, timeoutMs?: number): Promise<void>;
  /**
   * Cut this client's connection, keeping its document and everything it was told.
   * Changes made while disconnected stay local, which is what a person's screen does
   * when the network goes and the page stays open.
   */
  disconnect(): void;
  /**
   * Connect again: same document, new socket, and the same sync steps a reconnecting
   * client sends, so a room that has never seen this client is filled in from it.
   * Give a board id to reconnect to a different room than the one dropped.
   */
  reconnect(boardId?: string): Promise<void>;
  /** The notes this client holds, in stacking order. */
  snapshot(): readonly StickySnapshot[];
  /** True when this client and another hold exactly the same document. */
  matches(other: BoardClient): boolean;
  /** The id of this client's presence, which is also its document's client id. */
  clientId(): number;
  close(code?: number, reason?: string): void;
}

/** A request to the Worker, as a browser would make one. */
export function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

/** Ask the Worker about a board connection, and hand back whatever it answered. */
export function fetchBoard(boardId: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(request(`/api/rooms/${boardId}`, init));
}

/** Ask the Worker for a page. */
export function fetchPath(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(request(path, init));
}

/** The headers a browser sends when it asks to become a WebSocket. */
export function upgradeHeaders(): Record<string, string> {
  return { Upgrade: 'websocket', 'Sec-WebSocket-Version': '13' };
}

/**
 * Connect a client to a board and wait until it is synced with the room.
 *
 * Throws when the Worker did not accept the connection: everything that calls this
 * wants a connection, and a refusal here is the answer the test should see.
 */
export async function connect(boardId: string, init: RequestInit = {}): Promise<BoardClient> {
  const response = await fetchBoard(boardId, {
    ...init,
    headers: { ...upgradeHeaders(), ...(init.headers as Record<string, string> | undefined) },
  });
  const socket = response.webSocket;
  if (response.status !== 101 || socket === undefined || socket === null) {
    throw new Error(`connecting to board ${boardId} gave ${response.status}, not a connection`);
  }
  const client = createClient(boardId, socket);
  await client.waitForSync();
  return client;
}

/**
 * Wrap a socket as a board client. What it sends is a protocol-correct frame; what it
 * receives is logged and, for sync frames, applied to its document exactly as the
 * browser's provider applies it.
 */
export function createClient(boardId: string, initialSocket: WebSocket): BoardClient {
  const doc = new Y.Doc();
  initDoc(doc);
  const awareness = new awarenessProtocol.Awareness(doc);
  // Marks updates that arrived from the room, so applying one does not send it
  // straight back — the same trick the real provider plays with its own object.
  const remote = Symbol('remote');

  const log: ReceivedFrame[] = [];
  const sent: ReceivedFrame[] = [];
  const waiters = new Set<() => void>();
  // The socket this client is on now: a client that reconnects gets a new one and
  // keeps everything else, exactly as a browser tab does.
  let socket = initialSocket;
  let board = boardId;
  let closeInfo: { code: number; reason: string } | null = null;
  // The room answering this client's first sync step is what "synced" means here;
  // the client does not decide for itself that it is up to date.
  let synced = false;

  /** Every waiter looks at the same events; each one decides whether it is done. */
  const wake = (): void => {
    for (const notify of [...waiters]) notify();
  };

  const wait = async (what: string, predicate: () => boolean, timeoutMs = DEFAULT_WAIT_MS) => {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const notify = (): void => {
        if (!predicate()) return;
        waiters.delete(notify);
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        waiters.delete(notify);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}`));
      }, timeoutMs);
      waiters.add(notify);
    });
  };

  const sendBytes = (bytes: Uint8Array): void => {
    const frame = bytes.slice();
    sent.push({ kind: classify(frame.buffer as ArrayBuffer), bytes: frame });
    // A copy, because the runtime takes ownership of the buffer it is given.
    socket.send(frame.buffer as ArrayBuffer);
  };

  /** Whether anything sent now would actually leave. */
  const sending = (): boolean => socket.readyState === WebSocket.OPEN;

  const client: BoardClient = {
    get boardId() {
      return board;
    },
    doc,
    awareness,
    get ws() {
      return socket;
    },
    log,
    sent,
    get closeInfo() {
      return closeInfo;
    },
    get open() {
      return sending() && closeInfo === null;
    },

    countOf(kind) {
      return log.filter((frame) => frame.kind === kind).length;
    },

    sendSyncStep1() {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      sendBytes(encoding.toUint8Array(encoder));
    },

    sendSyncStep2() {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(encoder, doc);
      sendBytes(encoding.toUint8Array(encoder));
    },

    sendUpdate(update) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      sendBytes(encoding.toUint8Array(encoder));
    },

    sendAwareness(clientIds) {
      const ids = clientIds ?? [...awareness.getStates().keys()];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
      sendBytes(encoding.toUint8Array(encoder));
    },

    sendQueryAwareness() {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
      sendBytes(encoding.toUint8Array(encoder));
    },

    sendRaw(bytes) {
      if (typeof bytes === 'string') socket.send(bytes);
      else sendBytes(bytes);
    },

    waitForSync(timeoutMs) {
      return wait('the room to answer its sync step', () => synced, timeoutMs);
    },

    waitForClose(timeoutMs) {
      return wait('the room to close the connection', () => closeInfo !== null, timeoutMs).then(
        () => closeInfo as { code: number; reason: string },
      );
    },

    waitFor(what, predicate, timeoutMs) {
      return wait(what, predicate, timeoutMs);
    },

    disconnect() {
      try {
        socket.close();
      } catch {
        // It was already down; the point is that it is down now.
      }
    },

    async reconnect(nextBoardId) {
      const target = nextBoardId ?? board;
      const response = await fetchBoard(target, { headers: upgradeHeaders() });
      const next = response.webSocket;
      if (response.status !== 101 || !next) {
        throw new Error(`reconnecting to board ${target} gave ${response.status}, not a connection`);
      }
      board = target;
      synced = false;
      closeInfo = null;
      attach(next);
      // Everything this client knows goes back out as a sync step, which is how a
      // room that has lost the document gets it back.
      client.sendSyncStep1();
      await client.waitForSync();
    },

    snapshot() {
      return snapshot(doc);
    },

    matches(other) {
      // Two clients agree when each has seen everything the other has. The state
      // vector is the canonical statement of that — a client id and a clock per
      // client, sorted — whereas two encodings of the same document need not be the
      // same bytes, so comparing those would make tests flaky for no reason.
      return equalBytes(Y.encodeStateVector(doc), Y.encodeStateVector(other.doc));
    },

    clientId() {
      return doc.clientID;
    },

    close(code, reason) {
      try {
        socket.close(code, reason ?? '');
      } catch {
        // Already gone: the test is about the fact that it ended, not how.
      }
    },
  };

  /**
   * Start listening to a socket. A reconnecting client keeps its document, its
   * presence and its log, and gets a fresh set of listeners on a fresh socket — which
   * is what the browser's provider does too.
   */
  function attach(next: WebSocket): void {
    socket = next;
    // The socket the runtime hands a test will not deliver anything until it is
    // accepted and told what shape to deliver bytes in — which a browser does for free.
    next.binaryType = 'arraybuffer';
    next.accept();

    next.addEventListener('close', (event) => {
      // A socket this client has already swapped out closing in the background is not
      // news about this client's connection.
      if (next !== socket) return;
      const closeEvent = event as CloseEvent;
      closeInfo = { code: closeEvent.code, reason: closeEvent.reason };
      wake();
    });
    next.addEventListener('error', () => {
      if (next !== socket) return;
      wake();
    });

    next.addEventListener('message', (event) => {
      const bytes = toArrayBuffer((event as MessageEvent).data);
      log.push({ kind: classify(bytes), bytes: new Uint8Array(bytes) });

      const decoded = decodeMessage(bytes);
      if (decoded.kind === 'invalid' || decoded.kind === 'query-awareness') {
        wake();
        return;
      }
      if (decoded.kind === 'awareness') {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoded.payload, remote);
        wake();
        return;
      }

      // Sync frames are answered the way the browser's provider answers them: the
      // reply encoder starts with the message type and Yjs fills in the rest.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const step = syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, doc, remote);
      if (step === syncProtocol.messageYjsSyncStep2) synced = true;
      if (encoding.length(encoder) > 1) sendBytes(encoding.toUint8Array(encoder));
      wake();
    });
  }

  // A change this client makes goes out as it happens, which is what a person's
  // screen does: it does not wait to be asked. While the connection is down the
  // change simply stays in the document, to be sent as a sync step when it is back.
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === remote || !sending()) return;
    client.sendUpdate(update);
  });

  // Presence goes out the same way, including the first state, which is what makes
  // an idle connection look alive to everybody else on the board.
  awareness.on('update', (update: AwarenessChange, origin: unknown) => {
    if (origin === remote || !sending()) return;
    client.sendAwareness(update.added.concat(update.updated, update.removed));
  });

  attach(socket);
  client.sendSyncStep1();
  return client;
}

/**
 * Wait until every client holds exactly the same document.
 *
 * This asks the question of all of them at once rather than waiting on one client's
 * arrivals: the last change that makes two screens agree often arrives on the *other*
 * screen, and a wait that only wakes for its own socket would sit there forever while
 * the board was already in agreement.
 */
export async function converge(clients: BoardClient[], timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
  const [first, ...rest] = clients;
  if (!first) throw new Error('converge() with no clients says nothing');
  const deadline = Date.now() + timeoutMs;
  while (!agrees(first, rest)) {
    if (Date.now() > deadline) {
      throw new Error(`the board did not agree within ${timeoutMs}ms:\n${report(clients)}`);
    }
    await sleep(10);
  }
  // Having seen the same changes is the sync test; comparing what they spell out is the
  // assertion a reader of the test actually wants, so it is checked here too.
  const notes = first.snapshot();
  for (const client of rest) {
    expect(client.snapshot()).toEqual(notes);
  }
}

/** What each client holds right now, for a failure a person can read. */
function report(clients: BoardClient[]): string {
  return clients
    .map((client) => `  ${client.clientId()}: ${Array.from(Y.encodeStateVector(client.doc)).join('.')} ${JSON.stringify(client.snapshot())}`)
    .join('\n');
}

function agrees(first: BoardClient, rest: BoardClient[]): boolean {
  const vector = Y.encodeStateVector(first.doc);
  const notes = first.snapshot();
  return rest.every(
    (client) =>
      equalBytes(vector, Y.encodeStateVector(client.doc)) &&
      // The state vector says which changes each screen has *written*; a delete is not a
      // written change but a note on somebody else's, so two screens can agree on the
      // first and still disagree on the board. Both have to agree before the wait ends.
      JSON.stringify(client.snapshot()) === JSON.stringify(notes),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until a client's room has answered its first sync step. */
export function waitForSync(client: BoardClient, timeoutMs?: number): Promise<void> {
  return client.waitForSync(timeoutMs);
}

/** End a socket, whatever state it has got itself into. */
export function close(socket: WebSocket | null | undefined): void {
  if (!socket) return;
  try {
    socket.close();
  } catch {
    // It was already gone.
  }
}

/** Take these clients off their boards. Safe to call twice, and after a close. */
export function leave(...clients: (BoardClient | null | undefined)[]): void {
  for (const client of clients) if (client) client.close();
}

/** Let the room do whatever it is going to do, then stop waiting. */
export function settle(ms = SETTLE_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The number of presence states a client knows about, including its own. */
export function awarenessPeers(client: BoardClient): number {
  return client.awareness.getStates().size;
}

/** The presence frames a client received, whole, in order. */
export function awarenessFrames(client: BoardClient): number[][] {
  return client.log.filter((frame) => frame.kind === 'awareness').map((frame) => Array.from(frame.bytes));
}

/**
 * Frames no well-behaved client sends, for the tests that check what bad data costs.
 * They are built with the same encoders as the good frames, so each one is exactly one
 * thing wrong rather than a bag of random bytes.
 */
export const malformed = {
  /** Words, in a text frame: the board protocol is binary. */
  text: 'please sync my board',
  /** A message type this build has no handler for. */
  unknownType: frameOf([9]),
  /** A sync frame that announces a document update and then does not deliver one. */
  invalidUpdate: frameOf([MESSAGE_SYNC, syncProtocol.messageYjsUpdate, 7, 1, 2, 3, 4, 5, 6, 7]),
  /** A sync frame that stops after its type byte. */
  truncatedSync: frameOf([MESSAGE_SYNC]),
  /** An awareness frame that promises ten bytes and sends three. */
  truncatedAwareness: frameOf([MESSAGE_AWARENESS, 10, 1, 2, 3]),
  /** Nothing at all. */
  empty: new Uint8Array(0),
};

/** One frame: varUint message types and bytes, written out in order. */
function frameOf(parts: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  for (const part of parts) encoding.writeVarUint(encoder, part);
  return encoding.toUint8Array(encoder);
}

/** An awareness frame carrying these presence bytes, as a client sends them. */
export function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** A sticky note made through the model, as a person would make one. */
export function createNote(client: BoardClient, at?: { x: number; y: number }, color?: StickyColor): string {
  return createSticky(client.doc, at ?? { x: 100, y: 100 }, color);
}

/** Typing into a note through the model. */
export function typeInto(client: BoardClient, id: string, index: number, text: string): void {
  const note = getStickyText(client.doc, id);
  if (!note) throw new Error(`there is no note ${id} to type into`);
  note.insert(index, text);
}

/** The text a client holds for a note, or nothing when it has no such note. */
export function textOf(client: BoardClient, id: string): string {
  return getStickyText(client.doc, id)?.toString() ?? '';
}

/** Move a note through the model. */
export function moveTo(client: BoardClient, id: string, x: number, y: number): boolean {
  return moveObject(client.doc, id, x, y);
}

/** Recolour a note through the model. */
export function recolour(client: BoardClient, id: string, color: StickyColor): boolean {
  return setStickyColor(client.doc, id, color);
}

/** Delete a note through the model. */
export function removeNote(client: BoardClient, id: string): boolean {
  return deleteObject(client.doc, id);
}

/** The one note a client has, for tests that only ever make one. */
export function onlyNote(client: BoardClient): StickySnapshot {
  const notes = client.snapshot();
  if (notes.length !== 1) throw new Error(`expected one note, found ${notes.length}`);
  return notes[0];
}

/** The note with this id, or nothing. */
export function noteById(client: BoardClient, id: string): StickySnapshot | undefined {
  return client.snapshot().find((note) => note.id === id);
}

function classify(bytes: ArrayBuffer): ReceivedKind {
  const decoded = decodeMessage(bytes);
  if (decoded.kind === 'invalid') return 'invalid';
  if (decoded.kind === 'query-awareness') return 'query-awareness';
  if (decoded.kind === 'awareness') return 'awareness';
  const step = decoding.readVarUint(decoding.createDecoder(decoded.payload));
  if (step === syncProtocol.messageYjsSyncStep1) return 'syncStep1';
  if (step === syncProtocol.messageYjsSyncStep2) return 'syncStep2';
  return 'update';
}

/**
 * What a socket's `message` event holds in this runtime: an ArrayBuffer once asked
 * for, a Blob if it was not, and a string for a text frame.
 */
function toArrayBuffer(data: unknown): ArrayBuffer {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer as ArrayBuffer;
  }
  // A Blob cannot be read synchronously. Tests would then see frames they could not
  // classify, so say what happened instead of quietly pretending nothing arrived.
  throw new Error(`a socket delivered ${nameOf(data)}, not bytes; binaryType must be arraybuffer`);
}

function nameOf(value: unknown): string {
  if (value === null) return 'null';
  const named = value as { constructor?: { name?: string } };
  return named?.constructor?.name ?? typeof value;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
