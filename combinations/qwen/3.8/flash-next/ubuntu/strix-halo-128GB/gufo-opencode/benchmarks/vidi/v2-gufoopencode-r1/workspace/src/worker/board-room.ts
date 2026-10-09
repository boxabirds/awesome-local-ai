import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import { createEncoder, length as encodedLength, toUint8Array, writeVarUint } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

type FrameData = Blob | ArrayBuffer | string | Uint8Array;

// workerd delivers binary WebSocket frames as Blobs; normalise everything to
// an exact-length Uint8Array (owning its buffer) or pass text through so the
// shared decoder can reject it.
async function toFrame(data: FrameData): Promise<Uint8Array | string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data.slice();
  return new Uint8Array(await data.arrayBuffer());
}

function safeSend(socket: WebSocket, data: Uint8Array | ArrayBuffer): boolean {
  try {
    socket.send(data);
    return true;
  } catch {
    return false;
  }
}

// One board, one Y.Doc, held in memory for as long as at least one socket is
// open. The document is deliberately NOT stored yet (story 4): a socket is
// accepted with the non-hibernating `accept()` so the object stays alive while
// anybody is connected, and every (re)connecting client is asked for its full
// state with SyncStep1, which repopulates the document after a restart while
// at least one person still has the board open.
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const doc = this.ensureDoc();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      void this.handleMessage(server, event.data as FrameData).catch(() => {
        this.reject(server, 'unhandled message error');
      });
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });
    // Ask the newcomer for everything we lack; its SyncStep2 (re)populates a
    // room that started empty after a restart or eviction.
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    if (!safeSend(server, toUint8Array(encoder))) {
      this.sockets.delete(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureDoc(): Y.Doc {
    if (this.doc !== null) return this.doc;
    const doc = new Y.Doc();
    // Every applied update goes straight to every other open socket; the
    // sender receives no echo. A socket whose send throws is dropped.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      let targets: WebSocket[] | null = null;
      for (const socket of this.sockets) {
        if (socket !== origin) (targets ??= []).push(socket);
      }
      if (targets === null) return;
      // Updates travel framed, exactly like the provider sends them:
      // [MESSAGE_SYNC][SYNC_UPDATE][length-prefixed update].
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      writeUpdate(encoder, update);
      const message = toUint8Array(encoder);
      for (const socket of targets) {
        if (!safeSend(socket, message)) this.sockets.delete(socket);
      }
    });
    this.doc = doc;
    return doc;
  }

  private async handleMessage(socket: WebSocket, data: FrameData): Promise<void> {
    const doc = this.doc;
    if (doc === null) return;
    const frame = await toFrame(data);
    const decoded = decodeMessage(typeof frame === 'string' ? frame : (frame.buffer as ArrayBuffer));
    switch (decoded.kind) {
      case 'invalid':
        this.reject(socket, decoded.reason);
        return;
      case 'sync': {
        const decoder = createDecoder(decoded.payload);
        const reply = createEncoder();
        writeVarUint(reply, MESSAGE_SYNC);
        let failed = false;
        readSyncMessage(decoder, reply, doc, socket, () => {
          failed = true;
        });
        if (failed) {
          this.reject(socket, 'invalid yjs update');
          return;
        }
        if (encodedLength(reply) > 1 && !safeSend(socket, toUint8Array(reply))) {
          this.sockets.delete(socket);
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every open socket including the sender. Clients
        // renew their awareness periodically; hearing traffic back (their own
        // and everyone else's) is what keeps idle connections alive.
        // Interpreting awareness is story 6.
        if (typeof frame === 'string') return;
        for (const other of [...this.sockets]) {
          if (!safeSend(other, frame)) this.sockets.delete(other);
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: no awareness state is stored (story 6).
        return;
    }
  }

  private reject(socket: WebSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // The socket was already gone.
    }
  }
}
