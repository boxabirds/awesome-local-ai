// One BoardRoom per board address. It holds the board's Y.Doc in memory and
// relays y-websocket sync + awareness messages between every WebSocket on this
// board. Merging is Yjs CRDT semantics: concurrent text inserts are all kept,
// concurrent map sets converge to one value, and a deleted note is never
// resurrected by a simultaneous edit inside it.
//
// There is no persistence and no participant counting here: story 4 will persist
// the same document, and the PRD's five-editor capacity is a design/test target,
// never a limit the room enforces. Sockets use the non-hibernating accept (see
// the design): the doc exists only while an accepted socket keeps this object
// alive, which is exactly what we want until story 4 can reload it from storage.

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  /** WebSocket upgrade only; every other request is a programming error. */
  async fetch(request: Request): Promise<Response> {
    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.binaryType = 'arraybuffer';
    this.wireSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The room's document, created empty on the first accept. */
  private getDocument(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private wireSocket(ws: WebSocket): void {
    this.sockets.add(ws);
    ws.addEventListener('message', (event: MessageEvent) => {
      this.receive(ws, event.data as ArrayBuffer | string);
    });
    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });
    // On accept we ask the newcomer for its state. On a fresh or restarted room
    // this is the message that makes the first reconnecting client repopulate
    // the document (the client answers with a SyncStep2).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.getDocument());
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private receive(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupported(ws);
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, the sender included: relaying to
      // the sender is what keeps idle y-websocket clients under their reconnect
      // watchdog. We never interpret awareness in this story.
      for (const socket of [...this.sockets]) this.send(socket, decoded.payload);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // ignored: the room keeps no awareness state to answer a query with
    }

    // A sync message. readSyncMessage may apply an update (which fires `update`
    // with this socket as origin, broadcasting it to the others). An invalid
    // Yjs update is reported through the error handler rather than thrown.
    const doc = this.getDocument();
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let rejected = false;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      decoding.readVarUint(decoder); // consume the messageSync type byte
      syncProtocol.readSyncMessage(decoder, reply, doc, ws, () => {
        rejected = true;
      });
    } catch {
      this.closeUnsupported(ws);
      return;
    }
    if (rejected) {
      this.closeUnsupported(ws);
      return;
    }
    // `reply` always carries the messageSync type byte we wrote; only send when
    // readSyncMessage added real content to it.
    if (encoding.length(reply) > 1) this.send(ws, encoding.toUint8Array(reply));
  }

  /** Forward one applied update to every socket except the one it came from. */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    if (this.sockets.size === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const socket of [...this.sockets]) {
      if (socket === origin) continue; // the sender already has it (no echo)
      this.send(socket, message);
    }
  }

  /** Send raw bytes; a socket that throws is dropped rather than fatal. */
  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // the socket was already gone
    }
  }
}
