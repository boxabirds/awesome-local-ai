import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { snapshot } from '../shared/board-model';
import type { StickySnapshot } from '../shared/board-model';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, decodeMessage } from '../shared/protocol';
import type { Env } from './index';

/**
 * One board, live (anchor `sync.room`).
 *
 * The room holds the board's `Y.Doc` in memory and relays y-websocket frames
 * between the sockets connected to it:
 *
 * - **live.propagate** - an update from one socket is applied and forwarded to
 *   every other socket immediately, with no batching and no timers, and never
 *   echoed to its author.
 * - **live.join_state** - every accepted socket is sent a SyncStep1, and its
 *   own SyncStep1 is answered with a SyncStep2 holding the room's whole
 *   document, so a late joiner sees the current board.
 * - **live.concurrent_text / live.converge** - merging is plain Yjs semantics:
 *   concurrent text inserts are all kept, concurrent `Y.Map` sets resolve to
 *   one deterministic value on every replica.
 * - **live.catch_up** - because the room asks every connection for its state,
 *   edits made while disconnected travel to everyone else on reconnection, and
 *   the room's own SyncStep2 delivers what the reconnecting person missed.
 *
 * WebSockets are accepted with `server.accept()` rather than
 * `ctx.acceptWebSocket()` on purpose: until story 4 the document exists only in
 * memory, and an open socket is what keeps this object (and its document)
 * alive.
 *
 * Awareness bytes are relayed verbatim to *every* socket, including the one that
 * sent them. y-websocket clients renew their awareness periodically and close a
 * connection that has received nothing for a while, so the echo is what keeps
 * an idle board connected. Who is on the board is story 6's business; nothing
 * here interprets awareness.
 */
export class BoardRoom extends DurableObject<Env> {
  /** Created with the first socket; dropped with the instance. */
  private doc: Y.Doc | null = null;
  private readonly sockets = new Set<WebSocket>();
  /** The socket currently being served, i.e. who to not send an echo to. */
  private origin: WebSocket | null = null;
  /** Frames from one socket are handled in the order they arrived. */
  private drained: Promise<void> = Promise.resolve();

  /** Accept the upgrade and start relaying. Plain HTTP is not expected here. */
  fetch(req: Request): Response {
    const upgrade = (req.headers.get('upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const doc = this.ensureDoc();
    this.accept(server, doc);
    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      // Everything applied here goes straight to the other sockets. The socket
      // a change came from is `this.origin`, so it gets no echo (TC-08).
      doc.on('update', (update: Uint8Array) => {
        this.broadcastUpdate(update, this.origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private accept(ws: WebSocket, doc: Y.Doc): void {
    ws.accept();
    this.sockets.add(ws);

    // Ask the newcomer for everything it has that this room lacks. After a
    // restart or eviction, the first socket to reconnect repopulates the room
    // with its own SyncStep2 (sequence "room restart").
    this.send(ws, this.syncStep1(doc));

    ws.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string | Uint8Array | Blob;
      // Chaining keeps frame order even though reading a Blob is asynchronous.
      this.drained = this.drained.then(() => this.serve(ws, data, doc));
    });
    const leave = (): void => {
      this.sockets.delete(ws);
    };
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
  }

  private async serve(ws: WebSocket, data: ArrayBuffer | string | Uint8Array | Blob, doc: Y.Doc) {
    // workerd hands binary frames over as a Blob; text frames stay strings.
    const frame = typeof data === 'string' ? null : await frameBytes(data);
    if (frame === null) {
      this.reject(ws, 'text frames are not supported');
      return;
    }

    const message = decodeMessage(frame);
    if (message.kind === 'invalid') {
      // Only this socket is closed: everyone else keeps working (TC-15).
      this.reject(ws, message.reason);
      return;
    }

    if (message.kind === 'awareness') {
      // Relay the frame exactly as it arrived, to every socket, sender
      // included (TC-16).
      for (const socket of this.sockets) {
        this.send(socket, frame);
      }
      return;
    }

    if (message.kind === 'query-awareness') {
      return; // no awareness state is kept in this story
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let failure: Error | null = null;
    this.origin = ws;
    try {
      syncProtocol.readSyncMessage(decoding.createDecoder(message.payload), encoder, doc, ws, (error: Error) => {
        failure = error;
      });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.origin = null;
    }
    if (failure !== null) {
      // `applyUpdate` rejects bytes that are not a Yjs update, and it parses
      // before it writes, so the room's document is left untouched.
      this.reject(ws, failure.message);
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.send(ws, encoding.toUint8Array(encoder));
    }
  }

  /** SyncStep1: "what do you have?" - the reply carries the missing state. */
  private syncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  private broadcastUpdate(update: Uint8Array, from: WebSocket | null): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.sockets) {
      if (socket !== from) {
        this.send(socket, frame);
      }
    }
  }

  /**
   * Send, and forget the socket if sending fails: a socket that is already gone
   * must not break the room for everyone else (TC-31).
   */
  private send(ws: WebSocket, payload: Uint8Array): void {
    try {
      ws.send(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer);
    } catch {
      this.sockets.delete(ws);
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 100));
    } catch {
      // A socket that cannot be closed is already gone.
    }
  }

  /**
   * The room's own document, for tests (`runInDurableObject`) only. Story 4
   * replaces this with the persisted board.
   */
  inspectDoc(): readonly StickySnapshot[] {
    return this.doc === null ? [] : snapshot(this.doc);
  }
}

/** The frame's bytes, detached from whatever container workerd used. */
async function frameBytes(
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<Uint8Array> {
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy;
  }
  return new Uint8Array(data);
}
