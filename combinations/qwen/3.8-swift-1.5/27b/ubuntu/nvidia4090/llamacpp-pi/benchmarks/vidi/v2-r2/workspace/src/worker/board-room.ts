import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, MESSAGE_AWARENESS } from '../shared/protocol';

/**
 * BoardRoom Durable Object: holds a Y.Doc in memory and relays Yjs sync
 * and awareness messages over WebSockets.
 *
 * Non-hibernating: uses server.accept() (not ctx.acceptWebSocket) so the
 * object stays alive while sockets are open. The doc exists only in memory
 * until story 4 adds persistence.
 */
export class BoardRoom extends DurableObject {
  private doc: Y.Doc | null = null;
  private sockets: Set<WebSocket> = new Set();

  async fetch(_req: Request): Promise<Response> {
    const pairs = new WebSocketPair();
    const [client, server] = Object.values(pairs);

    // Accept the server-side socket (non-hibernating)
    server.accept();

    // Lazily create the document
    if (this.doc === null) {
      this.doc = new Y.Doc();
      this.setupDocListeners();
    }

    const ws = server;
    this.sockets.add(ws);

    // Message handler
    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(ws, event.data as ArrayBuffer | string);
    });

    // Cleanup on close/error
    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });

    // Send SyncStep1 to the new socket (so reconnecting clients can repopulate)
    this.sendSyncStep1(ws);

    return new Response(null, {
      status: 101,
      statusText: 'Switching Protocols',
      webSocket: client,
    });
  }

  private setupDocListeners(): void {
    const doc = this.doc!;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Broadcast to all sockets except the origin
      this.broadcast(update, origin);
    });
  }

  private sendSyncStep1(ws: WebSocket): void {
    const doc = this.doc!;
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    const message = encoding.toUint8Array(encoder);

    // Frame as y-websocket sync message
    const frameEncoder = encoding.createEncoder();
    encoding.writeUint8(frameEncoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(frameEncoder, message);
    const frame = encoding.toUint8Array(frameEncoder);

    try {
      ws.send(frame);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    // Handle potential string data (base64-encoded binary from Workers runtime)
    let binaryData: ArrayBuffer | string = data;
    if (typeof data === 'string') {
      // Could be base64-encoded binary or a text frame
      // Try to decode as base64 first
      try {
        const decodedBytes = atob(data);
        const uint8 = new Uint8Array(decodedBytes.length);
        for (let i = 0; i < decodedBytes.length; i++) {
          uint8[i] = decodedBytes.charCodeAt(i);
        }
        binaryData = uint8.buffer;
      } catch {
        // Not base64, treat as text frame (invalid)
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'string frame');
        } catch { /* already closed */ }
        this.sockets.delete(ws);
        return;
      }
    }

    const decoded = decodeMessage(binaryData);

    if (decoded.kind === 'invalid') {
      // Close this socket only
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      } catch {
        // Already closed
      }
      this.sockets.delete(ws);
      return;
    }

    if (decoded.kind === 'unknown') {
      // Ignore unknown message types for forward compatibility
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // Ignore in this story (no stored awareness)
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to ALL sockets including sender
      // (keeps idle y-websocket clients alive)
      const frameEncoder = encoding.createEncoder();
      encoding.writeUint8(frameEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(frameEncoder, decoded.payload);
      const frame = encoding.toUint8Array(frameEncoder);

      for (const socket of this.sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(frame);
          } catch {
            this.sockets.delete(socket);
          }
        }
      }
      return;
    }

    if (decoded.kind === 'sync') {
      const doc = this.doc!;
      const encoder = encoding.createEncoder();
      const decoder = decoding.createDecoder(decoded.payload);

      try {
        const reply = syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (reply !== undefined) {
          // Frame the reply as a y-websocket sync message
          const replyBytes = encoding.toUint8Array(encoder);
          const frameEncoder = encoding.createEncoder();
          encoding.writeUint8(frameEncoder, MESSAGE_SYNC);
          encoding.writeVarUint8Array(frameEncoder, replyBytes);
          const frame = encoding.toUint8Array(frameEncoder);

          try {
            ws.send(frame);
          } catch {
            this.sockets.delete(ws);
          }
        }
      } catch (e) {
        // Yjs rejected the update
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
        } catch {
          // Already closed
        }
        this.sockets.delete(ws);
      }
    }
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    // Wrap in sync protocol Update message, then frame as y-websocket sync message
    const syncEncoder = encoding.createEncoder();
    syncProtocol.writeUpdate(syncEncoder, update);
    const syncBytes = encoding.toUint8Array(syncEncoder);

    const frameEncoder = encoding.createEncoder();
    encoding.writeUint8(frameEncoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(frameEncoder, syncBytes);
    const frame = encoding.toUint8Array(frameEncoder);

    for (const socket of this.sockets) {
      if (socket === except) continue; // sender gets no echo
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(frame);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
