/**
 * One board's room.
 *
 * A `BoardRoom` instance holds one board's `Y.Doc` in memory and relays
 * y-websocket messages between everybody connected to that board. It is a dumb
 * relay on purpose: merging is Yjs' job, the room only applies what arrives and
 * forwards the same bytes to everyone else.
 *
 *  - **No batching, no timers.** An update is applied and forwarded in the same
 *    turn, so a change reaches every other connected screen well inside
 *    `LIVE_UPDATE_LATENCY_BUDGET_MS`.
 *  - **No echo.** The socket an update came from is the transaction origin, and
 *    the broadcast skips it — its screen already shows the change.
 *  - **Late joiners** get the board because the room sends SyncStep1 on accept and
 *    answers the newcomer's SyncStep1 with everything it is missing. That is also
 *    how a restarted room is repopulated: the first client back sends the whole
 *    document, so nothing is lost while at least one person keeps the board open.
 *  - **Bad traffic closes one socket, never the room.** A text frame, an
 *    undecodable frame, an unknown message type or a payload Yjs rejects closes
 *    only that connection with 1003; everybody else carries on.
 *  - **Awareness is relayed, not interpreted** (that is story 6). Every awareness
 *    message goes to all sockets *including the sender*, which is what keeps an
 *    idle `y-websocket` client's connection alive.
 *
 * The socket is accepted with the *non-hibernating* API deliberately: while the
 * document only lives in memory, an open accepted socket is what keeps the object
 * (and therefore the board) alive. Hibernation would evict the object between
 * messages and silently drop the document; story 4 switches to it once the
 * document can be reloaded from storage.
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
  frameBytes
} from '../shared/protocol';
import type { Env } from './index';

/** A WebSocket close reason is capped at 123 bytes by RFC 6455. */
const MAX_CLOSE_REASON_BYTES = 123;

/** One y-websocket frame: the message type, then the sync bytes. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** One y-websocket frame carrying an opaque awareness update. */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  /** Every open socket on this board. */
  private readonly sockets = new Set<WebSocket>();

  /** The board's document, created on the first connection and never persisted here. */
  private board: Y.Doc | null = null;

  /**
   * The room's document, with the broadcast hook attached once. Listening on the
   * doc (rather than per message) is what forwards replies and applied updates on
   * the same path, with the sending socket as the transaction origin.
   */
  private get document(): Y.Doc {
    if (this.board === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcastSync(update, origin);
      });
      this.board = doc;
    }
    return this.board;
  }

  /**
   * The board id in the URL the Worker forwarded. The room is addressed by an
   * object id derived from it, so this is the only way for it to say which board
   * it is; the Worker has already checked the id before passing it along.
   */
  private static boardIdOf(request: Request): string {
    const raw = new URL(request.url).pathname.slice('/api/rooms/'.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return '';
    }
  }

  /**
   * Accept the WebSocket handshake and put the newcomer into the initial sync.
   * The request itself carries nothing the room needs beyond the board id: the
   * protocol lives entirely in the socket, and the Worker has already validated it.
   *
   * A request without the upgrade header is not a join attempt (the Worker answers
   * those with 426); it is something asking how the room is, so it gets a count.
   */
  fetch(request: Request): Response {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return Response.json({ boardId: BoardRoom.boardIdOf(request), clients: this.sockets.size });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);

    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));
    // The listener itself is not async: a rejection inside it would be unhandled,
    // and an unhandled rejection is how a socket gets dropped badly.
    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data).catch(() => server.close(CLOSE_UNSUPPORTED_DATA, 'frame error'));
    });

    // Ask the newcomer what it has. A room that just restarted answers with an
    // empty state vector, and the newcomer's SyncStep2 puts the board back.
    this.sendTo(server, syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document)));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Type one frame and act on it. `invalid` closes only this socket.
   *
   * Reading the frame is awaited because the platform delivers a binary message as
   * a `Blob`, whose bytes are only available asynchronously.
   */
  private async handleMessage(socket: WebSocket, data: unknown): Promise<void> {
    const bytes = await frameBytes(data);
    const decoded = decodeMessage(bytes ?? 'not a binary frame');
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(socket, decoded.payload);
        break;
      case 'awareness':
        // Verbatim to everybody, sender included: idle clients stay alive on it.
        this.broadcastToAll(awarenessFrame(decoded.payload));
        break;
      case 'query-awareness':
        // No awareness state is kept in this story (story 6 interprets it).
        break;
      case 'invalid':
        socket.close(CLOSE_UNSUPPORTED_DATA, closeReason(decoded.reason));
        break;
    }
  }

  /**
   * Hand a sync message to Yjs. The reply (SyncStep2 or an update acknowledgement)
   * goes back to the sender; anything the room learned is broadcast by the doc's
   * `update` listener with this socket as origin, so the sender gets no echo.
   */
  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // Yjs swallows apply errors by default (they are only logged). Here an
      // undecodable update is the sender's protocol error, so hand it an
      // errorHandler that puts the exception back where it can be acted on.
      syncProtocol.readSyncMessage(decoding.createDecoder(payload), encoder, this.document, socket, (error) => {
        throw error;
      });
    } catch (error) {
      // Not a Yjs message at all: this connection is speaking nonsense.
      socket.close(CLOSE_UNSUPPORTED_DATA, closeReason(error instanceof Error ? error.message : 'invalid update'));
      return;
    }
    // `length > 1` means Yjs actually wrote a reply (just the type byte otherwise).
    if (encoding.length(encoder) > 1) this.sendTo(socket, encoding.toUint8Array(encoder));
  }

  /** Forward one document update to every socket except the one it came from. */
  private broadcastSync(update: Uint8Array, except: unknown): void {
    // `writeUpdate` is what makes this a sync message a peer can apply: the sync
    // type plus the length-prefixed update, not the update bytes on their own.
    const frame = syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update));
    for (const socket of [...this.sockets]) {
      if (socket === except) continue;
      this.sendTo(socket, frame);
    }
  }

  /** Send the same bytes to every open socket, sender included. */
  private broadcastToAll(frame: Uint8Array): void {
    for (const socket of [...this.sockets]) this.sendTo(socket, frame);
  }

  /**
   * Send, and forget the socket if it cannot take it: a peer that went away mid
   * -broadcast must not break the room for anybody else.
   */
  private sendTo(socket: WebSocket, frame: Uint8Array): void {
    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
      this.sockets.delete(socket);
      return;
    }
    try {
      socket.send(frame);
    } catch {
      this.sockets.delete(socket);
    }
  }
}

/** Clamp a close reason to what the protocol allows. */
function closeReason(reason: string): string {
  return reason.length <= MAX_CLOSE_REASON_BYTES ? reason : reason.slice(0, MAX_CLOSE_REASON_BYTES);
}
