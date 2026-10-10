import { SELF, env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { newBoardId } from '../../../src/shared/board-id';
import { createSticky, getStickyText, snapshot } from '../../../src/shared/board-model';
import type { StickySnapshot } from '../../../src/shared/board-model';
import type { Env } from '../../../src/worker/index';
import { ROOM_ROUTE_PREFIX } from '../../../src/shared/config';
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC } from '../../../src/shared/protocol';

/**
 * Test helpers for the live board, used by the integration suite.
 *
 * A `RoomSocket` is a real WebSocket from the Workers test runtime to the real
 * `BoardRoom`, opened through the real Worker entry. Frames are built and read
 * with the same lib0/y-protocols code the browser provider uses, so these tests
 * speak the production protocol rather than a mock of it.
 */

/** The Worker's bindings, typed as the Worker entry declares them. */
export const bindings = (): Env => env as unknown as Env;

/** A board address unique to one test, so tests never share a room. */
export function newBoardIdFor(label: string): string {
  const prefix = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 10);
  return (prefix + newBoardId()).slice(0, 22);
}

/** A board address no one has connected to (a room that must not exist yet). */
export const newUnusedBoardId = (): string => newBoardId();

/**
 * Create a board by calling `initialize()` on its own room over Durable Object
 * RPC - exactly what `POST /api/boards` does (`share.board_api`).
 */
export async function initializeBoard(boardId: string): Promise<'created' | 'exists'> {
  const ns = bindings().BOARD_ROOM;
  const stub = ns.get(ns.idFromName(boardId));
  return runInDurableObject(stub, (instance) => instance.initialize());
}

/**
 * Make sure a board exists before a test connects to it.
 *
 * Story 5 (`share.not_found`) removed the old shortcut where connecting to an
 * address made a board, so a test that wants a live room creates one the way the
 * product does. A board whose room has already been instantiated is left alone:
 * the test that instantiated it has prepared it (and may have swapped its
 * storage to inject a failure), and re-initialising it is not what that test is
 * asking about.
 */
export async function ensureBoard(boardId: string): Promise<'created' | 'exists'> {
  if (await hasRoom(boardId)) {
    return 'exists';
  }
  return initializeBoard(boardId);
}

/** Create a brand new board through the real HTTP API and return its address. */
export async function createBoardViaApi(): Promise<string> {
  const response = await SELF.fetch(`${SELF_ORIGIN}/api/boards`, { method: 'POST' });
  if (response.status !== 201) {
    throw new Error(`expected a 201 from POST /api/boards, got ${response.status}`);
  }
  const body = (await response.json()) as { id?: string };
  if (typeof body.id !== 'string') {
    throw new Error('POST /api/boards did not return an id');
  }
  return body.id;
}

/** Does the board API say this board exists? */
export async function boardExistsViaApi(boardId: string): Promise<boolean> {
  const response = await SELF.fetch(`${SELF_ORIGIN}/api/boards/${boardId}`);
  return response.status === 200;
}

/** How many room objects exist in total (a room is created on first visit). */
export async function roomCount(): Promise<number> {
  return (await listDurableObjectIds(bindings().BOARD_ROOM)).length;
}

/** Has a room object been created for this board id? */
export async function hasRoom(boardId: string): Promise<boolean> {
  const ns = bindings().BOARD_ROOM;
  const ids = await listDurableObjectIds(ns);
  return ids.map(String).includes(String(ns.idFromName(boardId)));
}

/** The room's own document, read from inside the Durable Object. */
export async function roomSnapshot(boardId: string): Promise<readonly StickySnapshot[]> {
  const ns = bindings().BOARD_ROOM;
  const stub = ns.get(ns.idFromName(boardId));
  return runInDurableObject(stub, (instance) => instance.inspectDoc());
}

const SELF_ORIGIN = 'http://board.test';

/** A frame holding SyncStep1 for `doc`, i.e. "what do you have?". */
export const syncStep1Frame = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

/** A frame holding `update`, i.e. "here is what changed". */
export const updateFrame = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

/** A frame holding an awareness update for `doc`'s awareness state. */
export const awarenessFrame = (
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
  );
  return encoding.toUint8Array(encoder);
};

/** A frame asking "who is here?", which this story never answers. */
export const queryAwarenessFrame = (): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
};

/** Do two frames hold exactly the same bytes? */
export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** Wait `ms` so "nothing more arrived" can be asserted. */
export const settle = (ms = 250): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalise a received frame to bytes. The Workers test runtime delivers
 * WebSocket payloads as `Blob`, browsers deliver `ArrayBuffer` when
 * `binaryType` is set, so accept all three shapes.
 */
async function toBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Blob) {
    const buffer = (await data.arrayBuffer()) as ArrayBuffer;
    return new Uint8Array(buffer);
  }
  throw new Error(`unsupported frame type ${(data as object)?.constructor?.name}`);
}

export interface RoomSocket {
  readonly ws: WebSocket;
  /** Every frame received so far, in order. */
  readonly frames: Uint8Array[];
  send(payload: Uint8Array): void;
  /** Be told about each frame as it is recorded. */
  onFrame(listener: (frame: Uint8Array, index: number) => void): void;
  /** Wait until at least `count` frames have been recorded. */
  waitForFrames(count: number, timeoutMs?: number): Promise<void>;
  frameCount(): number;
  /** Resolve once the room has closed this socket. */
  closed(timeoutMs?: number): Promise<{ code: number; reason: string }>;
  close(code?: number, reason?: string): void;
}

/** Open a live connection to `boardId`'s room through the real Worker entry. */
export async function connectRoom(boardId: string): Promise<RoomSocket> {
  // Story 5: a room only serves a board that exists, so a test that wants a
  // room creates its board first (`ensureBoard`, i.e. what `POST /api/boards`
  // does). Tests that assert the refusal itself call the Worker directly.
  await ensureBoard(boardId);
  const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${boardId}`, {
    headers: { upgrade: 'websocket', 'sec-websocket-version': '13' },
  });
  const ws = response.webSocket;
  if (response.status !== 101 || ws === null) {
    throw new Error(`expected a 101 upgrade, got ${response.status}`);
  }
  ws.accept();

  const frames: Uint8Array[] = [];
  const frameListeners: ((frame: Uint8Array, index: number) => void)[] = [];
  const countWaiters: { target: number; resolve: () => void }[] = [];
  const closeWaiters: ((info: { code: number; reason: string }) => void)[] = [];
  let closedInfo: { code: number; reason: string } | null = null;

  ws.addEventListener('message', (event: MessageEvent) => {
    void toBytes(event.data).then((frame) => {
      const index = frames.length;
      frames.push(frame);
      for (const listener of frameListeners) {
        listener(frame, index);
      }
      // Release exactly the waiters this frame satisfies; the others keep
      // waiting, so a waiter is never spent on the wrong frame.
      for (let index2 = countWaiters.length - 1; index2 >= 0; index2 -= 1) {
        const waiter = countWaiters[index2];
        if (waiter !== undefined && frames.length >= waiter.target) {
          countWaiters.splice(index2, 1);
          waiter.resolve();
        }
      }
    });
  });
  ws.addEventListener('close', (event: CloseEvent) => {
    closedInfo = { code: event.code, reason: event.reason };
    const waiter = closeWaiters.shift();
    if (waiter !== undefined) {
      waiter(closedInfo);
    }
  });

  return {
    ws,
    frames,
    send: (payload: Uint8Array) => {
      // Hand over an exact ArrayBuffer: a view onto a larger buffer is not
      // accepted the same way by the test runtime.
      const bytes = new Uint8Array(payload.byteLength);
      bytes.set(payload);
      ws.send(bytes.buffer);
    },
    onFrame: (listener) => {
      frameListeners.push(listener);
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        const frame = frames[index];
        if (frame !== undefined) {
          listener(frame, index);
        }
      }
    },
    waitForFrames: (count, timeoutMs = 5_000) =>
      frames.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`timed out waiting for ${count} frame(s); got ${frames.length}`));
            }, timeoutMs);
            countWaiters.push({
              target: count,
              resolve: () => {
                clearTimeout(timer);
                resolve();
              },
            });
          }),
    frameCount: () => frames.length,
    closed: (timeoutMs = 5_000) =>
      closedInfo === null
        ? new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error('timed out waiting for the room to close the socket'));
            }, timeoutMs);
            closeWaiters.push((info) => {
              clearTimeout(timer);
              resolve(info);
            });
          })
        : Promise.resolve(closedInfo),
    close: (code?: number, reason?: string) => {
      if (code === undefined) {
        ws.close();
      } else {
        ws.close(code, reason ?? '');
      }
    },
  };
}

/**
 * A client that speaks the protocol the way `y-websocket` does: it keeps its
 * own `Y.Doc`, answers SyncStep1 with SyncStep2, asks for the room's state, and
 * applies everything the room sends as it arrives.
 */
export class ProtocolClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly socket: RoomSocket;
  /** Frames handled so far. */
  private handled = 0;
  /** Yjs Update frames applied so far. */
  private updatesApplied = 0;
  private paused = false;
  private updateWaiters: { target: number; resolve: () => void }[] = [];

  constructor(socket: RoomSocket) {
    this.socket = socket;
    socket.onFrame(() => {
      if (!this.paused) {
        this.handleFrames();
      }
    });
  }

  /** Stop applying frames, e.g. to build up local state first. */
  pause(): void {
    this.paused = true;
  }

  /** Resume, applying everything that arrived meanwhile. */
  resume(): void {
    this.paused = false;
    this.handleFrames();
  }

  /** Exchange state with the room, the way a joining client does. */
  async handshake(): Promise<void> {
    // The room asks first; answer with everything this client has ...
    await this.socket.waitForFrames(1);
    this.handleFrames();
    // ... then ask for everything the room has.
    this.socket.send(syncStep1Frame(this.doc));
    await this.socket.waitForFrames(this.socket.frameCount() + 1);
    this.handleFrames();
  }

  /** Handle every frame received so far. */
  handleFrames(): void {
    while (this.handled < this.socket.frameCount()) {
      const frame = this.socket.frames[this.handled];
      this.handled += 1;
      if (frame === undefined) {
        continue;
      }
      const decoder = decoding.createDecoder(frame);
      const type = decoding.readVarUint(decoder);
      if (type !== MESSAGE_SYNC) {
        continue; // awareness frames carry no document state in this story
      }
      const payload = frame.subarray(decoder.pos);
      const isUpdate =
        decoding.readVarUint(decoding.createDecoder(payload)) === syncProtocol.messageYjsUpdate;
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, 'client');
      if (isUpdate) {
        this.updatesApplied += 1;
        for (let index = this.updateWaiters.length - 1; index >= 0; index -= 1) {
          const waiter = this.updateWaiters[index];
          if (waiter !== undefined && this.updatesApplied >= waiter.target) {
            this.updateWaiters.splice(index, 1);
            waiter.resolve();
          }
        }
      }
      if (encoding.length(reply) > 1) {
        this.socket.send(encoding.toUint8Array(reply));
      }
    }
  }

  /** How many Yjs Update frames this client has applied. */
  updateCount(): number {
    return this.updatesApplied;
  }

  /** Wait until this client has applied at least `count` Update frames. */
  async waitForUpdates(count: number, timeoutMs = 5_000): Promise<void> {
    if (this.updatesApplied >= count) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${count} update(s); got ${this.updatesApplied}`));
      }, timeoutMs);
      this.updateWaiters.push({
        target: count,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  /** Apply `change` locally and send it to the room, as a client would. */
  edit(change: (doc: Y.Doc) => void): Uint8Array {
    const update = captureUpdate(this.doc, change);
    this.socket.send(updateFrame(update));
    return update;
  }

  sendAwareness(): void {
    this.awareness.setLocalStateField('board', 'live');
    this.socket.send(awarenessFrame(this.doc, this.awareness));
  }

  /** Yjs update payloads the room has sent since `marker`, ignoring sync steps. */
  updatesSince(marker: number): Uint8Array[] {
    const updates: Uint8Array[] = [];
    for (const frame of this.socket.frames.slice(marker)) {
      const decoder = decoding.createDecoder(frame);
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
        continue;
      }
      const payload = frame.subarray(decoder.pos);
      const sub = decoding.createDecoder(payload);
      if (decoding.readVarUint(sub) !== syncProtocol.messageYjsUpdate) {
        continue;
      }
      updates.push(decoding.readVarUint8Array(sub));
    }
    return updates;
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  close(): void {
    this.socket.close();
  }
}

/** Create a sticky note holding `text`, in one transaction (one Yjs update). */
export function addSticky(doc: Y.Doc, x: number, y: number, text: string): string {
  let id = '';
  doc.transact(() => {
    id = createSticky(doc, { x, y });
    getStickyText(doc, id)?.insert(0, text);
  });
  return id;
}

/** Insert `text` at `index` in a note's shared text, as one transaction. */
export function insertText(doc: Y.Doc, id: string, index: number, text: string): void {
  doc.transact(() => {
    getStickyText(doc, id)?.insert(index, text);
  });
}

/** Run `change` on `doc` and return the single Yjs update it produced. */
export function captureUpdate(doc: Y.Doc, change: (doc: Y.Doc) => void): Uint8Array {
  const collected: Uint8Array[] = [];
  const observer = (update: Uint8Array): void => {
    collected.push(update);
  };
  doc.on('update', observer);
  try {
    change(doc);
  } finally {
    doc.off('update', observer);
  }
  if (collected.length !== 1) {
    throw new Error(`expected exactly one Yjs update, got ${collected.length}`);
  }
  return collected[0]!;
}

/** Open a connection and exchange state with the room. */
export async function openClient(boardId: string): Promise<ProtocolClient> {
  const client = new ProtocolClient(await connectRoom(boardId));
  await client.handshake();
  return client;
}

/** Reconnect an existing client (its document survives) to the same board. */
export async function reconnect(client: ProtocolClient, boardId: string): Promise<ProtocolClient> {
  // The document is what matters, not the socket: keep it and re-handshake.
  const next = new ProtocolClient(await connectRoom(boardId));
  Y.applyUpdate(next.doc, Y.encodeStateAsUpdate(client.doc));
  await next.handshake();
  return next;
}
