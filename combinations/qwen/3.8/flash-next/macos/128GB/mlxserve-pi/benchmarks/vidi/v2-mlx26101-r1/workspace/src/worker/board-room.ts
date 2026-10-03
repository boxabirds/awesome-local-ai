// BoardRoom: one Durable Object per board id.
//
// The room holds the board's `Y.Doc` in memory and relays Yjs sync and awareness
// messages between every WebSocket connected to the board. All merging is Yjs
// CRDT semantics: concurrent text inserts are all kept, concurrent writes to the
// same field resolve to one deterministic winner on every replica, and a deleted
// note cannot be resurrected by edits made inside it at the same moment.
//
// WebSockets are accepted with the *non-hibernating* API (`socket.accept()`, not
// `ctx.acceptWebSocket`) on purpose: until story 4 the document only exists in
// this object's memory, and hibernation would let the runtime evict the object —
// and with it the board — while sockets stay open. An open, accepted socket keeps
// the object alive. Story 4 switches to hibernation once the doc reloads from
// storage.

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import * as Yjs from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

/** Frame a raw Yjs update as a y-websocket sync message. */
function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** SyncStep1 (``what do you have?``) for `doc`, ready to send. */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  /** Every open, accepted socket on this board. Never counted, never limited. */
  private readonly sockets = new Set<WebSocket>();

  /** The board's document, created on the first connection. */
  private roomDoc: Y.Doc | null = null;

  /**
   * The room's Y.Doc, with the broadcast listener attached: every document
   * update goes to every socket except the one that caused it (so the sender
   * never gets an echo of its own change) with no batching and no timer, which
   * is what keeps a change inside the 1-second budget on typical broadband.
   */
  private get doc(): Y.Doc {
    if (this.roomDoc === null) {
      const doc = new Yjs.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // `origin` is the socket the update arrived on (undefined when the room's
        // own document was mutated directly), so the sender gets no echo.
        this.broadcast(updateFrame(update), origin instanceof WebSocket ? origin : null);
      });
      this.roomDoc = doc;
    }
    return this.roomDoc;
  }

  /** Accept a WebSocket for this board and start the initial sync handshake. */
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.trim().toLowerCase() !== 'websocket') {
      return new Response('Upgrade: websocket required', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    });
    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));

    // Ask the newcomer for its state vector. It answers with a SyncStep2 holding
    // everything the room lacks, which is how the first client to reconnect after
    // a runtime restart repopulates the board (no notes are lost while at least
    // one person still has the board open).
    this.sendTo(server, syncStep1Frame(this.doc));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Decode and act on one frame from one socket. */
  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // The reply envelope starts with the outer message type, exactly like
        // y-websocket's handler, and only carries a body when the room has one.
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          // Origin is the socket, so the update listener can skip the sender.
          // The error handler rethrows, turning a Yjs-level failure (a corrupt
          // update) into a close of this socket only.
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws, (error: Error) => {
            throw error;
          });
        } catch {
          this.closeUnsupported(ws, 'invalid Yjs sync message');
          return;
        }
        // The reply (SyncStep2 in answer to a SyncStep1) goes back to the asker.
        if (encoding.length(encoder) > 1) this.sendTo(ws, encoding.toUint8Array(encoder));
        return;
      }
      case 'awareness': {
        // Relay verbatim to every socket *including* the sender and keep no
        // awareness state: interpreting it (who is here, cleanup on leave) is
        // story 6. Echoing is also what keeps idle clients alive — the y-websocket
        // provider disconnects a socket that receives nothing for its reconnect
        // timeout, and it renews awareness on that same cadence.
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        this.relay(bytes);
        return;
      }
      case 'query-awareness':
        // Nothing to answer with while awareness is not stored.
        return;
      case 'invalid':
        this.closeUnsupported(ws, decoded.reason);
        return;
    }
  }

  /** Send `bytes` to every open socket, dropping any that cannot take them. */
  private relay(bytes: Uint8Array | ArrayBuffer): void {
    this.broadcast(bytes, null);
  }

  /**
   * Send to every socket except `except` (pass null for all of them). A socket
   * whose `send` throws is dead: remove it from the set so one broken client can
   * neither stall nor crash the room.
   */
  private broadcast(bytes: Uint8Array | ArrayBuffer, except: WebSocket | null): void {
    for (const ws of this.sockets) {
      if (ws === except) continue;
      try {
        ws.send(bytes);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  /** Send to one socket, dropping it if the send fails. */
  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      this.sockets.delete(ws);
    }
  }

  /** Close one socket for a protocol error; everybody else stays connected. */
  private closeUnsupported(ws: WebSocket, reason: string): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason);
    } catch {
      // The socket was already broken; dropping it from the set is enough.
    }
  }

  /**
   * Forget a socket that went away, and finish the close handshake on our side so
   * the other end learns about it instead of waiting for a close echo.
   */
  private drop(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close();
    } catch {
      // Nothing to close.
    }
  }
}
