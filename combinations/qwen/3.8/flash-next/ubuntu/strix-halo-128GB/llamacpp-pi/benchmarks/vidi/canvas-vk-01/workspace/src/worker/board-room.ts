import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './env';

/**
 * One BoardRoom per board. Holds the board's `Y.Doc` in memory and relays
 * y-websocket sync/awareness messages between every connected client.
 *
 * WebSockets are accepted with `server.accept()` (the non-hibernating API) on
 * purpose: until story 4 the doc lives only in memory, and hibernation would
 * evict the object while sockets stay open and silently drop it. An open,
 * accepted socket keeps the object alive.
 *
 * There is deliberately no participant counting: capacity is soft (PRD
 * live.over_capacity), a 6th person is never refused.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.acceptSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptSocket(ws: WebSocket): void {
    // workerd hands binary frames to a `message` listener as a Blob unless
    // `binaryType` says otherwise; the sync protocol decoder needs the bytes.
    ws.binaryType = 'arraybuffer';
    ws.accept();
    this.sockets.add(ws);
    const doc = this.ensureDoc();

    // Send our own SyncStep1: every client answers with a SyncStep2 containing
    // whatever this (possibly freshly restarted) room is missing, so a room
    // that lost its memory is repopulated by the first client back.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(ws, encoding.toUint8Array(encoder));

    ws.addEventListener('message', (event) => {
      void this.handleMessage(ws, event.data as ArrayBuffer | string | Blob);
    });
    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });
  }

  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // The sender gets no echo of its own update.
        this.broadcastSync(update, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private async handleMessage(ws: WebSocket, data: ArrayBuffer | string | Blob): Promise<void> {
    const doc = this.ensureDoc();
    if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) {
      // Defensive: some runtimes hand the Blob through regardless of
      // `binaryType`.
      data = await data.arrayBuffer();
    }
    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync': {
        const decoder = decoding.createDecoder(message.payload);
        const reply = encoding.createEncoder();
        try {
          syncProtocol.readSyncMessage(decoder, reply, doc, ws, (error: Error) => {
            void error;
            // Yjs rejected the update: drop this socket only.
            this.closeSocket(ws);
          });
        } catch {
          // Undecodable frame (truncated payload, unknown inner type).
          this.closeSocket(ws);
          return;
        }
        if (encoding.length(reply) > 0) {
          const frame = encoding.createEncoder();
          encoding.writeVarUint(frame, MESSAGE_SYNC);
          encoding.writeUint8Array(frame, encoding.toUint8Array(reply));
          this.send(ws, encoding.toUint8Array(frame));
        }
        break;
      }
      case 'awareness': {
        // Relay verbatim to every open socket *including the sender*: idle
        // y-websocket clients close when they receive nothing for their
        // reconnect timeout, and awareness updates are what keep them alive.
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(frame, message.payload);
        this.broadcastRaw(encoding.toUint8Array(frame), null);
        break;
      }
      case 'query-awareness':
        // No awareness state is kept in this story (presence is story 6).
        break;
      case 'invalid':
        this.closeSocket(ws);
        break;
    }
  }

  private broadcastSync(update: Uint8Array, except: unknown): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    this.broadcastRaw(encoding.toUint8Array(frame), except);
  }

  /** Send `bytes` to every open socket, skipping `except` (when provided). */
  private broadcastRaw(bytes: Uint8Array, except: unknown): void {
    for (const socket of this.sockets) {
      if (socket === except) continue;
      // A socket whose send throws is dropped from the set, never fatal.
      this.send(socket, bytes);
    }
  }

  private send(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes.slice());
    } catch {
      this.sockets.delete(ws);
    }
  }

  private closeSocket(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // already closing
    }
  }
}
