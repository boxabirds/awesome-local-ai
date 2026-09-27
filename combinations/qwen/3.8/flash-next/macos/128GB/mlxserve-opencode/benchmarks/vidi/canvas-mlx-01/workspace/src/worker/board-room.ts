/**
 * `BoardRoom`: one Durable Object per board, holding that board's `Y.Doc` in memory
 * and relaying Yjs sync + awareness messages between every connected socket.
 *
 * The sockets are accepted with the non-hibernating `server.accept()` API on purpose
 * in this story: the document lives only in memory until story 4 can reload it from
 * storage, and hibernation would evict the object (silently dropping the document)
 * while sockets stay open. An open, accepted socket keeps the object alive.
 *
 * Restart safety without storage: every (re)connection is answered with the room's
 * own SyncStep1, so the first client to reconnect answers with a SyncStep2 carrying
 * everything the freshly-restarted room lacks and repopulates it — no notes are lost
 * while at least one person still has the board open.
 *
 * Awareness: updates are relayed verbatim to *every* socket (including the sender), so
 * idle clients keep receiving traffic and their no-message timeout never fires. The room
 * also keeps its own awareness mirror so it can answer a newcomer's `queryAwareness`
 * (which y-websocket sends on connect) and announce a departure — without that mirror a
 * fresh joiner could never count the people already here.
 */
import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol.js';
import type { Env } from './index.js';

const { messageYjsSyncStep1 } = syncProtocol;

/**
 * Wrap a Yjs update as a y-websocket sync frame: `[ MESSAGE_SYNC, writeUpdate ]`.
 * Receivers apply it through `readSyncMessage`; it is never sent back to the peer
 * that produced it, so a sender never sees an echo of its own change.
 */
const frameUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

/** A room's own SyncStep1 frame: `[ MESSAGE_SYNC, SyncStep1, stateVector ]`. */
const frameSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

/** Wrap an awareness update as `[ MESSAGE_AWARENESS, varuint8array ]`. */
const frameAwareness = (bytes: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
};

export class BoardRoom extends DurableObject<Env> {
  /** Open, accepted server sockets for this board. */
  private readonly sockets = new Set<WebSocket>();
  /** Which awareness client ids each socket introduced, so a departure can be announced. */
  private readonly socketAwareness = new Map<WebSocket, Set<number>>();
  /** The socket that most recently asserted each awareness id (for reconnect re-ownership). */
  private readonly awarenessOwner = new Map<number, WebSocket>();
  /** The room's awareness mirror, kept only to answer queries and announce departures. */
  private readonly awarenessDoc = new Y.Doc();
  private readonly awareness = new Awareness(this.awarenessDoc);
  /** The room document; created lazily on the first accepted socket. */
  private doc: Y.Doc | null = null;

  /** Only WebSocket upgrades reach the room; anything else is a client error. */
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Binary frames arrive as ArrayBuffer (not Blob) so `decodeMessage` sees the bytes.
    server.binaryType = 'arraybuffer';
    // Non-hibernating accept: an open socket keeps this object (and its in-memory
    // doc) alive for the lifetime of the connection.
    server.accept();

    const doc = this.getDoc();
    this.sockets.add(server);
    this.bindSocket(server);

    // Ask the newcomer for its state so a restarted room is repopulated by the very
    // first client to reconnect (its SyncStep2 is everything the room lacks).
    this.send(server, frameSyncStep1(doc));
    // Push who is already here: y-websocket only queries presence over BroadcastChannel
    // (disabled here), so a newcomer learns the existing editors solely from this push.
    this.answerAwarenessQuery(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** The room's in-memory doc, created once and never discarded explicitly. */
  private getDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Broadcast to every socket except the one that produced the update, so the
        // sender never receives an echo of its own change.
        this.broadcast(frameUpdate(update), (origin as WebSocket | null | undefined) ?? null);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private bindSocket(ws: WebSocket): void {
    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(ws, event.data as ArrayBuffer | string);
    });
    ws.addEventListener('close', () => {
      this.forgetSocket(ws);
    });
    ws.addEventListener('error', () => {
      this.forgetSocket(ws);
    });
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        this.handleSync(ws, decoded.payload);
        break;
      }
      case 'awareness': {
        // Relay the original frame verbatim to every socket (including the sender) so
        // idle clients keep receiving traffic and their no-message timeout never fires.
        if (typeof data !== 'string') this.relay(data, null);
        this.trackAwareness(ws, decoded.payload);
        break;
      }
      case 'query-awareness': {
        // A newcomer asks who is here; answer it with everyone the room currently knows.
        this.answerAwarenessQuery(ws);
        break;
      }
      case 'invalid': {
        // A malformed frame only closes the socket that sent it; every other editor
        // stays connected and the room document is unchanged.
        this.closeUnsupported(ws);
        break;
      }
    }
  }

  /**
   * Handle a sync frame body (the bytes after the outer `MESSAGE_SYNC` type). A reply
   * is written only for a SyncStep1 (SyncStep2 back to the requester); a SyncStep2 or
   * update is applied to the doc, which fires `update` and broadcasts to the others.
   * Any undecodable message or rejected Yjs update closes just this socket.
   */
  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.getDoc();
    const decoder = decoding.createDecoder(payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let failed = false;
    try {
      const messageType = syncProtocol.readSyncMessage(decoder, reply, doc, ws, () => {
        // readSyncStep2 swallows apply errors and reports them here.
        failed = true;
      });
      if (messageType === messageYjsSyncStep1 && encoding.length(reply) > 1) {
        this.send(ws, encoding.toUint8Array(reply));
      }
    } catch {
      failed = true;
    }
    if (failed) this.closeUnsupported(ws);
  }

  /**
   * Merge an awareness update into the room's mirror and remember which client ids came
   * from this socket, so its departure can be announced later. The relay to everyone else
   * already happened verbatim; this only maintains the room's own bookkeeping.
   */
  private trackAwareness(ws: WebSocket, payload: Uint8Array): void {
    try {
      applyAwarenessUpdate(this.awareness, payload, ws);
    } catch {
      return; // a bad awareness update is ignored; the doc is untouched
    }
    // A client only ever sends updates about its OWN awareness id, so the present states
    // map to this socket. Re-own on reconnect (same client id, new socket) by moving it off
    // any previous socket, so exactly one socket can announce its loss.
    for (const id of this.presentClients()) {
      const prev = this.awarenessOwner.get(id);
      if (prev === ws) continue;
      if (prev !== undefined) this.socketAwareness.get(prev)?.delete(id);
      this.awarenessOwner.set(id, ws);
      let ids = this.socketAwareness.get(ws);
      if (ids === undefined) {
        ids = new Set<number>();
        this.socketAwareness.set(ws, ids);
      }
      ids.add(id);
    }
  }

  /**
   * The awareness client ids that represent an actual remote editor: every state the
   * mirror holds EXCEPT the room's own awareness-doc id (an `Awareness` always seeds its
   * own document's id, with a null state) and any null (departed) state. Without this
   * filter the room would broadcast its own placeholder id as phantom presence.
   */
  private presentClients(): number[] {
    const self = this.awarenessDoc.clientID;
    const present: number[] = [];
    for (const [id, state] of this.awareness.getStates()) {
      if (id === self || state == null) continue;
      present.push(id);
    }
    return present;
  }

  /** Answer a newcomer's `queryAwareness` with every state the room currently holds. */
  private answerAwarenessQuery(ws: WebSocket): void {
    const ids = this.presentClients();
    if (ids.length === 0) return;
    this.send(ws, frameAwareness(encodeAwarenessUpdate(this.awareness, ids)));
  }

  /** Announce a departed socket's awareness so the remaining editors drop it from their count. */
  private forgetSocket(ws: WebSocket): void {
    this.sockets.delete(ws);
    const ids = this.socketAwareness.get(ws);
    this.socketAwareness.delete(ws);
    if (ids === undefined || ids.size === 0) return;
    const changed = Array.from(ids);
    for (const id of changed) this.awarenessOwner.delete(id);
    removeAwarenessStates(this.awareness, changed, null);
    this.broadcast(frameAwareness(encodeAwarenessUpdate(this.awareness, changed)), ws);
  }

  private send(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      // A dead socket is dropped from the set rather than throwing into the room.
      this.sockets.delete(ws);
    }
  }

  /** Send `bytes` to every open socket, dropping any whose `send` throws. */
  private broadcast(bytes: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.sockets) {
      if (ws === except) continue;
      this.send(ws, bytes);
    }
  }

  /**
   * Relay raw frame bytes to every open socket. `except === null` includes the sender
   * (the awareness relay). Unlike `broadcast`, a send failure removes the socket but
   * never interrupts delivery to the rest.
   */
  private relay(data: ArrayBuffer, except: WebSocket | null): void {
    for (const ws of [...this.sockets]) {
      if (ws === except) continue;
      this.send(ws, new Uint8Array(data));
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // already closing
    }
  }
}
