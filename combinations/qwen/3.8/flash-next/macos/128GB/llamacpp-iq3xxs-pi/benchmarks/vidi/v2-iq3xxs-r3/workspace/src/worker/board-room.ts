/**
 * BoardRoom: the live room of one board (sync.room).
 *
 * One instance per board id (see `idFromName` in `index.ts`), holding the
 * board's `Y.Doc` in memory and relaying y-websocket frames between every
 * socket connected to it:
 *
 * - Sync frames are applied to the document with the sending socket as the
 *   Yjs transaction origin, so the resulting `update` event is broadcast to
 *   every *other* socket and never echoed back.
 * - Awareness frames are relayed verbatim to every socket, sender included.
 *   That relay is what keeps idle clients alive: each client renews its own
 *   awareness every few seconds, and the copy coming back counts as traffic
 *   from the server, so nobody times out (story 6 interprets the content).
 * - A frame that cannot be decoded, or a Yjs update that cannot be applied,
 *   closes only the socket that sent it.
 *
 * WebSockets are accepted with the plain (non-hibernating) `accept()` on
 * purpose: the document lives only in memory until story 4, and hibernation
 * would evict the object — and with it the document — while sockets stay open.
 * An open accepted socket keeps this object alive.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { createDecoder } from 'lib0/decoding';
import {
  createEncoder,
  length as encodedLength,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { messageYjsUpdate, readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';

import { initDoc } from '../shared/board-model';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';

import type { Env } from './index';

/** One whole message (type varUint + body), as it goes over a socket. */
type Frame = Uint8Array;

/** A sync frame carrying one document update, exactly as the client writes it. */
function updateFrame(update: Frame): Frame {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeVarUint(encoder, messageYjsUpdate);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

/**
 * Incoming frame data as `decodeMessage` wants it. workerd delivers the payload
 * of a binary websocket frame as a `Blob` (in the Durable Object and on the
 * caller side of a `fetch()` upgrade alike), but an `ArrayBuffer` is allowed by
 * the type of the event, so all of them are accepted here and nothing is
 * invented: data that is not there at all becomes an empty frame, which
 * `decodeMessage` reports as invalid.
 */
async function toFrameData(data: unknown): Promise<ArrayBuffer | string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }
  if (data instanceof Blob) return data.arrayBuffer();
  return new ArrayBuffer(0);
}

/**
 * The frame as it arrived, type byte included — awareness is relayed with
 * exactly these bytes, because its body is already length-prefixed inside the
 * frame and re-wrapping it would corrupt it.
 */
function frameBytes(frameData: ArrayBuffer | string): Frame {
  return typeof frameData === 'string'
    ? new TextEncoder().encode(frameData) // text frames never get this far
    : new Uint8Array(frameData);
}

export class BoardRoom extends DurableObject<Env> {
  /** Every open socket of this board, including the one just accepted. */
  readonly #sockets = new Set<WebSocket>();

  /**
   * The board's document, created with the first socket and dropped by the
   * runtime when this instance is evicted — nothing is persisted before
   * story 4, which is why a room may legitimately come back empty.
   */
  #doc: Y.Doc | undefined;

  /** Websocket upgrade only; every other request to the object is refused. */
  override async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    // `pair` is a two-ended pipe: `client` is handed to the caller on the
    // response, `server` is the room's own end, which is the one that gets
    // accepted (a socket already accepted cannot be put on a response).
    // Accepted without hibernation options on purpose — see the note at the
    // top of the file.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.#join(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Put one socket in the room and start it talking. */
  #join(socket: WebSocket): void {
    const doc = this.#document();
    this.#sockets.add(socket);
    // Frames of one socket are handled one after another (`#pending`), because
    // reading the payload out of a Blob is asynchronous and two frames must not
    // race each other through the document.
    let pending: Promise<void> = Promise.resolve();
    socket.addEventListener('message', (event) => {
      pending = pending
        .then(() => this.#receive(socket, event.data))
        .catch(() => {
          // A frame that breaks the relay is a bug, not a reason to stop
          // listening: drop that socket, keep the queue alive for the rest.
          this.#closeUnsupported(socket, 'internal relay error');
        });
    });
    socket.addEventListener('close', () => {
      this.#sockets.delete(socket);
    });
    socket.addEventListener('error', () => {
      this.#sockets.delete(socket);
    });

    // Ask the newcomer for everything it has (SyncStep1). This is how the
    // first client back fills a room that started empty after a deploy or an
    // eviction — and why a client that reconnects to a restarted room
    // repopulates it instead of showing a blank page.
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    this.#send(socket, toUint8Array(encoder));
  }

  /** The room's document, subscribed to the broadcast on first use. */
  #document(): Y.Doc {
    const existing = this.#doc;
    if (existing !== undefined) return existing;
    const doc = new Y.Doc();
    initDoc(doc);
    doc.on('update', (update: Frame, origin: unknown) => {
      // One apply, one send per other socket — no batching, no timers, so a
      // change is on its way to every other screen immediately (live.propagate).
      const frame = updateFrame(update);
      for (const socket of this.#sockets) {
        if (socket === origin) continue; // the sender already has it (TC-08)
        this.#send(socket, frame);
      }
    });
    this.#doc = doc;
    return doc;
  }

  /** One incoming frame: relay it, or close the socket that sent it. */
  async #receive(socket: WebSocket, data: unknown): Promise<void> {
    const frameData = await toFrameData(data);
    const decoded = decodeMessage(frameData);
    if (decoded.kind === 'invalid') {
      this.#closeUnsupported(socket, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') return; // nothing stored to answer with
    if (decoded.kind === 'awareness') {
      // Verbatim to everyone including the sender (idle keep-alive).
      const frame = frameBytes(frameData);
      for (const other of this.#sockets) this.#send(other, frame);
      return;
    }
    const doc = this.#document();
    const reply = createEncoder();
    writeVarUint(reply, MESSAGE_SYNC);
    try {
      // Passing `socket` as the Yjs transaction origin is what lets the update
      // listener — and so every other client — know who to leave out.
      //
      // y-protocols swallows an update it cannot apply (it logs and carries on),
      // so its error handler has to object: a corrupt update costs its sender the
      // connection exactly like a frame that does not decode at all.
      readSyncMessage(createDecoder(decoded.payload), reply, doc, socket, (error) => {
        throw error;
      });
    } catch {
      // Yjs refused the update: malformed traffic, and a reason to drop this
      // one socket, never a reason to disturb anybody else on the board.
      this.#closeUnsupported(socket, 'invalid yjs sync message');
      return;
    }
    // SyncStep1 answers (and nothing else) produce a reply, sent to the
    // requester alone — an echo of a client's own update would be wasted bytes.
    if (encodedLength(reply) > 1) this.#send(socket, toUint8Array(reply));
  }

  /** Send, dropping any socket whose send throws (TC-31). */
  #send(socket: WebSocket, frame: Frame): void {
    try {
      socket.send(frame);
    } catch {
      // A socket whose send throws is half gone already: drop it from the room
      // so no later broadcast is disturbed by it (TC-31).
      this.#sockets.delete(socket);
    }
  }

  /** Close one socket, leaving the rest of the room untouched. */
  #closeUnsupported(socket: WebSocket, reason: string): void {
    this.#sockets.delete(socket);
    try {
      socket.close(CLOSE_UNSUPPORTED_DATA, reason);
    } catch {
      // Already gone: nothing left to close.
    }
  }
}
