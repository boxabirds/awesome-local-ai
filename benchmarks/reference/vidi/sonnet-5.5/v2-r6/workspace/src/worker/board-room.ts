import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

/** One room per board: an in-memory Y.Doc relayed between all connected sockets. */
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
        const msg = encoding.toUint8Array(enc);
        for (const ws of [...this.sockets]) {
          if (ws !== origin) this.send(ws, msg);
        }
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private send(ws: WebSocket, msg: Uint8Array): void {
    try {
      ws.send(msg);
    } catch {
      this.sockets.delete(ws);
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
    // Non-hibernating on purpose: the doc lives only in memory until story 4.
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (ev) => this.onMessage(server, ev.data as string | ArrayBuffer));
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

  /** Yjs swallows malformed updates while applying them, so reject them up front. */
  private validate(payload: Uint8Array): void {
    const d = decoding.createDecoder(payload);
    const type = decoding.readVarUint(d);
    if (type === syncProtocol.messageYjsSyncStep2 || type === syncProtocol.messageYjsUpdate) {
      Y.decodeUpdate(decoding.readVarUint8Array(d));
    } else if (type === syncProtocol.messageYjsSyncStep1) {
      decoding.readVarUint8Array(d);
    } else {
      throw new Error('unknown sync message');
    }
  }

  private onMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'query-awareness':
        return; // no awareness state is kept in this story
      case 'awareness':
        // Relayed verbatim to everyone, including the sender, so idle clients keep receiving traffic.
        for (const s of [...this.sockets]) this.send(s, new Uint8Array(data as ArrayBuffer));
        return;
      case 'sync': {
        const doc = this.getDoc();
        try {
          this.validate(decoded.payload);
          const decoder = decoding.createDecoder(decoded.payload);
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
