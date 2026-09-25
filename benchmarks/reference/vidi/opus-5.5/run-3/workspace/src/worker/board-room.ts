// One BoardRoom per board: holds the board's Y.Doc in memory and relays y-websocket traffic.
//
// Sockets are accepted with `server.accept()` (not the hibernation API) on purpose: until story 4 the doc
// lives only in memory, and hibernation could evict the object while sockets stay open, dropping the doc.
// An accepted, open socket keeps the object alive.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, decodeMessage, encodeSync } from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Newer compatibility dates deliver binary frames as Blob by default; the protocol needs bytes.
    server.binaryType = 'arraybuffer';
    server.accept();
    this.join(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private getDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    // Every applied update goes to every other socket; the origin (the sending socket) gets no echo.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcast(encodeSync((e) => syncProtocol.writeUpdate(e, update)), origin);
    });
    this.doc = doc;
    return doc;
  }

  private join(ws: WebSocket): void {
    const doc = this.getDoc();
    this.sockets.add(ws);
    ws.addEventListener('message', (event) => this.onMessage(ws, event.data));
    ws.addEventListener('close', () => this.leave(ws));
    ws.addEventListener('error', () => this.leave(ws));
    // Always start with our state vector: a client that has more (e.g. after a restart) answers with it.
    this.send(ws, encodeSync((e) => syncProtocol.writeSyncStep1(e, doc)));
  }

  private leave(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(ws)) return;
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        let reply: Uint8Array | null;
        try {
          reply = this.readSync(msg.payload, ws);
        } catch {
          this.reject(ws);
          return;
        }
        if (reply) this.send(ws, reply);
        return;
      }
      case 'awareness':
        // Relayed verbatim to everyone, the sender included: it keeps idle clients' connections alive.
        // Interpreting awareness (who is here) is story 6.
        this.broadcast(data as ArrayBuffer, null);
        return;
      case 'query-awareness':
        return; // no awareness state is kept in this story
      case 'invalid':
        this.reject(ws);
        return;
    }
  }

  /**
   * Same as `syncProtocol.readSyncMessage`, except that an update Yjs rejects throws here (y-protocols would
   * log and swallow it) so the sender can be closed. Applied updates carry the socket as origin.
   * Returns the reply frame, if any.
   */
  private readSync(payload: Uint8Array, ws: WebSocket): Uint8Array | null {
    const doc = this.getDoc();
    const decoder = decoding.createDecoder(payload);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case syncProtocol.messageYjsSyncStep1:
        return encodeSync((e) => syncProtocol.readSyncStep1(decoder, e, doc));
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate:
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
        return null;
      default:
        throw new Error(`unknown sync message type ${type}`);
    }
  }

  private reject(ws: WebSocket): void {
    this.leave(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // already closing
    }
  }

  private broadcast(message: ArrayBuffer | Uint8Array, except: unknown): void {
    for (const ws of this.sockets) if (ws !== except) this.send(ws, message);
  }

  private send(ws: WebSocket, message: ArrayBuffer | Uint8Array): void {
    try {
      ws.send(message as ArrayBuffer | ArrayBufferView<ArrayBuffer>);
    } catch {
      this.leave(ws);
    }
  }
}
