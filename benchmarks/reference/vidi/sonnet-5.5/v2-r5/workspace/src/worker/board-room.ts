import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

const WS_OPEN = 1;

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null, false);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WS_OPEN) return;
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private broadcast(data: Uint8Array, except: WebSocket | null, includeSender: boolean): void {
    for (const ws of [...this.sockets]) {
      if (!includeSender && ws === except) continue;
      this.send(ws, data);
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const doc = this.getDoc();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating on purpose: the doc is memory-only until story 4.
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (ev: MessageEvent) => this.onMessage(server, ev.data));
    const drop = () => { this.sockets.delete(server); };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    this.send(server, encoding.toUint8Array(enc));

    return new Response(null, { status: 101, webSocket: client });
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try { ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data'); } catch { /* already closed */ }
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'query-awareness':
        return;
      case 'awareness':
        this.broadcast(msg.payload, null, true);
        return;
      case 'sync': {
        const doc = this.getDoc();
        try {
          // Y.applyUpdate swallows decode errors (logs and ignores), so validate updates first.
          const probe = decoding.createDecoder(msg.payload);
          decoding.readVarUint(probe); // message type
          const subType = decoding.readVarUint(probe);
          if (subType === syncProtocol.messageYjsSyncStep2 || subType === syncProtocol.messageYjsUpdate) {
            Y.decodeUpdate(decoding.readVarUint8Array(probe));
          }
          const decoder = decoding.createDecoder(msg.payload);
          decoding.readVarUint(decoder); // message type
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, ws);
          if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
        } catch {
          this.reject(ws);
        }
      }
    }
  }
}
