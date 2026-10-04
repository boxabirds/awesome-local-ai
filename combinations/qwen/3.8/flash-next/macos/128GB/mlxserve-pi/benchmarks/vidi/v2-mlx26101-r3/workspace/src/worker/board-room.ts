import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './index';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameData,
} from '../shared/protocol';

/** `WebSocket.READY_STATE_OPEN`; written out because the DOM lib calls the same state `OPEN`. */
const SOCKET_OPEN = 1;

/**
 * One live board.
 *
 * The room holds the board's `Y.Doc` in memory and relays y-websocket frames between every
 * socket on the board. It keeps no per-person state, so the cost of a change is one apply
 * plus one send per socket, which is what keeps a change inside
 * LIVE_UPDATE_LATENCY_BUDGET_MS with MAX_CONCURRENT_EDITORS people editing at once.
 *
 * Merge semantics are Yjs's, and they are the product's behaviour: concurrent typing is
 * all kept (live.concurrent_text), concurrent position or colour changes settle to one
 * value on every screen (live.converge), and a delete swallows the edits that happened
 * inside it at the same moment instead of bringing the note back (live.delete_during_edit).
 *
 * The sockets are accepted with the plain, *non-hibernating* API on purpose: the document
 * lives only in memory in this story, and an object that hibernated would evict the object
 * and silently lose the board. An open, accepted socket keeps the object in memory. Story 4
 * moves to hibernation together with storage. That is also why every (re)connection starts
 * with a SyncStep1 from the room: after a restart the first client to reconnect hands the
 * whole document back, so nobody loses notes while at least one person still has the board
 * open.
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's document. Created with the object, discarded when the runtime evicts it. */
  private readonly doc = new Y.Doc();
  /** Every socket currently on the board. */
  private readonly sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // One listener for the whole object: whatever any client applies is forwarded to the
    // other clients of this board only, and never back to where it came from.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcast(updateFrame(update), origin instanceof WebSocket ? origin : null);
    });
  }

  /** WebSocket upgrade only: everything else is a misdirected request. */
  override async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event: MessageEvent) => {
      void this.read(server, event.data as ArrayBuffer | Blob | string);
    });
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });
    // "What do you have?" - a client answers with SyncStep2, which is everything the room
    // is missing: the board for a newcomer, and the whole document for a restarted room.
    this.send(server, syncStep1Frame(this.doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * One received frame, in whatever shape it arrived, from one socket.
   *
   * Reading a frame is the only asynchronous step of handling a message, and it comes before
   * anything is applied, so frames still reach the document in the order they were read.
   */
  private async read(socket: WebSocket, data: ArrayBuffer | Blob | string): Promise<void> {
    this.receive(socket, await frameData(data));
  }

  /** One frame, now known to be bytes or text: text is refused, bytes are decoded. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync':
        this.receiveSync(socket, decoded.payload);
        return;
      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;
      case 'query-awareness':
        // The room keeps no awareness state in this story (presence is story 6), so there
        // is nothing to answer. The client's own state comes back to it as a relay.
        return;
      case 'invalid':
        this.refuse(socket, decoded.reason);
        return;
    }
  }

  /** Read a `y-protocols/sync` message into the board and reply if there is a reply. */
  private receiveSync(socket: WebSocket, payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // `readSyncMessage` catches an update that yjs cannot read, logs it and carries on as if
    // nothing happened. Here that is not a thing to log: an undecodable update belongs to the
    // socket that sent it, so the failure is collected through the handler it is offered.
    let rejected: Error | null = null;
    try {
      // origin = the socket, so the document update listener can skip the sender.
      syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        encoder,
        this.doc,
        socket,
        (error: Error) => {
          rejected = error;
        },
      );
    } catch (error) {
      this.refuse(socket, `yjs rejected the update: ${reason(error)}`);
      return;
    }
    if (rejected !== null) {
      this.refuse(socket, `yjs rejected the update: ${reason(rejected)}`);
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) {
      this.send(socket, reply);
    }
  }

  /**
   * Pass awareness bytes on verbatim, to every socket including the one they came from.
   *
   * Nobody interprets them in this story; they are the idle-connection heartbeat. A
   * y-websocket client drops a connection it has heard nothing on for 30 seconds, and a
   * room that answered its own queries would go quiet between edits.
   */
  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeUint8Array(encoder, payload);
    this.broadcast(encoding.toUint8Array(encoder), null);
  }

  /** Send to every open socket but the origin; a socket that refuses to take it is gone. */
  private broadcast(data: Uint8Array, origin: WebSocket | null): void {
    for (const socket of [...this.sockets]) {
      if (socket !== origin) {
        this.send(socket, data);
      }
    }
  }

  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== SOCKET_OPEN) {
      this.sockets.delete(socket);
      return;
    }
    try {
      socket.send(data);
    } catch {
      // The socket is dead: drop it here rather than let one broken client stop a board.
      this.sockets.delete(socket);
    }
  }

  /** Close the one socket that sent something undecodable; the board carries on. */
  private refuse(socket: WebSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already gone.
    }
  }
}

/** SyncStep1: "tell me what you have". */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A document update, framed the way a y-websocket client reads it. */
function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
