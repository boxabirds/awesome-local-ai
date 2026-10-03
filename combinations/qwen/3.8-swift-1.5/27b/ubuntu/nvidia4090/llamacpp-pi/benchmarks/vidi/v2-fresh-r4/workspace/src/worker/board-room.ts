import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';

/**
 * BoardRoom Durable Object: holds the board's Y.Doc in memory and relays
 * Yjs sync and awareness messages over WebSockets.
 *
 * Non-hibernating on purpose: the doc is memory-only until story 4.
 */
export class BoardRoom extends DurableObject {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get('upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.addSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
    }
    return this.doc;
  }

  private addSocket(ws: WebSocket): void {
    this.sockets.add(ws);
    const doc = this.ensureDoc();

    // Send SyncStep1 to the new socket (so it can respond with what it has)
    const encoder = createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(this.frameMessage(MESSAGE_SYNC, toUint8Array(encoder)));

    // Also immediately send the full state as SyncStep2 so the new client
    // gets all existing data without needing a second round-trip.
    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > 0) {
      const updateEnc = createEncoder();
      syncProtocol.writeUpdate(updateEnc, state);
      ws.send(this.frameMessage(MESSAGE_SYNC, toUint8Array(updateEnc)));
    }

    // Message handler
    ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(ws, event.data as ArrayBuffer | string);
    };

    // Cleanup on close/error
    ws.onclose = () => {
      this.sockets.delete(ws);
    };
    ws.onerror = () => {
      this.sockets.delete(ws);
    };
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'sync') {
      this.handleSync(ws, decoded.payload);
    } else if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to all sockets including sender
      // (keeps idle y-websocket clients alive)
      const frame = this.frameMessage(MESSAGE_AWARENESS, decoded.payload);
      for (const socket of this.sockets) {
        try {
          socket.send(frame);
        } catch {
          this.sockets.delete(socket);
        }
      }
    }
    // query-awareness: ignored in this story (no stored awareness)
  }

  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.ensureDoc();
    const decoder = createDecoder(payload);
    const encoder = createEncoder();
    try {
      const responseType = syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (responseType !== 0) {
        const response = toUint8Array(encoder);
        if (response.length > 0) {
          ws.send(this.frameMessage(MESSAGE_SYNC, response));
        }
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private broadcast(update: Uint8Array, origin: unknown): void {
    // Wrap the raw Yjs update in sync protocol format (type 2 = "update")
    const encoder = createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frame = this.frameMessage(MESSAGE_SYNC, toUint8Array(encoder));
    for (const socket of this.sockets) {
      if (socket === origin) continue; // sender gets no echo
      try {
        socket.send(frame);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private frameMessage(type: number, payload: Uint8Array): ArrayBuffer {
    const encoder = createEncoder();
    writeUint8(encoder, type);
    if (payload.length > 0) {
      writeUint8Array(encoder, payload);
    }
    // Use slice() to get exactly the encoded bytes as a new ArrayBuffer,
    // avoiding sending extra bytes from the encoder's internal buffer.
    return toUint8Array(encoder).slice().buffer as ArrayBuffer;
  }
}
