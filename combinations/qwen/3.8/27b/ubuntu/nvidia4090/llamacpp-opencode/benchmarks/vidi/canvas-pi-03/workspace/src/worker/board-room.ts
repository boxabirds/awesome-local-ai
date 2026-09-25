import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createDecoder } from 'lib0/decoding';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '@/shared/protocol';

/**
 * One BoardRoom per board (story 3).
 *
 * Holds the board's Y.Doc in memory and relays y-websocket messages between
 * the sockets connected to this board:
 *
 *  - on accept: send SyncStep1 (the room's state vector). A client that has
 *    content answers with SyncStep2, which is what repopulates the doc after
 *    a room restart (no storage in this story).
 *  - sync messages: `y-protocols/sync.readSyncMessage` decodes, applies and
 *    produces a reply; the reply (if any) goes back to the sender only.
 *  - doc updates: broadcast to every socket EXCEPT the one that produced
 *    them (no echo, TC-08).
 *  - awareness: relayed verbatim to ALL open sockets including the sender,
 *    which is what keeps idle y-websocket clients alive (their watchdog
 *    closes connections that receive no traffic). Story 6 will interpret it.
 *  - query-awareness: ignored (no stored awareness in this story).
 *
 * Malformed traffic (non-binary frames, undecodable bytes, unknown message
 * types, invalid Yjs updates) closes the offending socket with
 * CLOSE_UNSUPPORTED_DATA (1003) only; other sockets and the doc are
 * unaffected (TC-15). The y-websocket client treats 1003 as transient,
 * reconnects and fully resyncs.
 *
 * Sockets are accepted with `server.accept()` (non-hibernating, on purpose):
 * an open, accepted socket keeps the object alive, so the in-memory doc
 * cannot be evicted while anyone is connected. Story 4 switches to the
 * hibernation API once the doc can be reloaded from storage.
 */
export class BoardRoom {
  private readonly doc: Y.Doc;
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly state: DurableObjectState) {
    this.doc = new Y.Doc();
    this.doc.on('update', (update, origin) => {
      // Every doc mutation in the room comes from applyUpdate(origin = socket),
      // so `origin` is the WebSocket that produced the change. Broadcast to
      // everyone else (the sender gets no echo of its own update).
      this.broadcastUpdate(update, origin as WebSocket);
    });
  }

  async start(): Promise<void> {
    // Initialise the sqlite backing store (unused in this story, but the DO
    // is sqlite-migrated; touching it here keeps start deterministic).
    await this.state.storage;
  }

  async fetch(_request: Request): Promise<Response> {
    // Only WebSocket upgrades reach this point (the worker entry returns 426
    // for anything else).
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.attach(server);
    // Kick off the handshake with the room's current state vector.
    this.sendFrame(server, this.syncStep1Frame());

    return new Response(null, { status: 101, webSocket: client });
  }

  async stop(): Promise<void> {
    for (const socket of [...this.sockets]) {
      this.dropSocket(socket, 1001);
    }
  }

  // --- message handling ---------------------------------------------------

  private attach(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.addEventListener('message', (event: MessageEvent) => {
      this.onMessage(socket, event.data);
    });
    socket.addEventListener('close', () => this.detach(socket));
    socket.addEventListener('error', () => this.detach(socket));
  }

  private detach(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  private onMessage(socket: WebSocket, data: MessageEvent['data']): void {
    const decoded = decodeMessage(data as ArrayBuffer | string);
    switch (decoded.kind) {
      case 'invalid':
        // String frames, unknown types, truncated bytes: reject the sender.
        this.rejectSocket(socket);
        return;
      case 'query-awareness':
        // No stored awareness in this story.
        return;
      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;
      case 'sync':
        this.handleSync(socket, decoded.payload);
        return;
    }
  }

  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const decoder = createDecoder(payload);
    const encoder = createEncoder();
    let rejected = false;
    try {
      // readSyncMessage:
      //  - SyncStep1 -> writes a SyncStep2 reply into `encoder` (no doc change)
      //  - SyncStep2 -> applies to the doc (origin = socket) -> broadcast
      //  - Update    -> applies to the doc (origin = socket) -> broadcast
      // The errorHandler catches invalid Yjs updates that readSyncStep2 would
      // otherwise swallow (it logs and continues).
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket, () => {
        rejected = true;
      });
    } catch {
      rejected = true;
    }
    if (rejected) {
      this.rejectSocket(socket);
      return;
    }
    const reply = toUint8Array(encoder);
    if (reply.length > 0) {
      this.sendFrame(socket, withType(MESSAGE_SYNC, reply));
    }
  }

  /** Relays an awareness frame verbatim to every open socket (incl. sender). */
  private relayAwareness(payload: Uint8Array): void {
    const frame = withType(MESSAGE_AWARENESS, payload);
    for (const socket of [...this.sockets]) {
      this.sendFrame(socket, frame);
    }
  }

  /** Broadcasts a doc update to every socket except `origin`. */
  private broadcastUpdate(update: Uint8Array, origin: WebSocket): void {
    const inner = createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const frame = withType(MESSAGE_SYNC, toUint8Array(inner));
    for (const socket of [...this.sockets]) {
      if (socket === origin) continue;
      this.sendFrame(socket, frame);
    }
  }

  // --- plumbing -----------------------------------------------------------

  /** Frames an inner yjs sync message: [MESSAGE_SYNC: varUint][inner bytes]. */
  private syncStep1Frame(): Uint8Array {
    const encoder = createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return withType(MESSAGE_SYNC, toUint8Array(encoder));
  }

  private sendFrame(socket: WebSocket, frame: Uint8Array): void {
    try {
      socket.send(frame);
    } catch {
      // A send that throws means the socket is gone: drop it (TC-31).
      this.sockets.delete(socket);
    }
  }

  /** Closes `socket` with 1003 (unsupported data) and removes it. */
  private rejectSocket(socket: WebSocket): void {
    this.dropSocket(socket, CLOSE_UNSUPPORTED_DATA);
  }

  private dropSocket(socket: WebSocket, code: number): void {
    this.sockets.delete(socket);
    try {
      socket.close(code);
    } catch {
      // Already closed; nothing to do.
    }
  }
}

/**
 * Prepends a single-byte message type to a payload. All types used here
 * (MESSAGE_SYNC = 0, MESSAGE_AWARENESS = 1) fit in one varUint byte.
 */
function withType(type: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
}
