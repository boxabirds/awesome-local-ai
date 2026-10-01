// src/worker/board-room.ts
// BoardRoom Durable Object: in-memory Y.Doc room that merges and broadcasts updates between all sockets on a board.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';

export class BoardRoom {
  declare static __DURABLE_OBJECT_BRAND: "__DURABLE_OBJECT_BRAND";
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  async fetch(_req: Request): Promise<Response> {
    const pairs = new WebSocketPair();
    const [client, server] = Object.values(pairs);

    // Accept the server-side socket (non-hibernating: doc is memory-only until story 4)
    server.accept();

    // Ensure doc exists
    if (this.doc === null) {
      this.doc = new Y.Doc();
      this.updateHandler = (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin as WebSocket | null);
      };
      this.doc.on('update', this.updateHandler);
    }

    const doc = this.doc;
    const ws = server;

    // Add to socket set
    this.sockets.add(ws);

    // Send SyncStep1 to the new socket
    this.sendSyncStep1(ws, doc);

    // Message handler
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;
      const decoded = decodeMessage(data);

      if (decoded.kind === 'invalid') {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
      }

      if (decoded.kind === 'sync') {
        this.handleSyncMessage(ws, decoded.payload, doc);
      } else if (decoded.kind === 'awareness') {
        this.relayAwareness(decoded.payload);
      }
      // query-awareness: ignored in this story
    });

    // Close/error handlers
    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private sendSyncStep1(ws: WebSocket, doc: Y.Doc): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeSyncStep1(inner, doc);
    const innerBytes = encoding.toUint8Array(inner);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, innerBytes.length);
    encoding.writeUint8Array(encoder, innerBytes);
    ws.send(encoding.toUint8Array(encoder).buffer as ArrayBuffer);
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array, doc: Y.Doc): void {
    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      // Pass an errorHandler that throws so we can detect invalid updates
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (err: Error) => { throw err; });

      const replyBytes = encoding.toUint8Array(encoder);
      if (replyBytes.length > 0) {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
        encoding.writeVarUint(replyEncoder, replyBytes.length);
        encoding.writeUint8Array(replyEncoder, replyBytes);
        ws.send(encoding.toUint8Array(replyEncoder).buffer as ArrayBuffer);
      }
    } catch (e) {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private broadcast(update: Uint8Array, except: WebSocket | null): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const innerBytes = encoding.toUint8Array(inner);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, innerBytes.length);
    encoding.writeUint8Array(encoder, innerBytes);
    const bytes = encoding.toUint8Array(encoder);
    const buffer = bytes.buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState !== 1) continue; // WebSocket.OPEN = 1
      try {
        socket.send(buffer);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, payload.length);
    encoding.writeUint8Array(encoder, payload);
    const bytes = encoding.toUint8Array(encoder);
    const buffer = bytes.buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket.readyState !== 1) continue; // WebSocket.OPEN = 1
      try {
        socket.send(buffer);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
