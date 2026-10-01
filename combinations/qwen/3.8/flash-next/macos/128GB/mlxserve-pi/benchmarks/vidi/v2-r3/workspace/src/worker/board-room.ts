// One board, one instance of this Durable Object: it holds the board's Y.Doc
// in memory and relays y-websocket frames between every socket connected to
// the address.
//
// The socket is accepted the plain way (`server.accept()`) rather than through
// `ctx.acceptWebSocket`: the document only lives in memory until story 4 can
// reload it from storage, and hibernation would evict the object while the
// sockets stay open, silently dropping the board. An open accepted socket
// keeps the object alive instead.
//
// Where each requirement of story 3 lives:
//   * live.propagate        — `doc.on('update')` forwards the bytes to every
//                             other open socket immediately, no batching.
//   * live.join_state       — `syncStep1()` on accept plus the SyncStep2 the
//                             newcomer sends back: the room answers with its
//                             whole document.
//   * live.concurrent_text  — Y.Text keeps every concurrent insert.
//   * live.converge         — Y.Map fields resolve concurrent sets to one
//                             winner on every replica.
//   * live.delete_during_edit — a deleted entry discards concurrent edits
//                             inside it; they cannot resurrect it.
//   * live.catch_up         — the same SyncStep1/SyncStep2 exchange on
//                             reconnection moves both sides' offline work.
//   * restart safety        — the first client to reconnect after a restart
//                             repopulates the room from its own document.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc } from '../shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../shared/protocol';
import type { Env } from './index';

const WEBSOCKET_OPEN = 1;

/** A frame for the room's own SyncStep1 (its current state vector). */
function syncStep1Message(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A frame carrying one document update, sent to the other sockets. */
function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  /** Created on the first connection; discarded when the runtime evicts us. */
  private ydoc: Y.Doc | null = null;

  /** Every open socket of this board, including sockets that just died. */
  private readonly sockets = new Set<WebSocket>();

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  fetch(request: Request): Response {
    if ((request.headers.get('Upgrade') ?? '').trim().toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade\n', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    if (client === undefined || server === undefined) {
      return new Response('WebSocket pair unavailable\n', { status: 500 });
    }
    server.accept();
    this.doc(); // lazily create the board document before any socket exists
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      this.receive(server, event.data as ArrayBuffer | string);
    });
    const forget = () => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);

    // Ask the newcomer what it has. A client that is reconnecting to a room
    // that lost its document (a deploy, an eviction) answers with a SyncStep2
    // holding everything, so the board comes back without anyone reloading.
    this.sendTo(server, syncStep1Message(this.doc()));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board document, created (and wired for broadcasting) once per instance. */
  private doc(): Y.Doc {
    if (this.ydoc === null) {
      const doc = new Y.Doc();
      initDoc(doc);
      // Every applied update goes straight to the other sockets of this board
      // and to nobody else: the sender never gets an echo of its own change.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(updateMessage(update), origin);
      });
      this.ydoc = doc;
    }
    return this.ydoc;
  }

  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded: Decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(socket, decoded.payload);
        return;
      case 'awareness':
        // Relayed verbatim to every socket *including* the sender: clients
        // renew their awareness about every 15 seconds, and that traffic is
        // what stops an idle connection from looking dead. Interpreting it
        // (who is here, who left) arrives in story 6.
        this.broadcast(data as ArrayBuffer, null);
        return;
      case 'query-awareness':
        // Ignored in this story: the room keeps no awareness state.
        return;
      case 'invalid':
        this.reject(socket);
        return;
    }
  }

  /** Answer a sync message; a Yjs update the document rejects closes one socket. */
  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const syncType = decoding.readVarUint(decoder);
    let rejected: Error | null = null;
    // Yjs errors from a broken update are reported through a callback rather
    // than thrown, so the room cannot use `readSyncMessage`, which swallows
    // them and carries on: a client that sends nonsense would keep sending it.
    // The two message handlers are called directly, with the same y-protocols
    // code behind them.
    const noteRejection = (error: unknown): void => {
      rejected = error instanceof Error ? error : new Error(String(error));
    };
    try {
      switch (syncType) {
        case syncProtocol.messageYjsSyncStep1:
          syncProtocol.readSyncStep1(decoder, encoder, this.doc());
          break;
        case syncProtocol.messageYjsSyncStep2:
          syncProtocol.readSyncStep2(decoder, this.doc(), socket, noteRejection);
          break;
        case syncProtocol.messageYjsUpdate:
          syncProtocol.readUpdate(decoder, this.doc(), socket, noteRejection);
          break;
        default:
          throw new Error(`unknown sync message type ${syncType}`);
      }
    } catch {
      rejected ??= new Error('undecodable sync message');
    }
    if (rejected !== null) {
      // Undecodable or rejected update: only this socket is closed; the
      // document is untouched and everyone else keeps working.
      this.reject(socket);
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.sendTo(socket, encoding.toUint8Array(encoder));
    }
  }

  /** Send to every open socket except the one the change came from. */
  private broadcast(data: Uint8Array | ArrayBuffer, except: unknown): void {
    for (const socket of [...this.sockets]) {
      if (socket === except) continue;
      if (socket.readyState !== WEBSOCKET_OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      this.sendTo(socket, data);
    }
  }

  /** A socket that will not take the bytes is dropped, never fatal. */
  private sendTo(socket: WebSocket, data: Uint8Array | ArrayBuffer): void {
    try {
      socket.send(data);
    } catch {
      this.sockets.delete(socket);
    }
  }

  /** Close exactly the socket that sent something unusable. */
  private reject(socket: WebSocket): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, 'unsupported message');
    } catch {
      /* already gone */
    }
  }
}
