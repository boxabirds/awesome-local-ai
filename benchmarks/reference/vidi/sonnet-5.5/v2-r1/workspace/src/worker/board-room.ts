import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** One room per board: an in-memory Y.Doc relayed between all connected sockets (persistence arrives in story 4). */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const message = syncMessage((e) => syncProtocol.writeUpdate(e, update));
        for (const ws of [...this.sockets]) if (ws !== origin) this.send(ws, message);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
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
    const [client, server] = [pair[0], pair[1]];
    // Non-hibernating accept on purpose: the doc lives only in memory until story 4.
    server.accept();
    const doc = this.getDoc();
    this.sockets.add(server);
    server.addEventListener('message', (ev) => this.onMessage(server, doc, ev.data as ArrayBuffer | string));
    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    // Ask the newcomer for what we lack: repopulates a restarted room from the first reconnecting client.
    this.send(server, syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)));
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, doc: Y.Doc, data: ArrayBuffer | string): void {
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'query-awareness':
        return;
      case 'awareness':
        for (const other of [...this.sockets]) this.send(other, new Uint8Array(data as ArrayBuffer));
        return;
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(msg.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
            // y-protocols' own reader swallows bad updates (logs only); applying directly lets us reject them.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          } else {
            throw new Error(`unknown sync type ${syncType}`);
          }
          if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        } catch {
          this.reject(ws);
        }
      }
    }
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
    } catch {
      // already closed
    }
  }
}
