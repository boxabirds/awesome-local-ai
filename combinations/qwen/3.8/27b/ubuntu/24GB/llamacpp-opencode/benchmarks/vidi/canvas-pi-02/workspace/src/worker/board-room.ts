import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  decodeMessage,
} from '../shared/protocol';

/**
 * One BoardRoom per board (story 3).
 *
 * Holds the board's Y.Doc in memory and relays y-websocket frames between
 * all connected sockets:
 *
 *  - sync:     a joining client sends SyncStep1; the room answers with
 *              SyncStep2 (everything the client is missing) followed by
 *              SyncStep1 (ask the client for what the room is missing,
 *              answered with a SyncStep2). The two answers are separate
 *              WebSocket messages: the y-websocket client processes at most
 *              one top-level message per frame, so a combined [Step2, Step1]
 *              frame would drop the Step1 and the client would never send
 *              its pre-connection content to the room. Later
 *              SyncStep2/Update frames are applied to the room doc and the
 *              raw update is broadcast to every other socket — that
 *              broadcast is what makes one person's edits appear on the
 *              others' screens.
 *  - awareness: frames are relayed verbatim to every socket, including the
 *              sender. Other clients learn about state changes; the sender
 *              receives its own (same-clock) state back, which applies as a
 *              no-op but keeps the link alive under the y-websocket client's
 *              30 s "no message received" watchdog while everyone idles.
 *
 * The room keeps no participant list of its own and never refuses a
 * connection: capacity is a soft, test-driven setting (MAX_CONCURRENT_EDITORS)
 * and an over-capacity joiner is never turned away.
 *
 * The Y.Doc lives only in isolate memory in this story; story 4 persists it
 * to the object's SQLite storage. (The class is already SQLite-backed, so
 * that change needs no migration.)
 */
export class BoardRoom extends DurableObject {
  private readonly doc: Y.Doc;
  private readonly sockets: Set<WebSocket>;
  /**
   * Consolidated view of the peers' awareness states. New joiners are
   * answered with this snapshot immediately (otherwise they would only
   * learn about the other editors at the next ~15 s awareness keep-alive),
   * and the Awareness module's 30 s timeout prunes peers that vanish
   * without closing — the same cleanup each client does locally. The room
   * itself holds no local state, so it never appears in a snapshot.
   */
  private readonly roomAwareness: awarenessProtocol.Awareness;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.doc = new Y.Doc();
    this.sockets = new Set<WebSocket>();
    this.roomAwareness = new awarenessProtocol.Awareness(this.doc);
    this.roomAwareness.setLocalState(null);
  }

  /** Number of sockets currently attached (observability and tests). */
  get connectionCount(): number {
    return this.sockets.size;
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- connection lifecycle ------------------------------------------------

  private attach(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (event) => {
      try {
        this.onMessage(socket, event.data as ArrayBuffer | string);
      } catch {
        // A handler bug must never take the room down for everyone else.
        this.closeSocket(socket, 1011, 'internal error');
      }
    };
    const detach = (): void => {
      this.sockets.delete(socket);
    };
    socket.onclose = detach;
    socket.oncancel = detach;
    // Accept last, once every handler is attached.
    socket.accept();
    // A joiner learns about the editors already in the room right away.
    const clientIDs = Array.from(this.roomAwareness.getStates().keys());
    if (clientIDs.length > 0) {
      this.safeSend(socket, this.awarenessFrameFor(clientIDs));
    }
  }

  // --- inbound frames ------------------------------------------------------

  private onMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(socket, decoded.payload);
        return;
      case 'awareness':
        try {
          awarenessProtocol.applyAwarenessUpdate(this.roomAwareness, decoded.payload, socket);
        } catch {
          // Structurally valid frame with corrupt content (e.g. bad JSON
          // state): ignore it rather than dropping the connection over
          // ephemeral presence data.
        }
        // Relay to everyone, sender included (see the class doc for why).
        const frame = createEncoder();
        writeVarUint(frame, MESSAGE_AWARENESS);
        writeVarUint8Array(frame, decoded.payload);
        this.broadcast(socket, toUint8Array(frame), /* includeSender= */ true);
        return;
      case 'query-awareness': {
        const clientIDs = Array.from(this.roomAwareness.getStates().keys());
        if (clientIDs.length > 0) {
          this.safeSend(socket, this.awarenessFrameFor(clientIDs));
        }
        return;
      }
    }
  }

  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const decoder = createDecoder(payload);
    const type = readVarUint(decoder);
    switch (type) {
      case SYNC_STEP1: {
        const clientStateVector = readVarUint8Array(decoder);
        // Everything the client is missing, plus a request for what we are.
        // A 0-byte state vector means "the client knows nothing", in which
        // case the SyncStep2 carries the whole document. (yjs itself throws
        // on an empty binary state vector, so stand in one from a fresh
        // doc — a client id the room has certainly never seen.)
        const step2 = createEncoder();
        writeVarUint(step2, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(
          step2,
          this.doc,
          clientStateVector.length > 0 ? clientStateVector : Y.encodeStateVector(new Y.Doc())
        );
        this.safeSend(socket, toUint8Array(step2));
        // The request for the client's state MUST be a separate WebSocket
        // message: the y-websocket client processes at most one top-level
        // message per frame, so a [Step2, Step1] pair in one frame would
        // drop the Step1 and the client would never send its own (pre-
        // connection) content to the room.
        const step1 = createEncoder();
        writeVarUint(step1, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(step1, this.doc);
        this.safeSend(socket, toUint8Array(step1));
        return;
      }
      case SYNC_STEP2:
      case SYNC_UPDATE: {
        const update = readVarUint8Array(decoder);
        this.ingestUpdate(socket, update);
        return;
      }
      default:
        // decodeMessage has already rejected unknown sync types; belt and braces.
        this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'unknown sync message type');
    }
  }

  private ingestUpdate(socket: WebSocket, update: Uint8Array): void {
    if (update.length === 0) {
      return;
    }
    try {
      Y.applyUpdate(this.doc, update, socket);
    } catch {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
      return;
    }
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    this.broadcast(socket, toUint8Array(frame), /* includeSender= */ false);
  }

  // --- outbound frames -----------------------------------------------------

  private awarenessFrameFor(clientIDs: number[]): Uint8Array {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_AWARENESS);
    writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.roomAwareness, clientIDs));
    return toUint8Array(encoder);
  }

  private broadcast(sender: WebSocket, frame: Uint8Array, includeSender: boolean): void {
    for (const socket of this.sockets) {
      if (socket === sender && !includeSender) {
        continue;
      }
      this.safeSend(socket, frame);
    }
  }

  private safeSend(socket: WebSocket, frame: Uint8Array): void {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      }
    } catch {
      // The socket closed between the readyState check and the send; its
      // onclose removes it from the set. Dropping the frame is correct.
    }
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already closing or closed.
    }
  }
}
