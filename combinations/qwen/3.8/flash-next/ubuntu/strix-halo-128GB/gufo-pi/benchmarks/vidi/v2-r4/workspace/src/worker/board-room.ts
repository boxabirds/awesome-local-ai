import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  readSyncMessage,
  writeSyncStep1,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { decodeMessage, MESSAGE_SYNC, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';
import type { Env } from './index';

/**
 * BoardRoom: one Durable Object per board.
 * Holds an in-memory Y.Doc and relays Yjs sync + awareness messages over WebSockets.
 *
 * Non-hibernating WebSockets (server.accept(), not ctx.acceptWebSocket):
 * the room's Y.Doc exists only in memory until story 4. Hibernation would evict
 * the object while sockets stay open and silently drop the document.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets: Set<WebSocket> = new Set();

  private getDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Broadcast the update to every other open socket.
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // messageYjsUpdate = 2
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint8Array(encoder, update);
        const message = encoding.toUint8Array(encoder);
        for (const ws of this.sockets) {
          if (ws === origin) continue;
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(message);
            }
          } catch {
            this.sockets.delete(ws);
          }
        }
      });
    }
    return this.doc;
  }

  async fetch(req: Request): Promise<Response> {
    const upgradeHeader = req.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Non-hibernating accept
    server.accept();

    const doc = this.getDoc();
    this.sockets.add(server);

    // Send SyncStep1 so the new client responds with its state.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    server.send(encoding.toUint8Array(encoder));

    server.addEventListener('message', async (event) => {
      // In workerd, event.data for binary WebSocket frames is a Blob.
      // Convert to ArrayBuffer for our decoder.
      let data: ArrayBuffer | string;
      if (typeof event.data === 'string') {
        data = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        data = event.data;
      } else if (event.data instanceof Blob) {
        data = await event.data.arrayBuffer();
      } else {
        data = String(event.data);
      }

      const decoded = decodeMessage(data);

      if (decoded.kind === 'invalid') {
        server.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        this.sockets.delete(server);
        return;
      }

      if (decoded.kind === 'sync') {
        try {
          // Write MESSAGE_SYNC first, then readSyncMessage appends to same encoder.
          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
          readSyncMessage(createDecoder(decoded.payload), replyEncoder, doc, server);
          const reply = encoding.toUint8Array(replyEncoder);
          // Only send if readSyncMessage wrote content beyond the MESSAGE_SYNC byte
          if (reply.length > 1) {
            server.send(reply);
          }
        } catch {
          server.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
          this.sockets.delete(server);
        }
        return;
      }

      if (decoded.kind === 'awareness') {
        // Relay awareness to all open sockets including sender.
        const raw = decoded.payload;
        const frame = new Uint8Array(1 + raw.length);
        frame[0] = 1; // MESSAGE_AWARENESS
        frame.set(raw, 1);
        for (const ws of this.sockets) {
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frame);
            }
          } catch {
            this.sockets.delete(ws);
          }
        }
        return;
      }

      if (decoded.kind === 'query-awareness') {
        // Ignored in this story: no stored awareness
        return;
      }
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });

    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
