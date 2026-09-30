import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../shared/protocol';

function wrapSyncMessage(inner: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_SYNC);
  encoding.writeVarUint8Array(encoder, inner);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (this.doc === null) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
    }
    return this.doc;
  }

  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const innerEncoder = encoding.createEncoder();
    syncProtocol.writeUpdate(innerEncoder, update);
    const inner = encoding.toUint8Array(innerEncoder);
    const message = wrapSyncMessage(inner);

    for (const ws of this.sockets) {
      if (ws === except) continue;
      try {
        ws.send(message);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  private relayAwareness(data: ArrayBuffer): void {
    for (const ws of this.sockets) {
      try {
        ws.send(data);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const ws = server.accept() as unknown as WebSocket;

    this.sockets.add(ws);
    const doc = this.getDoc();

    // Send SyncStep1 to the new client
    const step1Encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1Encoder, doc);
    const step1Inner = encoding.toUint8Array(step1Encoder);
    ws.send(wrapSyncMessage(step1Inner));

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;
      const decoded = decodeMessage(data);

      if (decoded.kind === 'invalid') {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
      }

      if (decoded.kind === 'sync') {
        try {
          const decoder = decoding.createDecoder(decoded.payload);
          const replyEncoder = encoding.createEncoder();
          // readSyncMessage returns void in y-protocols types but actually returns boolean
          const result = syncProtocol.readSyncMessage(
            decoder,
            replyEncoder,
            doc,
            ws,
          ) as unknown as boolean;
          if (result) {
            const replyInner = encoding.toUint8Array(replyEncoder);
            ws.send(wrapSyncMessage(replyInner));
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        return;
      }

      if (decoded.kind === 'awareness') {
        const fullFrame = event.data as ArrayBuffer;
        this.relayAwareness(fullFrame);
        return;
      }
    };

    ws.onclose = () => {
      this.sockets.delete(ws);
    };

    ws.onerror = () => {
      this.sockets.delete(ws);
    };

    return new Response(null, {
      status: 101,
      // @ts-expect-error Cloudflare Workers extends Response to support WebSocket bodies
      body: client,
    });
  }
}
