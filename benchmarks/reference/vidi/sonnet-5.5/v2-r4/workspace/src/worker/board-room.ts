import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

/** One board: holds the Y.Doc in memory and relays Yjs sync and awareness messages between sockets. */
export class BoardRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        const msg = encoding.toUint8Array(enc);
        for (const s of [...this.sockets]) if (s !== origin) this.send(s, msg);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      if (ws.readyState !== 1) {
        this.sockets.delete(ws);
        return;
      }
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating on purpose: the doc is memory-only until story 4.
    server.accept();
    const doc = this.getDoc();
    this.sockets.add(server);

    const drop = () => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    server.addEventListener('message', (ev: MessageEvent) => this.onMessage(server, doc, ev.data as ArrayBuffer | string));

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
    if (msg.kind === 'invalid') return this.reject(ws);
    if (msg.kind === 'query-awareness') return;
    if (msg.kind === 'awareness') {
      // Relayed verbatim to everyone, sender included (keeps idle clients alive); not interpreted.
      const bytes = new Uint8Array(data as ArrayBuffer);
      for (const s of [...this.sockets]) this.send(s, bytes);
      return;
    }
    try {
      const decoder = decoding.createDecoder(msg.payload);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const syncType = decoding.readVarUint(decoder);
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, enc, doc);
      } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
        // Applied directly: y-protocols' readSyncStep2/readUpdate swallow decode errors.
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
      } else {
        throw new Error(`unknown sync message type ${syncType}`);
      }
      if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
    } catch {
      this.reject(ws);
    }
  }
}
