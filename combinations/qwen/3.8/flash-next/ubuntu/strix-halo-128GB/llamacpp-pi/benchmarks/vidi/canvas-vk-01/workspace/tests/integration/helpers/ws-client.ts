import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:test';

import type { Env } from '../../../src/worker/env';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  decodeMessage,
  type Decoded,
} from '../../../src/shared/protocol';

/**
 * Initialize a board (story 5: boards must exist before WebSocket connects).
 * Calls the DO's RPC `initialize()` method directly.
 */
export async function initializeBoard(boardId: string): Promise<'created' | 'exists'> {
  const bindings = env as unknown as Env;
  const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
  return stub.initialize();
}

/**
 * Integration test client: a real `Y.Doc` speaking the y-protocols wire
 * format over a real WebSocket obtained from a `SELF.fetch` upgrade —
 * the same framing the browser `WebsocketProvider` uses (design "Fixtures").
 */

/** Origin stamped on updates applied from the network (never re-sent). */
export const REMOTE_ORIGIN: unique symbol = Symbol('remote');

/** y-protocols sync sub-types (inner byte of a MESSAGE_SYNC frame). */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

export interface LogEntry {
  kind: Decoded['kind'];
  /** Inner sync type for `kind === 'sync'` frames. */
  syncType?: number;
  /** Raw frame bytes as received. */
  bytes: Uint8Array;
}

export class RoomClient {
  readonly log: LogEntry[] = [];
  closed = false;
  closeCode: number | null = null;
  closeReason = '';
  private ws: WebSocket | null = null;
  private pendingClose: Promise<void> = Promise.resolve();

  constructor(readonly doc: Y.Doc = new Y.Doc()) {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Offline edits stay in the doc until the next (re)connect; the sync
      // handshake carries them, exactly like the browser provider.
      if (origin === REMOTE_ORIGIN || this.ws === null || this.closed) return;
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      syncProtocol.writeUpdate(frame, update);
      this.sendFrame(encoding.toUint8Array(frame));
    });
  }

  /** `update` (not step-1/step-2) frames recorded since the last reset. */
  get updateMessages(): number {
    return this.log.filter((entry) => entry.kind === 'sync' && entry.syncType === SYNC_UPDATE).length;
  }

  resetLog(): void {
    this.log.length = 0;
  }

  board(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Upgrade to `/api/rooms/<boardId>` through the real Worker entry. */
  async connect(boardId: string): Promise<void> {
    const response = await SELF.fetch(`http://worker.local/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    if (response.status !== 101 || response.webSocket == null) {
      throw new Error(`expected 101 switching protocols, got ${response.status}`);
    }
    const ws = response.webSocket;
    // Without this, `message` events arrive as Blobs (the default).
    ws.binaryType = 'arraybuffer';
    ws.accept();
    this.ws = ws;
    this.closed = false;
    this.closeCode = null;
    this.pendingClose = new Promise((resolve) => {
      ws.addEventListener('close', (event) => {
        this.closed = true;
        this.closeCode = event.code;
        this.closeReason = event.reason;
        resolve();
      });
    });
    ws.addEventListener('message', (event) => {
      this.handleFrame(event.data as ArrayBuffer | string | Blob);
    });
    ws.addEventListener('error', () => {
      // workerd reports an aborted connection as `error` too; the `close`
      // event carrying the code arrives alongside it.
      this.closed = true;
    });
  }

  /** Send our SyncStep1 and wait for the room's SyncStep2 reply. */
  async sync(timeoutMs = 5000): Promise<void> {
    const before = this.log.length;
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(frame, this.doc);
    this.sendFrame(encoding.toUint8Array(frame));
    await waitUntil(
      () =>
        this.log
          .slice(before)
          .some((entry) => entry.kind === 'sync' && entry.syncType === SYNC_STEP_2),
      'initial sync never completed',
      timeoutMs,
    );
  }

  sendFrame(bytes: Uint8Array): void {
    if (this.ws === null || this.closed) throw new Error('client is not connected');
    this.ws.send(bytes.slice());
  }

  /** Send raw awareness bytes; returns the exact frame that went out. */
  sendAwareness(payload: Uint8Array): Uint8Array {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(frame, payload);
    const bytes = encoding.toUint8Array(frame);
    this.sendFrame(bytes);
    return bytes;
  }

  /** Send a frame bypassing every validation (error-path tests). */
  sendRaw(data: ArrayBuffer | Uint8Array | string): void {
    if (this.ws === null || this.closed) throw new Error('client is not connected');
    this.ws.send(data as ArrayBuffer | string);
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      // already gone
    }
  }

  /** Resolves when the socket has fully closed (`closeCode` then set). */
  whenClosed(timeoutMs = 3000): Promise<void> {
    return Promise.race([
      this.pendingClose,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('socket did not close in time')), timeoutMs);
      }),
    ]);
  }

  private handleFrame(data: ArrayBuffer | string | Blob): void {
    const buffer = data as ArrayBuffer;
    if (typeof data === 'string' || !(buffer instanceof ArrayBuffer)) {
      throw new Error('client socket needs binaryType = arraybuffer');
    }
    const message = decodeMessage(buffer);
    const bytes = new Uint8Array(buffer);
    if (message.kind !== 'sync') {
      this.log.push({ kind: message.kind, bytes });
      return;
    }
    let syncType = -1;
    try {
      syncType = decoding.readVarUint(decoding.createDecoder(message.payload));
    } catch {
      syncType = -1;
    }
    this.log.push({ kind: 'sync', syncType, bytes });
    if (syncType < 0) return;
    const decoder = decoding.createDecoder(message.payload);
    const reply = encoding.createEncoder();
    try {
      syncProtocol.readSyncMessage(decoder, reply, this.doc, REMOTE_ORIGIN);
    } catch {
      // A malformed frame from the room: record it, stay quiet.
      return;
    }
    if (encoding.length(reply) > 0) {
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      encoding.writeUint8Array(frame, encoding.toUint8Array(reply));
      try {
        this.sendFrame(encoding.toUint8Array(frame));
      } catch {
        // Socket closed while replying; nothing to do.
      }
    }
  }
}

/** Initialize a board and connect a fresh client, completing the initial sync. */
export async function connectClient(boardId: string): Promise<RoomClient> {
  await initializeBoard(boardId);
  const client = new RoomClient();
  await client.connect(boardId);
  await client.sync();
  return client;
}

/** Initialize a board and connect a client whose doc is a copy of `source`. */
export async function connectClientWithDoc(boardId: string, source: Y.Doc): Promise<RoomClient> {
  await initializeBoard(boardId);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  const client = new RoomClient(doc);
  await client.connect(boardId);
  await client.sync();
  return client;
}

/**
 * Wait until `predicate()` is true. Message delivery inside workerd is
 * asynchronous, so every cross-client assertion polls through this helper.
 */
export async function waitUntil(
  predicate: () => boolean,
  message = 'condition not met',
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** JSON of every client's board snapshot (for equality assertions). */
export function boardsOf(clients: RoomClient[]): string[] {
  return clients.map((client) => JSON.stringify(client.board()));
}
