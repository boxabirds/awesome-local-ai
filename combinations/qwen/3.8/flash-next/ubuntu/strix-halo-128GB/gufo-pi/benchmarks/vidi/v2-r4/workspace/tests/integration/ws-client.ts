import * as Y from 'yjs';
import {
  writeSyncStep1,
  writeSyncStep2,
  readSyncMessage,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';
import { initDoc, stickySnapshot as snapshot, type StickySnapshot } from '../../src/shared/board-model';

export interface ReceivedMessage {
  type: number;
  payload: Uint8Array;
}

/**
 * A test WebSocket client that wraps a real Y.Doc speaking y-protocols,
 * connected via WebSocket to a wrangler dev server.
 *
 * Message flow (matching y-websocket):
 * - On open: send [MESSAGE_SYNC, SyncStep1(doc)]
 * - On receive sync: writeVarUint(MESSAGE_SYNC) + readSyncMessage() → send if content
 * - After receiving SyncStep2: mark synced
 */
export class WsTestClient {
  readonly doc: Y.Doc;
  readonly ws: WebSocket;
  readonly receivedMessages: ReceivedMessage[] = [];
  private _synced = false;
  private _closed = false;
  private _closeCode: number | undefined;
  private _syncResolvers: Array<() => void> = [];

  constructor(doc: Y.Doc, ws: WebSocket) {
    this.doc = doc;
    this.ws = ws;
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data as ArrayBuffer);
    });
    this.ws.addEventListener('close', (event) => {
      this._closed = true;
      this._closeCode = event.code;
    });
  }

  get synced(): boolean { return this._synced; }
  get closed(): boolean { return this._closed; }
  get closeCode(): number | undefined { return this._closeCode; }

  /**
   * Handle a message matching y-websocket's protocol:
   * The encoder gets MESSAGE_SYNC type byte written first, then readSyncMessage
   * appends its reply content to the same encoder.
   */
  private handleMessage(data: ArrayBuffer) {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) return;
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);
    const remaining = bytes.slice(decoder.pos);

    if (type === MESSAGE_SYNC) {
      this.receivedMessages.push({ type, payload: remaining });
      // Match y-websocket: write MESSAGE_SYNC to reply encoder, then let
      // readSyncMessage append its response to the same encoder.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const msgType = readSyncMessage(createDecoder(remaining), encoder, this.doc, 'remote');
      // readSyncMessage returns: 0=SyncStep1, 1=SyncStep2, 2=Update
      if (msgType === 1) {
        this._synced = true;
        for (const resolve of this._syncResolvers) resolve();
        this._syncResolvers = [];
      }
      // Send reply if readSyncMessage wrote content (SyncStep1 → SyncStep2 response)
      const encoded = encoding.toUint8Array(encoder);
      if (encoded.length > 1) {
        this.ws.send(encoded);
      }
    } else if (type === MESSAGE_AWARENESS) {
      this.receivedMessages.push({ type, payload: remaining });
    } else {
      this.receivedMessages.push({ type, payload: remaining });
    }
  }

  /** Send SyncStep1 to the server. */
  sendSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send SyncStep2 (full local state) to the server. */
  sendSyncStep2() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep2(encoder, this.doc);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send a raw Yjs update (matching y-protocols writeUpdate format). */
  sendUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // messageYjsUpdate = 2
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint8Array(encoder, update);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send an awareness message (matching y-websocket format). */
  sendAwareness(payload: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send a query-awareness message. */
  sendQueryAwareness() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send raw bytes or text (for malformed message tests). */
  sendRaw(data: ArrayBuffer | Uint8Array | string) {
    if (typeof data === 'string') {
      this.ws.send(data);
    } else if (data instanceof Uint8Array) {
      this.ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else {
      this.ws.send(data);
    }
  }

  /** Wait until this client is synced. */
  async waitForSynced(timeout = 5000): Promise<void> {
    if (this._synced) return;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for sync')), timeout);
      this._syncResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Wait for at least `count` sync messages. */
  async waitForSyncMessages(count: number, timeout = 5000): Promise<void> {
    const start = Date.now();
    while (this.receivedMessages.filter(m => m.type === MESSAGE_SYNC).length < count) {
      if (this._closed) return;
      if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${count} sync messages, got ${this.receivedMessages.filter(m => m.type === MESSAGE_SYNC).length}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /** Wait for a new message after a given index. */
  async waitForMessageAfter(index: number, timeout = 5000): Promise<void> {
    const start = Date.now();
    while (this.receivedMessages.length <= index) {
      if (this._closed) return;
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for new message');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  async waitForClose(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (!this._closed) {
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for close');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  getSnapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  snapshotsEqual(other: WsTestClient): boolean {
    const a = this.getSnapshot();
    const b = other.getSnapshot();
    return JSON.stringify(a) === JSON.stringify(b);
  }

  close() {
    if (!this._closed) {
      try { this.ws.close(); } catch { /* already closed */ }
    }
  }
}

const baseUrl = () => process.env.INTEGRATION_BASE_URL ?? 'http://localhost:9111';

/**
 * Create a WebSocket client connected to a board and perform initial sync.
 * The server sends SyncStep1 on accept, and we respond with our SyncStep1 too.
 */
export async function connectClient(boardId: string): Promise<WsTestClient> {
  const doc = new Y.Doc();
  initDoc(doc);
  const httpUrl = baseUrl();
  const wsUrl = httpUrl.replace(/^http/, 'ws') + `/api/rooms/${boardId}`;

  const client = await new Promise<WsTestClient>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      const c = new WsTestClient(doc, ws);
      // Immediately send our SyncStep1 (matching y-websocket behavior)
      c.sendSyncStep1();
      resolve(c);
    });

    ws.addEventListener('error', () => {
      reject(new Error(`WebSocket error`));
    });

    // Timeout for initial connection
    setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
  });

  // Wait for sync (server's SyncStep2)
  await client.waitForSynced();
  // Also send SyncStep2 to give our state to the server
  client.sendSyncStep2();
  await new Promise(resolve => setTimeout(resolve, 50));

  return client;
}

/**
 * Perform initial sync (for backwards compatibility with existing tests).
 */
export async function performSync(client: WsTestClient): Promise<void> {
  if (client.synced) return;
  client.sendSyncStep1();
  await client.waitForSynced();
  client.sendSyncStep2();
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Make an HTTP fetch to the integration server.
 */
export async function integrationFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, init);
}

/**
 * Create a board via POST /api/boards and return its id.
 */
export async function createBoard(): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const data = await res.json() as { id: string };
  return data.id;
}

/**
 * Create a board and connect a client to it.
 */
export async function createAndConnect(): Promise<{ boardId: string; client: WsTestClient }> {
  const boardId = await createBoard();
  const client = await connectClient(boardId);
  return { boardId, client };
}
