/**
 * BoardRoom: one Durable Object per board (design "sync.room").
 *
 * The object holds the board's `Y.Doc` in memory and relays y-websocket traffic
 * between every socket connected to this board:
 *
 * - a sync message is applied to the document with the sending socket as the
 *   transaction origin, and the resulting Yjs update goes to every *other*
 *   socket (the sender already has it, so it never sees an echo);
 * - an awareness update is relayed verbatim to every *other* socket, and the
 *   room remembers it so a socket that arrives later can be told who is there
 *   and so a disconnect can be announced as a removal;
 * - after a restart the room starts empty and the first reconnecting client
 *   repopulates it, because the room sends its own SyncStep1 on every accept and
 *   the client answers with a SyncStep2 containing everything the room lacks.
 *
 * Merging is Yjs CRDT semantics: concurrent text inserts are all kept,
 * concurrent writes to `x`/`y`/`color` converge to one deterministic winner, and
 * a deleted note cannot be resurrected by concurrent edits inside it.
 *
 * A malformed message closes *only* the socket that sent it, with 1003
 * ("unsupported data"): the room, its document and everybody else's connection
 * carry on.
 *
 * The WebSockets are deliberately *not* hibernated: the document lives in memory
 * until story 4 persists it, and hibernation would let the runtime evict the
 * object underneath a live board. An open accepted socket keeps the object
 * alive. Nothing is written to storage in this story.
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { modifyAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  awarenessMessage,
  awarenessUpdateOf,
  decodeMessage,
  frameMessage,
} from '../shared/protocol';
import type { Env } from './index';

/**
 * A y-websocket client gives up on a connection it has heard nothing about for
 * 30 seconds, so a room whose people are idle has to say something. The node
 * y-websocket server does the same thing with a timer of its own: send an empty
 * awareness update to any socket that has not been written to recently. It is a
 * no-op to apply and keeps a healthy tab from being mistaken for a dead one.
 */
const KEEP_ALIVE_CHECK_MS = 5_000;
const KEEP_ALIVE_AFTER_MS = 12_500;

/** Per-socket state the room needs: presence, and when we last wrote to it. */
interface SocketState {
  /** The last awareness update this socket sent, or `null` for none. */
  awareness: Uint8Array | null;
  lastWriteAt: number;
}

export class BoardRoom extends DurableObject<Env> {
  /** Every open socket this instance accepted, plus what we know about it. */
  private readonly sockets = new Map<WebSocket, SocketState>();

  /** Created on the first connection; gone when the object is evicted. */
  private document: Y.Doc | null = null;

  /** The idle-socket timer; running only while somebody is connected. */
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [, server] = Object.values(pair);
    this.sockets.set(server, { awareness: null, lastWriteAt: Date.now() });
    // `acceptWebSocket` rather than `server.accept()`: this is what makes
    // `webSocketMessage`, `webSocketClose` and `webSocketError` run, and it is
    // what the socket survives a request boundary on.
    this.ctx.acceptWebSocket(server);

    // Ask the newcomer for its state: it answers with a SyncStep2 carrying
    // everything this room does not have, which is how a room rebuilds itself
    // after a restart with nobody noticing.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc());
    this.write(server, encoding.toUint8Array(encoder));
    this.startKeepAlive();

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** The board's document, with the update relay attached once. */
  private doc(): Y.Doc {
    if (this.document === null) {
      const doc = new Y.Doc();
      // The sending socket is the transaction origin, which is how a broadcast
      // knows whom to leave out: nobody sees their own edit come back.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastUpdate(update, origin);
      });
      this.document = doc;
    }
    return this.document;
  }

  webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): void {
    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync':
        this.applySync(webSocket, decoded.payload);
        return;
      case 'awareness':
        this.relayAwareness(webSocket, decoded.payload);
        return;
      case 'query-awareness':
        this.answerAwarenessQuery(webSocket);
        return;
      case 'invalid':
        this.closeUnsupported(webSocket);
        return;
    }
  }

  webSocketClose(webSocket: WebSocket): void {
    this.forgetResource(webSocket);
  }

  webSocketError(webSocket: WebSocket): void {
    this.forgetResource(webSocket);
  }

  /**
   * Apply one sync message and answer it. `readSyncMessage` handles all three
   * kinds — SyncStep1 is answered with what the room has, SyncStep2 and Update
   * are applied, and the document's update handler relays to the others.
   *
   * `readSyncMessage` swallows an `applyUpdate` failure by default, so the error
   * handler rethrows: a body that is not a Yjs update closes this socket instead
   * of being quietly dropped.
   */
  private applySync(socket: WebSocket, payload: Uint8Array): void {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      // `readSyncMessage` reads the inner sync kind itself and writes the answer
      // (SyncStep2 for a SyncStep1, nothing otherwise) into `reply`.
      syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        reply,
        this.doc(),
        socket,
        (error: Error) => {
          throw error;
        },
      );
    } catch {
      this.closeUnsupported(socket);
      return;
    }
    if (encoding.length(reply) > 1) this.write(socket, encoding.toUint8Array(reply));
  }

  /**
   * Relay a presence message to everybody else and remember the update inside it.
   * The payload is forwarded exactly as it arrived — the room edits nobody's
   * presence — and the stripped update is what gets remembered, because that is
   * what a removal has to be built from.
   */
  private relayAwareness(socket: WebSocket, payload: Uint8Array): void {
    const update = awarenessUpdateOf(payload);
    if (update === null) {
      this.closeUnsupported(socket);
      return;
    }
    if (isEmptyAwarenessUpdate(update)) {
      // A keep-alive, not news: nobody else needs it.
      return;
    }
    const known = this.sockets.get(socket);
    if (known !== undefined) known.awareness = update;
    const bytes = frameMessage(MESSAGE_AWARENESS, payload);
    for (const target of [...this.sockets.keys()]) {
      if (target !== socket) this.write(target, bytes);
    }
  }

  /**
   * Answer a client's presence query with what the room knows about the others.
   * Presence belongs to the connection, so this is never a copy of the
   * requester's own state.
   */
  private answerAwarenessQuery(socket: WebSocket): void {
    for (const [target, known] of [...this.sockets]) {
      if (target === socket || known.awareness === null) continue;
      this.write(socket, awarenessMessage(known.awareness));
    }
  }

  /**
   * A connection is gone: forget it, and tell everybody else so their presence
   * does not claim someone is still here. The removal keeps the clock the room
   * last saw, which is what makes clients drop it instead of ignoring it.
   */
  private forgetResource(socket: WebSocket): void {
    const known = this.sockets.get(socket);
    this.sockets.delete(socket);
    if (known !== undefined && known.awareness !== null) {
      const removal = modifyAwarenessUpdate(known.awareness, () => null);
      const bytes = awarenessMessage(removal);
      for (const target of [...this.sockets.keys()]) this.write(target, bytes);
    }
    if (this.sockets.size === 0) this.stopKeepAlive();
  }

  /** Write to one socket. A socket that cannot be written to is not our problem
   *  twice: it is dropped from the room and everybody else keeps working. */
  private write(socket: WebSocket, bytes: Uint8Array): void {
    const known = this.sockets.get(socket);
    if (known !== undefined) known.lastWriteAt = Date.now();
    try {
      socket.send(bytes);
    } catch {
      this.sockets.delete(socket);
    }
  }

  /** Broadcast a document update, skipping whoever it came from. */
  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const bytes = encoding.toUint8Array(encoder);
    for (const target of [...this.sockets.keys()]) {
      if (target === except) continue;
      this.write(target, bytes);
    }
  }

  private closeUnsupported(socket: WebSocket): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, 'malformed message');
    } catch {
      // Already gone.
    }
    if (this.sockets.size === 0) this.stopKeepAlive();
  }

  /** Keep idle-but-healthy sockets from timing out on a quiet room. */
  private startKeepAlive(): void {
    if (this.keepAliveTimer !== null) return;
    this.keepAliveTimer = setInterval(() => {
      const now = Date.now();
      for (const [socket, known] of [...this.sockets]) {
        if (now - known.lastWriteAt < KEEP_ALIVE_AFTER_MS) continue;
        // An awareness update with no clients: nothing to apply, and the client
        // hears a word from its room.
        this.write(socket, awarenessMessage(new Uint8Array([0])));
      }
    }, KEEP_ALIVE_CHECK_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer === null) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }
}

/** An awareness update with no clients in it: a keep-alive, not news. */
function isEmptyAwarenessUpdate(update: Uint8Array): boolean {
  return update.byteLength === 0 || update[0] === 0;
}
