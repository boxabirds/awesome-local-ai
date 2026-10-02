/**
 * The board's room: one Durable Object per board, holding that board's `Y.Doc`
 * in memory and relaying messages between everyone who is connected to it.
 *
 * Everything the room does is one of three things:
 *
 * - a **sync** message is read into the room's document and the resulting
 *   document updates go straight to every other socket on the board, so a change
 *   is on every other screen within LIVE_UPDATE_LATENCY_BUDGET_MS;
 * - an **awareness** message is relayed verbatim to every socket, including the
 *   one that sent it, which is what keeps an idle connection looking alive;
 * - anything else gets that one socket closed with 1003 and changes nothing else
 *   — a broken client cannot disturb anybody else on the board.
 *
 * Merging is left to Yjs: concurrent text inserts are all kept, concurrent writes
 * to one field settle on the same value on every screen, and an update inside a
 * note that someone deleted cannot bring the note back.
 *
 * The WebSockets are accepted with the plain, non-hibernating `accept()`: the
 * document lives only in memory until story 4 gives the room storage, and
 * hibernation would let the runtime evict the object (and its document) while
 * people are still connected. An open, accepted socket keeps the object alive.
 * The object is created on the first connection and discarded by the runtime when
 * the last one goes — a board is not kept after everybody has left (story 4).
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';

import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeAwarenessMessage,
  MESSAGE_SYNC,
} from '../shared/protocol';
import type { Env } from './index';

/**
 * `WebSocket.OPEN`, written out because a socket this room accepted is not the
 * browser's `WebSocket`: reading the constant off the global would tie the room's
 * behaviour to which runtime it happens to be running in.
 */
const SOCKET_OPEN = 1;

export class BoardRoom extends DurableObject<Env> {
  /** The board's document, made on the first connection and kept in memory only. */
  #doc: Y.Doc | null = null;
  /** Every socket currently on this board. */
  readonly #sockets = new Set<WebSocket>();

  /**
   * Upgrades a connection to a WebSocket on this board.
   *
   * The Worker has already checked the board address; the check here is
   * defensive, because a room only ever speaks over a WebSocket.
   */
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('this board speaks websocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    // A socket the room accepts hands over its frames as blobs unless told
    // otherwise, and a blob is not the bytes the framing is read from.
    server.binaryType = 'arraybuffer';
    server.accept();
    this.#join(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board's document, created on demand and wired to the broadcast. */
  #document(): Y.Doc {
    if (this.#doc === null) {
      const doc = new Y.Doc();
      // Every document update — whoever caused it — is forwarded to everybody
      // else, immediately and unbatched. The socket the update came from is the
      // transaction origin, so it is the one that does not get it back: the
      // sender never sees an echo of its own change.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.#broadcast(update, origin);
      });
      this.#doc = doc;
    }
    return this.#doc;
  }

  /** Starts following one socket, and asks it for the state of its document. */
  #join(socket: WebSocket): void {
    this.#sockets.add(socket);
    socket.addEventListener('message', (event: MessageEvent) => {
      this.#onMessage(socket, event.data as ArrayBuffer | string);
    });
    // Both the orderly close and a failed send end the room's interest in a
    // socket; see #send for why a send that throws is dropped here too.
    socket.addEventListener('close', () => {
      this.#sockets.delete(socket);
    });
    socket.addEventListener('error', () => {
      this.#sockets.delete(socket);
    });

    // Asking a newcomer for its state vector is also how a room that was
    // restarted fills itself back in: the newcomer answers with a SyncStep2
    // holding everything the room does not have, so nobody loses notes as long
    // as one person still has the board open.
    this.#send(socket, this.#syncStep1());
  }

  /** One SyncStep1 message: "what do you have?" */
  #syncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.#document());
    return encoding.toUint8Array(encoder);
  }

  /** Reads one frame from one socket and acts on it. */
  #onMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const message = decodeMessage(data);

    if (message.kind === 'invalid') {
      this.#reject(socket, message.reason);
      return;
    }

    if (message.kind === 'query-awareness') {
      // Ignored in this story: the room keeps no awareness state to report.
      // Interpreting presence is story 6.
      return;
    }

    if (message.kind === 'awareness') {
      // Relayed to every socket on the board, sender included. Clients renew
      // their awareness state periodically and disconnect when they hear nothing
      // for too long; relaying to the sender as well is what makes an idle board
      // keep receiving traffic.
      this.#sendToAll(encodeAwarenessMessage(message.payload));
      return;
    }

    const doc = this.#document();
    const decoder = decoding.createDecoder(message.payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let asked: number;
    try {
      // Applies whatever the client sent (SyncStep1, SyncStep2 or an update) with
      // this socket as the transaction origin, and writes the reply — a
      // SyncStep2 for a state we are missing — into `encoder`.
      asked = syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
    } catch {
      this.#reject(socket, 'that sync message could not be read');
      return;
    }
    // `> 1` means the encoder holds more than the message type byte, i.e. there
    // is a reply. It goes back to this socket only; everyone else learns about
    // the change from the document update broadcast.
    if (encoding.length(encoder) > 1) {
      this.#send(socket, encoding.toUint8Array(encoder));
    }

    // Somebody that asked for the board is asked for theirs in return. A room that
    // has just come back has nothing to give and everything to learn, and this is
    // the frame that tells it what the board holds — so a board is rebuilt from
    // anybody who still has it, whether that person reconnected on their own or
    // simply sent another SyncStep1. Once both sides agree, the answer comes back
    // empty and nothing more happens.
    if (asked === syncProtocol.messageYjsSyncStep1) {
      this.#send(socket, this.#syncStep1());
    }
  }

  /** Sends a document update to every socket except the one it came from. */
  #broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const bytes = encoding.toUint8Array(encoder);
    for (const socket of [...this.#sockets]) {
      if (socket === origin) continue; // no echo: the sender already has this
      this.#send(socket, bytes);
    }
  }

  /** Sends the same bytes to every open socket, including the sender. */
  #sendToAll(bytes: Uint8Array): void {
    for (const socket of [...this.#sockets]) {
      this.#send(socket, bytes);
    }
  }

  /**
   * One send, with the room's two safety rules: a socket that is not open is
   * forgotten, and a send that throws is forgotten too, so one client whose
   * connection is dying cannot stop the room from serving the others.
   */
  #send(socket: WebSocket, bytes: Uint8Array): void {
    if (socket.readyState !== SOCKET_OPEN) {
      this.#sockets.delete(socket);
      return;
    }
    try {
      socket.send(bytes);
    } catch {
      this.#sockets.delete(socket);
    }
  }

  /**
   * Closes the one socket that sent something unusable. Nobody else on the board
   * is touched, and the document is not changed by a message that was refused.
   */
  #reject(socket: WebSocket, reason: string): void {
    this.#sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason);
    } catch {
      // A socket that is already gone cannot be closed; that is the same outcome.
    }
  }
}
