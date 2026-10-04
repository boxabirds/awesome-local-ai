/**
 * One live board.
 *
 * The object holds the board's `Y.Doc` in memory and relays Yjs sync and
 * awareness frames between every WebSocket connected to it:
 *
 *  - a change from one person is applied to the doc and forwarded to every other
 *    socket immediately, with no batching and no echo to the sender
 *    (live.propagate);
 *  - a newcomer receives SyncStep1 and answers it with SyncStep2, so a late
 *    joiner gets the whole current board (live.join_state) — and so the first
 *    client to reconnect after a runtime restart repopulates an empty room
 *    (no notes lost while one person keeps the board open);
 *  - merging is plain Yjs semantics: concurrent text inserts are all kept
 *    (live.concurrent_text), concurrent writes to one field converge to a single
 *    identical value (live.converge), and edits made inside a deleted note are
 *    discarded and cannot resurrect it (live.delete_during_edit);
 *  - malformed traffic closes only the offending socket (CLOSE_UNSUPPORTED_DATA).
 *
 * WebSockets are accepted with the *non-hibernating* `accept()` on purpose: the
 * doc exists only in memory until story 4, and hibernation would evict the
 * object (taking the doc with it) while sockets stay open. An open, accepted
 * socket keeps the object alive. Story 4 switches to the hibernation API once
 * the doc can be reloaded from storage.
 *
 * No awareness state is kept and no participants are counted: presence is story
 * 6, and MAX_CONCURRENT_EDITORS is a soft target, never a limit.
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
import type { Env } from './index';

/**
 * The server half of a `WebSocketPair`. `accept()` and the message/close events
 * exist in the Workers runtime; the DOM `WebSocket` type describes the rest of
 * what we use (`send`, `close`, `readyState`).
 */
type ServerSocket = WebSocket & { accept(): void };

export class BoardRoom extends DurableObject<Env> {
  /** This board's document: created with the object, discarded when it is evicted. */
  private readonly doc = new Y.Doc();

  /** Every open socket on this board, including the one a message came from. */
  private readonly sockets = new Set<ServerSocket>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Every applied update goes straight to the other sockets. `origin` is the
    // socket the update was read from (see handleMessage), so the sender never
    // sees an echo of its own change.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const frame = syncFrame(update);
      for (const socket of this.sockets) {
        if (socket === origin) continue;
        if (!trySend(socket, frame)) this.sockets.delete(socket);
      }
    });
  }

  /** WebSocket upgrade only: 101 with the client half of a fresh pair. */
  fetch(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    const pair = new WebSocketPair();
    const server = pair[1] as ServerSocket;
    server.binaryType = 'arraybuffer';
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    });
    const leave = () => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);

    // Ask the newcomer for its state vector: the answer (SyncStep2) contains
    // everything this room is missing, which is how a restarted room is refilled.
    const hello = encoding.createEncoder();
    encoding.writeVarUint(hello, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(hello, this.doc);
    trySend(server, encoding.toUint8Array(hello));

    return new Response(null, { status: 101, webSocket: pair[0] } as Response);
  }

  private handleMessage(socket: ServerSocket, data: ArrayBuffer | Uint8Array | string): void {
    const decoded = decodeMessage(data);
    console.log('ROOM msg', decoded.kind, 'ctor', (data as object | null)?.constructor?.name);
    switch (decoded.kind) {
      case 'sync': {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // `readSyncMessage` swallows errors from a broken Yjs update (it only
        // reports them to the optional handler), so both paths end the same way.
        let updateError: Error | undefined;
        try {
          syncProtocol.readSyncMessage(
            decoding.createDecoder(decoded.payload),
            encoder,
            this.doc,
            socket,
            (error: unknown) => {
              updateError = error instanceof Error ? error : new Error(String(error));
            },
          );
        } catch (error) {
          // Not a sync message at all: drop this socket, nobody else.
          this.reject(socket, `unreadable sync message: ${message(error)}`);
          return;
        }
        if (updateError) {
          this.reject(socket, `unreadable yjs update: ${message(updateError)}`);
          return;
        }
        // More than the one-byte frame header means there is a reply
        // (SyncStep2 for a SyncStep1, an update for a SyncStep2).
        if (encoding.length(encoder) > 1) {
          if (!trySend(socket, encoding.toUint8Array(encoder))) {
            this.sockets.delete(socket);
          }
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every socket *including the sender*: idle clients
        // stay alive because they keep receiving traffic. Interpreting awareness
        // (who is here) is story 6.
        const frame = awarenessFrame(decoded.payload);
        for (const target of this.sockets) {
          if (!trySend(target, frame)) this.sockets.delete(target);
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: no awareness state is stored to answer with.
        return;
      case 'invalid':
        this.reject(socket, decoded.reason);
    }
  }

  /** Close one socket with 1003 (unsupported data). Others are unaffected. */
  private reject(socket: ServerSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closed: nothing to do.
    }
  }
}

/**
 * One sync frame carrying a raw update, encoded exactly like the client provider
 * sends them: outer type, then a `y-protocols` update message.
 */
function syncFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * An awareness frame from its payload: byte-for-byte what the sender sent, so
 * everyone on the board (sender included) sees the same bytes.
 */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** `WebSocket.READYSTATE_OPEN`, spelled without relying on the runtime constant. */
const READYSTATE_OPEN = 1;

/** Send, reporting failure instead of throwing (a dead socket must not break the room). */
function trySend(socket: ServerSocket, bytes: Uint8Array): boolean {
  try {
    if (socket.readyState === READYSTATE_OPEN) socket.send(bytes);
    return socket.readyState === READYSTATE_OPEN;
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
