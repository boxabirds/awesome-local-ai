/**
 * BoardRoom Durable Object: in-memory Y.Doc that relays Yjs sync and awareness
 * over WebSockets. Non-hibernating: uses server.accept() to keep the DO alive.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc = new Y.Doc();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Listen for document updates: broadcast to all sockets except the origin
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcast(update, origin);
    });
  }

  fetch(req: Request): Response {
    const upgradeHeader = req.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Non-hibernating accept: keeps the DO instance alive while sockets are open
    server.accept();

    // Register the socket
    this.sockets.add(server);

    // Set up message handling
    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data);
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });

    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    // Send SyncStep1 so the client replies with SyncStep2 (its full state for a fresh room)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    const message = encoding.toUint8Array(encoder);
    try {
      server.send(message);
    } catch {
      this.sockets.delete(server);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeSocket(ws);
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        const syncDecoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(syncDecoder, encoder, this.doc, ws);
        const reply = encoding.toUint8Array(encoder);
        // Only send if there is content beyond the type byte
        if (reply.byteLength > 1) {
          ws.send(reply);
        }
      } catch {
        this.closeSocket(ws);
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to all open sockets including sender
      // We need to reconstruct the full frame (type + varUint8Array)
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // MESSAGE_AWARENESS
      encoding.writeVarUint8Array(encoder, decoded.payload);
      const frame = encoding.toUint8Array(encoder);
      for (const socket of this.sockets) {
        try {
          socket.send(frame);
        } catch {
          this.sockets.delete(socket);
        }
      }
      return;
    }

    // query-awareness: ignore in this story (no stored awareness)
  }

  private broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC); // outer: sync
    syncProtocol.writeUpdate(encoder, update); // sync type 2 + varUint8Array
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      // Don't echo back to the origin socket
      if (socket === origin) continue;
      try {
        socket.send(frame);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private closeSocket(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // already closed
    }
  }
}
