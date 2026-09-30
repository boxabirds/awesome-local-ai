import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/**
 * One board's live room: holds the board's Y.Doc in memory and relays Yjs sync
 * and awareness messages between every WebSocket connected to the board.
 *
 * Sockets use the non-hibernating `accept()` on purpose: the doc exists only in
 * memory until story 4, and an open accepted socket keeps the object alive.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    // Every update is forwarded at once to every socket except the one it came from (no echo).
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const message = frame(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update));
      for (const ws of this.sockets) if (ws !== origin) this.send(ws, message);
    });
    this.doc = doc;
    return doc;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Newer compatibility dates deliver binary frames as Blob unless told otherwise.
    server.binaryType = 'arraybuffer';
    server.accept();
    this.sockets.add(server);
    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    server.addEventListener('message', (event) => this.onMessage(server, event.data));
    // SyncStep1 on every (re)connection: the client answers with everything the room lacks,
    // which repopulates a room that restarted while people kept the board open.
    const doc = this.getDoc();
    this.send(server, frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, doc)));
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(ws)) return;
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        const doc = this.getDoc();
        let reply: Uint8Array;
        try {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const before = encoding.length(encoder);
          syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, doc, ws, (error) => {
            throw error;
          });
          reply = encoding.length(encoder) > before ? encoding.toUint8Array(encoder) : new Uint8Array();
        } catch {
          this.reject(ws);
          return;
        }
        if (reply.length > 0) this.send(ws, reply);
        return;
      }
      case 'awareness': {
        // Relayed verbatim to everyone, sender included: idle y-websocket clients need traffic.
        const message = frame(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, decoded.payload));
        for (const socket of this.sockets) this.send(socket, message);
        return;
      }
      case 'query-awareness':
        // No awareness state is kept in this story (presence is story 6).
        return;
      case 'invalid':
        this.reject(ws);
        return;
    }
  }

  /** Closes one misbehaving socket; everyone else stays connected. */
  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // already closed
    }
  }

  /** A socket whose send throws is dead and leaves the set. */
  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      this.sockets.delete(ws);
    }
  }
}
