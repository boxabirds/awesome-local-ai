import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import { createDecoder } from 'lib0/decoding';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage
} from '../shared/protocol';
import type { Env } from './index';

// One BoardRoom per board (routed by idFromName in the Worker entry). The
// board's Y.Doc lives in memory only in this story: the sockets are accepted
// with the non-hibernating accept, because an open accepted socket keeps the
// object alive and hibernation would evict it and silently drop the document.
// Story 4 switches to hibernation once the doc can be reloaded from storage.
export class BoardRoom extends DurableObject<Env> {
  private readonly sockets = new Set<WebSocket>();
  private doc: Y.Doc | null = null;

  fetch(_request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const doc = this.ensureDoc();
    this.sockets.add(server);
    server.addEventListener('message', (event) => {
      void this.handleMessage(server, event.data as ArrayBuffer | string | Blob);
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });
    // SyncStep1 on accept: a reconnecting client answers with SyncStep2
    // containing everything the room lacks, which repopulates the room after
    // a restart (no loss while at least one person keeps the board open).
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    server.send(toUint8Array(encoder));
    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Broadcast each applied update to every socket except the one it
        // came from (origin is the sender socket passed to readSyncMessage),
        // framed exactly like the y-websocket provider does.
        for (const socket of this.sockets) {
          if (socket === origin) continue;
          const encoder = createEncoder();
          writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.writeUpdate(encoder, update);
          if (!this.send(socket, toUint8Array(encoder))) {
            this.sockets.delete(socket);
          }
        }
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private async handleMessage(ws: WebSocket, data: ArrayBuffer | string | Blob): Promise<void> {
    // Current workerd delivers binary WebSocket frames as Blob; tests and
    // older runtimes use ArrayBuffer. Normalise before decoding.
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
    const doc = this.ensureDoc();
    const message = decodeMessage(bytes);
    switch (message.kind) {
      case 'invalid':
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
      case 'query-awareness':
        // Ignored in this story: no stored awareness (story 6 interprets it).
        return;
      case 'awareness':
        // Relay verbatim to all open sockets including the sender, so idle
        // y-websocket clients keep receiving traffic within their timeout.
        for (const socket of this.sockets) {
          if (!this.send(socket, message.payload)) {
            this.sockets.delete(socket);
          }
        }
        return;
      case 'sync': {
        let reply: Uint8Array;
        let rejected = false;
        try {
          const replyEncoder = createEncoder();
          // readSyncStep2 swallows apply errors internally; the handler lets
          // us still close the offending socket with 1003.
          syncProtocol.readSyncMessage(
            createDecoder(message.payload),
            replyEncoder,
            doc,
            ws,
            () => {
              rejected = true;
            }
          );
          reply = toUint8Array(replyEncoder);
        } catch {
          // Undecodable bytes: close this socket only; others keep working.
          ws.close(CLOSE_UNSUPPORTED_DATA);
          return;
        }
        if (rejected) {
          ws.close(CLOSE_UNSUPPORTED_DATA);
          return;
        }
        if (reply.length > 0) {
          this.send(ws, frame(MESSAGE_SYNC, reply));
        }
        return;
      }
    }
  }

  // Returns false when the socket is dead (caller drops it from the set).
  private send(ws: WebSocket, payload: Uint8Array): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(payload);
      return true;
    } catch {
      return false;
    }
  }
}

function frame(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}
