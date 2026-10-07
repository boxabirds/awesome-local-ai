// BoardRoom Durable Object (story 3): holds the board's Y.Doc in memory and
// relays Yjs sync and awareness messages over WebSockets.
//
// Design: non-hibernating WebSockets (server.accept()) because the doc is
// memory-only in this story. An open, accepted socket keeps the object alive.
// Story 4 will switch to hibernation once the doc can be reloaded from storage.

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, MESSAGE_AWARENESS } from '../shared/protocol';

export class BoardRoom extends DurableObject {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    const pairs = new WebSocketPair();
    const [client, server] = Object.values(pairs);

    // Accept the server-side socket (non-hibernating)
    server.accept();

    // Create the doc lazily
    if (!this.doc) {
      this.doc = new Y.Doc();
    }

    this.sockets.add(server);

    // Send initial SyncStep1 so the client can complete the sync handshake
    this.sendSyncStep1(server);

    // Handle incoming messages
    server.onmessage = (event) => {
      this.handleMessage(server, event.data);
    };

    // Remove socket on close/error
    server.onclose = () => {
      this.sockets.delete(server);
    };
    server.onerror = () => {
      this.sockets.delete(server);
    };

    return new Response(null, { status: 101, webSocket: client });
  }

  private sendSyncStep1(ws: WebSocket): void {
    if (!this.doc) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeSyncStep1(enc, this.doc);
    ws.send(encoding.toUint8Array(enc));
  }

  private broadcastUpdate(update: Uint8Array, except: WebSocket): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    const bytes = encoding.toUint8Array(enc);

    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(bytes);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.doc) return;

    const decoded = decodeMessage(data);

    // Invalid frames: close this socket only
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    // Query awareness: ignore (no stored awareness in this story)
    if (decoded.kind === 'query-awareness') {
      return;
    }

    // Awareness: relay verbatim to all open sockets including sender
    if (decoded.kind === 'awareness') {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeUint8Array(enc, decoded.payload);
      const bytes = encoding.toUint8Array(enc);

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

    // Sync message
    if (decoded.kind === 'sync') {
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const responseEncoder = encoding.createEncoder();

        // Read the sub-message type to determine what we're dealing with
        const subType = decoding.readVarUint(decoder);

        if (subType === 2) {
          // messageYjsUpdate: raw update bytes follow
          const update = decoding.readVarUint8Array(decoder);

          // Apply to doc
          Y.applyUpdate(this.doc, update, ws);

          // Broadcast to all other sockets
          this.broadcastUpdate(update, ws);
        } else if (subType === 1) {
          // messageYjsSyncStep2: update bytes that fill in missing parts
          const update = decoding.readVarUint8Array(decoder);

          if (update.length > 0) {
            Y.applyUpdate(this.doc, update, ws);
            this.broadcastUpdate(update, ws);
          }
        } else if (subType === 0) {
          // messageYjsSyncStep1: state vector from client
          const stateVector = decoding.readVarUint8Array(decoder);
          const update = Y.encodeStateAsUpdate(this.doc, stateVector);

          if (update.length > 0) {
            // Send SyncStep2 response to this client only
            const enc = encoding.createEncoder();
            encoding.writeVarUint(enc, MESSAGE_SYNC);
            sync.writeSyncStep2(enc, this.doc, stateVector);
            ws.send(encoding.toUint8Array(enc));
          }
        }

        // If readSyncMessage generated a response (for SyncStep1), send it
        // (handled above for subType 0)
      } catch (e) {
        ws.close(CLOSE_UNSUPPORTED_DATA);
      }
    }
  }
}
