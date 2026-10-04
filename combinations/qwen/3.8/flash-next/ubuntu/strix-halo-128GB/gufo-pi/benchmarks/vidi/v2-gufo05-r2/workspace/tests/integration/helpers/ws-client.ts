/**
 * A test participant: a real `Y.Doc` speaking the y-protocols sync/awareness
 * framing over a real WebSocket, against a real `wrangler dev` server (see
 * `live-server.ts`). The bytes are the same ones the browser's
 * `WebsocketProvider` sends, so the room is exercised through its real input
 * path — nothing about the room is mocked here.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../src/shared/protocol';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

/** Inner y-protocols message types (see y-protocols/sync). */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

export interface ReceivedFrame {
  /** Outer y-websocket frame type (`-1` for a text frame). */
  readonly type: number;
  /** Inner y-protocols sync message type, for sync frames. */
  readonly syncType: number | null;
  readonly payload: Uint8Array;
}

export interface RoomClientOptions {
  /** Push local document updates to the room as they happen (default true). */
  autoSendUpdates?: boolean;
}

export class RoomClient {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  /** Every frame received from the room, in order. */
  readonly frames: ReceivedFrame[] = [];

  /**
   * Local updates queued while `setAutoSend(false)` was in effect: the
   * concurrency tests make two clients edit without seeing each other first,
   * then deliver both updates with `flushLocalUpdates()`.
   */
  readonly localUpdates: Uint8Array[] = [];

  /** The socket currently in use; `undefined` while offline (see `reconnect`). */
  ws: WebSocket | undefined;
  /** Every close seen on any socket of this client, oldest first. */
  readonly closes: { code: number; reason: string }[] = [];
  /** Resolves with the first close (the room kicking this client out, or a clean shutdown). */
  readonly closed: Promise<{ code: number; reason: string }>;

  private resolveClosed!: (value: { code: number; reason: string }) => void;
  private synced = false;
  private autoSend: boolean;
  private syncWaiters: (() => void)[] = [];
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

  private constructor(
    private readonly boardId: string,
    options: RoomClientOptions,
    private readonly serverUrl: string,
  ) {
    this.autoSend = options.autoSendUpdates !== false;
    this.awareness = new Awareness(this.doc);
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      if (!this.autoSend) {
        this.localUpdates.push(update);
        return;
      }
      this.sendUpdate(update);
    };
    this.doc.on('update', this.updateHandler);
  }

  /** Open a socket for `boardId` through the Worker's `/api/rooms/:boardId` route. */
  static async connect(
    boardId: string,
    options: RoomClientOptions = {},
    serverUrl = LIVE_WS_URL,
  ): Promise<RoomClient> {
    const client = new RoomClient(boardId, options, serverUrl);
    await client.open();
    return client;
  }

  /**
   * Drop the socket and open a new one with the *same* document, the way the
   * browser provider reconnects: the room has to catch up from this client.
   */
  async reconnect(): Promise<void> {
    this.teardownSocket();
    this.synced = false;
    await this.open();
    await this.waitForSync();
  }

  private async open(): Promise<void> {
    const ws = await openedSocket(`${this.serverUrl}/api/rooms/${this.boardId}`);
    this.ws = ws;
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closes.push({ code: event.code, reason: event.reason });
      this.resolveClosed({ code: event.code, reason: event.reason });
    });
    ws.addEventListener('error', () => {
      /* Reported through `closed`. */
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleFrame(event.data as ArrayBuffer | Uint8Array | string);
    });

    // Same as the browser provider: ask for the room's state as soon as we are up.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  /** Connect and wait for the initial sync to finish. */
  static async connectSynced(
    boardId: string,
    options: RoomClientOptions = {},
    serverUrl = LIVE_WS_URL,
  ): Promise<RoomClient> {
    const client = await RoomClient.connect(boardId, options, serverUrl);
    await client.waitForSync();
    return client;
  }

  /** Plain HTTP request against the same server (routing assertions). */
  static rawFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${LIVE_HTTP_URL}${path}`, init);
  }

  /** Send one raw frame — for malformed-traffic tests. */
  sendRaw(bytes: Uint8Array | ArrayBuffer | string): void {
    this.socket().send(bytes as ArrayBufferView | ArrayBuffer | string);
  }

  /** Send a frame with an arbitrary outer type and payload. */
  sendFrame(type: number, payload?: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    if (payload) encoding.writeUint8Array(encoder, payload);
    this.socket().send(encoding.toUint8Array(encoder));
  }

  sendQueryAwareness(): void {
    this.sendFrame(MESSAGE_QUERY_AWARENESS);
  }

  /** Awareness update bytes for the given clients (as the provider would send). */
  sendAwareness(clients: number[] = [this.doc.clientID]): Uint8Array {
    const payload = encodeAwarenessUpdate(this.awareness, clients);
    this.sendFrame(MESSAGE_AWARENESS, payload);
    return payload;
  }

  /** Stop (or resume) pushing local document updates to the room. */
  setAutoSend(enabled: boolean): void {
    this.autoSend = enabled;
  }

  /** Send every queued local update and clear the queue. */
  flushLocalUpdates(): void {
    for (const update of this.localUpdates.splice(0)) this.sendUpdate(update);
  }

  get isSynced(): boolean {
    return this.synced;
  }

  /** True when no socket is open (offline: local edits queue up in the doc). */
  get isOffline(): boolean {
    return !this.ws || this.ws.readyState !== this.ws.OPEN;
  }

  /** Resolve once the room has sent us its SyncStep2. */
  waitForSync(): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.syncWaiters.push(resolve);
    });
  }

  /** This client's view of the board. */
  boardSnapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Sync frames that carried a plain document update. */
  updateFrames(): ReceivedFrame[] {
    return this.frames.filter((f) => f.type === MESSAGE_SYNC && f.syncType === SYNC_UPDATE);
  }

  awarenessFrames(): ReceivedFrame[] {
    return this.frames.filter((f) => f.type === MESSAGE_AWARENESS);
  }

  /** Close the socket (the client stays usable: `reconnect()` opens a new one). */
  close(code?: number): void {
    this.teardownSocket(code);
  }

  /** Release everything: socket, doc listeners, awareness timers. */
  dispose(code?: number): void {
    this.teardownSocket(code);
    this.doc.off('update', this.updateHandler);
    this.doc.destroy();
    this.awareness.destroy();
  }

  private teardownSocket(code?: number): void {
    const ws = this.ws;
    this.ws = undefined;
    if (!ws) return;
    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(code ?? 1000, code === undefined ? undefined : 'test closed the socket');
      }
    } catch {
      /* Already gone. */
    }
  }

  private socket(): WebSocket {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error(`client for board ${this.boardId} has no open socket`);
    }
    return this.ws;
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    // Nothing to do while offline: the local doc keeps the changes, and the next
    // sync after reconnecting takes them to the room.
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(encoding.toUint8Array(encoder));
  }

  private handleFrame(data: ArrayBuffer | Uint8Array | string): void {
    if (typeof data === 'string') {
      // The room only sends binary frames; a text frame would be a protocol bug.
      this.frames.push({ type: -1, syncType: null, payload: new TextEncoder().encode(data) });
      return;
    }
    const bytes = toArrayBytes(data);
    const frameDecoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(frameDecoder);
    const payload = decoding.readTailAsUint8Array(frameDecoder);
    let syncType: number | null = null;

    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncType = syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        encoder,
        this.doc,
        this,
      );
      if (syncType === SYNC_STEP_2 && !this.synced) {
        this.synced = true;
        for (const resolve of this.syncWaiters.splice(0)) resolve();
      }
      if (encoding.length(encoder) > 1 && this.ws) this.ws.send(encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      applyAwarenessUpdate(this.awareness, payload, this);
    }

    this.frames.push({ type, syncType, payload });
  }
}

/** The `wrangler dev` instance started for this test run (see live-server.ts). */
export const LIVE_PORT = Number(process.env.VIDI6_LIVE_PORT ?? 28741);
export const LIVE_HTTP_URL = `http://127.0.0.1:${LIVE_PORT}`;
export const LIVE_WS_URL = `ws://127.0.0.1:${LIVE_PORT}`;

function toArrayBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/** Open a WebSocket and resolve once the handshake (101) completed. */
async function openedSocket(url: string, timeoutMs = 10_000): Promise<WebSocket> {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`websocket open timed out: ${url}`)), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`websocket could not connect to ${url}`));
    });
  });
  return ws;
}

/** Wait until `check()` is true — a functional wait, the budget is generous. */
export async function until(
  check: () => boolean,
  what: string,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Compare two board snapshots (same notes, same text/colour/position/z). */
export function snapshotsEqual(
  a: readonly StickySnapshot[],
  b: readonly StickySnapshot[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when every client sees exactly the same board. */
export function allConverged(clients: readonly RoomClient[]): boolean {
  if (clients.length === 0) return true;
  const first = JSON.stringify(clients[0]!.boardSnapshot());
  return clients.every((client) => JSON.stringify(client.boardSnapshot()) === first);
}
