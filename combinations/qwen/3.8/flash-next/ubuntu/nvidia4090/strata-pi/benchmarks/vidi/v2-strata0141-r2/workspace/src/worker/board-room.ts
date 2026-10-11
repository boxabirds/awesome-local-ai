/**
 * BoardRoom: one Durable Object per board (`sync.room`).
 *
 * The room is a relay, not a server with its own rules. It holds the board's
 * `Y.Doc` in memory and moves y-websocket frames between the sockets on the
 * board:
 *
 * - a socket that connects is told what the room has (SyncStep1), so it can
 *   answer with what the room lacks (SyncStep2) — that is what rebuilds a room
 *   after a restart while somebody still has the board open;
 * - every document update is applied and forwarded to the other sockets
 *   immediately, with no batching or timers (`live.propagate`), and never back
 *   to the socket it came from;
 * - merging is plain Yjs semantics: concurrent text inserts are all kept,
 *   concurrent property sets converge to one value every replica agrees on, and
 *   a deleted note cannot be resurrected by edits made inside it at the same
 *   moment;
 * - awareness bytes are relayed verbatim to every socket *including* the sender,
 *   which keeps an idle client's connection alive. Who is present is story 6.
 *
 * WebSockets are accepted with the plain (non-hibernating) `accept()`: the
 * document only exists in memory until story 4 can reload it from storage, and
 * hibernation would evict this object while sockets are still open.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  toArrayBuffer,
} from '../shared/protocol';
import type { Env } from './index';

/** What a socket sent, before it is interpreted. */
interface RawFrame {
  /** The frame exactly as it arrived, so awareness can be relayed untouched. */
  bytes: Uint8Array | null;
  /** `decodeMessage` input: the same bytes, or the text frame itself. */
  input: ArrayBuffer | string;
}

export class BoardRoom extends DurableObject<Env> {
  /** Created on the first socket; discarded by the runtime on eviction. */
  private doc: Y.Doc | null = null;
  private readonly sockets = new Set<WebSocket>();

  /** WebSocket upgrade only; the client side is handed back in the response. */
  override async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.joinRoom(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private joinRoom(ws: WebSocket): void {
    // No participant counting: `MAX_CONCURRENT_EDITORS` is a design and test
    // target, not a limit (`live.over_capacity`). Everyone who reaches a board
    // joins it.
    //
    // workerd hands binary frames over as Blobs by default; the protocol works
    // on bytes.
    ws.binaryType = 'arraybuffer';
    ws.accept();
    this.sockets.add(ws);

    // "Here is what this room already knows." A client answers with the state
    // the room is missing, which repopulates a room that just restarted.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.document());
    this.send(ws, encoding.toUint8Array(encoder));

    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(ws, event.data);
    });
    ws.addEventListener('close', () => {
      this.sockets.delete(ws);
    });
    ws.addEventListener('error', () => {
      this.sockets.delete(ws);
    });
  }

  private document(): Y.Doc {
    if (this.doc !== null) {
      return this.doc;
    }
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // The socket a update arrived from must not get an echo of its own work.
      this.broadcastUpdate(update, origin);
    });
    this.doc = doc;
    return doc;
  }

  private handleMessage(ws: WebSocket, data: string | ArrayBuffer | Uint8Array): void {
    const frame = rawFrame(data);
    const decoded = decodeMessage(frame.input);

    if (decoded.kind === 'invalid') {
      this.closeUnsupported(ws, decoded.reason);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Verbatim, to everyone including the sender: an idle client stays
      // connected because it keeps hearing traffic.
      const bytes = frame.bytes;
      if (bytes !== null) {
        for (const socket of this.sockets) {
          this.send(socket, bytes);
        }
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // This room stores no awareness; there is nothing to answer.
      return;
    }

    this.handleSync(ws, decoded.payload);
  }

  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.document();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      const decoder = decoding.createDecoder(payload);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === syncProtocol.messageYjsSyncStep1) {
        // Answer a newcomer with everything this room already has.
        syncProtocol.readSyncStep1(decoder, encoder, doc);
      } else if (
        messageType === syncProtocol.messageYjsSyncStep2 ||
        messageType === syncProtocol.messageYjsUpdate
      ) {
        // `y-protocols/sync` logs a rejected update and carries on. This contract
        // closes the socket that sent it, so the bytes are read and applied here.
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), ws);
      } else {
        throw new Error(`unknown sync message type ${messageType}`);
      }
    } catch (cause) {
      // Truncated bytes or a Yjs update the document rejected: drop this socket
      // and leave every other participant alone.
      this.closeUnsupported(ws, cause instanceof Error ? cause.message : 'unreadable sync message');
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1) {
      this.send(ws, reply);
    }
  }

  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      if (socket === origin) {
        continue;
      }
      this.send(socket, frame);
    }
  }

  /** Send, and forget the socket if it is no longer sendable. */
  private send(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      this.sockets.delete(ws);
    }
  }

  /** Close one socket only; the board and its other sockets are untouched. */
  private closeUnsupported(ws: WebSocket, reason: string): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already gone.
    }
  }
}

/** Copy whatever the runtime delivered into a standalone frame buffer. */
function rawFrame(data: string | ArrayBuffer | Uint8Array): RawFrame {
  const input = toArrayBuffer(data);
  if (typeof input === 'string') {
    // Text frames are invalid; decodeMessage reports them, nothing to copy.
    return { bytes: null, input };
  }
  return { bytes: new Uint8Array(input), input };
}
