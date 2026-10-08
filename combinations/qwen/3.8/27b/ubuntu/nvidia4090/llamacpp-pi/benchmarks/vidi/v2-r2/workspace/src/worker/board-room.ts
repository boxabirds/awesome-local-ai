/**
 * BoardRoom: one Durable Object per board (story 3).
 *
 * Holds the board's Y.Doc in memory and relays y-protocols sync messages
 * between all sockets on the board. No persistence in this story (story 4)
 * and no awareness state (story 6).
 *
 * - Non-hibernating `server.accept()`: hibernation would evict the object
 *   while its sockets stay open and silently drop the in-memory doc. An
 *   open, accepted socket keeps the object alive.
 * - On every (re)connection the room sends its SyncStep1; the client
 *   answers with SyncStep2 containing everything the room lacks. After a
 *   restart the first reconnecting client repopulates the room.
 * - Document updates are applied with the receiving socket as origin and
 *   broadcast to every other socket immediately (no batching); the sender
 *   gets no echo.
 * - Awareness bytes are relayed verbatim to ALL sockets including the
 *   sender: y-websocket clients have a 30 s no-message watchdog, and the
 *   y-protocols Awareness instance renews its (non-null) local state every
 *   15 s, so relaying keeps idle connections alive.
 */

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync.js';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  /** WebSocket upgrade only; every socket becomes a room participant. */
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.attachSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attachSocket(ws: WebSocket): void {
    ws.binaryType = 'arraybuffer';
    this.sockets.add(ws);
    ws.addEventListener('message', (event: MessageEvent): void => {
      this.onMessage(ws, event.data);
    });
    ws.addEventListener('close', (): void => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', (): void => {
      this.sockets.delete(ws);
    });
    this.ensureDoc();
    // Send our state vector so the newcomer can send back what we lack
    // (this is how a restarted room gets repopulated).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc as Y.Doc);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private ensureDoc(): void {
    if (this.doc !== null) {
      return;
    }
    const doc = new Y.Doc();
    doc.on('update', (update, origin) => {
      this.broadcast(update, origin);
    });
    this.doc = doc;
  }

  private onMessage(ws: WebSocket, data: MessageEvent['data']): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.reject(ws, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story (story 6 interprets it).
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, including the sender.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, decoded.payload);
      const frame = encoding.toUint8Array(encoder);
      for (const socket of [...this.sockets]) {
        this.send(socket, frame);
      }
      return;
    }
    // kind === 'sync'
    this.ensureDoc();
    const doc = this.doc as Y.Doc;
    const decoder = decoding.createDecoder(decoded.payload);
    const encoder = encoding.createEncoder();
    let failed = false;
    try {
      // Origin = the receiving socket, so the broadcast skips it (no echo).
      readSyncMessage(decoder, encoder, doc, ws, (error: Error): void => {
        failed = true;
        console.error('BoardRoom: rejected Yjs update: ' + error.message);
      });
    } catch (error) {
      failed = true;
      console.error('BoardRoom: rejected sync message: ' + String(error));
    }
    if (failed) {
      this.reject(ws, 'unsupported data');
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 0) {
      // y-protocols writes bare sync sub-messages; the y-websocket wire
      // format appends them RAW after the MESSAGE_SYNC type byte
      // (no length prefix — see protocol.ts).
      const outer = encoding.createEncoder();
      encoding.writeVarUint(outer, MESSAGE_SYNC);
      encoding.writeUint8Array(outer, reply);
      this.send(ws, encoding.toUint8Array(outer));
    }
  }

  /** Forward one document update to every socket except the one it came from. */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of [...this.sockets]) {
      if (socket !== origin) {
        this.send(socket, frame);
      }
    }
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      // A send to a dead socket must not take the room down: just drop it.
      this.sockets.delete(ws);
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason);
    } catch {
      // already closed
    }
  }
}
