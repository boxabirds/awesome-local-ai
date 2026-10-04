/**
 * BoardRoom: one Durable Object per board. Holds the board's Y.Doc in memory
 * and relays Yjs sync and awareness messages between all connected sockets.
 *
 * - Non-hibernating `server.accept()` is deliberate in this story: the doc is
 *   memory-only until story 4, and an open, accepted socket keeps the object
 *   instance alive (hibernation would evict it and silently drop the doc).
 * - On accept the room sends its SyncStep1; a reconnecting client answers
 *   with a SyncStep2 carrying everything the room lacks, which is how a
 *   restarted room gets repopulated (no notes lost while one tab stays open).
 * - Document updates are broadcast to every other socket (no echo to the
 *   sender); awareness bytes are relayed verbatim to all sockets including
 *   the sender, which keeps idle y-websocket clients from timing out.
 * - Malformed traffic (string frames, truncated bytes, unknown types,
 *   invalid Yjs updates) closes only the offending socket with
 *   CLOSE_UNSUPPORTED_DATA; it never affects other sockets or the doc.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private readonly sockets = new Set<WebSocket>();
  /** Sockets that have already received the room's initial SyncStep1. */
  private readonly greeted = new WeakSet<WebSocket>();

  /** Lazily create the in-memory Y.Doc and register the broadcast listener. */
  private ensureDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcastUpdate(update, origin);
    });
    this.doc = doc;
    return doc;
  }

  async fetch(_req: Request): Promise<Response> {
    const doc = this.ensureDoc();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // `accept()` (non-hibernating, see file header) returns the same object
    // in current typings; the accepted socket is `server` itself.
    server.accept();
    const ws: WebSocket = server;
    this.sockets.add(ws);

    ws.addEventListener('message', (event: MessageEvent) => {
      // Greet the newcomer with the room's SyncStep1 as soon as we know the
      // channel is bidirectional (we just received from it). Frames sent
      // earlier are lost because the 101 handshake is not complete yet. This
      // greeting is what lets a restarted room be repopulated from a
      // returning client's SyncStep2; y-websocket clients always send a
      // SyncStep1 first, so this fires immediately on connect.
      if (!this.greeted.has(ws)) {
        this.greeted.add(ws);
        try {
          const g = this.encodeSyncStep1(doc);
          queueMicrotask(() => {
            try {
              ws.send(g);
            } catch {
              this.sockets.delete(ws);
            }
          });
        } catch (err) {
          console.log('ROOM greeting send threw', String(err));
          // A socket that cannot receive will close; the listeners below
          // remove it from the set.
        }
      }
      this.handleMessage(ws, doc, event.data);
    });
    const removeSocket = () => this.sockets.delete(ws);
    ws.addEventListener('close', () => {
      // workerd fires 'close' while the socket is still CLOSING and does not
      // echo the close frame itself; closing here completes the handshake so
      // the client's 'close' event fires (and the provider can reconnect).
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      removeSocket();
    });
    ws.addEventListener('error', removeSocket);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Handle one wire frame from `ws`. Closes only `ws` on bad data. */
  private handleMessage(ws: WebSocket, doc: Y.Doc, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) return;

    const decoded = decodeMessage(data as ArrayBuffer | string);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }

    switch (decoded.kind) {
      case 'query-awareness':
        // Ignored in this story: awareness is relayed, not stored (story 6).
        return;

      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;

      case 'sync': {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        let bad = false;
        try {
          // `ws` as origin: the resulting doc update is not echoed back.
          // The error handler catches applyUpdate failures (y-protocols
          // swallows them instead of throwing); the outer catch covers
          // decode failures (bad state vectors, unknown submessages).
          syncProtocol.readSyncMessage(decoder, encoder, doc, ws, () => {
            bad = true;
          });
        } catch {
          bad = true;
        }
        if (bad) {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
          return;
        }
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 0) {
          // `encoder` holds the raw sync message (no frame prefix); wrap it
          // in a sync frame before sending. MESSAGE_SYNC is 0 → one byte.
          const frame = new Uint8Array(1 + reply.length);
          frame[0] = MESSAGE_SYNC;
          frame.set(reply, 1);
          try {
            ws.send(frame);
          } catch {
            this.sockets.delete(ws);
          }
        }
        return;
      }
    }
  }

  /**
   * Broadcast a document update to every open socket except `origin`
   * (the socket the update came from gets no echo). A send that throws
   * drops that socket from the set.
   */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    // [MESSAGE_SYNC: varuint][update: ...] — the y-websocket update frame.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const bytes = encoding.toUint8Array(encoder);
    for (const s of [...this.sockets]) {
      if (s === origin) continue;
      if (s.readyState !== WebSocket.OPEN) continue;
      try {
        s.send(bytes);
      } catch {
        this.sockets.delete(s);
      }
    }
  }

  /**
   * Relay awareness bytes verbatim to all open sockets, including the
   * sender. The y-websocket client treats silence as a dead connection, so
   * this periodic traffic keeps idle clients alive (story 6 interprets it).
   */
  private relayAwareness(payload: Uint8Array): void {
    // The payload is already the raw awareness message bytes
    // ([clientID: varuint][state: varuint8array]); the frame is just the
    // type prefix followed by those bytes — no extra length wrapper.
    const typeBytes = encoding.toUint8Array(
      (() => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_AWARENESS);
        return e;
      })()
    );
    const bytes = new Uint8Array(typeBytes.length + payload.length);
    bytes.set(typeBytes, 0);
    bytes.set(payload, typeBytes.length);
    for (const s of [...this.sockets]) {
      if (s.readyState !== WebSocket.OPEN) continue;
      try {
        s.send(bytes);
      } catch {
        this.sockets.delete(s);
      }
    }
  }

  /** Encode the room's current state vector as a SyncStep1 frame. */
  private encodeSyncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    // [MESSAGE_SYNC: varuint][SyncStep1: ...]
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }
}
