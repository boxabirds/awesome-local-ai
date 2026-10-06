/**
 * Integration test client: a real `Y.Doc` speaking the y-protocols wire format over a
 * real WebSocket to a real BoardRoom.
 *
 * The socket comes from an upgrade response (via `SELF.fetch`, i.e. through the Worker, or
 * straight from a Durable Object stub), which is how workerd hands a connection to a
 * caller. The framing is deliberately re-implemented here instead of importing
 * `decodeMessage`: these clients must be independent of the code under test, and they
 * mirror what the browser's `y-websocket` provider does byte for byte - SyncStep1 on open,
 * answer every SyncStep1 with a SyncStep2, apply everything else, and relay awareness.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { env, SELF } from 'cloudflare:test';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  toFrameBytes,
  type IncomingFrame,
} from '../../src/shared/protocol';

/** Inner sync message types (`y-protocols/sync`). */
export const SYNC_STEP_1 = syncProtocol.messageYjsSyncStep1;
export const SYNC_STEP_2 = syncProtocol.messageYjsSyncStep2;
export const SYNC_UPDATE = syncProtocol.messageYjsUpdate;

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ReceivedFrame {
  /** Outer y-websocket frame type. */
  kind: 'sync' | 'awareness' | 'query-awareness' | 'invalid';
  /** For sync frames: the inner sync message type. */
  syncType?: number;
  /** The frame exactly as it arrived. */
  bytes: Uint8Array;
}

export interface ClosedFrame {
  code: number;
  reason: string;
  wasClean: boolean;
}

/** Shape of the close event workerd delivers (this project has no DOM types). */
interface CloseEventShape {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

/** Marks updates that came from the room, so a client never echoes them back. */
const APPLIED_REMOTELY = Symbol('applied from the room');

/** One participant on a board. */
export interface RoomClient {
  /** The board this client joined (`''` for a client bound to a specific instance). */
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly socket: WebSocket;
  /** Every frame received so far, in arrival order. */
  readonly frames: ReceivedFrame[];
  /** Every close observed on this socket. */
  readonly closes: ClosedFrame[];
  /** Errors observed on this socket. */
  readonly errors: unknown[];
  /** True once the room answered this client's SyncStep1 with a SyncStep2. */
  synced(): boolean;
  /** Resolves when `synced()`, rejects after the timeout. */
  waitForSync(timeoutMs?: number): Promise<void>;
  /** Resolves with the first close event, rejects after the timeout. */
  waitForClose(timeoutMs?: number): Promise<ClosedFrame>;
  /** Sync frames that carried a plain update - what somebody else's change looks like. */
  updateFrames(): number;
  /** The board this client holds, read through the app's own model. */
  notes(): readonly StickySnapshot[];
  /** Sends raw bytes (malformed on purpose in the error tests). */
  sendBytes(bytes: Uint8Array | ArrayBuffer): void;
  /** Sends a text frame (never produced by a real client). */
  sendText(text: string): void;
  /** Sends an awareness frame with the given body. */
  sendAwareness(body: Uint8Array): void;
  /** Sends a sync frame with the given body (garbage on purpose in the error tests). */
  sendSync(body: Uint8Array): void;
  /** Starts (or restarts) the sync handshake. */
  sendSyncStep1(): void;
  /** Closes the connection from this side. */
  close(code?: number, reason?: string): void;
}

/** Polls `condition` until it holds; rejects with `message` after a timeout. */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  message = 'condition was never met',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * A sync frame, byte for byte like `y-websocket` speaks it: the frame type, then the sync
 * message itself (with its own step byte). There is no length prefix - y-protocols knows
 * where the message ends.
 */
export function syncFrameOf(message: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, message);
  return encoding.toUint8Array(encoder);
}

/** An awareness frame: the frame type, then the update as `varUint8Array`. */
export function awarenessFrameOf(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** The upgrade headers a browser sends; workerd needs them to hand over a socket. */
function upgradeRequest(url: string): Request {
  return new Request(url, {
    headers: {
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGVzdGluZy1rZXktMDEyMzQ1Njc4OTI=',
    },
  });
}

/** Classifies one frame without consuming it (independent of the room's decoder). */
function classify(bytes: Uint8Array): ReceivedFrame {
  if (bytes.length === 0) return { kind: 'invalid', bytes };
  const decoder = decoding.createDecoder(bytes);
  try {
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      return { kind: 'sync', syncType: decoding.readVarUint(decoder), bytes };
    }
    if (type === MESSAGE_AWARENESS) return { kind: 'awareness', bytes };
    if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness', bytes };
    return { kind: 'invalid', bytes };
  } catch {
    return { kind: 'invalid', bytes };
  }
}

/**
 * Wraps the client half of a 101 upgrade response in a Yjs participant.
 *
 * Like `y-websocket`: send SyncStep1 on open, answer a SyncStep1 with a SyncStep2, apply
 * everything else, and treat the SyncStep2 that answers our own SyncStep1 as "synced".
 */
export function wrapClient(
  response: Response,
  options: { doc?: Y.Doc; boardId?: string; init?: boolean } = {},
): RoomClient {
  const socket = response.webSocket;
  if (!socket) throw new Error(`expected a WebSocket in the response, got ${response.status}`);
  socket.accept();

  // a reconnecting participant brings its own document, which is what makes catching up work
  const doc = options.doc ?? new Y.Doc();
  // `init: false` is for clients that only send broken frames: without a document of their
  // own they cannot change what the other participants see
  if (options.init !== false) initDoc(doc);

  let syncSeen = false;

  const client: RoomClient = {
    boardId: options.boardId ?? '',
    doc,
    socket,
    frames: [],
    closes: [],
    errors: [],
    synced: () => syncSeen,
    waitForSync: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
      waitFor(() => syncSeen, timeoutMs, 'the room never finished the initial sync'),
    waitForClose: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
      waitFor(() => client.closes.length > 0, timeoutMs, 'the socket was never closed').then(
        () => client.closes[0] as ClosedFrame,
      ),
    updateFrames: () =>
      client.frames.filter((entry) => entry.kind === 'sync' && entry.syncType === SYNC_UPDATE)
        .length,
    notes: () => snapshot(doc),
    sendBytes: (bytes) => {
      socket.send(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    },
    sendText: (text) => {
      socket.send(text);
    },
    sendAwareness: (body) => {
      socket.send(awarenessFrameOf(body));
    },
    sendSync: (body) => {
      socket.send(syncFrameOf(body));
    },
    sendSyncStep1: () => {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, doc);
      socket.send(syncFrameOf(encoding.toUint8Array(encoder)));
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
  };

  /**
   * Applies one received frame. Frames are handled one at a time, in arrival order: the
   * sync handshake only works step by step (workerd may hand a frame as a Blob, so this
   * half is asynchronous).
   */
  const receive = async (message: IncomingFrame): Promise<void> => {
    const data = await toFrameBytes(message);
    if (typeof data === 'string') {
      client.frames.push({
        kind: 'invalid',
        bytes: new TextEncoder().encode(data),
      });
      return;
    }
    client.frames.push(classify(data));

    const decoder = decoding.createDecoder(data);
    // the frame type, then - for a sync frame - the sync message itself
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return; // awareness: nothing to apply
    const encoder = encoding.createEncoder();
    const type = syncProtocol.readSyncMessage(decoder, encoder, doc, APPLIED_REMOTELY);
    if (type === SYNC_STEP_2) syncSeen = true;
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 0) socket.send(syncFrameOf(reply));
  };

  let pending: Promise<void> = Promise.resolve();
  socket.addEventListener('message', (event) => {
    pending = pending
      .then(() => receive(event.data as IncomingFrame))
      .catch(() => {
        // a frame this client cannot read is a room bug the tests notice elsewhere
      });
  });
  socket.addEventListener('close', (event) => {
    const close = event as unknown as CloseEventShape;
    client.closes.push({
      code: close.code ?? 1005,
      reason: close.reason ?? '',
      wasClean: close.wasClean ?? false,
    });
  });
  socket.addEventListener('error', (event) => {
    client.errors.push(event);
  });

  // a local change goes to the room, exactly like the browser provider does it - and, like
  // the provider, changes made while the socket is closed are simply kept for the next sync
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === APPLIED_REMOTELY) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    try {
      socket.send(syncFrameOf(encoding.toUint8Array(encoder)));
    } catch {
      // the connection went away mid-change; the next sync carries it
    }
  });

  client.sendSyncStep1();
  return client;
}

/**
 * Initializes a board via POST /api/boards, returning the created id.
 * Use before `connect()` in tests that address a specific id.
 */
export async function createBoardViaApi(): Promise<string> {
  const response = await SELF.fetch('http://vidi6.local/api/boards', { method: 'POST' });
  if (response.status !== 201) {
    throw new Error(`POST /api/boards returned ${response.status}`);
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

/**
 * Ensures a board with the given id exists (initializes it). Used before `connect()` in tests
 * that already have a board id.
 */
export async function ensureBoard(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await stub.initialize();
}

/** Connects through the Worker: `GET /api/rooms/<boardId>` with an upgrade. */
export async function connect(
  boardId: string,
  options?: { doc?: Y.Doc; init?: boolean },
): Promise<RoomClient> {
  const response = await SELF.fetch(upgradeRequest(`http://vidi6.local/api/rooms/${boardId}`));
  if (response.status !== 101) {
    throw new Error(`connecting to /api/rooms/${boardId} returned ${response.status}`);
  }
  return wrapClient(response, { ...options, boardId });
}

/**
 * Connects straight to a Durable Object instance - used to simulate a fresh room after a
 * restart, where the runtime hands out a new instance id for the same board.
 */
export async function connectToStub(
  stub: DurableObjectStub,
  options?: { doc?: Y.Doc },
): Promise<RoomClient> {
  const response = await stub.fetch(upgradeRequest('http://vidi6.local/api/rooms/internal'));
  if (response.status !== 101) {
    throw new Error(`connecting to the room returned ${response.status}`);
  }
  return wrapClient(response, options);
}

/** True when every document has the same state vector, i.e. everyone holds the same board. */
export function sameState(clients: readonly RoomClient[]): boolean {
  const [first, ...rest] = clients;
  if (!first) return true;
  const base = Y.encodeStateVector(first.doc);
  return rest.every((client) => {
    const other = Y.encodeStateVector(client.doc);
    if (other.length !== base.length) return false;
    return base.every((value, index) => value === other[index]);
  });
}

/** True when every document renders to the same notes, in the same order. */
export function sameNotes(clients: readonly RoomClient[]): boolean {
  const [first, ...rest] = clients;
  if (!first) return true;
  const base = JSON.stringify(first.notes());
  return rest.every((client) => JSON.stringify(client.notes()) === base);
}

/** Polls until all clients hold the same state and the same notes. */
export async function converge(
  clients: readonly RoomClient[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(
    () => sameState(clients) && sameNotes(clients),
    timeoutMs,
    `clients did not converge within ${timeoutMs}ms`,
  );
}

/** Closes every client's socket, ignoring sockets that are already gone. */
export function closeAll(clients: readonly RoomClient[]): void {
  for (const client of clients) {
    try {
      client.close(1000, 'test over');
    } catch {
      // already closed
    }
  }
}
