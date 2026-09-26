// Integration-test WebSocket client for the BoardRoom (workerd runtime).
//
// A minimal y-websocket *client* speaking the exact wire protocol the real
// client (y-websocket's WebsocketProvider) speaks: binary frames of
// [varUint type][payload]. It keeps a Y.Doc, answers sync messages with
// y-protocols' readSyncMessage, and logs every received frame so tests can
// assert on the wire traffic (e.g. "no echo back to the sender").
//
// Not a browser client: it runs inside workerd next to the worker, so no
// reconnect logic, no Awareness watchdog, no BroadcastChannel.

import { SELF } from 'cloudflare:test';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import {
  createEncoder,
  length,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
} from '../../src/shared/protocol';
import {
  LOCAL_ORIGIN,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/** One received frame, already classified. */
export interface ReceivedFrame {
  type: number;
  /** Bytes after the message-type byte. */
  payload: Uint8Array;
  /** For sync frames: 0 = step1, 1 = step2, 2 = update. */
  syncSub?: number;
  /** For sync step2/update frames: the Yjs update bytes. */
  update?: Uint8Array;
  /** For awareness frames: the awareness update bytes. */
  awarenessUpdate?: Uint8Array;
}

// LOCAL_ORIGIN is the board-model symbol: every mutation the tests apply
// (applyLocal or a direct board-model call on the doc) commits under it, so
// the update handler below can tell local work from remote application.

let clientCounter = 0;

export class WsClient {
  readonly name: string;
  readonly doc = new Y.Doc();
  readonly ws: WebSocket;
  readonly received: ReceivedFrame[] = [];
  private holding = false;
  private held: ArrayBuffer[] = [];
  private closed: { code: number; reason: string } | null = null;
  private closeResolvers: ((r: { code: number; reason: string }) => void)[] = [];
  private destroyed = false;
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

  private constructor(ws: WebSocket, name: string, holding: boolean, doc?: Y.Doc) {
    this.ws = ws;
    this.name = name;
    this.holding = holding;
    if (doc !== undefined) {
      // Reconnect: attach to the client's surviving doc (its state vector
      // and content come along — exactly what WebsocketProvider does).
      this.doc = doc;
    }
    this.updateHandler = (update, origin) => {
      if (origin !== LOCAL_ORIGIN) return; // never echo remote updates back
      const enc = createEncoder();
      writeVarUint(enc, MESSAGE_SYNC);
      writeUpdate(enc, update);
      const out = toUint8Array(enc).buffer as ArrayBuffer;
      if (this.holding || this.destroyed) this.held.push(out);
      else this.ws.send(out);
    };
    this.doc.on('update', this.updateHandler);
    ws.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(ev.data as ArrayBuffer | string);
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      this.closed = { code: ev.code, reason: ev.reason };
      for (const resolve of this.closeResolvers.splice(0)) resolve(this.closed);
    });
  }

  /**
   * Open a WebSocket to the room for `boardId` via the worker's own route
   * (SELF.fetch performs the upgrade; workerd attaches the server socket to
   * the 101 response). By default the client performs the initial exchange
   * immediately (sends its SyncStep1); with `autoExchange: false` every
   * outbound sync frame is held until flush().
   */
  static async connect(
    boardId: string,
    opts: { autoExchange?: boolean } = {},
  ): Promise<WsClient> {
    const autoExchange = opts.autoExchange !== false;
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    ws.accept(); // in-process upgrade: the caller accepts its half
    const client = new WsClient(ws, `client-${++clientCounter}`, !autoExchange);
    if (autoExchange) client.sendStep1();
    return client;
  }

  /**
   * Reconnect an EXISTING Y.Doc to a room (the client's doc survives
   * reconnects in the real client too). The exchange sends the doc's full
   * state, repopulating an empty room.
   */
  static async adopt(boardId: string, doc: Y.Doc): Promise<WsClient> {
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    ws.accept(); // in-process upgrade: the caller accepts its half
    const client = new WsClient(ws, `client-${++clientCounter}`, false, doc);
    client.sendStep1();
    return client;
  }

  /** Send our state vector, like WebsocketProvider does on socket open. */
  sendStep1(): void {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeSyncStep1(enc, this.doc);
    const out = toUint8Array(enc).buffer as ArrayBuffer;
    if (this.holding || this.destroyed) this.held.push(out);
    else this.ws.send(out);
  }

  /** Hold every outbound sync frame (for concurrent-join scenarios). */
  holdUpdates(): void {
    this.holding = true;
  }

  /** Send all held frames, in order. */
  flush(): void {
    this.holding = false;
    for (const frame of this.held.splice(0)) this.ws.send(frame);
  }

  /** Apply a local mutation (createStickyAt / moveObject / ... on this.doc). */
  /** Apply a local mutation and return its result (e.g. a new note id). */
  applyLocal<T>(mutate: (doc: Y.Doc) => T): T {
    let result: T;
    this.doc.transact(
      () => {
        result = mutate(this.doc);
      },
      LOCAL_ORIGIN,
    );
    return result;
  }

  /** Send arbitrary bytes (or a string, for a text frame) unframed. */
  sendRaw(data: ArrayBuffer | string): void {
    this.ws.send(data);
  }

  /** Resolves with the close code/reason once the socket is closed. */
  closeInfo(): Promise<{ code: number; reason: string }> {
    if (this.closed !== null) return Promise.resolve(this.closed);
    return new Promise((resolve) => this.closeResolvers.push(resolve));
  }

  /** Cleanly close our side. */
  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closing/closed
    }
  }

  /** Snapshot of this client's board (same function the UI renders from). */
  boardSnapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /**
   * Wait until the doc's state vector and the received-frame count are both
   * stable (nothing in flight). workerd delivers in-process, so this is fast.
   */
  async waitForSync(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let prevSv = Y.encodeStateVector(this.doc);
    let prevCount = this.received.length;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const sv = Y.encodeStateVector(this.doc);
      const count = this.received.length;
      if (bytesEqual(sv, prevSv) && count === prevCount) return;
      prevSv = sv;
      prevCount = count;
    }
    throw new Error(`${this.name}: doc not stable within ${timeoutMs}ms`);
  }

  /** True when this client has seen a note with `id` in its doc. */
  hasNote(id: string): boolean {
    return this.boardSnapshot().some((n) => n.id === id);
  }

  /**
   * Poll until `check()` is true or the timeout expires. Used to assert that
   * a remote change arrived, with an explicit budget.
   */
  async waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`${this.name}: condition not met within ${timeoutMs}ms`);
  }

  /**
   * Stop answering and close; the doc is detached from the socket. Awaits
   * the close handshake so the room releases its socket before the test
   * ends (workerd's isolated storage needs DOs idle at teardown).
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off('update', this.updateHandler);
    this.close();
    // Note: with the hibernation API (ctx.acceptWebSocket) a SELF-initiated
    // close never fires the client half's close event in the workerd test
    // pool (server-initiated closes do), so there is no close event to wait
    // for - just a short grace for the pool to process the teardown. The
    // old 1000ms race timeout cost a full second per destroyed client.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  private onMessage(data: ArrayBuffer | string): void {
    if (this.destroyed) return;
    if (typeof data === 'string') return; // this client never expects text
    const dec = createDecoder(new Uint8Array(data));
    const type = readVarUint(dec);
    const frame: ReceivedFrame = {
      type,
      payload: dec.arr.slice(dec.pos),
    };
    if (type === MESSAGE_SYNC) {
      frame.syncSub = readVarUint(dec);
      const bytes = readVarUint8Array(dec);
      if (frame.syncSub === SYNC_STEP2 || frame.syncSub === SYNC_UPDATE) {
        frame.update = bytes;
      }
    } else if (type === MESSAGE_AWARENESS) {
      frame.awarenessUpdate = readVarUint8Array(dec);
    }
    this.received.push(frame);
    if (type === MESSAGE_SYNC) this.respondToSync(frame);
  }

  /** Answer a sync frame exactly like the y-websocket client does. */
  private respondToSync(frame: ReceivedFrame): void {
    const dec = createDecoder(frame.payload);
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    try {
      readSyncMessage(dec, enc, this.doc, this);
    } catch {
      return; // ignore anything malformed in test
    }
    if (length(enc) > 1) {
      const out = toUint8Array(enc).buffer as ArrayBuffer;
      if (this.holding || this.destroyed) this.held.push(out);
      else this.ws.send(out);
    }
  }
}

/**
 * The room's own doc state, observed by joining with a fresh empty client:
 * the room answers the probe's SyncStep1 with everything the room holds.
 * The probe makes no local changes, so it cannot perturb the room.
 */
export async function probeRoomSnapshot(boardId: string): Promise<readonly StickySnapshot[]> {
  const probe = await WsClient.connect(boardId);
  try {
    await probe.waitForSync();
    return probe.boardSnapshot();
  } finally {
    await probe.destroy();
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
