// A second pair of hands on a board, for tests: a small client that speaks
// exactly the frames the browser's provider speaks — sync step 1 when the
// socket opens, sync step 2 / updates in reply, awareness sent on its own
// frame type — so a test can put several editors on one address and read back
// what each of them sees.
//
// It is deliberately not `WebsocketProvider` itself: the provider would build
// its own socket, and the subject of these tests is the *room*. What the
// provider does — how it reconnects, how one keystroke becomes one frame — is
// covered end to end in `tests/e2e/live-collaboration.spec.ts` in real browsers.
//
// How each fixture of the design is provided:
//   * `open()`                  — upgrade through `SELF.fetch` + our SyncStep1
//   * `close()`                 — a clean close, i.e. a closed tab
//   * `sendSync()`              — `sendSyncStep1()`
//   * `receiveSync()`           — `settle()`: wait for the exchange to quieten
//   * `received()`              — `syncFramesReceived`, `awarenessFramesReceived`
//   * `text()`                  — `noteText(id)`, `noteTexts()`
//   * `sentUpdateBytes()`       — `updateBytesSent`
//   * `sendText()`              — `createNote()`, `typeAt()`, `setText()`,
//                                `moveNote()`, `setColor()`, `deleteNote()`
//   * `sendAwarenessQuery()`    — the query-awareness frame
//   * `waitForText()`           — `waitForText()`, `waitForNoteCount()`
//   * `importIntoYDoc(snapshot)`— `seedNote()` (a note put on the board before
//                                anyone else is watching)
import * as Y from 'yjs';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { ROOM_PATH_PREFIX } from '../../../src/shared/routes';
import type { Env } from '../../../src/worker/index';
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../../src/shared/protocol';
import { sleep, until, untilAsync } from './wait';

/** Give `cloudflare:test`'s `env` the app's own bindings. */
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

/** Origin of this client's own edits, which is the only one worth sending. */
const ORIGIN_LOCAL = 'test-client';

/** Origin of everything the room wrote into this client's document. */
const ORIGIN_REMOTE = 'test-room';

/** The room's guts, for the few tests that must look inside one.
 * Story 4 moved the room to the hibernation API: its sockets are the runtime's
 * (`ctx.getWebSockets()`), no longer an in-memory `Set`, so that is what the
 * tests read. `state` is the room's own lifecycle field (`RoomState`). */
export interface RoomInternals {
  ctx: DurableObjectState;
  ydoc: Y.Doc | null;
  state: string;
  store: unknown;
  broadcast(data: Uint8Array | ArrayBuffer, except: unknown): void;
  sendTo(socket: WebSocket, data: Uint8Array | ArrayBuffer): void;
}

/** A WebSocket the runtime reports as open. `getWebSockets()` keeps a socket
 * while it is still closing, so "how many people are connected" counts only
 * the ones that can still carry bytes. */
function openSockets(room: RoomInternals): WebSocket[] {
  return room.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
}

/** What a test may put on the wire. */
export type Frame = string | Uint8Array | ArrayBuffer;

/**
 * workerd sends a `Uint8Array` happily; its own type declaration for
 * `WebSocket.send` only names `string | ArrayBuffer`, so a view is copied into
 * a buffer of its own first.
 */
export function asMessage(data: Frame): string | ArrayBuffer {
  if (typeof data === 'string') return data;
  return data instanceof ArrayBuffer ? data : data.slice().buffer;
}

/** Code-point offset inside `text` as a utf-16 offset (what Y.Text counts). */
function utf16Offset(text: string, codePoints: number): number {
  return Array.from(text)
    .slice(0, codePoints)
    .join('').length;
}

/** One editor on one board. */
export class TestClient {
  readonly ydoc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.ydoc);

  /** Every frame received, counted by kind. */
  framesReceived = 0;
  syncFramesReceived = 0;
  /** Sync frames counted by sub-type, so "no update arrived" is testable. */
  syncStep1Received = 0;
  syncStep2Received = 0;
  updateFramesReceived = 0;
  awarenessFramesReceived = 0;
  queryAwarenessFramesReceived = 0;
  /** Total bytes handed to the socket as document updates. */
  updateBytesSent = 0;
  /** What our socket reported when it went away, null while it is open. */
  closeCode: number | null = null;
  /** Awareness payloads received, in arrival order. */
  readonly awarenessPayloads: Uint8Array[] = [];

  private socket: WebSocket | null = null;

  constructor(
    readonly boardId: string,
    readonly name: string,
  ) {
    initDoc(this.ydoc);
    this.awareness.setLocalStateField('user', { name });
    // What the provider does with a local transaction: one update frame out.
    // `board-model`'s mutators pass no origin of their own, so anything that
    // is not known to be the room's doing is treated as ours — which is what
    // the provider's `origin !== ydoc` test amounts to.
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.updateBytesSent += update.length;
      this.rawSend(encoding.toUint8Array(encoder));
    });
  }

  /** Open a socket and start the sync exchange. */
  async open(): Promise<void> {
    const response = await SELF.fetch(`http://localhost${ROOM_PATH_PREFIX}${this.boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      throw new Error(`${this.name}: upgrade to board ${this.boardId} failed (${response.status})`);
    }
    socket.accept();
    this.closeCode = null;
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent) => {
      this.receive(event.data as ArrayBuffer | string);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
      if (this.socket === socket) this.socket = null;
    });
    socket.addEventListener('error', () => {
      this.closeCode ??= -1;
    });
    // Step one, exactly as the provider sends it when its socket opens.
    this.sendSyncStep1();
  }

  /** Drop and re-open the socket, which is what a recovered connection is. */
  async reconnect(): Promise<void> {
    this.close();
    await this.open();
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    try {
      socket.close(1000, 'bye');
    } catch {
      /* already gone */
    }
  }

  // --- the board as this client sees it --------------------------------------

  notes(): readonly StickySnapshot[] {
    return snapshot(this.ydoc);
  }

  noteIds(): string[] {
    return this.notes().map((note) => note.id);
  }

  noteText(id: string): string {
    return this.notes().find((note) => note.id === id)?.text ?? '';
  }

  noteTexts(): string[] {
    return this.notes().map((note) => note.text);
  }

  noteColor(id: string): string {
    return this.notes().find((note) => note.id === id)?.color ?? '';
  }

  awarenessNames(): string[] {
    const names: string[] = [];
    this.awareness.getStates().forEach((state: unknown) => {
      const user = (state as { user?: { name?: string } }).user;
      if (user?.name !== undefined) names.push(user.name);
    });
    return names;
  }

  // --- local edits (each one is one transaction, i.e. one frame) -------------

  /** Ask the room what it has (sync step 1). */
  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.ydoc);
    this.rawSend(encoding.toUint8Array(encoder));
  }

  createNote(at: { x?: number; y?: number } = {}): string {
    return this.edit(() => createSticky(this.ydoc, { x: at.x ?? 0, y: at.y ?? 0 }));
  }

  /** Insert `text` at the code-point offset `index` of a note. */
  typeAt(id: string, index: number, text: string): void {
    this.edit(() => {
      const ytext = this.mustText(id);
      ytext.insert(utf16Offset(ytext.toString(), index), text);
    });
  }

  /** Replace a note's whole text. */
  setText(id: string, text: string): void {
    this.edit(() => {
      const ytext = this.mustText(id);
      ytext.delete(0, ytext.length);
      if (text.length > 0) ytext.insert(0, text);
    });
  }

  moveNote(id: string, x: number, y: number): boolean {
    return this.edit(() => moveObject(this.ydoc, id, x, y));
  }

  setColor(id: string, color: string): boolean {
    return this.edit(() => setStickyColor(this.ydoc, id, color));
  }

  deleteNote(id: string): boolean {
    return this.edit(() => deleteObject(this.ydoc, id));
  }

  /** An awareness update of our own state, on the awareness frame type. */
  sendAwareness(): Uint8Array {
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.rawSend(encoding.toUint8Array(encoder));
    return update;
  }

  /** "Send me every awareness state you know": the room keeps none. */
  sendAwarenessQuery(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    this.rawSend(encoding.toUint8Array(encoder));
  }

  /** A frame the room cannot use, for the error paths. */
  sendRaw(data: Frame): void {
    this.rawSend(data);
  }

  /** True while the socket is open and the room still holds it. */
  get isOpen(): boolean {
    return this.socket !== null && this.closeCode === null;
  }

  /** Not a frame at all: a plain text message, which y-websocket never sends. */
  sendTextFrame(text: string): void {
    this.sendRaw(text);
  }

  /** A frame that stops in the middle of a field. */
  sendTruncatedBytes(): void {
    this.sendRaw(Uint8Array.from([0]));
  }

  /** A frame with a message type y-websocket does not have. */
  sendUnknownType(): void {
    this.sendRaw(Uint8Array.from([9, 1, 0]));
  }

  /** A sync frame whose update is not a Yjs update. */
  sendGarbageSyncFrame(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, 2);
    encoding.writeUint8Array(encoder, Uint8Array.from([0xff, 0xff, 0xff]));
    this.rawSend(encoding.toUint8Array(encoder));
  }

  // --- waiting ---------------------------------------------------------------

  /** Wait until this client has seen `count` notes. */
  waitForNoteCount(count: number, timeoutMs = 4000): Promise<void> {
    return until(
      () => this.noteIds().length === count,
      `${this.name} to see ${count} note(s) on board ${this.boardId}`,
      timeoutMs,
    );
  }

  /** Wait until a note reads exactly `text` here. */
  waitForText(id: string, text: string, timeoutMs = 4000): Promise<void> {
    return until(
      () => this.noteText(id) === text,
      `${this.name} to see ${JSON.stringify(text)} on note ${id}`,
      timeoutMs,
    );
  }

  /** Wait until this client's socket has gone away. */
  waitForClosed(timeoutMs = 4000): Promise<void> {
    return until(() => this.closeCode !== null, `${this.name}'s socket to close`, timeoutMs);
  }

  /** Wait for a note's colour to arrive here. */
  waitForColor(id: string, color: string, timeoutMs = 4000): Promise<void> {
    return until(
      () => this.noteColor(id) === color,
      `${this.name} to see note ${id} as ${color}`,
      timeoutMs,
    );
  }

  // --- internals -------------------------------------------------------------

  /**
   * One local edit, one transaction, one frame — the shape the browser makes
   * a keystroke into. A mutator that opens a transaction of its own is folded
   * into this one, and keeps its origin.
   */
  private edit<T>(change: () => T): T {
    let result: T;
    this.ydoc.transact(() => {
      result = change();
    }, ORIGIN_LOCAL);
    return result!;
  }

  private mustText(id: string): Y.Text {
    const ytext = getStickyText(this.ydoc, id);
    if (ytext === undefined) throw new Error(`${this.name}: board has no note ${id}`);
    return ytext;
  }

  private receive(data: ArrayBuffer | string): void {
    this.framesReceived++;
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        // Counted by the protocol's own constants, which are 0, 1 and 2 in
        // that order — guessing them is how "no update arrived" stops meaning
        // anything.
        const subType = decoding.peekVarUint(decoding.createDecoder(decoded.payload));
        if (subType === syncProtocol.messageYjsSyncStep1) this.syncStep1Received++;
        else if (subType === syncProtocol.messageYjsSyncStep2) this.syncStep2Received++;
        else if (subType === syncProtocol.messageYjsUpdate) this.updateFramesReceived++;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          // ORIGIN_REMOTE is what keeps our own update listener from sending
          // the change straight back — the same guard the provider uses.
          syncProtocol.readSyncMessage(
            decoding.createDecoder(decoded.payload),
            encoder,
            this.ydoc,
            ORIGIN_REMOTE,
          );
        } catch {
          // The room answers this by closing our socket; nothing else to do.
          return;
        }
        this.syncFramesReceived++;
        if (encoding.length(encoder) > 1) this.rawSend(encoding.toUint8Array(encoder));
        return;
      }
      case 'awareness': {
        this.awarenessFramesReceived++;
        this.awarenessPayloads.push(decoded.payload);
        try {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.payload, ORIGIN_REMOTE);
        } catch {
          /* a room that sends nonsense awareness is not this client's problem */
        }
        return;
      }
      case 'query-awareness':
        this.queryAwarenessFramesReceived++;
        return;
      case 'invalid':
        return;
    }
  }

  private rawSend(data: Frame): void {
    const socket = this.socket;
    if (socket === null) return;
    try {
      socket.send(asMessage(data));
    } catch {
      /* the room has already dropped us */
    }
  }
}

/** Wait until no frame has arrived for `quietMs`: the exchange has settled. */
export async function settle(client: TestClient, quietMs = 40): Promise<void> {
  let seen = -1;
  while (seen !== client.framesReceived) {
    seen = client.framesReceived;
    await sleep(quietMs);
  }
}

/** A connected editor whose documents agree with the room. */
export async function connectClient(boardId: string, name: string): Promise<TestClient> {
  const client = new TestClient(boardId, name);
  await client.open();
  await settle(client);
  return client;
}

/** Several connected editors. */
export async function connectClients(
  boardId: string,
  names: readonly string[],
): Promise<TestClient[]> {
  const clients: TestClient[] = [];
  for (const name of names) clients.push(await connectClient(boardId, name));
  return clients;
}

/**
 * Put a note on a board before anyone is watching, the way a board that was
 * saved earlier looks when the first person arrives.
 */
export async function seedNote(
  boardId: string,
  note: { x?: number; y?: number; text?: string; color?: string } = {},
): Promise<string> {
  const client = new TestClient(boardId, 'seeder');
  await client.open();
  const id = client.createNote({ x: note.x, y: note.y });
  if (note.text !== undefined) client.setText(id, note.text);
  if (note.color !== undefined) client.setColor(id, note.color);
  await settle(client);
  client.close();
  return id;
}

/** The Durable Object that serves a board. */
export function roomStub(boardId: string): DurableObjectStub {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/**
 * Evict the room: drop its sockets and throw away its in-memory document, which
 * is what a deploy or a runtime eviction does. Story 4 keeps the board in the
 * room's own storage, so eviction is no longer loss — going to `storage-failed`
 * is exactly what makes the next connection read the board back from storage,
 * which is the point of the story. Any client can rebuild it by reconnecting,
 * because Yjs merges; and a room that reloads from storage arrives with the
 * board already in it.
 */
export async function simulateRoomEviction(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    for (const socket of room.ctx.getWebSockets()) {
      try {
        socket.close(1001, 'evicted');
      } catch {
        /* already gone */
      }
    }
    room.ydoc?.destroy();
    room.ydoc = null;
    // Ask the next connection to read storage rather than trust what is here.
    room.state = 'storage-failed';
  });
}

/** Read the room's own state (how many sockets it holds open, what its document
 * has). A hibernated room reports its live sockets through `ctx.getWebSockets()`. */
export async function inspectRoom(boardId: string): Promise<{ sockets: number; notes: number }> {
  return runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    return {
      sockets: openSockets(room).length,
      notes: room.ydoc === null ? 0 : snapshot(room.ydoc).length,
    };
  });
}

/** The store the room holds, for the tests that must inject a storage fault. */
interface StoreInternals {
  append(update: Uint8Array): void;
  readSnapshot(): Uint8Array | null;
  load(doc: Y.Doc): unknown;
  countUpdates(): number;
  countChunks(): number;
  countQuarantined(): number;
}

/**
 * Make the next `store.append` throw once, then behave normally: the fixture
 * `persist.room` names for a write that fails (`store.append` stubbed to throw).
 * The fault is installed on the room's own live store instance.
 */
export async function stubAppendOnce(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const store = (object as unknown as RoomInternals).store as StoreInternals & {
      __origAppend?: (u: Uint8Array) => void;
    };
    const original = store.append.bind(store);
    let armed = true;
    store.append = (update: Uint8Array): void => {
      if (armed) {
        armed = false;
        throw new Error('injected storage write failure');
      }
      original(update);
    };
  });
}

/** Undo any injected append fault, restoring the store's real method. */
export async function clearAppendFault(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    // Re-loading the prototype method clears the shadowing own property. Cast
    // through a string index so `delete` is allowed on a method the class declares.
    const store = (object as unknown as RoomInternals).store as unknown as Record<string, unknown>;
    delete store.append;
  });
}

/**
 * Make the store's snapshot read throw: the real `load` then reports
 * `ok: false, reason: 'sql-error'`, which is `persist.room`'s read-failure
 * fixture ("make SELECT throw via injected store"). It is installed on the
 * live store and the room's document is dropped so the next connection reloads.
 */
export async function stubReadFailureAndDrop(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    const store = room.store as StoreInternals;
    store.readSnapshot = (): Uint8Array | null => {
      throw new Error('injected storage read failure');
    };
    // Force the next connection to read storage again, into the fault.
    room.ydoc?.destroy();
    room.ydoc = null;
  });
}

/** Remove the injected read fault so a later load succeeds. */
export async function clearReadFault(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    const store = room.store as unknown as Record<string, unknown>;
    delete store.readSnapshot;
    // The room is sitting on a load-failed state from the fault; ask the next
    // connection to read storage now rather than wait out the retry interval.
    room.state = 'storage-failed';
  });
}

/**
 * Drop the room's in-memory document but keep its storage, which is what a
 * runtime eviction or a redeploy does: the board is gone from memory and must
 * come back from SQLite on the next connection. The state stays `ready`, so a
 * reload is driven only by "there is no document here any more".
 */
export async function forceMemoryEviction(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    for (const socket of room.ctx.getWebSockets()) {
      try {
        socket.close(1001, 'evicted');
      } catch {
        /* already gone */
      }
    }
    room.ydoc?.destroy();
    room.ydoc = null;
  });
}

/** Read the board straight out of a board's SQLite, into a fresh document. */
export async function notesInStorage(boardId: string): Promise<readonly StickySnapshot[]> {
  return runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomInternals;
    const store = room.store as StoreInternals;
    const fresh = new Y.Doc();
    // Load the stored board into a document that has never been on the wire.
    (store as { load(doc: Y.Doc): unknown }).load(fresh);
    return snapshot(fresh);
  });
}

/** How many log rows a board's storage holds. */
export async function updateRowsInStorage(boardId: string): Promise<number> {
  return runInDurableObject(roomStub(boardId), (object) => {
    const store = (object as unknown as RoomInternals).store as StoreInternals;
    return store.countUpdates();
  });
}

/** The room's own test hooks, called in-object (they are RPC methods). */
interface RoomHooks {
  testCorruptSnapshot(): boolean;
  testRepairSnapshot(): boolean;
  store: StoreInternals & { compactNow(doc: Y.Doc): boolean };
  ydoc: Y.Doc | null;
}

/** Fold the room's log into a snapshot now, so a snapshot exists to inspect. */
export async function compactRoomNow(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (object) => {
    const room = object as unknown as RoomHooks;
    if (room.ydoc !== null) room.store.compactNow(room.ydoc);
  });
}

/** Damage the board's snapshot through the room's own test hook. */
export async function corruptSnapshot(boardId: string): Promise<boolean> {
  return runInDurableObject(roomStub(boardId), (object) =>
    (object as unknown as RoomHooks).testCorruptSnapshot(),
  );
}

/** Repair the board's snapshot through the room's own test hook. */
export async function repairSnapshot(boardId: string): Promise<boolean> {
  return runInDurableObject(roomStub(boardId), (object) =>
    (object as unknown as RoomHooks).testRepairSnapshot(),
  );
}

export { runInDurableObject, env, SELF };
export { sleep, until, untilAsync } from './wait';
export { ROOM_PATH_PREFIX } from '../../../src/shared/routes';