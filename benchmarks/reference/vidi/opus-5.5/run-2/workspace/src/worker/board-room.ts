/**
 * One BoardRoom per board (anchor: sync.room): holds the board's Y.Doc in memory and
 * relays y-websocket sync and awareness messages between every socket on the board.
 *
 * Sockets are accepted with `server.accept()` (not the hibernation API) on purpose: the
 * doc lives only in memory until story 4, and an open accepted socket keeps the object
 * alive. On every accept the room sends its own SyncStep1, so after a restart the first
 * reconnecting client repopulates the empty doc with its SyncStep2.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

const SWITCHING_PROTOCOLS = 101;
const UPGRADE_REQUIRED = 426;

function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: UPGRADE_REQUIRED });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Binary frames as ArrayBuffer (newer compatibility dates default to Blob).
    server.binaryType = 'arraybuffer';
    server.accept();
    this.join(server);
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }

  private getDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      // Forward every applied update to all sockets except the one it came from.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const frame = syncFrame((e) => syncProtocol.writeUpdate(e, update));
        this.broadcast(frame, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private join(ws: WebSocket): void {
    const doc = this.getDoc();
    this.sockets.add(ws);
    const leave = () => this.sockets.delete(ws);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    ws.addEventListener('message', (event) => this.onMessage(ws, event.data));
    this.send(ws, syncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
  }

  private onMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(ws)) return;
    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync':
        this.onSync(ws, message.payload);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, the sender included: the renewal traffic keeps
        // idle y-websocket clients from timing out. Presence semantics are story 6.
        if (typeof data !== 'string') this.broadcast(new Uint8Array(data), null);
        return;
      case 'query-awareness':
        return; // no awareness is stored in this story
      case 'invalid':
        this.reject(ws);
        return;
    }
  }

  private onSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.getDoc();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let failed = false;
    try {
      syncProtocol.readSyncMessage(decoding.createDecoder(payload), encoder, doc, ws, () => {
        failed = true;
      });
    } catch {
      failed = true;
    }
    if (failed) {
      this.reject(ws);
      return;
    }
    if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
  }

  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // already closing
    }
  }

  private send(ws: WebSocket, frame: Uint8Array): void {
    try {
      ws.send(frame);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private broadcast(frame: Uint8Array, except: unknown): void {
    for (const ws of [...this.sockets]) {
      if (ws !== except) this.send(ws, frame);
    }
  }
}
