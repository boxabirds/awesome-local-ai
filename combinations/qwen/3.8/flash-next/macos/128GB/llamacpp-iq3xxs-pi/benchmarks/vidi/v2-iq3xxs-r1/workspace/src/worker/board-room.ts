import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

/** `WebSocket.OPEN` (readyState 1); the runtime does not expose the constant. */
const WS_OPEN = 1;

/**
 * One live board.
 *
 * The room holds the board's `Y.Doc` in memory and relays y-websocket frames
 * between every socket on the board:
 *
 * - a document update is applied here and forwarded to every *other* socket
 *   immediately, with no batching or timers, so a change reaches every other
 *   screen within `LIVE_UPDATE_LATENCY_BUDGET_MS` (PRD live.propagate) and never
 *   echoes back to the person who made it;
 * - awareness frames are relayed verbatim to *all* sockets, sender included, so
 *   idle clients keep receiving traffic and never time their connection out. No
 *   awareness state is kept (interpreting it is story 6);
 * - a newcomer is answered with SyncStep2 of the whole document, so a late
 *   joiner sees the board as it is now (PRD live.join_state) and, after a runtime
 *   restart, the first reconnection repopulates the room (no notes are lost while
 *   somebody still has the board open).
 *
 * Merging is plain Yjs semantics: concurrent text inserts are all kept (PRD
 * live.concurrent_text), concurrent sets on one field converge to a single
 * winner on every replica (live.converge), and edits inside a deleted note are
 * discarded and cannot resurrect it (live.delete_during_edit).
 *
 * WebSockets are accepted the *non-hibernating* way on purpose: until story 4 the
 * document exists only in memory, and hibernation would let the runtime evict the
 * object (taking the document with it) while sockets stayed open.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | undefined;
  private readonly sockets = new Set<WebSocket>();

  /** WebSocket upgrade only; everything else is refused without closing anything. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket connection', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event) => this.onMessage(server, event.data));
    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));

    // Ask the newcomer for its state: a client that is reconnecting to a restarted
    // room answers with everything the room is missing.
    this.send(server, syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document())));
    return new Response(null, { status: 101, webSocket: client });
  }

  private document(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // `origin` is the socket the update arrived on, or `null` for changes made
      // inside the room; the sender never sees its own change come back.
      this.broadcast(syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)), origin);
    });
    this.doc = doc;
    return doc;
  }

  private onMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    if (!this.sockets.has(socket)) return; // closed while a frame was in flight

    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.reject(socket, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') return; // no stored awareness in this story
    if (decoded.kind === 'awareness') {
      // Relay verbatim, including to the sender: that is what keeps idle clients
      // inside their reconnect timeout.
      this.broadcast(new Uint8Array(data as ArrayBuffer), null);
      return;
    }

    const doc = this.document();
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let unreadable: unknown = null;
    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        reply,
        doc,
        socket, // origin: the doc listener uses it to skip the echo
        (error: unknown) => {
          // y-protocols applies a document update inside its own try/catch, so a
          // broken update is reported here instead of thrown.
          unreadable = error;
        },
      );
    } catch (error) {
      unreadable = error;
    }
    if (unreadable) {
      this.reject(socket, 'unreadable sync message');
      return;
    }
    if (encoding.length(reply) > 1) this.send(socket, encoding.toUint8Array(reply));
  }

  /** Close exactly one socket; the room and the other sockets carry on. */
  private reject(socket: WebSocket, _reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // already closing: nothing to do
    }
  }

  /**
   * Send to every open socket, skipping `except` (pass `null` for all of them).
   * A socket whose `send` throws is dropped from the set, so one dead peer can
   * neither abort the broadcast nor break the room for anybody else.
   */
  private broadcast(bytes: Uint8Array, except: unknown): void {
    for (const socket of this.sockets) {
      if (socket === except || socket.readyState !== WS_OPEN) continue;
      this.send(socket, bytes);
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    if (!this.sockets.has(socket)) return;
    try {
      socket.send(bytes);
    } catch {
      this.sockets.delete(socket); // a peer we can no longer write to
    }
  }
}

/** One y-websocket sync frame: type byte + y-protocols message. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
