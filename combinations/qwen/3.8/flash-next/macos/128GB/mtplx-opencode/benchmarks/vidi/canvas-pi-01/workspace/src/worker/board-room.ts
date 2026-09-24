/**
 * Story 3 · the BoardRoom Durable Object (design "BoardRoom Durable Object").
 *
 * One instance per board (the Worker calls `idFromName(boardId)`), holding the
 * board's `Y.Doc` in memory and relaying Yjs sync + awareness frames between
 * every connected socket. It is a pure relay: it never interprets a client's
 * identity or selection, only merges binary document updates.
 *
 * WebSockets are accepted with `server.accept()` (non-hibernating) on purpose:
 * the document lives only in memory until story 4, and hibernation would evict
 * the object while sockets stayed open and silently drop it. An accepted, open
 * socket keeps the instance alive.
 *
 * Merge semantics are Yjs' own, which is the whole point (design "Why these
 * choices"): concurrent text inserts are all kept, concurrent `Y.Map` sets
 * converge to one deterministic value, and deleting a note's `Y.Map` entry
 * discards concurrent edits inside it and cannot be resurrected by them.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  toArrayBuffer,
} from '../shared/protocol';

export class BoardRoom extends DurableObject {
  /** Every open server-side socket on this board. */
  private readonly sockets = new Set<WebSocket>();
  /** The board document, created lazily on the first accepted socket. */
  private ydoc: Y.Doc | null = null;

  private doc(): Y.Doc {
    let doc = this.ydoc;
    if (doc === null) {
      doc = new Y.Doc();
      this.ydoc = doc;
      // Broadcast every document update to everyone except its origin socket,
      // so a sender never sees an echo of its own change (TC-08).
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
    }
    return doc;
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, MESSAGE_SYNC);
    syncProtocol.writeUpdate(message, update);
    const bytes = encoding.toUint8Array(message);
    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(bytes.slice().buffer);
      } catch {
        // A socket that throws on send is dead; drop it from the set (TC-31).
        this.sockets.delete(socket);
      }
    }
  }

  private relayFrame(frame: Uint8Array): void {
    // Awareness frames are relayed verbatim to every open socket, including
    // the sender, so idle y-websocket clients keep receiving traffic and are
    // never dropped by their no-message timeout (design "Awareness relayed").
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(frame.slice().buffer);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Non-hibernating accept (see the file header). `arraybuffer` gives a
    // synchronous, flat message body instead of a Blob.
    server.binaryType = 'arraybuffer';
    server.accept();
    this.sockets.add(server);

    const doc = this.doc();

    // On every (re)connection the room greets the socket with SyncStep1 so a
    // reconnected client can repopulate a restarted room via its SyncStep2
    // (constraint: no notes lost while at least one person keeps the board).
    const greeting = encoding.createEncoder();
    encoding.writeVarUint(greeting, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(greeting, doc);
    try {
      server.send(encoding.toUint8Array(greeting).buffer);
    } catch {
      this.sockets.delete(server);
    }

    server.addEventListener('message', (event: MessageEvent) => {
      const buf = toArrayBuffer(event.data);
      if (buf === null) {
        server.close(CLOSE_UNSUPPORTED_DATA, 'text frame');
        return;
      }
      const decoded = decodeMessage(buf);
      if (decoded.kind === 'invalid') {
        server.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
        return;
      }
      if (decoded.kind === 'awareness') {
        this.relayFrame(decoded.payload);
        return;
      }
      if (decoded.kind === 'query-awareness') {
        return; // no stored awareness in this story
      }

      // A sync frame: hand the body to y-protocols, which applies updates to
      // the doc (origin = this socket, so they are not echoed back) and writes
      // any reply. A decode failure is an unsupported-data error (TC-15).
      const decoder = decoding.createDecoder(decoded.payload);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, doc, server);
      } catch {
        server.close(CLOSE_UNSUPPORTED_DATA, 'undecodable sync');
        return;
      }
      if (encoding.length(encoder) > 1) {
        try {
          server.send(encoding.toUint8Array(encoder).buffer);
        } catch {
          this.sockets.delete(server);
        }
      }
    });

    const forget = (): void => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);

    return new Response(null, { status: 101, webSocket: client });
  }
}