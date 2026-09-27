// BoardRoom Durable Object (story 3): an in-memory Y.Doc per board that relays
// y-websocket sync + awareness messages between every connected socket. It is
// the SUT for the sync.room tests. No storage writes in this story (persistence
// is story 4); the doc lives only as long as the object is kept alive.
//
// WebSockets are accepted NON-hibernating (server.accept(), not
// ctx.acceptWebSocket) on purpose: hibernation would let the runtime evict the
// object while sockets stay open and silently drop the in-memory doc. An open,
// accepted socket pins the object. Story 4 switches to hibernation once the doc
// can be reloaded from storage.
import * as Y from 'yjs';
import * as YjsSync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol.ts';
import type { Env } from './index.ts';

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private ydoc: Y.Doc | null = null;

  // Lazily create the room doc and start broadcasting its updates. The doc is
  // never discarded explicitly; the runtime drops it when the object is evicted.
  private doc(): Y.Doc {
    let doc = this.ydoc;
    if (!doc) {
      doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
      this.ydoc = doc;
    }
    return doc;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Non-hibernating accept keeps this object (and its doc) alive.
    server.accept();
    server.binaryType = 'arraybuffer';

    const doc = this.doc();
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data);
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    // Send SyncStep1 to the new socket. A client reconnecting to a restarted
    // (empty) room answers with SyncStep2, repopulating the room — this is why
    // no notes are lost while at least one person keeps the board open.
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    YjsSync.writeSyncStep1(hello, doc);
    this.sendTo(server, encoding.toUint8Array(hello));

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      // Text frame, undecodable/truncated bytes, or unknown type: close THIS
      // socket only with 1003; other sockets and the doc are untouched.
      this.closeUnsupported(ws);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story (presence is story 6): ignore.
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay the ORIGINAL frame bytes verbatim to every open socket including
      // the sender, so idle clients keep receiving traffic and their no-message
      // watchdog never fires.
      this.relayBytes(data);
      return;
    }

    // Sync message. Read + apply into the doc with this socket as the origin.
    // An invalid Yjs update is reported via the error handler and turned into a
    // 1003 close (y-protocols otherwise swallows applyUpdate errors).
    const doc = this.doc();
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let failed = false;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      YjsSync.readSyncMessage(decoder, reply, doc, ws, (err: Error) => {
        failed = true;
        throw err;
      });
    } catch {
      failed = true;
    }
    if (failed) {
      this.closeUnsupported(ws);
      return;
    }
    // A reply is written only for SyncStep1 (SyncStep2 + SyncStep1). An Update
    // message leaves the reply as just the type prefix (length 1): nothing sent.
    if (encoding.length(reply) > 1) {
      this.sendTo(ws, encoding.toUint8Array(reply));
    }
  }

  // Broadcast a Yjs update to every open socket except the one that produced it
  // (the sender must never receive an echo of its own change).
  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    if (this.sockets.size <= 1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    YjsSync.writeUpdate(enc, update);
    const bytes = encoding.toUint8Array(enc);
    for (const ws of Array.from(this.sockets)) {
      if (ws === except) continue;
      this.sendTo(ws, bytes);
    }
  }

  // Relay a raw received frame to every open socket, verbatim, including the
  // sender (awareness keepalive).
  private relayBytes(data: ArrayBuffer | string): void {
    if (this.sockets.size === 0) return;
    for (const ws of Array.from(this.sockets)) {
      this.sendRaw(ws, data);
    }
  }

  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    if (this.sockets.has(ws) === false || ws.readyState !== WebSocket.READY_STATE_OPEN) {
      this.sockets.delete(ws);
      return;
    }
    try {
      ws.send(bytes);
    } catch {
      // A send that throws (peer already gone): drop the socket from the set.
      this.sockets.delete(ws);
    }
  }

  private sendRaw(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.sockets.has(ws) === false || ws.readyState !== WebSocket.READY_STATE_OPEN) {
      this.sockets.delete(ws);
      return;
    }
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported message');
    } catch {
      /* already closing */
    }
  }
}
