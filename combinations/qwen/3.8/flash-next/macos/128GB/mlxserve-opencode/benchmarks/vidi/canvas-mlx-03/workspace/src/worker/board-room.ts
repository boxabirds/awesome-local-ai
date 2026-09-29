// One BoardRoom Durable Object per board. It holds the board's Y.Doc in memory
// and relays Yjs sync and awareness messages between every WebSocket connected
// to this board. There is no persistence in story 3 — the document exists only
// while at least one socket keeps the object alive. See design
// "BoardRoom Durable Object".

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './index.ts';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol.ts';

/** Wrap a y-protocols sync sub-message in the y-websocket `messageSync` frame. */
function syncMessage(build: (enc: encoding.Encoder) => void): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  build(enc);
  return encoding.toUint8Array(enc);
}

export class BoardRoom extends DurableObject<Env> {
  /** Open, accepted (server-side) sockets on this board. */
  private readonly sockets = new Set<WebSocket>();
  /** The board document, created lazily on the first accepted socket. */
  private doc: Y.Doc | null = null;
  private docWired = false;

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  fetch(request: Request): Response {
    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Non-hibernating accept on purpose: the in-memory Y.Doc must stay resident
    // with the object. An open, accepted socket keeps the object alive.
    this.handleSocket(server);

    const doc = this.ensureDoc();
    // Send our state vector so a (re)connecting client sends back everything we
    // are missing (this is how a restarted room is repopulated by the first
    // client still holding the document).
    this.safeSend(server, syncMessage((enc) => syncProtocol.writeSyncStep1(enc, doc)));

    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureDoc(): Y.Doc {
    if (!this.doc) this.doc = new Y.Doc();
    if (!this.docWired) {
      this.docWired = true;
      // Broadcast every local document change to all *other* open sockets; the
      // originating socket (origin) never receives an echo of its own update.
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        const frame = syncMessage((enc) => syncProtocol.writeUpdate(enc, update));
        for (const ws of this.sockets) {
          if (ws === origin) continue;
          this.safeSend(ws, frame);
        }
      });
    }
    return this.doc;
  }

  private handleSocket(server: WebSocket): void {
    server.accept();
    server.binaryType = 'arraybuffer';
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      this.onMessage(server, event.data);
    });
    const forget = () => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);
  }

  private onMessage(server: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      this.closeSocket(server, CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relayed verbatim to every open socket *including* the sender, so idle
      // clients keep receiving traffic and never trip their no-message timeout.
      // Awareness semantics (who is here) are story 6 — we do not interpret it.
      for (const ws of this.sockets) this.safeSend(ws, data);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // No stored awareness state in this story: ignore.
      return;
    }

    // kind === 'sync'
    const doc = this.ensureDoc();
    try {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const sub = decoding.createDecoder(decoded.payload);
      // Any Yjs apply error is rethrown so the offending socket is closed with
      // CLOSE_UNSUPPORTED_DATA rather than silently corrupting the room.
      syncProtocol.readSyncMessage(sub, reply, doc, server, (err: unknown) => {
        throw err;
      });
      if (encoding.length(reply) > 1) {
        this.safeSend(server, encoding.toUint8Array(reply));
      }
    } catch {
      this.closeSocket(server, CLOSE_UNSUPPORTED_DATA);
    }
  }

  /** Send bytes; a socket whose send throws is dropped from the set. */
  private safeSend(ws: WebSocket, data: ArrayBuffer | Uint8Array | string): void {
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private closeSocket(ws: WebSocket, code: number): void {
    this.sockets.delete(ws);
    try {
      ws.close(code);
    } catch {
      /* already closing */
    }
  }
}
