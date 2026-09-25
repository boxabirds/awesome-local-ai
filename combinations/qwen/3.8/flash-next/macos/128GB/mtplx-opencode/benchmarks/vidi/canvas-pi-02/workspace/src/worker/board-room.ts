/**
 * The board room: one Durable Object per board (story 3).
 *
 * A room holds the board's `Y.Doc` in memory and moves bytes between the
 * sockets attached to it. It is deliberately dumb about content: Yjs decides
 * what a merge means, the room only decides *who* receives a message.
 *
 * Two rules shape everything below.
 *
 * 1. **A sender never hears itself.** Document updates are broadcast with the
 *    sending socket as the exception, which is what makes "no echo" true and
 *    stops one client's traffic from bouncing around the room for ever.
 * 2. **A bad frame costs one connection, not a board.** Undecodable or
 *    rejected traffic closes only the socket that sent it, with 1003. The
 *    other sockets keep working, and the document is left as it was.
 *
 * WebSockets are accepted the non-hibernating way (`socket.accept()` plus
 * listeners): in this story the document exists only in memory, and an object
 * that hibernated would lose it. An open, accepted socket keeps the object
 * alive, which is exactly what the story needs. Story 4 replaces this with the
 * hibernation API once the document can be reloaded from storage.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { MessageData } from '../shared/protocol';
import type { Env } from './env';

/** Anything a WebSocket message can carry that is worth relaying. */
type Frame = ArrayBuffer | ArrayBufferView;

/** One contiguous copy of a frame, safe to hand to several sockets. */
function frameBytes(frame: Frame): Uint8Array {
  if (ArrayBuffer.isView(frame)) {
    const view = frame as ArrayBufferView;
    return new Uint8Array(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return new Uint8Array(frame.slice(0));
}

export class BoardRoom extends DurableObject<Env> {
  /** Every socket currently attached to this board. */
  readonly #sockets = new Set<WebSocket>();

  /** The board, shared by every socket here and rebuilt after an eviction. */
  readonly #doc = new Y.Doc();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Anything that lands in the room's document - whoever made it - goes to
    // everyone else attached to this board.
    this.#doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.#broadcastUpdate(update, origin);
    });
  }

  /** How many sockets are attached right now (used by the capacity tests). */
  socketCount(): number {
    return this.#sockets.size;
  }

  /** The board's document, exposed for the integration tests' assertions. */
  get doc(): Y.Doc {
    return this.#doc;
  }

  fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      // A room speaks WebSockets only. The Worker answers 426 before a
      // request like this can reach the object; the guard is here so an
      // internal call cannot smuggle one in either.
      return new Response('Upgrade Required', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (client === undefined || server === undefined) {
      return new Response('Internal Server Error', { status: 500 });
    }
    this.#attach(server);
    // The reply is the server half of the pair, handed over through the
    // Workers-only `webSocket` member of the response initialiser.
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Start tracking one socket and ask it for the board it thinks it has. */
  #attach(server: WebSocket): void {
    this.#sockets.add(server);
    server.accept();

    // SyncStep1 in both directions is the whole restart story: a room that
    // lost its document asks every newcomer for it again, and a client that
    // reconnects holding edits the room has never seen hands them over here.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.#doc);
    this.#send(server, encoding.toUint8Array(encoder));

    server.addEventListener('message', (event: MessageEvent) => {
      this.#onMessage(server, event.data as MessageData);
    });
    const leave = (): void => {
      this.#sockets.delete(server);
    };
    // Either way the socket is gone; dropping it here is what stops a dead
    // peer from being written to again on every later change.
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);
  }

  /**
   * Send to one socket, forgetting it if it is gone.
   *
   * A `send` that throws means the peer is already dead (TC-31). Dropping it
   * here keeps a disconnected client from breaking the board for everyone
   * else, and from breaking it again on every later update.
   */
  #send(socket: WebSocket, data: Uint8Array): boolean {
    if (!this.#sockets.has(socket)) return false;
    if (socket.readyState !== WebSocket.OPEN) {
      this.#sockets.delete(socket);
      return false;
    }
    try {
      socket.send(data);
      return true;
    } catch {
      this.#sockets.delete(socket);
      return false;
    }
  }

  /** Relay a frame to every open socket, optionally skipping one. */
  #relay(frame: Frame, except?: unknown): void {
    if (this.#sockets.size === 0) return;
    const bytes = frameBytes(frame);
    // Copied out first: a failed send removes a socket from the set while
    // this loop is running.
    for (const socket of [...this.#sockets]) {
      if (socket === except) continue;
      this.#send(socket, bytes);
    }
  }

  /** A document update travels as one SyncUpdate frame: `[0][2][len][bytes]`. */
  #broadcastUpdate(update: Uint8Array, except: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.#relay(encoding.toUint8Array(encoder), except);
  }

  #onMessage(server: WebSocket, data: MessageData): void {
    if (!this.#sockets.has(server)) return;

    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.#reject(server, decoded.reason);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // There is no stored presence to answer with until story 6.
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relayed verbatim, sender included. Idle clients survive because
      // awareness keeps moving; a client that receives its own state back
      // ignores it, because its clock is already at least as new.
      this.#relay(data as Frame);
      return;
    }

    // A sync message. The origin is the socket itself, so the document update
    // raised by this message knows who not to send the result back to.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let rejected = false;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      syncProtocol.readSyncMessage(decoder, encoder, this.#doc, server, () => {
        rejected = true;
      });
    } catch {
      // A frame that got past the length checks and still cannot be read is
      // still just a bad frame.
      rejected = true;
    }
    if (rejected) {
      this.#reject(server, 'the room rejected this update');
      return;
    }
    // A SyncStep1 is answered with whatever the newcomer is missing; a
    // SyncStep2 or a plain update leaves the encoder empty and nothing goes
    // back to the sender.
    if (encoding.length(encoder) > 1) {
      this.#send(server, encoding.toUint8Array(encoder));
    }
  }

  /** Drop one socket for bad traffic, with the room staying open for the rest. */
  #reject(server: WebSocket, reason: string): void {
    this.#sockets.delete(server);
    try {
      server.close(CLOSE_UNSUPPORTED_DATA, reason);
    } catch {
      // The socket was already gone, which is the same outcome.
    }
  }
}
