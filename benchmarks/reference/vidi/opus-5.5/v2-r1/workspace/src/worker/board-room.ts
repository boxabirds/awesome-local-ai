import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeSyncStep1,
  encodeUpdate,
  readSync,
} from '../shared/protocol';
import type { Env } from './index';

/**
 * One board's live room: holds the board's Y.Doc in memory and relays y-websocket sync and
 * awareness messages between every socket on the board.
 *
 * Sockets use the non-hibernating `accept()` on purpose: the doc lives only in memory until
 * story 4, and hibernation would evict the object (and the doc) while sockets stay open.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    // Forward every applied update to all sockets except the one it came from (no echo).
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const frame = encodeUpdate(update);
      for (const ws of this.sockets) {
        if (ws !== origin) this.send(ws, frame);
      }
    });
    this.doc = doc;
    return doc;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    // Newer compatibility dates deliver binary frames as Blob by default.
    server.binaryType = 'arraybuffer';
    this.sockets.add(server);
    const doc = this.getDoc();
    server.addEventListener('message', (event) => this.onMessage(server, event.data));
    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    // Ask the newcomer for everything the room lacks (repopulates a restarted room).
    this.send(server, encodeSyncStep1(doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(ws)) return;
    const msg = decodeMessage(data);
    switch (msg.kind) {
      case 'sync': {
        let reply: Uint8Array | null;
        try {
          reply = readSync(this.getDoc(), msg.payload, ws);
        } catch {
          this.reject(ws);
          return;
        }
        if (reply) this.send(ws, reply);
        return;
      }
      case 'awareness': {
        // Relayed verbatim to everyone, sender included: keeps idle clients' connections alive.
        const frame = new Uint8Array(data as ArrayBuffer);
        for (const other of this.sockets) this.send(other, frame);
        return;
      }
      case 'query-awareness':
        // No awareness state is kept in this story.
        return;
      case 'invalid':
        this.reject(ws);
        return;
    }
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // Already closed.
    }
  }

  private send(ws: WebSocket, frame: Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      this.sockets.delete(ws);
    }
  }
}
