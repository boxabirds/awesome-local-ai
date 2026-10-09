// One BoardRoom per board. Holds the board's Y.Doc in memory and relays
// Yjs sync + awareness messages between all sockets on the board.
//
// Non-hibernating accept on purpose (see design): the doc exists only in
// memory until story 4, and an open accepted socket keeps the object alive.
// Story 4 switches to the hibernation API once the doc reloads from storage.

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private docInstance: Y.Doc | null = null;

  private get doc(): Y.Doc {
    let doc = this.docInstance;
    if (doc === null) {
      doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // The sender never gets an echo of its own update.
        this.broadcast(update, origin instanceof WebSocket ? origin : null);
      });
      this.docInstance = doc;
    }
    return doc;
  }

  // WebSocket upgrade only; the Worker has already validated the board id.
  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    // SyncStep1 from the room: every (re)connecting client answers with a
    // SyncStep2 holding everything the room lacks, which repopulates the
    // document after a runtime restart.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.sendTo(server, encoding.toUint8Array(enc));

    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    });
    const remove = (): void => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', remove);
    server.addEventListener('error', remove);

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync': {
        // Frame layout matches y-websocket: the reply starts with the sync
        // message type byte and readSyncMessage appends its answer.
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_SYNC);
        try {
          syncProtocol.readSyncMessage(
            decoding.createDecoder(message.payload),
            frame,
            this.doc,
            ws,
            // y-protocols swallows update-application errors otherwise;
            // rethrow so the catch below closes the offending socket.
            (error) => {
              throw error;
            },
          );
        } catch {
          // Yjs rejected the update: close only this socket (TC-15).
          this.closeUnsupported(ws);
          return;
        }
        if (encoding.length(frame) > 1) {
          this.sendTo(ws, encoding.toUint8Array(frame));
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim (original bytes) to all open sockets including the
        // sender, so idle y-websocket clients keep receiving traffic.
        // Awareness state is not interpreted in this story (presence is 6).
        const bytes = new Uint8Array(data as ArrayBuffer);
        for (const socket of this.sockets) this.sendTo(socket, bytes);
        return;
      }
      case 'query-awareness':
        // Ignored in this story: the room keeps no awareness state.
        return;
      case 'invalid':
        this.closeUnsupported(ws);
        return;
    }
  }

  private broadcast(update: Uint8Array, except: WebSocket | null): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, 2);
    encoding.writeVarUint8Array(frame, update);
    const bytes = encoding.toUint8Array(frame);
    for (const socket of this.sockets) {
      if (socket !== except) this.sendTo(socket, bytes);
    }
  }

  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) {
      this.sockets.delete(ws);
      return;
    }
    try {
      ws.send(bytes);
    } catch {
      // Dead socket: drop it from the set, keep the room serving the rest.
      this.sockets.delete(ws);
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // Already closing/closed.
    }
  }
}
