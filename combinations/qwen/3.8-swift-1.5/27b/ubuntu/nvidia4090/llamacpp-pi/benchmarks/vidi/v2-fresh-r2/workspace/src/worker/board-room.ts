/**
 * BoardRoom Durable Object: one in-memory Y.Doc per board, relaying Yjs sync
 * and awareness messages between the board's WebSockets.
 *
 * - Non-hibernating WebSockets on purpose: the doc exists only in memory in
 *   this story (persistence arrives in story 4, which switches to the
 *   hibernation API).
 * - On accept the room sends its own SyncStep1 so a client reconnecting after
 *   a restart repopulates the room with a SyncStep2.
 * - Document updates are broadcast to every other socket (no echo to the
 *   sender). A send that throws drops that socket.
 * - Awareness bytes are relayed verbatim to ALL sockets including the sender,
 *   which keeps idle y-websocket clients alive (their idle timeout closes a
 *   silent connection).
 * - String frames, undecodable bytes, unknown types and invalid Yjs updates
 *   close only the offending socket with CLOSE_UNSUPPORTED_DATA.
 */

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol';

export class BoardRoom extends DurableObject {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const ws = server;

    this.sockets.add(ws);
    const doc = this.ensureDoc();

    // Announce the room's state so the newcomer (and a room that just
    // restarted) can converge: the client answers with what it has.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));

    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => this.onMessage(ws, event.data as ArrayBuffer);
    ws.onclose = () => {
      this.sockets.delete(ws);
      // Complete the close handshake: workerd does not echo a close frame for
      // us, so a client that initiates the close would otherwise sit in
      // CLOSING forever (its `close` event never fires). Responding lets the
      // client's socket reach CLOSED and fire `close` (which y-websocket uses
      // to detect the disconnect and queue updates).
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    };
    ws.onerror = () => this.sockets.delete(ws);

    return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
  }

  /** Lazily create the in-memory doc (and its broadcast hook) on first accept. */
  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
    }
    return this.doc;
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer): void {
    const doc = this.ensureDoc();
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story: ignore.
      return;
    }
    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
      return;
    }

    // Sync message: apply to the room doc, reply with what the sender lacks.
    const decoder = decoding.createDecoder(decoded.payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      // Newer y-protocols swallow Yjs update errors by default; rethrow so an
      // invalid update closes the offending socket.
      syncProtocol.readSyncMessage(decoder, reply, doc, ws, (error) => {
        throw error;
      });
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    // The leading type varuint is 1 byte; only send a non-empty reply.
    if (encoding.length(reply) > 1) {
      ws.send(encoding.toUint8Array(reply));
    }
  }

  /** Broadcast a document update to every socket except its origin (no echo). */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      if (socket === origin) continue;
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(frame);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  /** Relay awareness bytes verbatim to all open sockets, including the sender. */
  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(frame);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
