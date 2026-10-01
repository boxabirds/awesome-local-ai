import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

/** One room per board: an in-memory Y.Doc relayed over non-hibernating WebSockets. */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | null);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  async fetch(_req: Request): Promise<Response> {
    const doc = this.getDoc();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (e) => this.onMessage(server, doc, e.data as ArrayBuffer | string));
    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(server, encoding.toUint8Array(encoder));

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, doc: Y.Doc, data: ArrayBuffer | string): void {
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(msg.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
            // Applied directly: y-protocols' readSyncUpdate swallows errors, but a bad update must close the socket.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          } else {
            throw new Error(`unknown sync message type ${syncType}`);
          }
          if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        } catch {
          this.reject(ws);
        }
        return;
      }
      case 'awareness':
        // Relayed verbatim to everyone, sender included, so idle clients keep receiving traffic.
        this.broadcast(new Uint8Array(data as ArrayBuffer), null);
        return;
      case 'query-awareness':
        return;
      default:
        this.reject(ws);
    }
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try { ws.close(CLOSE_UNSUPPORTED_DATA); } catch { /* already closed */ }
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private broadcast(data: Uint8Array, except: WebSocket | null): void {
    for (const ws of [...this.sockets]) {
      if (ws !== except) this.send(ws, data);
    }
  }
}
