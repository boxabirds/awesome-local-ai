import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

const WS_OPEN = 1;

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private readonly sockets = new Set<WebSocket>();

  private getDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), (ws) => ws !== origin);
    });
    this.doc = doc;
    return doc;
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WS_OPEN) return;
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private broadcast(data: Uint8Array, include: (ws: WebSocket) => boolean): void {
    for (const ws of [...this.sockets]) if (include(ws)) this.send(ws, data);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const doc = this.getDoc();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating on purpose: the doc lives in memory only until story 4.
    server.accept();
    server.binaryType = 'arraybuffer';
    this.sockets.add(server);

    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    server.addEventListener('message', (e) => this.onMessage(server, doc, e.data as ArrayBuffer | string));

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    this.send(server, encoding.toUint8Array(enc));

    return new Response(null, { status: 101, webSocket: client });
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
    } catch {
      /* already closed */
    }
  }

  private onMessage(ws: WebSocket, doc: Y.Doc, data: ArrayBuffer | string): void {
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, sender included, so idle clients keep receiving traffic.
        this.broadcast(msg.payload, () => true);
        return;
      case 'query-awareness':
        return;
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(msg.payload);
          decoding.readVarUint(decoder); // message type
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          // Not readSyncMessage: it swallows update errors, but a bad update must close the socket.
          const step = decoding.readVarUint(decoder);
          if (step === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, enc, doc);
          } else if (step === syncProtocol.messageYjsSyncStep2 || step === syncProtocol.messageYjsUpdate) {
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          } else {
            throw new Error(`unknown sync step ${step}`);
          }
          if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
        } catch {
          this.reject(ws);
        }
      }
    }
  }
}
