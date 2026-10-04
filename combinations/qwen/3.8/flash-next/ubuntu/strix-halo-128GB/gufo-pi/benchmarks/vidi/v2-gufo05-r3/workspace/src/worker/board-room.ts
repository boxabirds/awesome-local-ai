/**
 * `BoardRoom` — one Durable Object per board.
 *
 * The object holds the board's `Y.Doc` in memory and relays Yjs sync and
 * awareness messages between every socket connected to that board. It never
 * interprets board content: merging is Yjs CRDT semantics.
 *
 * Why the *non-hibernating* accept (`server.accept()` rather than
 * `ctx.acceptWebSocket()`): until story 4 the document exists only in this
 * object's memory, and hibernation would evict the object while sockets stay
 * open, silently dropping it. An open, accepted socket keeps the object alive.
 *
 * Why SyncStep1 is sent on every accept: after a runtime restart or deploy the
 * document is gone. The first client to reconnect answers our SyncStep1 with a
 * SyncStep2 carrying everything it has, which repopulates the room — so notes
 * survive a restart as long as at least one person keeps the board open.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  /** Every open socket of this board. No participant counting: capacity is soft. */
  private readonly sockets = new Set<WebSocket>();
  /** The board document, created on the first connection and never persisted here. */
  private boardDoc: Y.Doc | null = null;

  /** WebSocket upgrade only; everything else is a protocol error. */
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('upgrade')?.toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    const doc = this.ensureDoc();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // The 101 must be built *before* `accept()`: the runtime refuses to hand out
    // a socket in a Response once it has been accepted.
    const switching = new Response(null, { status: 101, webSocket: client });
    server.accept();

    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(server, event.data, doc);
    });
    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));

    // Ask the newcomer for its state: it answers with a SyncStep2 that fills in
    // whatever this room does not have yet (a restarted room, a late joiner's
    // offline edits).
    this.sendSyncStep1(server, doc);

    return switching;
  }

  /** The room's document, with the broadcast listener attached once. */
  private ensureDoc(): Y.Doc {
    if (this.boardDoc) return this.boardDoc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Every change one socket caused is forwarded to all the others, framed as
      // a y-websocket sync message. The sender gets no echo.
      this.broadcast(syncFrame(update), origin);
    });
    this.boardDoc = doc;
    return doc;
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string, doc: Y.Doc): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupported(ws, decoded.reason);
      return;
    }
    // Awareness keeps idle connections alive; stored awareness and presence
    // semantics are story 6, so a query is simply ignored.
    if (decoded.kind === 'query-awareness') return;
    if (decoded.kind === 'awareness') {
      this.relay(decoded.payload);
      return;
    }

    const encoder = encoding.createEncoder();
    // The reply carries the same outer frame byte as the request; a reply is
    // only sent when the handler added something after it.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const decoder = decoding.createDecoder(decoded.payload);
    // `y-protocols` swallows (and logs) errors while applying an update, so it
    // reports them through this callback instead of throwing. A broken update
    // means that socket gets closed; nobody else is affected.
    const failure: { reason: string | null } = { reason: null };
    try {
      // SyncStep1 in → SyncStep2 out; SyncStep2 / Update in → applied to the doc,
      // which fires the `update` listener that broadcasts it to everybody else.
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (error) => {
        failure.reason = error.message;
      });
    } catch (error) {
      failure.reason = error instanceof Error ? error.message : String(error);
    }
    if (failure.reason !== null) {
      this.closeUnsupported(ws, failure.reason);
      return;
    }
    if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
  }

  /** Send our state request so the client can (re)populate the room. */
  private sendSyncStep1(ws: WebSocket, doc: Y.Doc): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  /** Forward a document update to every open socket except its origin. */
  private broadcast(payload: Uint8Array, origin: unknown): void {
    for (const ws of this.sockets) {
      if (ws === origin) continue;
      this.send(ws, payload);
    }
  }

  /**
   * Relay awareness bytes verbatim to every open socket, sender included (that
   * is what keeps an idle connection's liveness traffic flowing both ways). The
   * payload goes back out inside the same frame the sender used.
   */
  private relay(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    for (const ws of this.sockets) this.send(ws, frame);
  }

  /**
   * Send to one socket. A socket that cannot be written to is dropped from the
   * set so a dead peer can neither throw during a broadcast nor block the others.
   */
  private send(ws: WebSocket, payload: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) {
      this.sockets.delete(ws);
      return;
    }
    try {
      ws.send(payload.slice());
    } catch {
      this.sockets.delete(ws);
    }
  }

  /** Close exactly one socket for breaking the framing contract. */
  private closeUnsupported(ws: WebSocket, reason: string): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closing: nothing to do.
    }
  }
}

/**
 * Wrap a bare Yjs update in a y-websocket frame: the outer message type
 * (`MESSAGE_SYNC`) plus the `y-protocols` update message. The outer byte is not
 * optional — without it the first byte of the payload would be read as the
 * message type and the update would be silently misparsed.
 */
function syncFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}
