// BoardRoom: one Durable Object per board id, with the board stored in the
// object's own SQLite database.
//
// The room holds the board's `Y.Doc` in memory and relays Yjs sync and awareness
// messages between every WebSocket connected to the board. All merging is Yjs
// CRDT semantics: concurrent text inserts are all kept, concurrent writes to the
// same field resolve to one deterministic winner on every replica, and a deleted
// note cannot be resurrected by edits made inside it at the same moment.
//
// Story 4 adds persistence (persist.room):
//  - On construct or wake the document is reloaded from SQLite inside
//    `ctx.blockConcurrencyWhile`, so an event is never handled against a half
//    loaded board.
//  - Every update is written to storage *before* it is broadcast (the SQL API is
//    synchronous; the platform's output gate additionally holds outbound frames
//    until the write is durable), so a change another client can see is never the
//    only copy of it.
//  - Sockets are accepted with the *hibernation* API (`ctx.acceptWebSocket`), so
//    an idle board costs no compute; `ctx.getWebSockets()` is the source of truth
//    for who is connected and survives eviction.
//  - A board that cannot be loaded refuses clients with CLOSE_BOARD_LOAD_FAILED
//    rather than serving an empty doc; a change that cannot be saved closes every
//    socket with CLOSE_STORAGE_FAILURE and discards the doc so the next connection
//    reloads from what is actually on disk.

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import * as Yjs from 'yjs';
import { LOAD_ORIGIN, BoardStore, type LoadResult } from './board-store';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import type { RoomState } from './room-state';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';

/** Frame a raw Yjs update as a y-websocket sync message. */
function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** SyncStep1 (``what do you have?``) for `doc`, ready to send. */
function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  /**
   * The board's storage. Exposed (not `private`) only so integration tests can
   * inject failures on `append` / `load` at the seam the design calls for; nothing
   * outside the object uses it.
   */
  readonly store: BoardStore;

  /** The board's document, or null while loading or after a storage reset. */
  private roomDoc: Y.Doc | null = null;

  /** Lifecycle state the room holds between events (see room-state.ts). */
  private state: RoomState = 'ready';

  /** When the room entered `load-failed`, to throttle reload attempts. */
  private loadFailedAt = 0;

  /**
   * Test-only: the snapshot chunk 0 as it was before a test corrupted it, so the
   * repair route can put it back. Only ever set by the `/__test` routes, which
   * exist only when `env.TEST_HOOKS === '1'` (never in production). See TC-24.
   */
  private testSavedChunk0: Uint8Array | null = null;

  constructor(ctx: DurableObjectState<`${string}`>, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // The document is reloaded before the object handles any event, so no client
    // ever sees a board that is only partly back.
    ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  /**
   * Build a document whose update listener stores then broadcasts every change.
   * The listener is attached before the document is ever loaded into, so load
   * replay is caught by the `LOAD_ORIGIN` guard and neither re-stored nor echoed.
   */
  private createDoc(): Y.Doc {
    const doc = new Yjs.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // A change is durable before anyone else can see it: store first, and if
      // storing fails, do not broadcast at all (persist.save_failure).
      if (origin === LOAD_ORIGIN) return; // replayed from storage on load
      try {
        this.store.append(update);
      } catch (error) {
        this.resetAfterStorageFailure(error);
        return; // the update is *not* broadcast, so nobody sees an unsaved change
      }
      // Durable now, so broadcast it to everyone but the sender, then keep the log
      // bounded (compaction is a no-op below threshold and never throws).
      this.broadcast(
        updateFrame(update),
        origin instanceof WebSocket ? origin : null,
      );
      this.store.compactIfNeeded(doc);
    });
    return doc;
  }

  /**
   * Read the board from storage into a fresh document. On success the room becomes
   * `ready`; a `snapshot-unreadable` or `sql-error` result puts it in
   * `load-failed` and discards the document so it never serves an empty board.
   */
  private async loadDoc(): Promise<void> {
    this.store.migrate();
    const doc = this.createDoc();
    const result: LoadResult = this.store.load(doc);
    if (result.ok) {
      this.roomDoc = doc;
      this.state = 'ready';
    } else {
      this.roomDoc = null; // refuse to present an empty or half-loaded board
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      console.error(
        JSON.stringify({ event: 'board-load-failed', reason: result.reason }),
      );
    }
  }

  /** Lifecycle state, read through a method so TypeScript control-flow analysis
   * does not assume `loadDoc()` (which mutates it) left it unchanged. */
  currentState(): RoomState {
    return this.state;
  }

  /** A change could not be saved: discard the doc, close every socket (1011). */
  private resetAfterStorageFailure(error: unknown): void {
    this.roomDoc = null;
    this.state = 'storage-failed';
    console.error(
      JSON.stringify({ event: 'board-storage-failed', error: String(error) }),
    );
    for (const ws of this.ctx.getWebSockets()) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'could not save the board');
    }
  }

  /**
   * Accept a WebSocket for this board and start the initial sync handshake. A
   * room that could not load refuses the connection with CLOSE_BOARD_LOAD_FAILED,
   * retrying the load only once LOAD_RETRY_MIN_INTERVAL_MS has passed.
   */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    // Test-only board surgery (corrupt / repair the stored snapshot), used by the
    // e2e "broken board" story. Gated on an env var that is set only in the e2e
    // wrangler session, never in production, so this branch is dead in a deploy.
    if (this.env.TEST_HOOKS === '1' && path.startsWith('/__test/')) {
      return this.handleTestRoute(path);
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.trim().toLowerCase() !== 'websocket') {
      return new Response('Upgrade: websocket required', { status: 426 });
    }

    if (this.state === 'load-failed') {
      if (Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        await this.loadDoc(); // give the board another chance
      }
      if (this.currentState() === 'load-failed') {
        // Accept then immediately close, so the client sees the dedicated code.
        const refused = new WebSocketPair();
        refused[1].accept();
        refused[1].close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
        return new Response(null, { status: 101, webSocket: refused[0] });
      }
    } else if (this.state === 'storage-failed') {
      // The previous change could not be saved; reload what *is* on disk so the
      // reconnecting clients' SyncStep2 can re-send and re-save their changes.
      await this.loadDoc();
      if (this.currentState() === 'load-failed') {
        const refused = new WebSocketPair();
        refused[1].accept();
        refused[1].close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
        return new Response(null, { status: 101, webSocket: refused[0] });
      }
    }

    // The room is `ready` (or just recovered): accept with the hibernation API so
    // the object can go idle while this socket stays attached.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    // Ask the newcomer for its state vector. It answers with a SyncStep2 holding
    // everything the room lacks — how the board is re-populated and, after a
    // storage failure, how unsaved changes are re-sent.
    this.sendTo(server, syncStep1Frame(this.roomDoc!));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Handle one frame from a socket (called by the runtime, even after wake). */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // A socket that was still open across a failure is refused by state, so an
    // unreadable board never stores anything and a failed save never half-applies.
    if (this.state === 'load-failed') {
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.state === 'storage-failed' || this.roomDoc === null) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'could not save the board');
      return;
    }

    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync': {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        // The reply envelope starts with the outer message type, exactly like
        // y-websocket's handler, and only carries a body when the room has one.
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          // Origin is the socket, so the update listener stores it and skips the
          // sender when broadcasting. The error handler rethrows, turning a Yjs
          // failure (a corrupt update) into a close of this socket only, stored
          // nothing (persist: rejected garbage is never written).
          syncProtocol.readSyncMessage(
            decoder,
            encoder,
            this.roomDoc,
            ws,
            (error: Error) => {
              throw error;
            },
          );
        } catch {
          this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'invalid Yjs sync message');
          return;
        }
        // The reply (SyncStep2 in answer to a SyncStep1) goes back to the asker.
        if (encoding.length(encoder) > 1) this.sendTo(ws, encoding.toUint8Array(encoder));
        return;
      }
      case 'awareness': {
        // Relay verbatim to every socket *including* the sender and keep no
        // awareness state: interpreting it (who is here, cleanup on leave) is
        // story 6. Echoing is also what keeps idle clients alive, and these relays
        // are what keep a connected-but-idle board from being a problem under
        // hibernation (each relay wakes the object, which stays loaded while open).
        const bytes =
          typeof message === 'string'
            ? new TextEncoder().encode(message)
            : new Uint8Array(message);
        this.broadcast(bytes, null);
        return;
      }
      case 'query-awareness':
        // Nothing to answer with while awareness is not stored.
        return;
      case 'invalid':
        this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, decoded.reason);
        return;
    }
  }

  /**
   * A socket closed. There is no per-socket state to clean up, and the board stays
   * in memory (and on disk) whether or not anyone is watching; we still finish the
   * close handshake from our side so a peer that dropped does not hang waiting for
   * our close frame (the same courtesy story 3's socket listener provided).
   */
  webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }

  /** A socket errored; finish its handshake exactly like a close. */
  webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * Send to every connected socket except `except` (pass null for all of them),
   * iterating `ctx.getWebSockets()` so the set survives hibernation. A socket
   * whose `send` throws is dropped by the runtime; guard so one broken client can
   * neither stall nor crash the room.
   */
  private broadcast(bytes: Uint8Array | ArrayBuffer, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(bytes);
      } catch {
        // The runtime removes the broken socket on its own.
      }
    }
  }

  /** Send to one socket, ignoring a socket that is already gone. */
  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      // The socket is already gone.
    }
  }

  /** Close one socket with a code, ignoring one that is already closed. */
  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closing or closed.
    }
  }

  /**
   * Test-only board surgery for the e2e "broken board" flow (TC-24). Reached only
   * via the top-level `/__test/boards/:id/...` route, which itself only exists
   * when `env.TEST_HOOKS === '1'`. Both routes act on the *stored* board, then put
   * the room in the state a real load of that storage would produce, so a waiting
   * client sees exactly what a fresh reopen would.
   */
  private handleTestRoute(path: string): Response {
    if (path === '/__test/corrupt-snapshot') {
      // Ensure there is a snapshot to corrupt (the e2e board is small, below the
      // automatic compaction threshold), exactly as a real compaction would write
      // one — same chunks, same log truncation, same `snapshot_through_seq`.
      if (this.roomDoc === null) {
        return new Response(JSON.stringify({ ok: false, error: 'no board loaded' }), {
          status: 409,
        });
      }
      // Only corrupt a board nobody is looking at: a live client's in-memory copy
      // would not reflect the on-disk corruption, so the test must disconnect first
      // (the "reopen in a fresh context" flow). Keeps the assertion honest.
      if (this.ctx.getWebSockets().length > 0) {
        return new Response(
          JSON.stringify({ ok: false, error: 'clients still connected; close them first' }),
          { status: 409 },
        );
      }
      this.store.compactIfNeeded(this.roomDoc, true);

      const row = this.sql1('SELECT data FROM snapshot_chunks WHERE idx = 0');
      if (row === null) {
        return new Response(JSON.stringify({ ok: false, error: 'no snapshot chunk 0' }), {
          status: 409,
        });
      }
      const original = new Uint8Array(row as ArrayBuffer);
      this.testSavedChunk0 = original;
      // Overwrite chunk 0 with the same byte pattern the store's own load-failure
      // fixtures use (all 0xff): applying it throws "Integer out of Range" rather
      // than applying to nothing, so a reopen is a genuine `snapshot-unreadable`.
      const garbage = new Uint8Array(original.length).fill(0xff);
      this.sqlRun('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);

      // Present the corruption now: discard the in-memory board and enter
      // `load-failed`, and close anyone connected, so the board is neither served
      // from memory nor silently edited.
      this.roomDoc = null;
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      for (const ws of this.ctx.getWebSockets()) {
        this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      }
      return new Response(JSON.stringify({ ok: true, corruptedBytes: original.length }), {
        status: 200,
      });
    }

    if (path === '/__test/repair') {
      if (this.testSavedChunk0 === null) {
        return new Response(JSON.stringify({ ok: false, error: 'nothing to repair' }), {
          status: 409,
        });
      }
      this.sqlRun('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', this.testSavedChunk0);
      this.testSavedChunk0 = null;
      // Do NOT touch the room state or the retry clock: the board reappears only
      // when a client reconnects after LOAD_RETRY_MIN_INTERVAL_MS and the room
      // re-reads the now-repaired storage — the honest, no-reload recovery path.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: false, error: 'unknown test route' }), {
      status: 404,
    });
  }

  /** Run a SELECT and return the first column of the first row, or null. */
  private sql1(sql: string, ...params: unknown[]): unknown {
    const rows = this.ctx.storage.sql.exec(sql, ...params).toArray();
    const first = rows[0] as Record<string, unknown> | undefined;
    return first === undefined ? null : Object.values(first)[0];
  }

  /** Run a write statement. */
  private sqlRun(sql: string, ...params: unknown[]): void {
    this.ctx.storage.sql.exec(sql, ...params);
  }
}
