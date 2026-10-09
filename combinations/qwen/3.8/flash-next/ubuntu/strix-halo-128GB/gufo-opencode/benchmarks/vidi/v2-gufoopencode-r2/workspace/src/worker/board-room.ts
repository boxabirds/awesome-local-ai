// One BoardRoom per board. Holds the board's Y.Doc in memory, persists
// every update to SQLite-backed Durable Object storage before broadcasting
// it, and reloads the board when the object wakes (story 4). Sockets use
// the hibernation API so idle boards cost no compute: after eviction the
// runtime reconstructs this object (constructor reloads the doc from
// storage) and delivers queued messages via the class handlers.
//
// Lifecycle (see room-state.ts): loading -> ready -> ... ; a snapshot that
// cannot be decoded puts the room in load-failed (clients get close code
// CLOSE_BOARD_LOAD_FAILED and must not edit); a storage write failure puts
// it in storage-failed (all sockets closed with CLOSE_STORAGE_FAILURE, doc
// discarded, next connection reloads).

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState, type RoomEvent, type RoomState } from './room-state';
import type { Env } from './index';

const HIBERNATION_TAGS = ['vidi6-board'] as const;

export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore;
  private docInstance: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.ctx.blockConcurrencyWhile(async () => {
      await this.loadBoard();
    });
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  // migrate + load on every construction (wake). A result that is not ok
  // means the snapshot or the storage itself is unreadable: the room enters
  // load-failed and every connection is refused with 4500 until a retry
  // succeeds.
  private loadBoard(): void {
    if (this.state === 'storage-failed') this.transition('next-connection');
    else if (this.state === 'load-failed') this.transition('retry-allowed');
    else this.state = 'loading';
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.handleDocUpdate(doc, update, origin);
    });
    this.docInstance = doc;
    try {
      this.store.migrate();
      const result = this.store.load(doc);
      if (result.ok) {
        this.transition('load-ok');
      } else {
        this.transition('load-failed');
        this.loadFailedAt = Date.now();
        console.error(
          JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }),
        );
      }
    } catch (error) {
      // migrate/load already traps SQL errors; belt and braces so a hard
      // failure can never leave the room in 'loading' forever.
      this.transition('load-failed');
      this.loadFailedAt = Date.now();
      console.error(
        JSON.stringify({
          event: 'board-load-failed',
          reason: 'sql-error',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  // WebSocket upgrade only; the Worker has already validated the board id.
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/__test/')) {
      return this.handleTestHook(req);
    }
    const upgrade = req.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    if (this.state === 'load-failed') {
      if (Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        this.loadBoard();
      }
    } else if (this.state === 'storage-failed') {
      this.loadBoard();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [...HIBERNATION_TAGS]);

    if (this.state === 'load-failed') {
      // Accepted so the client can observe the close code, then refused.
      server.close(CLOSE_BOARD_LOAD_FAILED);
      return new Response(null, { status: 101, webSocket: client });
    }

    // SyncStep1 from the room: every (re)connecting client answers with a
    // SyncStep2 holding everything the room lacks, which repopulates the
    // document after a storage-failed reset.
    const doc = this.doc;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    this.sendTo(server, encoding.toUint8Array(enc));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    const message = decodeMessage(data);
    switch (message.kind) {
      case 'sync': {
        // Frame layout matches y-websocket: the reply starts with the sync
        // message type byte and readSyncMessage appends its answer.
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_SYNC);
        try {
          syncProtocol.readSyncMessage(
            decoding.createDecoder(message.payload),
            frame,
            this.doc,
            ws,
            // y-protocols swallows update-application errors otherwise;
            // rethrow so the catch below closes the offending socket.
            (error) => {
              throw error;
            },
          );
        } catch {
          // Undecodable or rejected update: close only this socket (TC-15)
          // and never store anything for it.
          try {
            ws.close(CLOSE_UNSUPPORTED_DATA);
          } catch {
            // Already closing/closed.
          }
          return;
        }
        if (encoding.length(frame) > 1) {
          this.sendTo(ws, encoding.toUint8Array(frame));
        }
        return;
      }
      case 'awareness': {
        // Relayed verbatim (original bytes) to all open sockets including
        // the sender, so idle y-websocket clients keep receiving traffic.
        const bytes = new Uint8Array(data as ArrayBuffer);
        for (const socket of this.ctx.getWebSockets(HIBERNATION_TAGS[0])) {
          this.sendTo(socket, bytes);
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: the room keeps no awareness state.
        return;
      case 'invalid':
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        } catch {
          // Already closing/closed.
        }
        return;
    }
  }

  webSocketClose(): void {
    // Hibernated sockets are managed by the runtime; nothing to clean up.
  }

  webSocketError(): void {
    // Same: getWebSockets() no longer lists errored sockets.
  }

  private get doc(): Y.Doc {
    // After a storage failure the doc is discarded; webSocketMessage's
    // state checks prevent reaching this getter in that state.
    if (this.docInstance === null) {
      throw new Error('board room has no document');
    }
    return this.docInstance;
  }

  // The single write path: updates applied to the doc (origin = sender
  // socket) are stored BEFORE any broadcast, so a client only ever observes
  // an update that is already durable (persist.automatic, TC-12).
  private handleDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return; // replayed on load: neither stored nor broadcast
    if (this.state !== 'ready') return; // storage-failed room must not keep writing
    try {
      this.store.append(update);
    } catch (error) {
      this.transition('append-failed');
      console.error(
        JSON.stringify({ event: 'board-storage-failed', error: error instanceof Error ? error.message : String(error) }),
      );
      // Close every client with 1011 and drop the doc: clients hold the
      // change locally and re-send it via SyncStep2 on reconnect, after
      // this.fetch reloads the room.
      for (const socket of this.ctx.getWebSockets(HIBERNATION_TAGS[0])) {
        try {
          socket.close(CLOSE_STORAGE_FAILURE);
        } catch {
          // Already closing/closed.
        }
      }
      this.docInstance = null;
      return;
    }
    this.transition('update');
    this.broadcast(update, origin instanceof WebSocket ? origin : null);
    this.store.compactIfNeeded(doc);
  }

  private broadcast(update: Uint8Array, except: WebSocket | null): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, 2);
    encoding.writeVarUint8Array(frame, update);
    const bytes = encoding.toUint8Array(frame);
    for (const socket of this.ctx.getWebSockets(HIBERNATION_TAGS[0])) {
      if (socket !== except) this.sendTo(socket, bytes);
    }
  }

  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    // Hibernated sockets report CONNECTING/OPEN; only OPEN sends are
    // guaranteed, so hibernated sockets would throw here. Story 3's
    // keepalive pattern means sockets in use are open; hibernated ones are
    // woken by their own traffic before any broadcast is needed.
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(bytes);
      } catch {
        // Dead socket: the runtime drops it from getWebSockets().
      }
    }
  }

  // ---- Test-only hooks (env.TEST_HOOKS === '1', never set in production) ----

  private async handleTestHook(req: Request): Promise<Response> {
    if (this.env.TEST_HOOKS !== '1') {
      return new Response('Not found', { status: 404 });
    }
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    if (path === '/__test/corrupt-snapshot') {
      return this.corruptSnapshot();
    }
    if (path === '/__test/repair-snapshot') {
      return this.repairSnapshot();
    }
    return new Response('Not found', { status: 404 });
  }

  // Snapshots the current doc (if the log has grown enough) and destroys
  // the first snapshot chunk, then reloads so the room observes the damage
  // exactly as it would after a restart with a broken snapshot.
  private corruptSnapshot(): Response {
    const doc = this.docInstance;
    if (doc !== null) {
      this.store.compact(doc);
    }
    const rows = this.ctx.storage.sql
      .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
      .toArray();
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: 'no snapshot' }), { status: 409 });
    }
    const good = new Uint8Array(rows[0].data as ArrayBuffer);
    void this.ctx.storage.put('__test_backup_chunk0', good);
    const broken = new Uint8Array(good.byteLength).fill(0xff);
    this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', broken);
    this.docInstance = null;
    this.state = 'ready'; // force a fresh reload attempt
    this.loadBoard();
    return new Response(
      JSON.stringify({ ok: true, state: this.state }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  private async repairSnapshot(): Promise<Response> {
    const stored = (await this.ctx.storage.get('__test_backup_chunk0')) as
      | ArrayBuffer
      | Uint8Array
      | null;
    if (stored === null) {
      return new Response(JSON.stringify({ ok: false, reason: 'no backup' }), { status: 409 });
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?) ON CONFLICT(idx) DO UPDATE SET data = excluded.data',
      new Uint8Array(stored),
    );
    await this.ctx.storage.delete('__test_backup_chunk0');
    this.docInstance = null;
    this.state = 'ready';
    this.loadBoard();
    return new Response(
      JSON.stringify({ ok: true, state: this.state }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
}
