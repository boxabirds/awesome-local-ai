import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../shared/protocol';

type Env = { BOARD_ROOM: DurableObjectNamespace };

export class BoardRoom extends DurableObject<Env> {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  private getDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Broadcast the update to all sockets except the origin (sender)
        this.broadcastUpdate(update, origin as WebSocket | undefined);
      });
    }
    return this.doc;
  }

  private broadcastUpdate(update: Uint8Array, except?: WebSocket): void {
    // Frame as: MESSAGE_SYNC + syncProtocol Update (varuint(2) + varuint8array(update))
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);

    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          this.sockets.delete(ws);
        }
      }
    }
  }

  fetch(request: Request): Response {
    const doc = this.getDoc();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    // Send SyncStep1 to the new client so it can respond with SyncStep2
    // (this repopulates a restarted room with client state)
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    server.send(encoding.toUint8Array(syncEncoder));

    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data, doc);
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });

    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string, doc: Y.Doc): void {
    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(decoded.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
          // Send reply if non-empty (more than just the varint type byte)
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
          this.sockets.delete(ws);
        }
        break;
      }
      case 'awareness': {
        // Relay awareness bytes verbatim to ALL open sockets including sender
        const frame = new Uint8Array(1 + decoded.payload.length);
        frame[0] = MESSAGE_AWARENESS;
        frame.set(decoded.payload, 1);
        for (const s of this.sockets) {
          if (s.readyState === WebSocket.OPEN) {
            try {
              s.send(frame);
            } catch {
              this.sockets.delete(s);
            }
          }
        }
        break;
      }
      case 'query-awareness': {
        // Ignored in this story — no stored awareness
        break;
      }
      case 'invalid': {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        this.sockets.delete(ws);
        break;
      }
    }
  }
}
