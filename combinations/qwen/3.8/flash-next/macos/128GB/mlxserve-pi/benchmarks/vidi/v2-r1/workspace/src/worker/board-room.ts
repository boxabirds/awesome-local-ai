import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

/**
 * One live board (design: sync.room). The object holds the board's Y.Doc in
 * memory and relays messages between everyone on the board:
 *
 * - a document update is applied and forwarded to every *other* socket
 *   immediately, with no batching and no timers, so a change is on every other
 *   connected screen as fast as the network allows (live.propagate);
 * - merging is Yjs CRDT semantics: concurrent typing is all kept
 *   (live.concurrent_text), concurrent position/colour writes settle on one
 *   value everywhere (live.converge), and a deleted note is never brought back
 *   by someone else's simultaneous edit (live.delete_during_edit);
 * - awareness bytes are relayed verbatim to everyone, sender included, so idle
 *   clients keep receiving traffic and stay connected. Nothing is interpreted —
 *   who is here and who left is story 6.
 *
 * There is no participant counting and no connection limit: capacity is a
 * design and test target, never enforced (live.over_capacity).
 *
 * Storage: none in this story. The document is created on the first connection
 * and discarded when the runtime evicts this object; on every (re)connection
 * the room sends SyncStep1, so the first client to come back answers with
 * SyncStep2 containing everything the room lacks — which is what keeps a
 * service restart from losing notes while at least one person still has the
 * board open.
 */
export class BoardRoom extends DurableObject<Env> {
  /** The server side of every open connection to this board. */
  private readonly sockets = new Set<WebSocket>();
  /** The board, created with the first connection, memory-only in this story. */
  private doc: Y.Doc | null = null;

  /** WebSocket upgrade only; anything else is not a connection to a board. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    // Non-hibernating accept, on purpose (design: Context). The document only
    // lives in memory until story 4; an open, accepted socket keeps this object
    // — and with it the document — alive, where hibernating would let the
    // runtime evict it and silently drop the board.
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      this.receive(server, event.data as string | ArrayBuffer);
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
      // Let the closing handshake finish. Without this the socket is dropped on
      // the server side only, and the client sits in CLOSING until its browser
      // gives up — so a person who closes their tab keeps believing they are in
      // the room for half a minute, and the room cannot tell anybody otherwise.
      this.hangUp(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
      this.hangUp(server);
    });

    // Ask the newcomer for its whole state. A room that has just come back from
    // a restart is empty and gets repopulated by whoever reconnects first.
    this.send(server, syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document())));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board's document, created on demand, with the broadcast listener on. */
  private document(): Y.Doc {
    if (this.doc !== null) return this.doc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // The socket a change arrived from never gets an echo of its own update.
      const frame = syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update));
      for (const socket of [...this.sockets]) {
        if (socket !== origin) this.send(socket, frame);
      }
    });
    this.doc = doc;
    return doc;
  }

  /** Handle one frame from one socket. */
  private receive(socket: WebSocket, data: string | ArrayBuffer): void {
    if (!this.sockets.has(socket)) return; // hung up while the frame was in flight
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupported(socket);
      return;
    }
    if (decoded.kind === 'query-awareness') return; // no stored awareness in this story
    if (decoded.kind === 'awareness') {
      // Verbatim, to everyone including the sender.
      for (const target of [...this.sockets]) this.send(target, decoded.payload);
      return;
    }

    const encoder = encoding.createEncoder();
    // The reply is a y-websocket frame too: same prefix as the message we got.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let rejected: unknown = null;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      decoding.readVarUint(decoder); // the y-websocket message type prefix
      syncProtocol.readSyncMessage(decoder, encoder, this.document(), socket, (error: Error) => {
        // Yjs swallows the error internally; re-raise it here so a sender's
        // malformed update cannot sit in the middle of a live board. Returning
        // false tells y-protocols it is handled, so it does not log it instead.
        rejected = error;
        return false;
      });
    } catch (error) {
      rejected = error;
    }
    if (rejected !== null) {
      this.closeUnsupported(socket);
      return;
    }
    // A reply (SyncStep2, or an update the newcomer was missing) goes back to
    // the socket that asked for it — and only to it.
    if (encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
  }

  /** Write one frame; a socket that cannot be written to is no longer here. */
  private send(socket: WebSocket, payload: Uint8Array): void {
    if (!this.sockets.has(socket)) return;
    try {
      socket.send(payload);
    } catch {
      this.sockets.delete(socket);
    }
  }

  /** Close one misbehaving socket; everybody else keeps their connection. */
  private closeUnsupported(socket: WebSocket): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, 'unsupported message');
    } catch {
      // already gone
    }
  }

  /** Finish a close the other side started; never a problem if it is over. */
  private hangUp(socket: WebSocket): void {
    try {
      socket.close();
    } catch {
      // already gone
    }
  }
}

/** Wrap a y-protocols/sync message in the y-websocket frame prefix. */
const syncFrame = (write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
};
