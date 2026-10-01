import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import { decodeMessage, wrapSyncMessage, encodeAwarenessMessage, MESSAGE_SYNC, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';
import type { Env } from './index';

/**
 * BoardRoom: one Durable Object instance per board.
 *
 * Holds the board's Y.Doc in memory, relays Yjs sync and awareness messages over
 * WebSockets. Uses the non-hibernating WebSocket accept API so the object stays alive
 * while sockets are open (the doc is memory-only until story 4).
 *
 * On connection the server sends SyncStep1 to the client (asking the client to share
 * everything it already has). This is essential: without it, a client's pre-connect
 * state (e.g. schemaVersion set before the provider attached) would never reach the
 * server's doc, and subsequent deltas that reference those items would be unapplicable
 * on other clients.
 *
 * Broadcast: when an update arrives from a client (SyncStep2 or Update), the server
 * applies it to its own doc and forwards the raw update bytes to all other connected
 * clients. This works because the initial sync exchange ensures every client has the
 * same base state as the server.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets: Set<WebSocket> = new Set();

  private getDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
    }
    return this.doc;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0] as WebSocket, pair[1] as WebSocket];
    void client;
    this.handleSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSocket(ws: WebSocket): void {
    this.sockets.add(ws);

    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(ws, event.data);
    });

    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });

    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });

    ws.accept();

    // Server-initiated SyncStep1: ask the client to share its current state.
    // Deferred to the next microtask so the fetch() response is fully delivered
    // before the first message is dispatched.
    void Promise.resolve().then(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, this.getDoc());
        ws.send(encoding.toUint8Array(encoder));
      }
    });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case 'sync': {
        try {
          const doc = this.getDoc();
          const decoder = decoding.createDecoder(decoded.payload);
          const encoder = encoding.createEncoder();

          // Read the sync message type.
          // 0=SyncStep1, 1=SyncStep2, 2=Update
          const messageType = decoding.readVarUint(decoder);

          if (messageType === 0) {
            // SyncStep1: client asks what the server has.
            // Server responds with SyncStep2 (everything server has that client doesn't).
            // No document changes; only a reply is generated.
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else {
            // SyncStep2 (type 1) or Update (type 2): apply the update to our doc and
            // broadcast the raw update bytes to all other clients.
            const updateBytes = decoding.readVarUint8Array(decoder);
            Y.applyUpdate(doc, updateBytes);
            this.broadcastUpdate(updateBytes, ws);
          }

          // Send reply if non-empty (SyncStep2 reply to a SyncStep1).
          if (encoding.length(encoder) > 0) {
            const syncReply = encoding.toUint8Array(encoder);
            const framed = wrapSyncMessage(syncReply);
            ws.send(framed);
          }
        } catch (e) {
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
          } catch {
            // already closed
          }
          this.sockets.delete(ws);
        }
        break;
      }
      case 'awareness': {
        // Relay awareness bytes verbatim to all open sockets including sender.
        const framed = encodeAwarenessMessage(decoded.payload);
        for (const socket of this.sockets) {
          if (socket.readyState === WebSocket.OPEN) {
            try {
              socket.send(framed);
            } catch {
              this.sockets.delete(socket);
            }
          }
        }
        break;
      }
      case 'query-awareness': {
        // Ignored in this story; no stored awareness state.
        break;
      }
      case 'invalid': {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        } catch {
          // already closed
        }
        this.sockets.delete(ws);
        break;
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, origin: WebSocket): void {
    // Frame as: varuint(MESSAGE_SYNC) + syncProtocol.writeUpdate(update)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const framed = encoding.toUint8Array(encoder);

    for (const socket of this.sockets) {
      if (socket === origin) continue; // sender gets no echo
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(framed);
        } catch {
          this.sockets.delete(socket);
        }
      }
    }
  }
}
