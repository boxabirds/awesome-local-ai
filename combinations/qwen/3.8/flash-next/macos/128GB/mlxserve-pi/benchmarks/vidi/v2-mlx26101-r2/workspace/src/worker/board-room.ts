/**
 * The BoardRoom Durable Object: one object per board, holding that board's
 * `Y.Doc` in memory and relaying messages between everyone connected to it.
 *
 * What it does in this story:
 * - accepts a WebSocket per person on the board;
 * - merges every document update into its own `Y.Doc` (Yjs CRDT semantics: no
 *   conflicts to resolve, concurrent text all survives) and forwards the same
 *   bytes to every other socket, immediately — no batching, no timers;
 * - relays awareness bytes verbatim to every socket, *including* the sender, so
 *   an idle client keeps receiving traffic and does not time its connection out;
 * - closes a socket that sends something it cannot understand, and only that
 *   socket.
 *
 * What it deliberately does not do: count participants (the capacity setting is
 * a design and test target, never enforced), store anything (story 4), or
 * interpret awareness (story 6).
 *
 * The WebSockets are accepted with the **non-hibernating** `accept()` on
 * purpose: the document exists only in this object's memory until story 4 can
 * reload it from storage, and hibernation would evict the object while sockets
 * stay open — silently dropping the document. An open, accepted socket keeps
 * the object alive.
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameMessage,
} from '../shared/protocol.js';
import type { Env } from './index.js';

/** A frame whose body is built by `write` (a `y-protocols/sync` writer). */
const syncFrame = (write: (body: encoding.Encoder) => void): Uint8Array =>
  frameMessage(MESSAGE_SYNC, encoding.encode(write));

export class BoardRoom extends DurableObject<Env> {
  /** The board's document, created on the first connection. */
  private boardDoc: Y.Doc | undefined;

  /** Every open server-side socket of this board. */
  private readonly sockets = new Set<WebSocket>();

  /**
   * A WebSocket upgrade only: 101 with the new socket, or 426 when the client
   * did not ask for an upgrade. The Worker checks the board id before it gets
   * here; the room holds exactly one board, so nothing else is routed.
   */
  fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade') ?? '';
    if (upgrade.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating: see the module comment.
    server.accept();
    // Messages arrive as ArrayBuffers rather than Blobs.
    server.binaryType = 'arraybuffer';

    const doc = this.ensureDoc();
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    });
    const forget = (): void => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);

    // Ask the newcomer what it has. Whoever reconnects first after a restart
    // answers this with a SyncStep2 holding the whole document, which is how a
    // room that lost its memory gets repopulated without any storage.
    this.send(server, syncFrame((body) => writeSyncStep1(body, doc)));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The board's document, created (once) on first use. */
  private ensureDoc(): Y.Doc {
    if (this.boardDoc !== undefined) return this.boardDoc;

    const doc = new Y.Doc();
    // Every applied update — from a sync message or from another person's
    // change — goes straight out to everybody else on this board.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const frame = syncFrame((body) => writeUpdate(body, update));
      for (const socket of Array.from(this.sockets)) {
        // The sender never sees its own change come back.
        if (socket === origin) continue;
        this.send(socket, frame);
      }
    });

    this.boardDoc = doc;
    return doc;
  }

  /**
   * Send on one socket, forgetting it when it is gone. A socket that throws on
   * send is dead: dropping it here is the error path of "send to dead socket".
   */
  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WebSocket.READY_STATE_OPEN) {
      this.sockets.delete(socket);
      return;
    }
    try {
      socket.send(data);
    } catch {
      this.sockets.delete(socket);
    }
  }

  /** Close one socket, leaving everyone else on the board alone. */
  private reject(socket: WebSocket): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, 'unsupported message');
    } catch {
      // Already closed: nothing to do.
    }
  }

  /** One message from one socket. Never throws: bad input closes that socket. */
  private handleMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const doc = this.ensureDoc();
    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case 'sync': {
        const body = encoding.createEncoder();
        let failure: unknown = null;
        try {
          // `readSyncMessage` writes its reply into `body` (a SyncStep2 for the
          // newcomer's SyncStep1, nothing at all for an update). It applies the
          // update with this socket as the origin, so the sender gets no echo.
          readSyncMessage(
            decoding.createDecoder(decoded.payload),
            body,
            doc,
            socket,
            (error: Error) => {
              failure = error;
            },
          );
        } catch (error) {
          failure = error;
        }
        if (failure !== null) {
          // An undecodable or invalid Yjs update: this person's connection is
          // closed, the document is unchanged and nobody else notices.
          this.reject(socket);
          return;
        }
        const reply = encoding.toUint8Array(body);
        if (reply.byteLength > 0) {
          this.send(socket, frameMessage(MESSAGE_SYNC, reply));
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every socket *including* the sender: the room
        // keeps no awareness state in this story, and the copy back to the
        // sender is what keeps an idle connection's traffic flowing.
        const frame = frameMessage(MESSAGE_AWARENESS, decoded.payload);
        for (const target of Array.from(this.sockets)) {
          this.send(target, frame);
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: there is no stored awareness to answer with.
        // Story 6 (presence) answers it.
        return;
      case 'invalid':
        this.reject(socket);
        return;
    }
  }
}
