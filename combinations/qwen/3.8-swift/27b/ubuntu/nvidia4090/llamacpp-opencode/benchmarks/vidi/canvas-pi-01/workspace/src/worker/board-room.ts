// BoardRoom Durable Object (see spec: sync.room).
//
// One object per board. It holds the board's Y.Doc in memory (no persistence
// until story 4) and relays y-websocket sync + awareness frames between all
// connected clients.
//
// - Accepted with `server.accept()` (non-hibernating on purpose: hibernation
//   would evict the object while sockets stay open and silently drop the
//   in-memory document; story 4 switches to the hibernation API).
// - On accept: the server sends its own SyncStep1; a (re)connecting client
//   answers with SyncStep2 containing everything the server lacks, which is
//   how a restarted room is repopulated from any live client.
// - Doc updates are broadcast to every other socket (the sender gets no echo);
//   a send that throws drops that socket from the set.
// - Awareness frames are relayed verbatim to ALL sockets including the
//   sender, so idle y-websocket clients keep receiving traffic (their 30 s
//   no-message watchdog would otherwise drop the connection).
// - A string / undecodable / unknown-type frame, or an update Yjs rejects,
//   closes only that socket with CLOSE_UNSUPPORTED_DATA.

// WebSocketPair / WebSocket are workerd globals (typed by
// @cloudflare/workers-types); only DurableObject comes from the module.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

type RoomSocket = WebSocket;
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrameMessage,
} from '../shared/protocol';

export class BoardRoom extends DurableObject<Env> {
  private sockets = new Set<RoomSocket>();
  private doc: Y.Doc | null = null;

  fetch(req: Request): Promise<Response> {
    const headers = new Headers(req.headers);
    if (headers.get('Upgrade') !== 'websocket') {
      return Promise.resolve(new Response('Expected Upgrade: websocket', { status: 426 }));
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    headers.set('Set-Cookie', `yjs-session=${Math.random().toString(36).slice(2)}`);
    this.handleConnection(server);
    return Promise.resolve(
      new Response(null, { status: 101, headers, webSocket: client }),
    );
  }

  /** Lazily create the in-memory doc; the runtime discards it on eviction. */
  private ensureDoc(): Y.Doc {
    if (this.doc === null) {
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
      this.doc = doc;
    }
    return this.doc;
  }

  private handleConnection(server: RoomSocket): void {
    const doc = this.ensureDoc();
    server.accept();
    this.sockets.add(server);
    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data);
    });

    // Send our state vector first (sync step 1). A fresh room sends an empty
    // vector; a repopulated one sends what it already has.
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    this.safeSend(server, encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
  }

  private handleMessage(ws: RoomSocket, data: unknown): void {
    // A text (string) frame, or anything that is not binary, is unsupported
    // data: close only this socket (spec TC-15).
    if (typeof data === 'string' || !(data instanceof ArrayBuffer)) {
      this.closeUnsupportedData(ws);
      return;
    }
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupportedData(ws);
      return;
    }
    const doc = this.ensureDoc();
    if (decoded.kind === 'sync') {
      let rejected = false;
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // y-protocols swallows Yjs update errors unless an errorHandler is
        // given; use it to close the offending socket (spec TC-15).
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws, () => {
          rejected = true;
          this.closeUnsupportedData(ws);
        });
        if (!rejected && encoding.length(encoder) > 0) {
          this.safeSend(ws, encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder)));
        }
      } catch {
        this.closeUnsupportedData(ws);
      }
    } else if (decoded.kind === 'awareness') {
      // Relayed verbatim to every socket including the sender: this is what
      // keeps idle clients alive (see file header).
      const frame = encodeFrameMessage(MESSAGE_AWARENESS, decoded.payload);
      for (const socket of this.sockets) {
        this.safeSend(socket, frame);
      }
    }
    // 'query-awareness' is ignored: this story stores no awareness state.
  }

  /** Close a single socket for unsupported data; others are unaffected. */
  private closeUnsupportedData(ws: RoomSocket): void {
    this.sockets.delete(ws);
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
    } catch {
      // already closed
    }
  }

  /** Send, dropping the socket from the set if the send throws. */
  private safeSend(ws: RoomSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      this.sockets.delete(ws);
    }
  }

  /** Broadcast a doc update to every socket except its origin. */
  private broadcast(update: Uint8Array, except: unknown): void {
    // Wrap as a y-protocols UPDATE sync message (type prefix + update), as
    // y-websocket does; a bare update byte string is not a sync message.
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frame = encodeFrameMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder));
    for (const socket of this.sockets) {
      if (socket === except) continue;
      this.safeSend(socket, frame);
    }
  }
}
