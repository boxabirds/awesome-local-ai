/**
 * BoardRoom Durable Object — in-memory Y.Doc room that merges and broadcasts
 * updates between all connected WebSocket clients on a board.
 *
 * Story 3 — live collaboration.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';
import type { Decoded } from '@/shared/protocol';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
} from '@/shared/protocol';

// y-websocket wire constants
const messageSync = 0;
const messageAwareness = 1;

interface RoomSocket {
  id: string;
  ws: WebSocket;
}

export interface Env {}

/**
 * Accept a WebSocket connection and set up the full sync relay lifecycle.
 */
function setupConnection(
  doc: Y.Doc,
  sockets: Set<RoomSocket>,
): [serverWs: WebSocket, clientWs: WebSocket] {
  const pair = new WebSocketPair();
  const serverWs = pair[0];
  const clientWs = pair[1];
  serverWs.accept();

  const socketId = crypto.randomUUID();
  const socketEntry: RoomSocket = { id: socketId, ws: serverWs };
  sockets.add(socketEntry);

  // --- Send SyncStep1 to the new client ---
  const step1Enc = encoding.createEncoder();
  encoding.writeVarUint(step1Enc, messageSync);
  writeSyncStep1(step1Enc, doc);
  serverWs.send(encoding.toUint8Array(step1Enc));

  // --- Observe document updates and broadcast to others ---
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    // Build a y-websocket frame: [varint:messageSync][update-bytes]
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageSync);
    const arr = encoding.toUint8Array(enc);
    const frameBytes = new Uint8Array(arr.length + update.length);
    frameBytes.set(arr);
    frameBytes.set(update, arr.length);

    // Broadcast to all except the origin socket
    for (const s of sockets) {
      if (s.id !== String(origin)) {
        try {
          s.ws.send(frameBytes);
        } catch {
          sockets.delete(s);
        }
      }
    }
  };
  doc.on('update', updateHandler);

  // Clean up when socket closes
  serverWs.addEventListener('close', () => {
    sockets.delete(socketEntry);
    doc.off('update', updateHandler);
  });
  serverWs.addEventListener('error', () => {
    sockets.delete(socketEntry);
    doc.off('update', updateHandler);
  });

  // --- Incoming message handler ---
  serverWs.addEventListener('message', async (event: MessageEvent) => {
    let data: ArrayBuffer | string;
    if (typeof event.data === 'string') {
      data = event.data;
    } else {
      const buf = event.data instanceof ArrayBuffer
        ? event.data
        : event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength);
      data = buf;
    }

    // Decode the y-websocket message frame
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      serverWs.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      sockets.delete(socketEntry);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // Ignore — no stored awareness in this story
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to ALL sockets including sender
      const frame = new Uint8Array(1 + decoded.payload.length);
      frame[0] = messageAwareness;
      frame.set(decoded.payload, 1);
      for (const s of sockets) {
        try {
          s.ws.send(frame);
        } catch {
          sockets.delete(s);
        }
      }
      return;
    }

    if (decoded.kind === 'sync') {
      // Process sync: read incoming, generate response, send reply
      try {
        const respEnc = encoding.createEncoder();
        encoding.writeVarUint(respEnc, messageSync);
        const dec = decoding.createDecoder(new Uint8Array(decoded.payload));
        readSyncMessage(dec, respEnc, doc, socketId);
        const respBytes = encoding.toUint8Array(respEnc);
        // Only send if there's actual content beyond the type byte
        if (respBytes.length > 1) {
          serverWs.send(respBytes);
        }
      } catch {
        serverWs.close(CLOSE_UNSUPPORTED_DATA, 'sync error');
        sockets.delete(socketEntry);
        doc.off('update', updateHandler);
      }
    }
  });

  return [serverWs, clientWs];
}

/**
 * BoardRoom Durable Object holds the Y.Doc for one board in memory.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc;
  private sockets: Set<RoomSocket>;

  constructor(_ctx: DurableObjectState, _env: Env) {
    super(_ctx, _env);
    // Create Y.Doc lazily — each fresh instance starts empty
    this.doc = new Y.Doc();
    this.doc.getMap('meta').set('schemaVersion', 1);
    this.sockets = new Set();
  }

  async fetch(req: Request): Promise<Response> {
    // Only accept WebSocket upgrades
    const upgradeHeader = req.headers.get('Upgrade') || '';
    if (upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    // Accept the WebSocket
    const [_serverWs, clientWs] = setupConnection(this.doc, this.sockets);

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    });
  }
}
