import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '@shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc = new Y.Doc();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Broadcast to all sockets except the origin
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const encoded = encoding.toUint8Array(encoder);
      for (const ws of this.sockets) {
        if (ws === origin) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
          ws.send(encoded);
        } catch {
          this.sockets.delete(ws);
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.handleSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSocket(ws: WebSocket): void {
    ws.accept();

    // Send SyncStep1 so client responds with SyncStep2 (repopulates doc on restart)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));

    this.sockets.add(ws);

    ws.addEventListener('message', (event) => {
      const decoded = decodeMessage(event.data);
      if (decoded.kind === 'invalid') {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
        this.sockets.delete(ws);
        return;
      }
      if (decoded.kind === 'awareness') {
        // Relay awareness verbatim to all sockets including sender
        const relayEncoder = encoding.createEncoder();
        encoding.writeVarUint(relayEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(relayEncoder, decoded.payload);
        const bytes = encoding.toUint8Array(relayEncoder);
        for (const s of this.sockets) {
          if (s.readyState !== WebSocket.OPEN) continue;
          try {
            s.send(bytes);
          } catch {
            this.sockets.delete(s);
          }
        }
        return;
      }
      if (decoded.kind === 'query-awareness') {
        // Ignore in this story
        return;
      }
      // sync message: decoded.payload is the sync protocol message bytes
      if (decoded.kind === 'sync') {
        try {
          const syncDecoder = decoding.createDecoder(decoded.payload);
          const replyEncoder = encoding.createEncoder();
          syncProtocol.readSyncMessage(syncDecoder, replyEncoder, this.doc, ws);
          const reply = encoding.toUint8Array(replyEncoder);
          if (reply.length > 0) {
            // Wrap in MESSAGE_SYNC outer frame
            const outerEncoder = encoding.createEncoder();
            encoding.writeVarUint(outerEncoder, MESSAGE_SYNC);
            encoding.writeUint8Array(outerEncoder, reply);
            ws.send(encoding.toUint8Array(outerEncoder));
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
          this.sockets.delete(ws);
        }
      }
    });

    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });

    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });
  }
}
