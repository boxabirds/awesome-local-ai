/**
 * BoardRoom: one Durable Object per board. Story 4 makes it persistent:
 *
 * - the constructor loads the board from SQLite-backed Durable Object
 *   storage (snapshot chunks + update log) while blocking concurrency, so
 *   no message can be accepted before the load settles;
 * - every accepted Yjs update is written to the log BEFORE it is broadcast
 *   (persist.automatic), and a storage failure resets the room to a
 *   transient "storage-failed" state that closes clients with 1011 and
 *   reloads on the next connection;
 * - a load failure puts the room in "load-failed": new connections are
 *   accepted then closed with 4500 so y-websocket keeps retrying, and the
 *   room itself retries the load at most once per LOAD_RETRY_MIN_INTERVAL_MS.
 *
 * Hibernation API: sockets are handed to the runtime via
 * `ctx.acceptWebSocket` and read through `ctx.getWebSockets()`; the room
 * keeps no socket set of its own.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_ORIGIN, BoardStore, type BoardStorage, type LoadResult } from './board-store';
import { nextRoomState, type RoomState } from './room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import type { Env } from './index';

/** The Durable Object storage surface, as handed to BoardStore. */
type Storage = BoardStorage;

export class BoardRoom extends DurableObject<Env> {
  private state: RoomState = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private lastLoadAttemptAt = 0;
  /** Sockets that already received their sync-step-1 greeting. */
  private readonly greeted = new WeakSet<WebSocket>();
  /** Updates received since the last flush, awaiting persist + broadcast. */
  private pending: Array<{ update: Uint8Array; origin: unknown }> = [];
  private flushScheduled = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Block concurrent fetches/messages until the (synchronous) load settles.
    ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  /**
   * Test-only: expose the raw Durable Object storage so integration tests can
   * inspect/mutate the SQLite tables directly (the worker's TEST_HOOKS gate
   * the destructive ones). Not part of the public protocol.
   */
  get rawStorage(): Storage {
    return this.ctx.storage;
  }

  /**
   * (Re)load the board from storage. Synchronous: Durable Object SQLite is
   * synchronous. On failure the room is left in "load-failed" with no doc.
   */
  private load(): void {
    const doc = new Y.Doc();
    let store: BoardStore | null = null;
    let result: LoadResult;
    try {
      const s = new BoardStore(this.ctx.storage as unknown as Storage);
      s.migrate();
      result = s.load(doc);
      if (result.ok) store = s;
    } catch (err) {
      // migrate() or an unexpected throw: treat as a SQL error.
      console.error('BOARD_ROOM load failed', { error: String(err) });
      result = { ok: false, reason: 'sql-error', error: String(err) };
    }
    if (!result.ok || !store) {
      this.state = nextRoomState(this.state, { type: 'load-failure' });
      this.lastLoadAttemptAt = Date.now();
      this.doc = null;
      this.store = null;
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) =>
      this.onDocUpdate(update, origin),
    );
    this.doc = doc;
    this.store = store;
    this.state = nextRoomState(this.state, {
      type: 'load-success',
      quarantined: result.quarantined,
    });
  }

  /**
   * A doc update from a connected client. It is buffered and flushed on the
   * next macrotask: a synchronous SQLite write inside a WebSocket-message
   * activation poisons the shared lock in workerd after a few hundred
   * writes (blocking every other board's SQL until this object hibernates),
   * while a macrotask write commits cleanly. The flush persists BEFORE it
   * broadcasts, so a change is never seen by another client unrecorded
   * (persist.seen_is_saved). The log stores a self-contained full board
   * state (not the received delta) so one damaged row can never destroy the
   * other rows on load (persist.partial_damage); clients receive the delta.
   */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return; // state applied from storage
    if (this.state !== 'ready' || !this.doc || !this.store) return;

    this.pending.push({ update, origin });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setTimeout(() => this.flush(), 0);
    }
  }

  /** Persist the buffered updates (full state), then broadcast them. */
  private flush(): void {
    this.flushScheduled = false;
    if (this.state !== 'ready' || !this.doc || !this.store) {
      this.pending = [];
      return;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    try {
      this.store.append(Y.encodeStateAsUpdate(this.doc));
    } catch (err) {
      console.error('BOARD_ROOM storage append failed', { error: String(err) });
      this.state = nextRoomState(this.state, { type: 'storage-failure' });
      this.resetRoom();
      return;
    }
    this.state = nextRoomState(this.state, { type: 'update-stored' });

    for (const { update, origin } of batch) {
      this.broadcastUpdate(update, origin);
    }
    this.state = nextRoomState(this.state, { type: 'compact-start' });
    const compacted = this.store.compactIfNeeded(this.doc);
    this.state = nextRoomState(this.state, {
      type: compacted ? 'compact-success' : 'compact-failure',
    });
  }

  /**
   * Drop the in-memory doc and close every socket with 1011. The log and
   * snapshot on disk are untouched; the next connection reloads.
   */
  private resetRoom(): void {
    this.doc = null;
    this.store = null;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // Already closing; the runtime drops it.
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    // Test-only storage hooks (enabled only when env.TEST_HOOKS === "1"): the
    // /__test/ routes forward here as ?__test=corrupt-snapshot|repair.
    const testAction = new URL(req.url).searchParams.get('__test');
    if (this.env?.TEST_HOOKS === '1' && testAction) {
      try {
        if (testAction === 'corrupt-snapshot') {
          this.testCorruptSnapshot();
        } else if (testAction === 'repair') {
          this.testRepairSnapshot();
        } else {
          return new Response('Unknown test action', { status: 400 });
        }
        return new Response(JSON.stringify({ ok: true, action: testAction }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // A new connection is the retry vector for a broken room.
    if (this.state === 'storage-failed') {
      this.state = nextRoomState(this.state, { type: 'reload-request' });
      this.load();
    }
    if (this.state === 'load-failed') {
      if (Date.now() - this.lastLoadAttemptAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        this.state = nextRoomState(this.state, { type: 'retry-load' });
        this.load();
      } else {
        this.state = nextRoomState(this.state, { type: 'retry-rejected' });
      }
      if (this.state === 'load-failed') {
        // Accept, then close with 4500: y-websocket treats 4500 as "try
        // again later" and keeps retrying (recovery without a reload).
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        this.ctx.acceptWebSocket(server);
        const socket = this.ctx.getWebSockets()[0];
        queueMicrotask(() => {
          try {
            socket?.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          } catch {
            // Already closed.
          }
        });
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      try {
        ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      } catch {
        // Already closing.
      }
      return;
    }
    if (this.state !== 'ready') {
      // Transient: "storage-failed" until the doc reloads on the next fetch.
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // Already closing.
      }
      return;
    }
    // Greet on the first message (the browser cannot send before the
    // upgrade, so this is exactly once per socket).
    if (!this.greeted.has(ws)) {
      this.greeted.add(ws);
      const doc = this.doc;
      if (!doc) return;
      try {
        ws.send(this.encodeSyncStep1(doc));
      } catch {
        return; // Socket is closing; webSocketClose fires.
      }
    }
    this.handleMessage(ws, msg);
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // The hibernation API tracks sockets for us; nothing to clean up.
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // The runtime closes the socket; webSocketClose fires.
  }

  // ---------------------------------------------------------------- test-only

  /**
   * Test-only (driven by the /__test/ storage hooks, enabled only when
   * env.TEST_HOOKS === '1'): corrupt the board's snapshot in place — chunk 0
   * is backed up and then overwritten with garbage — and invalidate the
   * in-memory doc so the next connection reloads (and fails to load).
   */
  testCorruptSnapshot(): void {
    const sql = (this.ctx.storage as unknown as Storage).sql;
    sql.exec('CREATE TABLE IF NOT EXISTS test_backups (key TEXT PRIMARY KEY, data BLOB NOT NULL)');
    const store = new BoardStore(this.ctx.storage as unknown as Storage);
    store.migrate();
    const { c } = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as {
      c: number;
    };
    if (c === 0) {
      // No snapshot yet: force one from the current (or freshly loaded) doc.
      store.compact(this.ensureTestDoc(store));
    }
    const row = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0] as {
      data: ArrayBuffer;
    };
    const original = new Uint8Array(row.data);
    sql
      .exec('INSERT OR REPLACE INTO test_backups (key, data) VALUES (?, ?)', 'chunk_0', original)
      .toArray();
    const damaged = new Uint8Array(original.length);
    for (let i = 0; i < damaged.length; i++) damaged[i] = Math.floor(Math.random() * 256);
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', damaged, 0).toArray();
    // Invalidate: the next connection reloads (and fails).
    this.state = 'storage-failed';
    this.doc = null;
    this.store = null;
  }

  /**
   * Test-only: restore the snapshot chunk 0 from the backup made by
   * {@link testCorruptSnapshot} and invalidate the doc so the next
   * connection reloads (now successfully).
   */
  testRepairSnapshot(): void {
    const sql = (this.ctx.storage as unknown as Storage).sql;
    sql.exec('CREATE TABLE IF NOT EXISTS test_backups (key TEXT PRIMARY KEY, data BLOB NOT NULL)');
    const backupRow = sql
      .exec('SELECT data FROM test_backups WHERE key = ?', 'chunk_0')
      .toArray()[0] as { data: ArrayBuffer } | undefined;
    if (backupRow) {
      const backup = new Uint8Array(backupRow.data);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', backup, 0).toArray();
      sql.exec('DELETE FROM test_backups WHERE key = ?', 'chunk_0').toArray();
    }
    this.state = 'storage-failed';
    this.doc = null;
    this.store = null;
  }

  /** For the test hooks: the live doc, or a freshly loaded one. */
  private ensureTestDoc(store: BoardStore): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc();
    const result = store.load(doc);
    if (!result.ok) {
      throw new Error(`board cannot be loaded for test compaction: ${result.reason}`);
    }
    return doc;
  }

  // ------------------------------------------------------------- y-protocols

  private encodeSyncStep1(doc: Y.Doc): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  private handleMessage(ws: WebSocket, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) return;

    const decoded = decodeMessage(data as ArrayBuffer | string);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    switch (decoded.kind) {
      case 'query-awareness':
        return;
      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;
      case 'sync': {
        const doc = this.doc;
        if (!doc) return;
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        let invalid = false;
        try {
          syncProtocol.readSyncMessage(decoder, encoder, doc, ws, () => {
            invalid = true;
          });
        } catch {
          invalid = true;
        }
        if (invalid) {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
          return;
        }
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 0) {
          const frame = new Uint8Array(1 + reply.length);
          frame[0] = MESSAGE_SYNC;
          frame.set(reply, 1);
          try {
            ws.send(frame);
          } catch {
            // Socket is closing; webSocketClose fires.
          }
        }
        return;
      }
    }
  }

  /**
   * Relay an awareness frame to every other open socket. The room owns no
   * awareness state (PRD scope: presence is out of scope).
   */
  private relayAwareness(payload: Uint8Array): void {
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_AWARENESS;
    frame.set(payload, 1);
    for (const s of this.ctx.getWebSockets()) {
      if (s.readyState !== WebSocket.OPEN) continue;
      try {
        s.send(frame);
      } catch {
        // Socket is closing; the runtime drops it.
      }
    }
  }

  /**
   * Send a stored doc update to every open socket except `origin`. Sockets
   * that miss it catch up via sync messages.
   */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const bytes = encoding.toUint8Array(encoder);
    for (const s of this.ctx.getWebSockets()) {
      if (s === origin) continue;
      if (s.readyState !== WebSocket.OPEN) continue;
      try {
        s.send(bytes);
      } catch {
        // Socket is closing; the runtime drops it.
      }
    }
  }
}
