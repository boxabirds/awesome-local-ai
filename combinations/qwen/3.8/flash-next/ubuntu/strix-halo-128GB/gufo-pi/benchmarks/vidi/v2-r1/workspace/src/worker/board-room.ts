import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';

import { decodeMessage, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';

/**
 * BoardRoom Durable Object: holds the board's Y.Doc in memory and relays
 * Yjs sync and awareness messages over WebSockets.
 *
 * Uses non-hibernating WebSocket accept (server.accept()) because the doc is
 * memory-only until story 4. An open accepted socket keeps the object alive.
 */
export class BoardRoom extends DurableObject {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.doc = new Y.Doc();
    // Broadcast document updates to all sockets except the origin
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      for (const ws of this.sockets) {
        if (ws === origin) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
          // Wrap update in y-websocket sync message framing: [MESSAGE_SYNC, Update, updateBytes]
          const encoder = createEncoder();
          writeUint8(encoder, 0); // MESSAGE_SYNC
          writeUint8(encoder, 2); // Update sub-type
          writeUint8Array(encoder, update);
          const msg = toUint8Array(encoder);
          ws.send(msg);
        } catch {
          this.sockets.delete(ws);
        }
      }
    });
  }

  fetch(request: Request): Response {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.sockets.add(server);

    // Listen for incoming messages
    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data);
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });

    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    // Send SyncStep1 so the new client can reply with its full state.
    // This is critical for room restart: the reconnecting client repopulates the doc via SyncStep2.
    this.sendSyncStep1(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private sendSyncStep1(ws: WebSocket): void {
    const stateVector = Y.encodeStateVector(this.doc);
    // SyncStep1: [MESSAGE_SYNC, SyncStep1(0), stateVector]
    const encoder = createEncoder();
    writeUint8(encoder, 0); // MESSAGE_SYNC
    writeUint8(encoder, 0); // SyncStep1
    writeUint8Array(encoder, stateVector);
    const msg = toUint8Array(encoder);
    try {
      ws.send(msg);
    } catch {
      // ignore - socket might already be closing
    }
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        this.handleSyncMessage(ws, decoded.payload);
        break;
      }
      case 'awareness': {
        // Relay awareness to ALL sockets including sender (keeps idle clients alive)
        const frame = new Uint8Array(1 + decoded.payload.byteLength);
        frame[0] = 1; // MESSAGE_AWARENESS
        frame.set(decoded.payload, 1);
        for (const socket of this.sockets) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          try {
            socket.send(frame);
          } catch {
            this.sockets.delete(socket);
          }
        }
        break;
      }
      case 'query-awareness': {
        // Ignored in this story (no stored awareness)
        break;
      }
      case 'invalid': {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        } catch {
          // ignore
        }
        this.sockets.delete(ws);
        break;
      }
    }
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array): void {
    // Parse sync sub-message type: first byte is 0=SyncStep1, 1=SyncStep2, 2=Update
    const decoder = createDecoder(payload);
    const syncType = readUint8(decoder);

    switch (syncType) {
      case 0: {
        // SyncStep1: client sends its state vector, we reply with SyncStep2
        const svBuf = readUint8Array(decoder);
        const sv = new Uint8Array(svBuf);
        const missing = Y.encodeStateAsUpdate(this.doc, sv);
        if (missing.byteLength > 0) {
          const encoder = createEncoder();
          writeUint8(encoder, 0); // MESSAGE_SYNC
          writeUint8(encoder, 1); // SyncStep2
          writeUint8Array(encoder, missing);
          const msg = toUint8Array(encoder);
          try {
            ws.send(msg);
          } catch {
            // ignore
          }
        }
        break;
      }
      case 1: {
        // SyncStep2: client sends the update the server is missing
        const updateBuf = readUint8Array(decoder);
        const update = new Uint8Array(updateBuf);
        try {
          Y.applyUpdate(this.doc, update, ws);
        } catch {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
          } catch {
            // ignore
          }
          this.sockets.delete(ws);
        }
        break;
      }
      case 2: {
        // Update: client sends an incremental update
        const updateBuf = readUint8Array(decoder);
        const update = new Uint8Array(updateBuf);
        try {
          Y.applyUpdate(this.doc, update, ws);
        } catch {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
          } catch {
            // ignore
          }
          this.sockets.delete(ws);
        }
        break;
      }
      default: {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'unknown sync type');
        } catch {
          // ignore
        }
        this.sockets.delete(ws);
        break;
      }
    }
  }
}

// ---- Minimal binary encoding/decoding helpers (lib0-compatible varuint framing) ----

interface Encoder {
  buf: Uint8Array;
  pos: number;
}

interface Decoder {
  data: Uint8Array;
  pos: number;
}

function createEncoder(): Encoder {
  return { buf: new Uint8Array(1024), pos: 0 };
}

function ensureCapacity(encoder: Encoder, extra: number): void {
  while (encoder.pos + extra > encoder.buf.length) {
    const newBuf = new Uint8Array(encoder.buf.length * 2);
    newBuf.set(encoder.buf);
    encoder.buf = newBuf;
  }
}

function writeUint8(encoder: Encoder, val: number): void {
  ensureCapacity(encoder, 1);
  encoder.buf[encoder.pos++] = val;
}

function writeVarUint(encoder: Encoder, num: number): void {
  while (num > 127) {
    writeUint8(encoder, (num & 127) | 128);
    num >>>= 7;
  }
  writeUint8(encoder, num);
}

function writeUint8Array(encoder: Encoder, arr: Uint8Array): void {
  writeVarUint(encoder, arr.byteLength);
  ensureCapacity(encoder, arr.byteLength);
  encoder.buf.set(arr, encoder.pos);
  encoder.pos += arr.byteLength;
}

function toUint8Array(encoder: Encoder): Uint8Array {
  return encoder.buf.slice(0, encoder.pos);
}

function createDecoder(data: Uint8Array): Decoder {
  return { data, pos: 0 };
}

function readUint8(decoder: Decoder): number {
  if (decoder.pos >= decoder.data.length) return 0;
  return decoder.data[decoder.pos++];
}

function readVarUint(decoder: Decoder): number {
  let num = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = readUint8(decoder);
    num |= (byte & 127) << shift;
    shift += 7;
  } while (byte >= 128);
  return num >>> 0;
}

function readUint8Array(decoder: Decoder): ArrayBuffer {
  const len = readVarUint(decoder);
  const arr = decoder.data.slice(decoder.pos, decoder.pos + len);
  decoder.pos += len;
  return arr.buffer as ArrayBuffer;
}
