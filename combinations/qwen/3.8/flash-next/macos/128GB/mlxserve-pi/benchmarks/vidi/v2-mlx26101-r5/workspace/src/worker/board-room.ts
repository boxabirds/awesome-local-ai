/**
 * One board's room: a Durable Object that holds the board's `Y.Doc` in memory and
 * relays `y-websocket` traffic between everybody connected to this board.
 *
 * Isolation comes from the binding: `env.BOARD_ROOM.idFromName(boardId)` sends all
 * of a board's connections to this one object, and this object only ever talks to
 * its own sockets — so a change made on one board can never appear on another.
 *
 * The sockets are *non-hibernating* (`server.accept()`, and the sockets are kept in
 * a set): the document exists only in memory until story 4 can reload it from
 * storage, and hibernation would evict the object while sockets stay open and
 * silently drop the document.
 *
 * Restart safety without storage: every socket is sent a SyncStep1 as soon as it is
 * accepted, so the first client to come back after a restart answers with a
 * SyncStep2 that repopulates the room, and the room then hands that state to
 * everybody else.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  encodeAwarenessMessage,
  encodeUpdateFrame,
} from '../shared/protocol';
import type { Env } from './index';

/** Longest close reason the WebSocket protocol allows. */
const MAX_CLOSE_REASON_BYTES = 123;

/** A frame that asks a client for everything the room is missing. */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A close reason is a short diagnostic string, never the payload. */
function closeReason(reason: string): string {
  return reason.length <= MAX_CLOSE_REASON_BYTES ? reason : reason.slice(0, MAX_CLOSE_REASON_BYTES);
}

/**
 * A frame as the runtime delivered it. With `binaryType = 'arraybuffer'` a binary
 * frame is an `ArrayBuffer`; a text frame is passed through so `decodeMessage` can
 * reject it as the malformed input it is. A Blob (the default `binaryType` in the
 * runtime) or a view is normalised to a copy of its bytes.
 */
function frameData(data: unknown): ArrayBuffer | string | Promise<ArrayBuffer> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new ArrayBuffer(data.byteLength);
    new Uint8Array(copy).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy;
  }
  if (data instanceof Blob) return data.arrayBuffer();
  return new ArrayBuffer(0);
}

/**
 * The room behind `/api/rooms/:boardId`: WebSocket upgrades only. Everything it
 * applies to its `Y.Doc` is forwarded to every other socket immediately, so a
 * change appears on every other screen within `LIVE_UPDATE_LATENCY_BUDGET_MS`.
 */
export class BoardRoom extends DurableObject<Env> {
  /** This board's document. In memory only in this story (story 4 persists it). */
  private readonly doc = new Y.Doc();

  /** Every socket currently on this board. Nobody is ever counted or refused. */
  private readonly sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // One Yjs transaction is one message: the sender gets no echo, everybody else
    // gets the same bytes, with no batching and no timers in between.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const frame = encodeUpdateFrame(update);
      for (const socket of this.sockets) {
        if (socket === origin) continue;
        this.send(socket, frame);
      }
    });
  }

  /** Accepts a WebSocket upgrade; anything else is a 426. */
  override fetch(request: Request): Response {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { 'x-vidi6-error': 'upgrade_required' },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Read binary frames as ArrayBuffers rather than as Blobs (the runtime default),
    // so a frame can be decoded the moment it arrives.
    server.binaryType = 'arraybuffer';
    // Non-hibernating accept: this object stays alive while the socket is open.
    server.accept();
    this.sockets.add(server);
    server.addEventListener('message', (event) => {
      this.onMessage(server, event.data).catch(() => this.sockets.delete(server));
    });
    server.addEventListener('close', () => this.sockets.delete(server));
    server.addEventListener('error', () => this.sockets.delete(server));

    // Ask the newcomer for its state. On a fresh or restarted (empty) room this is
    // what repopulates the document from the first client back.
    this.send(server, syncStep1Frame(this.doc));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Handles one frame from one socket. */
  private async onMessage(socket: WebSocket, data: unknown): Promise<void> {
    if (!this.sockets.has(socket)) return; // already closed: ignore

    const decoded = decodeMessage(await frameData(data));
    if (decoded.kind === 'invalid') {
      this.reject(socket, decoded.reason);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relayed verbatim to everybody, sender included: an idle client renews its
      // awareness clock every 15 seconds, and that traffic is what keeps the
      // provider from deciding the connection is dead. Interpreting it is story 6.
      const frame = encodeAwarenessMessage(decoded.payload);
      for (const other of this.sockets) this.send(other, frame);
      return;
    }

    if (decoded.kind === 'query-awareness') return; // no awareness state is kept yet

    // A sync message: SyncStep1 is answered with SyncStep2 (the whole document for a
    // newcomer), SyncStep2 and single updates are applied to the room doc — which is
    // what broadcasts them — and any update Yjs rejects closes just this socket.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.doc,
        socket,
        (error: unknown) => {
          throw error; // y-protocols would swallow it; an invalid update is malformed traffic
        },
      );
    } catch {
      this.reject(socket, 'undecodable sync message');
      return;
    }

    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1) this.send(socket, reply); // longer than the type byte = there is a reply
  }

  /** Sends bytes; a socket that cannot be written to is dropped from the room. */
  private send(socket: WebSocket, bytes: Uint8Array): void {
    if (!this.sockets.has(socket)) return;
    try {
      socket.send(bytes);
    } catch {
      // The peer is gone (its socket was closed abruptly). Forget it and carry on:
      // one dead socket must not stop the board for anybody else.
      this.sockets.delete(socket);
    }
  }

  /** Closes one socket for sending something undecodable, leaving the rest alone. */
  private reject(socket: WebSocket, reason: string): void {
    this.sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, closeReason(reason));
    } catch {
      // already closed
    }
  }
}
