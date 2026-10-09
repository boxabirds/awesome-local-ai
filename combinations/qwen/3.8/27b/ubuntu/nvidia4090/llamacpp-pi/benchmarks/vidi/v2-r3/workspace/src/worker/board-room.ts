import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrame,
} from '../shared/protocol';

/**
 * One BoardRoom per board. Holds the board's Y.Doc in memory and relays
 * y-websocket framed sync and awareness messages between all sockets on the
 * board. No persistence in this story (story 4).
 *
 * Non-hibernating WebSockets on purpose: an open, accepted socket keeps the
 * object alive while the doc is memory-only.
 */
export class BoardRoom extends DurableObject {
  private doc: Y.Doc | undefined;
  private sockets = new Set<WebSocket>();

  private get document(): Y.Doc {
    if (!this.doc) {
      const doc = new Y.Doc();
      this.doc = doc;
      // Subscribe once for the lifetime of the doc: broadcast each update to
      // every socket except the one it came from (no echo for the sender).
      doc.on('update', (update, origin) => {
        this.broadcast(update, origin);
      });
    }
    return this.doc;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const ws: WebSocket = server;

    this.sockets.add(ws);
    ws.addEventListener('message', (ev) => {
      this.onMessage(ws, ev.data);
    });
    const drop = () => {
      this.sockets.delete(ws);
    };
    // workerd does not echo the close frame on a Durable Object socket: the
    // close handshake only completes once we answer it explicitly, otherwise
    // clients see an abnormal 1006 closure.
    ws.addEventListener('close', (ev) => {
      try {
        ws.close(ev.code, ev.reason);
      } catch {
        /* already closing */
      }
      drop();
    });
    ws.addEventListener('error', drop);

    const response = new Response(null, { status: 101, webSocket: client });
    // On (re)connect the room offers its state; a reconnecting client whose
    // doc is newer answers with everything the room lacks (restart safety).
    // Deferred past the response: workerd drops sends issued before the 101
    // response has been flushed.
    const step1 = encoding.createEncoder();
    writeSyncStep1(step1, this.document);
    const kickoff = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeFrame(MESSAGE_SYNC, encoding.toUint8Array(step1)));
        }
        resolve();
      }, 50);
    });
    this.ctx.waitUntil(kickoff);
    return response;
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    const message = encodeFrame(MESSAGE_SYNC, encoding.toUint8Array(enc));
    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(message);
      } catch {
        this.sockets.delete(ws); // dead socket: drop it, keep serving the rest
      }
    }
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const decoded = decodeMessage(data as ArrayBuffer | string);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story: ignore.
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay the full frame verbatim to every socket including the sender:
      // y-websocket clients drop sockets that go quiet, so idle clients must
      // keep receiving traffic.
      const message = encodeFrame(MESSAGE_AWARENESS, decoded.payload);
      for (const other of this.sockets) {
        if (other.readyState !== WebSocket.OPEN) continue;
        try {
          other.send(message);
        } catch {
          this.sockets.delete(other);
        }
      }
      return;
    }
    // kind === 'sync'
    const doc = this.document;
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(decoded.payload);
    try {
      // A sync frame can carry several messages (e.g. a step2+step1 reply);
      // process every one. Origin is the sending socket: its own update is
      // not echoed back.
      while (decoding.hasContent(decoder)) {
        readSyncMessage(decoder, encoder, doc, ws);
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 0) {
      try {
        ws.send(encodeFrame(MESSAGE_SYNC, reply));
      } catch {
        this.sockets.delete(ws);
      }
    }
  }
}
