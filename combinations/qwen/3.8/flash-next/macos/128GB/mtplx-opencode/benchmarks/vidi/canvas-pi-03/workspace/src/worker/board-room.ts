// BoardRoom Durable Object (sync.room).
//
// One object per board id (routed by `idFromName` in ./index.ts). The room
// holds the board's Y.Doc in memory and relays Yjs sync + awareness traffic
// between every socket connected to the board:
//
//   * document updates are broadcast to every socket EXCEPT the origin;
//   * awareness bytes are relayed verbatim to ALL sockets including the
//     sender, which keeps idle y-websocket clients under their 30-second
//     no-message timeout (clients periodically renew awareness; the echo
//     counts as received traffic);
//   * query-awareness messages are ignored (no stored awareness in this
//     story — presence semantics are story 6).
//
// Socket hosting uses the Durable-Object pattern: `ctx.acceptWebSocket(server)`
// in fetch() and the class-level webSocketMessage/webSocketClose handlers, so
// message events always deliver to the room regardless of hibernation state.
// No hibernation options are configured, so the object (and its document)
// stays resident while sockets are open.
//
// Restart safety without storage: every new socket immediately receives the
// room's SyncStep1, so a client whose view the room lost (after a restart)
// answers with SyncStep2 and repopulates the document.

import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  /** The board document, created lazily on the first accepted connection.
   * Never discarded explicitly; the runtime discards it when the object is
   * evicted (restart edge, simulated by TC-18). */
  private doc: Y.Doc | null = null;

  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc({ gc: true });
      // Every applied update (sync step2 / update message) is framed and
      // broadcast to the other sockets. The transaction origin is the socket
      // that sent it (see handleMessage), so it never sees an echo of its own
      // update. Identity comparison against ctx.getWebSockets() entries keeps
      // the no-echo rule exact regardless of runtime identity quirks.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder();
        encoding.writeUint8(encoder, MESSAGE_SYNC);
        writeUpdate(encoder, update);
        const frame = encoding.toUint8Array(encoder);
        const except =
          typeof origin === 'object' && origin !== null ? (origin as WebSocket) : null;
        this.broadcast(frame, except);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  /** Send a copy of `bytes` to `ws`. Returns false for dead sockets. */
  private sendTo(ws: WebSocket, bytes: Uint8Array): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      // Fresh copy per send: the runtime detaches the buffer it consumes.
      ws.send(bytes.slice());
      return true;
    } catch {
      return false;
    }
  }

  /** Relay to every open, accepted socket except `except`. Dead sockets are
   * simply skipped; ctx.getWebSockets() reflects closed ones. */
  private broadcast(bytes: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.sendTo(ws, bytes);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const doc = this.ensureDoc();
    // Accept the server end: incoming messages arrive via the class-level
    // webSocketMessage handler, close/error likewise.
    this.ctx.acceptWebSocket(server);

    // Push our own SyncStep1 first, so a reconnecting client whose history the
    // room lost answers with SyncStep2 (full document) and repopulates it.
    const encoder = encoding.createEncoder();
    encoding.writeUint8(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    this.sendTo(server, encoding.toUint8Array(encoder));

    // Return the CLIENT end on the 101 response; the runtime pipes it to the
    // upgraded connection (the server end is the room's event source).
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const doc = this.doc;
    if (doc === null) return; // cannot happen: accepting a socket created the doc
    this.handleMessage(ws, doc, message);
  }

  private handleMessage(server: WebSocket, doc: Y.Doc, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Text frames, undecodable bytes, unknown types, truncation → close the
      // offending socket only. Other sockets and the document are untouched.
      try {
        server.close(CLOSE_UNSUPPORTED_DATA, 'unsupported message');
      } catch {
        /* already closed */
      }
      return;
    }

    if (decoded.kind === 'query-awareness') return; // no stored awareness to answer

    if (decoded.kind === 'awareness') {
      // Relay verbatim to ALL open sockets, including the sender (idle
      // keepalive). The sender's own client ignores it (equal clocks).
      this.broadcast(new Uint8Array(data as ArrayBuffer), null);
      return;
    }

    // Sync channel: step1 gets a step2 reply, step2/update get applied. The
    // transaction origin is the sender socket, so the doc-update broadcast
    // below skips it. A throwing apply (corrupt update) closes the sender.
    const encoder = encoding.createEncoder();
    encoding.writeUint8(encoder, MESSAGE_SYNC);
    let failed = false;
    try {
      readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        doc,
        server,
        () => {
          failed = true;
        },
      );
    } catch {
      failed = true;
    }
    if (failed) {
      try {
        server.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
      } catch {
        /* already closed */
      }
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.sendTo(server, encoding.toUint8Array(encoder));
    }
  }
}
