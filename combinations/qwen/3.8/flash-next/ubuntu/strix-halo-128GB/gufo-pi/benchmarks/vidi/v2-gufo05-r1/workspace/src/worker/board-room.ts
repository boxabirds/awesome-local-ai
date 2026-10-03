/**
 * One board, one object: the room that keeps a board's document in memory and
 * relays messages between the people on it.
 *
 * The room holds a `Y.Doc` and a set of open sockets. It does three things with
 * a message:
 *
 * - **sync** — apply it to the document with `y-protocols` semantics and forward
 *   the resulting update to every *other* socket, immediately, with no batching.
 *   That is what makes a change appear on every other screen within
 *   `LIVE_UPDATE_LATENCY_BUDGET_MS`, and why the sender never sees an echo.
 * - **awareness** — relay the bytes verbatim to every socket, including the
 *   sender. The room understands nothing about them (story 6 will). Relaying to
 *   the sender as well is what keeps an idle `y-websocket` client receiving
 *   traffic, so it does not time its connection out.
 * - **anything else** — close that one socket with `CLOSE_UNSUPPORTED_DATA`.
 *   Nobody else is affected and the document is untouched.
 *
 * The document is memory-only in this story, so the WebSockets are accepted with
 * the plain, non-hibernating `accept()`: an open socket keeps the object alive,
 * which is the only thing keeping the document alive. Story 4 switches to
 * hibernation once the document can be reloaded from storage.
 *
 * Restart safety without storage: on every connection the room sends its own
 * SyncStep1, so the newcomer answers with a SyncStep2 holding everything the
 * room lacks. After a restart the first person to reconnect repopulates the room
 * from their own copy — no notes are lost while one person keeps the board open.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_SYNC,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  /** Created on the first connection; discarded with the object. */
  private ydoc: Y.Doc | null = null;

  private readonly sockets = new Set<WebSocket>();

  /** The room's document, created on first use with its broadcast listener. */
  private document(): Y.Doc {
    if (this.ydoc === null) {
      const doc = new Y.Doc();
      // One Yjs transaction is one update: forward it to everyone but whoever
      // sent it. `origin` is the socket the sync message was read with.
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
      this.ydoc = doc;
    }
    return this.ydoc;
  }

  fetch(request: Request): Response {
    if (!(request.headers.get('upgrade') ?? '').toLowerCase().includes('websocket')) {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const doc = this.document();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.binaryType = 'arraybuffer';
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });

    // Ask the newcomer what it has. Its SyncStep2 answers with everything this
    // room is missing, which is how a restarted room gets its board back.
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    writeSyncStep1(hello, doc);
    server.send(encoding.toUint8Array(hello));

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.drop(socket, decoded.reason);
      return;
    }
    if (decoded.kind === 'awareness') {
      // Verbatim, to everyone including the sender. No stored awareness state in
      // this story, so a query is answered with nothing at all.
      this.relay(data);
      return;
    }
    if (decoded.kind === 'query-awareness') return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // Applies the update to the document (firing the broadcast listener) and
      // writes the reply — a SyncStep2 for a newcomer — into `encoder`.
      //
      // `y-protocols` logs an update Yjs refuses and carries on, which is right for
      // a library that cannot know who to blame. The room can: the bytes came from
      // this socket, so the handler turns the swallow back into a throw and this one
      // connection is closed instead of the client quietly diverging.
      readSyncMessage(new decoding.Decoder(decoded.payload), encoder, this.document(), socket, (error) => {
        throw error;
      });
    } catch (error) {
      // Yjs rejects the update: it is this socket's bad data, so it is this
      // socket that closes. A half-written reply is never sent.
      this.drop(socket, `rejected sync message: ${error instanceof Error ? error.message : ''}`);
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    // More than the lone message-type byte means there is a reply to send.
    if (reply.byteLength > 1) socket.send(reply);
  }

  /** Send a document update to every open socket except the one it came from. */
  private broadcast(update: Uint8Array, except: unknown): void {
    // One framed `sync/update` message, sent to many sockets.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(message);
      } catch {
        this.sockets.delete(socket); // a socket that cannot be written is gone
      }
    }
  }

  /** Relay raw awareness bytes to every open socket, sender included. */
  private relay(data: ArrayBuffer | string): void {
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(data);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  /** Close one socket, leaving the rest of the board alone. */
  private drop(socket: WebSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closed: nothing else to do.
    }
  }
}
