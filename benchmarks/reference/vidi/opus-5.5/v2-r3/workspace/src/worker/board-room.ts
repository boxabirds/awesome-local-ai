// BoardRoom: one Durable Object per board. Holds the board's Y.Doc in memory
// (persistence arrives in story 4) and relays y-websocket sync and awareness
// messages between every socket connected to the board.
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  encodeSyncFrame,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Non-hibernating on purpose: the doc lives only in memory until story 4, and
    // an open accepted socket keeps the object (and so the doc) alive.
    server.accept();
    server.binaryType = 'arraybuffer';
    this.join(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private getDoc(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      // Every update is forwarded at once to every socket except the one it came from.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const frame = encodeSyncFrame((e) => syncProtocol.writeUpdate(e, update));
        this.broadcast(frame, origin instanceof WebSocket ? origin : null);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private join(ws: WebSocket): void {
    const doc = this.getDoc();
    this.sockets.add(ws);
    ws.addEventListener('message', (event) => this.onMessage(ws, event.data));
    ws.addEventListener('close', () => this.leave(ws));
    ws.addEventListener('error', () => this.leave(ws));
    // Our state vector: a reconnecting client answers with everything we lack,
    // which repopulates a room that restarted.
    this.send(ws, encodeSyncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
  }

  private leave(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(ws)) return;
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, sender included, so idle clients keep
        // receiving traffic within the y-websocket reconnect timeout.
        this.broadcast(data as ArrayBuffer, null);
        return;
      case 'query-awareness':
        return; // No awareness state is kept in this story.
      case 'sync': {
        const doc = this.getDoc();
        const decoder = decoding.createDecoder(msg.payload);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, doc);
          } else {
            // SyncStep2 or Update. Applied directly (not via readSyncMessage, which
            // swallows errors) so an invalid update closes the sender. The socket is
            // the origin, so the broadcast skips it: no echo.
            Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
          }
        } catch {
          this.reject(ws);
          return;
        }
        if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
        return;
      }
    }
  }

  private reject(ws: WebSocket): void {
    this.leave(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // Already closing.
    }
  }

  private broadcast(frame: ArrayBuffer | Uint8Array, except: WebSocket | null): void {
    for (const ws of this.sockets) {
      if (ws !== except) this.send(ws, frame);
    }
  }

  private send(ws: WebSocket, frame: ArrayBuffer | Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      this.leave(ws);
    }
  }
}
