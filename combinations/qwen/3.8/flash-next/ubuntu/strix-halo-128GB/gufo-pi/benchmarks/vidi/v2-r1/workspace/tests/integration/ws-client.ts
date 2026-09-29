/**
 * Integration test helper: a WebSocket client that wraps a real Y.Doc
 * and speaks y-protocols over a WebSocket obtained from SELF.fetch() upgrade.
 *
 * This mirrors what y-websocket does in the browser: it syncs the local doc
 * with the room's doc via SyncStep1/SyncStep2/Update messages, and can detect
 * received messages.
 */
import * as Y from 'yjs';
import { env, SELF } from 'cloudflare:test';

// ---- Binary encoding/decoding helpers (matching the room's framing) ----

interface Encoder {
  buf: Uint8Array;
  pos: number;
}

interface Decoder {
  data: Uint8Array;
  pos: number;
}

function createEncoder(): Encoder {
  return { buf: new Uint8Array(4096), pos: 0 };
}

function ensureCapacity(enc: Encoder, extra: number): void {
  while (enc.pos + extra > enc.buf.length) {
    const newBuf = new Uint8Array(enc.buf.length * 2);
    newBuf.set(enc.buf);
    enc.buf = newBuf;
  }
}

function writeUint8(enc: Encoder, val: number): void {
  ensureCapacity(enc, 1);
  enc.buf[enc.pos++] = val;
}

function writeVarUint(enc: Encoder, num: number): void {
  while (num > 127) {
    writeUint8(enc, (num & 127) | 128);
    num >>>= 7;
  }
  writeUint8(enc, num);
}

function writeUint8Array(enc: Encoder, arr: Uint8Array): void {
  writeVarUint(enc, arr.byteLength);
  ensureCapacity(enc, arr.byteLength);
  enc.buf.set(arr, enc.pos);
  enc.pos += arr.byteLength;
}

function toUint8Array(enc: Encoder): Uint8Array {
  return enc.buf.slice(0, enc.pos);
}

function createDecoder(data: Uint8Array): Decoder {
  return { data, pos: 0 };
}

function readUint8(dec: Decoder): number {
  if (dec.pos >= dec.data.length) return 0;
  return dec.data[dec.pos++];
}

function readVarUint(dec: Decoder): number {
  let num = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = readUint8(dec);
    num |= (byte & 127) << shift;
    shift += 7;
  } while (byte >= 128);
  return num >>> 0;
}

function readUint8Array(dec: Decoder): Uint8Array {
  const len = readVarUint(dec);
  const arr = dec.data.slice(dec.pos, dec.pos + len);
  dec.pos += len;
  return arr;
}

// ---- Message builders ----

function buildSyncStep1(sv: Uint8Array): Uint8Array {
  const enc = createEncoder();
  writeUint8(enc, 0); // MESSAGE_SYNC
  writeUint8(enc, 0); // SyncStep1
  writeUint8Array(enc, sv);
  return toUint8Array(enc);
}

function buildSyncStep2(update: Uint8Array): Uint8Array {
  const enc = createEncoder();
  writeUint8(enc, 0); // MESSAGE_SYNC
  writeUint8(enc, 1); // SyncStep2
  writeUint8Array(enc, update);
  return toUint8Array(enc);
}

function buildUpdate(update: Uint8Array): Uint8Array {
  const enc = createEncoder();
  writeUint8(enc, 0); // MESSAGE_SYNC
  writeUint8(enc, 2); // Update
  writeUint8Array(enc, update);
  return toUint8Array(enc);
}

// ---- Test client ----

export interface ReceivedMessage {
  type: number; // first byte: 0=sync, 1=awareness, etc.
  data: Uint8Array; // full raw frame
}

export interface TestClient {
  /** The client-side Y.Doc that syncs with the room. */
  doc: Y.Doc;
  /** The WebSocket connection to the room. */
  ws: WebSocket;
  /** All messages received from the room (in order). */
  received: ReceivedMessage[];
  /** Board id used for this connection. */
  boardId: string;
  /** Send raw bytes to the room. */
  send(data: Uint8Array): void;
  /** Wait until at least `count` messages have been received. */
  waitForMessages(count: number, timeout?: number): Promise<void>;
  /** Wait for the next message after current count. Returns the message. */
  waitForNextMessage(timeout?: number): Promise<ReceivedMessage>;
  /** Close the connection. */
  close(): void;
  /** Send a local Y.Doc update to the room. */
  sendUpdate(update: Uint8Array): void;
  /** Perform initial sync handshake (send SyncStep1, reply to room's SyncStep1/SyncStep2). */
  sync(): Promise<void>;
  /** Get a snapshot of the doc's objects map. */
  snapshot(): Map<string, unknown>;
  /** Get the number of messages received of a specific type. */
  messageCount(frameType: number): number;
}

/**
 * Initialize a board via POST /api/boards. Returns the new board id.
 * Used by test helpers to create a board before connecting.
 */
export async function initializeBoard(): Promise<string> {
  const req = new Request('http://localhost/api/boards', { method: 'POST' });
  const res = await SELF.fetch(req);
  if (res.status !== 201) {
    throw new Error(`Failed to create board: ${res.status}`);
  }
  const body = await res.json() as { id: string };
  return body.id;
}

/**
 * Ensure a board with the given id exists (for tests that need a specific id).
 * Uses the DO RPC directly.
 */
export async function ensureBoardExists(boardId: string): Promise<void> {
  const ns = (env as Record<string, unknown>).BOARD_ROOM as DurableObjectNamespace;
  const doId = ns.idFromName(boardId);
  const stub = ns.get(doId);
  await (stub as unknown as { initialize(): Promise<string> }).initialize();
}

/**
 * Open a WebSocket connection to the board room for the given boardId (or a
 * new one if not provided). If no boardId is given, a new board is created.
 */
export async function openRoomClient(boardId?: string): Promise<TestClient> {
  let id = boardId ?? await initializeBoard();
  // Ensure board exists (for tests that pass a pre-generated id)
  if (boardId) {
    await ensureBoardExists(id);
  }
  const req = new Request(`http://localhost/api/rooms/${id}`, {
    headers: { Upgrade: 'websocket' },
  });
  const res = await SELF.fetch(req);
  if (res.status !== 101) {
    throw new Error(`Expected 101 Switching Protocols, got ${res.status}`);
  }
  const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
  if (!ws) {
    throw new Error('No webSocket in upgrade response');
  }

  // In the workerd test environment, the client-side WebSocket must be
  // accepted before use (the test runner acts as the client).
  (ws as unknown as { accept(): void }).accept();

  const doc = new Y.Doc();
  const received: ReceivedMessage[] = [];

  ws.addEventListener('message', (event: MessageEvent) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    received.push({ type: data[0], data });

    // Auto-handle sync messages: reply to SyncStep1, apply SyncStep2/Update
    if (data[0] === 0) {
      const dec = createDecoder(data.slice(1));
      const syncType = readUint8(dec);
      if (syncType === 0) {
        // Room sent SyncStep1 - reply with our SyncStep2
        const sv = readUint8Array(dec);
        const missing = Y.encodeStateAsUpdate(doc, sv);
        if (missing.byteLength > 0) {
          try {
            ws.send(buildSyncStep2(missing));
          } catch {
            // socket might be closed
          }
        }
      } else if (syncType === 1 || syncType === 2) {
        // SyncStep2 or Update - apply to our local doc
        const update = readUint8Array(dec);
        try {
          Y.applyUpdate(doc, update);
        } catch {
          // ignore invalid updates in test
        }
      }
    }
  });

  const client: TestClient = {
    doc,
    ws,
    received,
    boardId: id,
    send(data: Uint8Array) {
      ws.send(data);
    },
    async waitForMessages(count: number, timeout = 5000): Promise<void> {
      const start = Date.now();
      while (received.length < count) {
        if (Date.now() - start > timeout) {
          throw new Error(`Timeout waiting for ${count} messages, got ${received.length}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    async waitForNextMessage(timeout = 5000): Promise<ReceivedMessage> {
      const target = received.length + 1;
      await this.waitForMessages(target, timeout);
      return received[received.length - 1];
    },
    close() {
      ws.close(1000, 'test done');
    },
    sendUpdate(update: Uint8Array) {
      ws.send(buildUpdate(update));
    },
    async sync(): Promise<void> {
      // Send our SyncStep1 (state vector) to the room
      const sv = Y.encodeStateVector(doc);
      ws.send(buildSyncStep1(sv));
      // Wait for a response (SyncStep2 or Update)
      // Give a small delay for processing
      await new Promise((r) => setTimeout(r, 50));
    },
    snapshot(): Map<string, unknown> {
      const objects = doc.getMap('objects');
      const result = new Map<string, unknown>();
      for (const [key, value] of objects) {
        if (value instanceof Y.Map) {
          const entry: Record<string, unknown> = {};
          for (const [k, v] of value) {
            if (v instanceof Y.Text) {
              entry[k] = v.toString();
            } else {
              entry[k] = v;
            }
          }
          result.set(key, entry);
        }
      }
      return result;
    },
    messageCount(frameType: number): number {
      return received.filter((m) => m.type === frameType).length;
    },
  };

  return client;
}

/**
 * Connect two clients to the same board, perform initial sync, and return them.
 * If no boardId is given, a new board is created.
 */
export async function openTwoClients(boardId?: string): Promise<[TestClient, TestClient]> {
  const id = boardId ?? await initializeBoard();
  const a = await openRoomClient(id);
  const b = await openRoomClient(id);
  // Wait for initial sync messages to be processed
  await new Promise((r) => setTimeout(r, 100));
  return [a, b];
}

export { buildSyncStep1, buildSyncStep2, buildUpdate };
export { createEncoder, createDecoder, writeUint8, writeVarUint, writeUint8Array, toUint8Array, readUint8, readVarUint, readUint8Array };
