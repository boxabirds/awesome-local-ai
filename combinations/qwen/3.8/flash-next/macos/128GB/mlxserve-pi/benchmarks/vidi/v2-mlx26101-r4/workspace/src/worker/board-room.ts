/**
 * The room a board lives in: one Durable Object per board, holding that board's
 * document in memory and relaying messages between everyone connected to it.
 *
 * It is a relay, not an authority: Yjs decides how changes merge (which is why two
 * people typing in the same note keep both people's typing), and this file only
 * moves bytes between sockets — apply what arrived, send it to everyone else on
 * this board, and reply to the sync steps of whoever joins. Two boards are two
 * objects, so nothing a person does here can ever be seen on another board.
 *
 * The document exists only while the object does. That is deliberate for this
 * story: the WebSockets are accepted without hibernation, which keeps the object
 * — and so the document — alive as long as somebody has the board open, and a
 * restart is recovered by asking each reconnecting client for its whole state
 * again. Persistence is story 4's job.
 */
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';

/** Bindings the Worker gives this object (see `src/worker/index.ts`). */
export interface Env {
  /** This class, so the Worker can open the room for a board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, for everything that is not a board connection. */
  ASSETS: Fetcher;
}

export class BoardRoom extends DurableObject<Env> {
  /** Every open connection to this board, including the one we accepted first. */
  private readonly sockets = new Set<WebSocket>();

  /** The board as Yjs holds it; made on the first connection, dropped on eviction. */
  private document: Y.Doc | null = null;

  /**
   * Accept a connection to this board, or answer the board's current state to a
   * client that has just connected.
   *
   * Every connection — the first, a late joiner, and every reconnection after a
   * drop — starts the same way: the room asks the client what it is missing
   * (SyncStep1), and the client answers with everything the room does not have
   * (SyncStep2). That single rule is what makes a late joiner see the whole board
   * and a restarted room be filled back in by the first person to come back.
   */
  override fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      // The room speaks one thing. The Worker answers this for normal page
      // requests; getting here means something sent a board request that was not
      // a connection.
      return new Response('The board room accepts WebSocket connections only.', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Binary frames arrive as an ArrayBuffer rather than as a Blob. Without this,
    // `event.data` is a Blob in this runtime, every frame looks undecodable, and
    // every connection is closed as though the sender had sent garbage.
    server.binaryType = 'arraybuffer';
    // Accepted without hibernation on purpose: the document is in memory only, and
    // hibernating would let the runtime evict this object while the connections
    // stay open, silently losing everyone's board. Story 4 switches to the
    // hibernation API once the document can be read back from storage.
    server.accept();

    const doc = this.doc();
    this.sockets.add(server);
    server.addEventListener('message', (event) => {
      this.receive(server, event.data as ArrayBuffer | string);
    });
    const leave = (): void => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);

    // Ask the newcomer for what it has. Its answer repopulates this room after a
    // restart and fills in the board for a late joiner.
    this.send(server, this.syncStep1(doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board's document, made on the first connection to this object. */
  private doc(): Y.Doc {
    if (this.document === null) {
      const doc = new Y.Doc();
      // One listener does all the sharing: whatever lands in this document goes to
      // every other connection on this board, immediately and unbundled, which is
      // what keeps a change inside the latency budget. `origin` is the socket the
      // change arrived on, so nobody is sent their own work back.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
      this.document = doc;
    }
    return this.document;
  }

  /** Read one frame from one socket and act on it. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Data we cannot read is that connection's problem only: it is closed with
      // the code that says "unsupported data" and the board carries on.
      this.drop(socket, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // Nobody is counted and no presence is kept in this story, so there is
      // nothing to answer. The connection stays open: the client asked, the room
      // has no idea who is here.
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relayed as it arrived, to everyone including the person who sent it. That
      // last part matters: an idle browser expects to hear something on an open
      // connection, and its own presence coming back is what stops it declaring
      // the board dead after 45 seconds of nobody typing.
      this.relay(decoded.payload);
      return;
    }

    const doc = this.doc();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // Yjs reports a bad update by calling this instead of throwing, so a client
    // that sends garbage is identifiable here and is the only thing closed.
    let rejected: unknown = null;
    const onError = (error: unknown): void => {
      rejected = error;
    };

    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        doc,
        socket,
        onError,
      );
    } catch (error) {
      this.drop(socket, error instanceof Error ? error.message : String(error));
      return;
    }
    if (rejected !== null) {
      this.drop(socket, 'the board rejected this update');
      return;
    }

    // A reply is only worth sending if it holds more than its type byte: a message
    // we merely stored is already on its way to everyone else as an update.
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) this.send(socket, reply);
    // A SyncStep2 is the end of a client's "here is everything I have"; there is no
    // extra acknowledgement in this protocol, so nothing else is done with it.
  }

  /** Send a document update to every connection on this board but its author's. */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of [...this.sockets]) {
      if (socket === origin) continue;
      this.send(socket, frame);
    }
  }

  /** Send presence bytes to every connection, the sender's included. */
  private relay(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of [...this.sockets]) this.send(socket, frame);
  }

  private syncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Write to one socket. A socket that cannot be written to is gone: it is dropped
   * from the room here, so a half-closed connection cannot make a change fail to
   * reach the people who are still there.
   */
  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(data);
    } catch (error) {
      this.sockets.delete(socket);
      console.warn(`dropping a board connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Close the one connection that sent something unusable, and change nothing else. */
  private drop(socket: WebSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch (error) {
      // Already closed: there is nothing left to do about it.
      console.warn(`board connection already closed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
