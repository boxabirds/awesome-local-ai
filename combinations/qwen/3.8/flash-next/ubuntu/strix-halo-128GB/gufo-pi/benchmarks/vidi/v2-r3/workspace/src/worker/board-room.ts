import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';
import type { Env } from './index';

/**
 * BoardRoom: one instance per board.
 * Holds the board's Y.Doc in memory and relays Yjs sync + awareness messages
 * over WebSockets.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Wrap the raw Y.Doc update in the sync protocol's update sub-message
        const syncEnc = encoding.createEncoder();
        writeUpdate(syncEnc, update);
        const syncPayload = encoding.toUint8Array(syncEnc);

        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
        encoding.writeUint8Array(enc, syncPayload);
        const frame = encoding.toUint8Array(enc);
        for (const ws of this.ctx.getWebSockets()) {
          if (ws === origin) continue;
          if (ws.readyState !== WebSocket.OPEN) continue;
          try {
            ws.send(frame);
          } catch {
            // Socket is dead, it will be cleaned up by close handler
          }
        }
      });
    }
    return this.doc;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const doc = this.getDoc();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Use hibernation-compatible accept: ctx.acceptWebSocket registers the socket
    this.ctx.acceptWebSocket(server);

    // Send SyncStep1 to the new client so it can respond with its state
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
    writeSyncStep1(enc, doc);
    const frame = encoding.toUint8Array(enc);
    server.send(frame);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      } catch {
        // already closed
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return; // Ignored in this story
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to ALL open sockets including sender
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
      encoding.writeUint8Array(enc, decoded.payload);
      const frame = encoding.toUint8Array(enc);
      for (const s of this.ctx.getWebSockets()) {
        if (s.readyState !== WebSocket.OPEN) continue;
        try {
          s.send(frame);
        } catch {
          // dead socket
        }
      }
      return;
    }

    // Sync message
    if (decoded.kind === 'sync') {
      const doc = this.getDoc();
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        readSyncMessage(decoder, encoder, doc, ws);
        const reply = encoding.toUint8Array(encoder);
        if (reply.byteLength > 0) {
          const outerEnc = encoding.createEncoder();
          encoding.writeVarUint(outerEnc, 0); // MESSAGE_SYNC
          encoding.writeUint8Array(outerEnc, reply);
          const outerFrame = encoding.toUint8Array(outerEnc);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(outerFrame);
          }
        }
      } catch {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid yjs sync data');
        } catch {
          // already closed
        }
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    // Socket removed automatically from ctx.getWebSockets()
  }

  webSocketError(ws: WebSocket): void {
    // Socket removed automatically from ctx.getWebSockets()
  }
}
