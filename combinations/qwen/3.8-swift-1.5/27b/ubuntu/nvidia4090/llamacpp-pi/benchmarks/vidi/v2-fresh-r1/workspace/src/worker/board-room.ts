// BoardRoom Durable Object (sync.room): one in-memory Y.Doc per board that
// merges and relays Yjs sync + awareness messages between all sockets on the
// board.
//
// Design notes (see spec design.md):
// - Non-hibernating `server.accept()` on purpose: the doc is memory-only until
//   story 4, so hibernation could evict the object while sockets stay open and
//   silently drop the document.
// - On every (re)connection the room sends its own SyncStep1; a reconnecting
//   client answers with SyncStep2 containing everything the room lacks, so a
//   restarted room is repopulated by its first client (no loss while one
//   person keeps the board open).
// - Updates are applied and forwarded immediately (no batching): the sender
//   gets no echo, every other socket gets the same bytes.
// - Awareness is relayed verbatim to ALL sockets including the sender, so
//   idle y-websocket clients keep receiving traffic and their 30 s watchdog
//   does not drop the connection. Awareness is not interpreted (story 6).
// - Malformed traffic (string frame, truncated bytes, unknown type, invalid
//   Yjs update) closes only the offending socket with CLOSE_UNSUPPORTED_DATA.

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { createEncoder, length, toUint8Array, writeVarUint } from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { CLOSE_UNSUPPORTED_DATA, decodeMessage, MESSAGE_SYNC } from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private sockets = new Set<WebSocket>();

  fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating accept: an open, accepted socket keeps this object (and
    // its in-memory doc) alive (see class docs).
    server.accept();
    const socket = server;
    const doc = this.ensureDoc();
    this.sockets.add(socket);

    // Initial SyncStep1 (see class docs for why).
    const step1 = createEncoder();
    writeVarUint(step1, MESSAGE_SYNC);
    writeSyncStep1(step1, doc);
    this.safeSend(socket, toUint8Array(step1));

    socket.addEventListener('message', (event) =>
      this.handleMessage(socket, event.data as ArrayBuffer | string),
    );
    socket.addEventListener('close', () => {
      this.sockets.delete(socket);
    });
    socket.addEventListener('error', () => {
      this.sockets.delete(socket);
    });

    return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
  }

  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) =>
        this.broadcast(update, origin),
      );
    }
    return this.doc;
  }

  private handleMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      socket.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, including the sender.
      for (const s of this.sockets) {
        this.safeSend(s, decoded.payload);
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story: ignore.
      return;
    }

    // kind === 'sync'
    const doc = this.ensureDoc();
    const decoder = createDecoder(decoded.payload);
    // Skip the top-level MESSAGE_SYNC byte (already validated by decodeMessage);
    // readSyncMessage expects the decoder positioned at the sync sub-type.
    readVarUint(decoder);
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    let invalid = false;
    try {
      readSyncMessage(decoder, encoder, doc, socket, () => {
        // y-protocols catches applyUpdate errors and reports them here
        // (truncated payloads and invalid Yjs updates both land here).
        invalid = true;
      });
    } catch {
      invalid = true;
    }
    if (invalid) {
      console.log('ROOM closing socket: invalid sync');
      socket.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (length(encoder) > 1) {
      this.safeSend(socket, toUint8Array(encoder));
    }
  }

  /**
   * Broadcast a document update to every socket except the one it came from
   * (the socket passed as origin when reading the sync message). The sender
   * never receives an echo of its own update.
   */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_SYNC);
    writeUpdate(frame, update);
    const bytes = toUint8Array(frame);
    for (const socket of this.sockets) {
      if (socket === origin) continue;
      this.safeSend(socket, bytes);
    }
  }

  /** Send, dropping the socket from the room if the send throws. */
  private safeSend(socket: WebSocket, data: Uint8Array): void {
    try {
      socket.send(data);
    } catch {
      this.sockets.delete(socket);
    }
  }
}
