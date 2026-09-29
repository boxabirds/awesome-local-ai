import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './env';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
} from '../shared/protocol';

/**
 * One BoardRoom per board. Holds the board's Y.Doc in memory and relays Yjs sync
 * and awareness traffic between every connected WebSocket.
 *
 * WebSockets are accepted with the non-hibernating API (`server.accept()`): the
 * document only lives in memory until story 4 gives the room storage, and an
 * open, accepted socket keeps this object (and its doc) alive. Hibernation would
 * evict the object while sockets stay open and silently drop the document.
 *
 * There is deliberately no participant cap (live.over_capacity): a 6th person is
 * never refused; MAX_CONCURRENT_EDITORS is a soft design/test target only.
 */
export class BoardRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  /** Lazily create the room's document and subscribe the broadcast handler once. */
  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      // Echo every applied update to every socket except the one that produced it,
      // so a sender never sees its own update come back (TC-08). `origin` is the
      // socket passed to readSyncMessage; non-socket origins are broadcast to all.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  fetch(request: Request): Response {
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      // Routing already rejects this; keep the room strict about it too.
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const doc = this.getDoc();
    server.accept();
    server.binaryType = 'arraybuffer';
    this.sockets.add(server);

    // Announce the room's state so a reconnecting client answers with SyncStep2 and
    // repopulates a room that lost its doc to a restart (no storage in this story).
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(hello, doc);
    this.safeSend(server, encoding.toUint8Array(hello));

    server.addEventListener('message', (event) => this.handleMessage(server, event.data));
    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      // Malformed traffic affects only the offending socket; others keep working.
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      } catch {
        this.sockets.delete(ws);
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story (presence is story 6): ignore.
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket INCLUDING the sender: this is what keeps
      // idle y-websocket clients (which close a socket that receives nothing for 30s)
      // alive during otherwise-silent periods.
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(frame, decoded.payload);
      const bytes = encoding.toUint8Array(frame);
      for (const socket of this.sockets) this.safeSend(socket, bytes);
      return;
    }

    // Sync sub-message. Decoder is positioned so readSyncMessage reads the sync type.
    const decoder = decoding.createDecoder(decoded.payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      // Pass an errorHandler that rethrows so an invalid Yjs update surfaces here
      // (y-protocols otherwise swallows applyUpdate errors).
      syncProtocol.readSyncMessage(decoder, reply, this.getDoc(), ws, (err) => {
        throw err;
      });
    } catch {
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync update');
      } catch {
        this.sockets.delete(ws);
      }
      return;
    }
    // reply contains only the MESSAGE_SYNC header when there is nothing to send
    // (SyncStep2/Update replies are empty; SyncStep1 replies with SyncStep2).
    if (encoding.length(reply) > 1) {
      this.safeSend(ws, encoding.toUint8Array(reply));
    }
  }

  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    const bytes = encoding.toUint8Array(frame);
    for (const socket of this.sockets) {
      if (socket === except) continue;
      this.safeSend(socket, bytes);
    }
  }

  /** Send on an open socket; a throwing send (dead socket) drops it from the set. */
  private safeSend(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(data);
    } catch (err) {
      // A dead socket must not break the room or other sockets: log and drop it.
      console.error('[room] send failed, dropping socket:', err);
      this.sockets.delete(ws);
    }
  }
}
