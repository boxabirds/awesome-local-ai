import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../shared/protocol';

interface RoomEnv {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
}

export class BoardRoom extends DurableObject<RoomEnv> {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.addSocket(server);

    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  private ensureDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.updateHandler = (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      };
      this.doc.on('update', this.updateHandler);
    }
    return this.doc;
  }

  private addSocket(ws: WebSocket): void {
    const doc = this.ensureDoc();
    this.sockets.add(ws);

    // Send SyncStep1 to the new socket (wrapped in y-websocket framing)
    const syncEncoder = encoding.createEncoder();
    sync.writeSyncStep1(syncEncoder, doc);
    const msg = this.frameSyncMessage(encoding.toUint8Array(syncEncoder));
    ws.send(msg);

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(ws, event.data);
    };

    ws.onclose = () => {
      this.sockets.delete(ws);
    };

    ws.onerror = () => {
      this.sockets.delete(ws);
    };
  }

  /**
   * Wrap a sync protocol message in y-websocket framing:
   * varInt(MESSAGE_SYNC) + rawSyncMessageBytes
   */
  private frameSyncMessage(syncBytes: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarInt(encoder, MESSAGE_SYNC);
    encoding.writeUint8Array(encoder, syncBytes);
    return encoding.toUint8Array(encoder);
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // Ignored in this story
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to all open sockets including sender
      const bytes = decoded.payload;
      for (const socket of this.sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(bytes);
          } catch {
            this.sockets.delete(socket);
          }
        }
      }
      return;
    }

    if (decoded.kind === 'sync') {
      const doc = this.ensureDoc();
      const payload = decoded.payload;

      try {
        // payload is already the sync message content (type varint stripped by decodeMessage)
        const decoder = decoding.createDecoder(payload);
        const responseEncoder = encoding.createEncoder();
        sync.readSyncMessage(decoder, responseEncoder, doc, ws);
        const responseBytes = encoding.toUint8Array(responseEncoder);

        if (responseBytes.length > 0) {
          const framed = this.frameSyncMessage(responseBytes);
          ws.send(framed);
        }
      } catch {
        ws.close(CLOSE_UNSUPPORTED_DATA);
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    // Wrap the update in a sync protocol message, then in y-websocket framing
    const syncEncoder = encoding.createEncoder();
    sync.writeUpdate(syncEncoder, update);
    const framed = this.frameSyncMessage(encoding.toUint8Array(syncEncoder));

    for (const socket of this.sockets) {
      if (socket === origin) continue; // sender gets no echo
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(framed);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
