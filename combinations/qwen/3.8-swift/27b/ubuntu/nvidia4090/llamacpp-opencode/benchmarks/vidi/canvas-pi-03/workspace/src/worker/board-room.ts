/**
 * Story 3: BoardRoom.
 *
 * One room per board. Holds the board's Y.Doc in memory and relays Yjs sync
 * and awareness messages over WebSockets (y-websocket framing).
 *
 * The room logic lives in `BoardRoomCore`, a plain class (no DurableObject
 * base) so it can be constructed directly in tests. The `BoardRoom` Durable
 * Object is a thin wrapper that hands each accepted socket to a core.
 *
 * - Sockets are held in a Set (deliberately non-hibernating: the doc is
 *   memory-only until story 4).
 * - On attach the room sends its own SyncStep1, so a reconnecting client
 *   repopulates a restarted room via its own SyncStep2 (restart safety).
 * - Sync messages are applied to the doc with `readSyncMessage` (origin = the
 *   socket); the doc's `update` event is broadcast to every other socket, so
 *   the sender gets no echo.
 * - Awareness bytes are relayed verbatim to all open sockets (including the
 *   sender) to keep idle y-websocket clients alive. Query-awareness is ignored.
 * - A string / undecodable / unknown-type frame, or an update Yjs rejects,
 *   closes only that socket with CLOSE_UNSUPPORTED_DATA. A send that throws
 *   removes the socket.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { initDoc } from 'src/shared/board-model';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeSyncFrame,
} from 'src/shared/protocol';

interface Env {
  BOARD_ROOM: unknown;
  ASSETS: unknown;
}

/**
 * The board-room logic, independent of the DurableObject base class. Accepts
 * an already-accepted server-side WebSocket and relays sync/awareness.
 */
export class BoardRoomCore {
  readonly sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  /** Attaches an accepted server-side socket: (re)syncs it and wires handlers. */
  attachSocket(ws: WebSocket): void {
    const doc = this.ensureDoc();
    this.sockets.add(ws);

    // Send the server's SyncStep1 so the newcomer (re)syncs; a fresh room
    // repopulates from the first reconnecting client's SyncStep2.
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(step1, doc);
    ws.send(encoding.toUint8Array(step1));

    ws.addEventListener('message', (e: MessageEvent) =>
      this.handleMessage(ws, e.data as string | ArrayBuffer),
    );
    ws.addEventListener('close', () => this.sockets.delete(ws));
    ws.addEventListener('error', () => this.sockets.delete(ws));
  }

  private ensureDoc(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
      // The room is the authority: seed the initial state (schema) so newcomers
      // sync it down. Clients must not create this op themselves.
      initDoc(this.doc);
    }
    return this.doc;
  }

  private handleMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        this.handleSync(ws, decoded.payload);
        return;
      }
      case 'awareness': {
        // Relay the original frame verbatim to everyone, sender included.
        const frame =
          typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        for (const s of this.sockets) {
          try {
            s.send(frame);
          } catch {
            this.sockets.delete(s);
          }
        }
        return;
      }
      case 'query-awareness':
        // No stored awareness in this story: ignore.
        return;
      case 'invalid':
        this.closeUnsupported(ws);
        return;
    }
  }

  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, this.ensureDoc(), ws);
      if (encoding.hasContent(encoder)) {
        ws.send(encodeSyncFrame(encoding.toUint8Array(encoder)));
      }
    } catch {
      this.closeUnsupported(ws);
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
    } catch {
      // already closing/closed
    }
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    if (this.sockets.size === 0) return;
    // A doc update is relayed as a sync `messageYjsUpdate` message, framed as
    // a y-websocket sync frame: [MESSAGE_SYNC][messageYjsUpdate][update].
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const frame = encoding.toUint8Array(enc);
    for (const s of this.sockets) {
      if (s === except) continue;
      try {
        s.send(frame);
      } catch {
        this.sockets.delete(s);
      }
    }
  }
}

/** The BoardRoom Durable Object: a thin wrapper around `BoardRoomCore`. */
export class BoardRoom extends DurableObject<Env> {
  readonly core = new BoardRoomCore();

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating accept: the accepted socket is the server side itself.
    server.accept();
    this.core.attachSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
