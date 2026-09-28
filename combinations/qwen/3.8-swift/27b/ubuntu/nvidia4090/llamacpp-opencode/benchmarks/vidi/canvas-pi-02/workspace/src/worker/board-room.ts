// BoardRoom Durable Object (story 3, sync.room): one instance per board id.
// Holds the board's Y.Doc in memory (persistence arrives in story 4) and
// relays y-protocols sync and awareness messages between all connected
// sockets.
//
// Non-hibernating on purpose: an open, accepted socket keeps this object
// alive for as long as anyone has the board open. Story 4 switches to the
// hibernation API once the doc can be reloaded from storage.
//
// Merge semantics are Yjs': concurrent text inserts are all kept, concurrent
// Y.Map sets converge to the same winner on every replica, and deleting a
// note's entry discards concurrent edits inside it (it cannot be
// resurrected by them).
//
// Restart safety without storage: on every (re)connection the room sends its
// own SyncStep1; each client answers with SyncStep2 containing everything
// the room lacks, so the first client to reconnect after a restart
// repopulates the room.
//
// Awareness is relayed verbatim to all open sockets INCLUDING the sender:
// the y-websocket client closes a connection that receives no message within
// its 30 s timeout, and clients renew awareness periodically (~15 s), so the
// relay keeps idle clients alive. Interpreting awareness is story 6.

import { DurableObject } from 'cloudflare:workers';
import { createEncoder, toUint8Array, writeUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { createDecoder, readVarUint } from 'lib0/decoding';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../shared/protocol';
import { KEEP_ALIVE_INTERVAL_MS } from '../shared/config';

/** A valid, no-op frame: type 1 (awareness) with an empty varBytes payload.
 *  The client applies it as an empty awareness update (no state change), and
 *  receiving it refreshes its no-message watchdog. */
const KEEP_ALIVE_FRAME: Uint8Array = (() => {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_AWARENESS);
  writeVarUint8Array(frame, new Uint8Array(0));
  return toUint8Array(frame);
})();

export default class BoardRoom extends DurableObject {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | undefined;
  private keepAliveTimer: number | undefined;

  fetch(req: Request): Promise<Response> {
    if (!req.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
      return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.handleSocket(server);
    return Promise.resolve(
      new Response(null, { status: 101, webSocket: client }),
    );
  }

  /** The in-memory board document, created lazily on first socket. */
  private boardDoc(): Y.Doc {
    if (this.doc === undefined) {
      this.doc = new Y.Doc();
      // Every update's origin is the socket that produced it (local
      // transactions never happen in the room), so broadcasting to everyone
      // except the sender means no one ever receives an echo of their own
      // change.
      this.doc.on('update', (update, origin) => {
        this.broadcast(update, origin === undefined ? undefined : (origin as WebSocket));
      });
    }
    return this.doc;
  }

  private handleSocket(ws: WebSocket): void {
    const doc = this.boardDoc();
    this.ctx.acceptWebSocket(ws); // workerd requirement before sending
    this.sockets.add(ws);
    this.ensureKeepAlive();

    // Send our own SyncStep1 immediately: a reconnecting client answers with
    // SyncStep2 and repopulates a room that lost its in-memory doc on
    // restart; a fresh client receives the whole board as SyncStep2.
    const step1 = createEncoder();
    sync.writeSyncStep1(step1, doc);
    ws.send(syncFrame(toUint8Array(step1)));
  }

  /** DO lifecycle hook: every message from a connected socket. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (!this.sockets.has(ws)) return; // closed in the meantime
    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // no stored awareness in this story
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, sender included (see above).
      this.sendToAll(awarenessFrame(decoded.payload));
      return;
    }
    this.handleSyncMessage(ws, decoded.payload);
  }

  webSocketClose(ws: WebSocket): void {
    this.sockets.delete(ws);
    if (this.sockets.size === 0 && this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /** Pings every open socket on a timer so the y-websocket 30 s no-message
   *  watchdog never drops an idle connection. A send to the socket that just
   *  sent us a message is not reliably delivered in workerd, so the awareness
   *  relay to the sender cannot be relied on; this timer is independent of
   *  message handling and always reaches every socket. */
  private ensureKeepAlive(): void {
    if (this.keepAliveTimer !== undefined) return;
    this.keepAliveTimer = setInterval(() => {
      this.sendToAll(KEEP_ALIVE_FRAME);
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  webSocketError(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  private handleSyncMessage(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.boardDoc();
    const encoder = createEncoder();
    // Peeked inner sync message type (without consuming the payload) so we
    // can guarantee a reply to SyncStep1 (see below). Both the peek and the
    // read are guarded: a truncated/malformed frame must close only this
    // socket, never throw out of the lifecycle hook.
    let innerType = 0;
    let applyError: Error | null = null;
    try {
      innerType = readVarUint(createDecoder(payload));
      sync.readSyncMessage(
        createDecoder(payload),
        encoder,
        doc,
        ws,
        (err: Error) => {
          applyError = err;
        },
      );
    } catch {
      // Truncated or malformed sync frame: close only this socket.
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported sync data');
      return;
    }
    if (applyError !== null) {
      // An update Yjs rejects: close only this socket; the doc is untouched.
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported sync data');
      return;
    }
    const reply = toUint8Array(encoder);
    if (reply.length > 0) {
      ws.send(syncFrame(reply));
    } else if (innerType === sync.messageYjsSyncStep1) {
      // Guarantee a reply to every SyncStep1: an empty SyncStep2 lets the
      // y-websocket client flip to `synced` even when nothing is missing.
      const empty = createEncoder();
      sync.writeSyncStep2(empty, doc, new Uint8Array(0));
      ws.send(syncFrame(toUint8Array(empty)));
    }
  }

  /** Broadcasts a doc update to every open socket except `except`. */
  private broadcast(update: Uint8Array, except: WebSocket | undefined): void {
    const message = createEncoder();
    sync.writeUpdate(message, update);
    for (const socket of [...this.sockets]) {
      if (socket === except) continue;
      this.sendOrDrop(socket, syncFrame(toUint8Array(message)));
    }
  }

  private sendToAll(frame: Uint8Array): void {
    for (const socket of [...this.sockets]) {
      this.sendOrDrop(socket, frame);
    }
  }

  /** A send that throws drops the socket from the room. */
  private sendOrDrop(socket: WebSocket, frame: Uint8Array): void {
    try {
      socket.send(frame);
    } catch {
      this.sockets.delete(socket);
    }
  }
}

export { BoardRoom };

/** Frames a complete y-protocols sync message as a type-0 WebSocket frame.
 *  The inner sync message follows the type byte RAW (no varBytes wrapper),
 *  matching what the y-websocket provider sends and expects. */
function syncFrame(message: Uint8Array): Uint8Array {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_SYNC);
  writeUint8Array(frame, message);
  return toUint8Array(frame);
}

/** Frames an awareness update as a type-1 WebSocket frame. */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const frame = createEncoder();
  writeVarUint(frame, MESSAGE_AWARENESS);
  writeVarUint8Array(frame, payload);
  return toUint8Array(frame);
}
