/**
 * BoardRoom: one Durable Object per board. Holds the board's Y.Doc in memory and relays
 * y-websocket sync and awareness messages between every socket on the board.
 *
 * Sockets are accepted with `server.accept()` (not the hibernation API) on purpose: until
 * story 4 the document exists only in memory, and hibernation would evict the object while
 * sockets stay open, silently dropping the document. An open accepted socket keeps it alive.
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_UPGRADE_REQUIRED = 426;
/** Encoder length of a reply that contains only the message type (nothing to send). */
const EMPTY_REPLY_LENGTH = 1;

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: HTTP_UPGRADE_REQUIRED });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Binary frames as ArrayBuffer (newer compatibility dates default to Blob).
    server.binaryType = 'arraybuffer';
    server.accept();
    this.join(server);
    return new Response(null, { status: HTTP_SWITCHING_PROTOCOLS, webSocket: client });
  }

  /** The room's document, created empty on first use. */
  private getDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      // Every applied update goes to every other socket; the sender (origin) gets no echo.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const message = frame((e) => {
          encoding.writeVarUint(e, MESSAGE_SYNC);
          syncProtocol.writeUpdate(e, update);
        });
        this.broadcast(message, origin instanceof WebSocket ? origin : null);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private join(ws: WebSocket): void {
    const doc = this.getDoc();
    this.sockets.add(ws);
    const leave = () => {
      this.sockets.delete(ws);
    };
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    ws.addEventListener('message', (event: MessageEvent) => this.onMessage(ws, event.data));
    // Our state vector first: a client that has content we lack (e.g. after a restart
    // emptied this room) answers with SyncStep2 and repopulates the room.
    this.send(
      ws,
      frame((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(e, doc);
      }),
    );
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    if (!this.sockets.has(ws)) return;
    const decoded =
      typeof data === 'string' || data instanceof ArrayBuffer
        ? decodeMessage(data)
        : ({ kind: 'invalid', reason: 'unsupported frame' } as const);
    switch (decoded.kind) {
      case 'invalid':
        this.reject(ws);
        return;
      case 'awareness':
        // Relayed verbatim to everyone, sender included: the renewals keep idle clients'
        // no-message watchdog satisfied. Interpreting awareness is story 6.
        this.broadcast(new Uint8Array(data as ArrayBuffer), null);
        return;
      case 'query-awareness':
        // No awareness state is kept in this story.
        return;
      case 'sync':
        this.onSync(ws, decoded.payload);
        return;
    }
  }

  private onSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.getDoc();
    const decoder = decoding.createDecoder(payload);
    const syncType = decoding.readVarUint(decoder);
    // Handled directly rather than via readSyncMessage, which swallows update errors: a
    // malformed state vector or update closes the offending socket.
    try {
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncStep1(decoder, reply, doc);
        if (encoding.length(reply) > EMPTY_REPLY_LENGTH) this.send(ws, encoding.toUint8Array(reply));
        return;
      }
      // SyncStep2 or update.
      Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
    } catch {
      this.reject(ws);
    }
  }

  /** Closes one misbehaving socket; everyone else is unaffected. */
  private reject(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
    } catch {
      // Already closed.
    }
  }

  private broadcast(message: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.sockets) {
      if (ws !== except) this.send(ws, message);
    }
  }

  /** A socket whose send throws is dead: drop it from the room. */
  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      this.sockets.delete(ws);
    }
  }
}
