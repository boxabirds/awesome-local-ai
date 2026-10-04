/**
 * A room for component tests.
 *
 * The app connects to its board as soon as it renders, and jsdom — while it has
 * a WebSocket constructor — has no server on the other end. This stands in for
 * one: it speaks the same framing as `BoardRoom` (through the production
 * `decodeMessage`) and merges with a real `Y.Doc`, so a component test sees a
 * board that syncs, can cut that connection to see what the page does about it,
 * and never touches a real network. Only the transport is replaced; the protocol
 * handling is the code the real room runs, and the socket itself is covered by
 * the integration tests against a real `wrangler dev` server.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { decodeMessage, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

class StandInSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  binaryType: BinaryType = 'blob';
  readyState = StandInSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    // The handshake completes on the microtask queue, so a test that renders and
    // then looks at the badge sees a board that has finished syncing.
    queueMicrotask(() => {
      if (this.readyState !== StandInSocket.CONNECTING) return;
      this.readyState = StandInSocket.OPEN;
      standInRoom.track(this);
      this.onopen?.();
    });
  }

  send(data: ArrayBuffer | ArrayBufferView | string): void {
    if (this.readyState !== StandInSocket.OPEN) return;
    standInRoom.receive(this, data);
  }

  close(): void {
    this.readyState = StandInSocket.CLOSED;
    standInRoom.forget(this);
  }

  /** Deliver a frame as if it had arrived from the room. */
  deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: toArrayBuffer(bytes) });
  }

  /** Drop the connection the way a lost network does: code 1006, no goodbye. */
  cut(): void {
    if (this.readyState !== StandInSocket.OPEN) return;
    this.readyState = StandInSocket.CLOSED;
    standInRoom.forget(this);
    this.onclose?.({ code: 1006, reason: '' });
  }

  /**
   * Close it the way the room does when it has a reason to give: the code is the
   * message, and the page is expected to read it. 4500 means "this board could not
   * be loaded"; 1011 means the room's own storage failed.
   */
  refuse(code: number, reason: string): void {
    if (this.readyState !== StandInSocket.OPEN) return;
    this.readyState = StandInSocket.CLOSED;
    standInRoom.forget(this);
    this.onclose?.({ code, reason });
  }
}

export class StandInRoom {
  private readonly sockets = new Set<StandInSocket>();
  private doc = new Y.Doc();
  private readonly broadcast: (update: Uint8Array, origin: unknown) => void;

  constructor() {
    this.broadcast = (update: Uint8Array, origin: unknown) => {
      const frame = syncFrame(update);
      for (const socket of this.sockets) {
        if (socket !== origin) socket.deliver(frame);
      }
    };
    this.doc.on('update', this.broadcast);
  }

  /** Swap the browser's WebSocket constructor for this room's sockets. */
  install(): void {
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
  }

  /**
   * Start over: every connection is cut and the board's document is emptied.
   * Without this, a test would see notes left behind by the one before it.
   */
  reset(): void {
    for (const socket of [...this.sockets]) socket.cut();
    this.sockets.clear();
    this.doc.off('update', this.broadcast);
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.doc.on('update', this.broadcast);
  }

  /**
   * Apply a change on the room's side of the wire, the way another participant's
   * update arriving does: it lands in the room's document and is relayed to
   * everybody connected. This is how a test says "somebody else did something".
   */
  someoneElsesChange(mutate: (doc: Y.Doc) => void): void {
    const roomDoc = this.doc;
    this.doc.transact(() => mutate(roomDoc), 'somebody else');
  }

  /**
   * Everything the room holds, as one update: what a person who connects right
   * now is sent before they can do anything else.
   */
  stateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** Cut every open connection, as a network outage does to a page. */
  cutConnections(): void {
    for (const socket of [...this.sockets]) socket.cut();
  }

  /**
   * Turn every connection away with a reason, as the room does when it cannot do
   * what the page asked of it. `cutConnections` says the wire went bad; this says
   * the room looked at the board and could not read it.
   */
  refuseConnections(code: number, reason = ''): void {
    for (const socket of [...this.sockets]) socket.refuse(code, reason);
  }

  receive(socket: StandInSocket, data: ArrayBuffer | ArrayBufferView | string): void {
    const decoded = decodeMessage(
      typeof data === 'string' ? data : toBytes(data),
    );
    if (decoded.kind === 'invalid') {
      socket.close(); // what the room does with traffic it cannot read
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relayed verbatim, sender included, exactly like the room.
      socket.deliver(awarenessFrame(decoded.payload));
      return;
    }
    if (decoded.kind === 'query-awareness') return; // story 6 answers this

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(
      decoding.createDecoder(decoded.payload),
      encoder,
      this.doc,
      socket,
    );
    if (encoding.length(encoder) > 1) socket.deliver(encoding.toUint8Array(encoder));
  }

  forget(socket: StandInSocket): void {
    this.sockets.delete(socket);
  }

  track(socket: StandInSocket): void {
    this.sockets.add(socket);
  }
}

function syncFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

/** The room every component test talks to. */
export const standInRoom = new StandInRoom();
