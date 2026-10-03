import { DurableObject, DurableObjectState, DurableObjectCtx } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, oneRow } from './board-store';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

/**
 * The room's resting states (story 4). `loading` / `compacting` / `hibernated`
 * are transient/implicit and modelled in `room-state.ts`; at runtime the room
 * sits in one of these three.
 */
type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export interface StorageInfo {
  tables: string[];
  createdAt: string | null;
  updatesCount: number;
  snapshotCount: number;
}

/**
 * The RPC surface of BoardRoom, callable on a Durable Object stub
 * (`env.BOARD_ROOM.get(...) as BoardRoomStub`).
 */
export interface BoardRoomStub extends DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  /** Initialises the board: migrate + stamp `created_at` if absent. */
  initialize(): Promise<'created' | 'exists'>;
  /** Read-only existence check. */
  exists(): Promise<boolean>;
  /** TEST-ONLY: make the next `initialize()` throw. */
  __testSetFailInitialize(fail: boolean): Promise<void>;
  /** TEST-ONLY: storage facts. */
  __testStorageInfo(): Promise<StorageInfo>;
  /** TEST-ONLY: seed legacy `updates` rows without `created_at`. */
  __testSeed(updates: Uint8Array[]): Promise<void>;
}

/**
 * BoardRoom Durable Object (persistent, story 4).
 *
 * - Loads the board from SQLite on construction (first wake) and after a
 *   storage failure. A failed load leaves the room in `load-failed`; new
 *   connections retry (bounded by LOAD_RETRY_MIN_INTERVAL_MS) or are closed
 *   with CLOSE_BOARD_LOAD_FAILED (4500).
 * - Persists every applied update BEFORE broadcasting it (append-before-
 *   broadcast); a storage write failure resets the room to `storage-failed`
 *   and closes all sockets with CLOSE_STORAGE_FAILURE (1011).
 * - Uses the hibernation API (`ctx.acceptWebSocket` + `webSocketMessage/Close/
 *   Error` + `ctx.getWebSockets`) when the runtime provides it (production and
 *   the real-server integration tests), and falls back to a socket Set + direct
 *   socket handlers when it does not (the in-process workerd test pool). Both
 *   paths share the same sync/awareness/state logic.
 */
export class BoardRoom extends DurableObject {
  /** TEST-ONLY: how many times `initialize()` has run (across instances). */
  static __testInitializeCalls = 0;
  /** TEST-ONLY: whether the last `initialize()` threw. */
  static __testInitializeThrew = false;
  state: DurableObjectState;
  private ctx: DurableObjectCtx | null = null;
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private roomState: RoomState = 'ready';
  private loadFailedAt = 0;
  private useHibernation = false;
  private sockets = new Set<WorkersWebSocket>();

  /** TEST-ONLY event log. Never used in prod. */
  __testEvents: string[] = [];
  /** TEST-ONLY: when true, the next `store.append` throws (simulates storage failure). */
  __testFailAppend = false;
  /** TEST-ONLY: when true, the next `initialize()` throws (TC-12). */
  __testFailInitialize = false;

  constructor(state: DurableObjectState, env: unknown) {
    super(state, env);
    this.state = state;
    this.store = new BoardStore(state.storage);
    // Story 5: the constructor no longer loads (and therefore no longer
    // migrates). Storage is written only by `initialize()` or the first
    // `append()`, so probing an unknown link leaves nothing behind.
  }

  /**
   * Initialises the board (share.board_api): creates the schema, stamps
   * `created_at` (epoch ms) if absent, and loads the doc. Idempotent: a
   * second call returns `'exists'` and never re-initialises an existing
   * board (TC-15).
   */
  async initialize(): Promise<'created' | 'exists'> {
    BoardRoom.__testInitializeCalls += 1;
    if (this.__testFailInitialize) {
      this.__testFailInitialize = false;
      BoardRoom.__testInitializeThrew = true;
      throw new Error('injected initialize failure (test)');
    }
    this.store.migrate();
    const sql = this.state.storage.sql;
    const existing = oneRow<{ value: string }>(
      sql,
      'SELECT value FROM storage_meta WHERE key = ?',
      'created_at',
    );
    if (existing) {
      return 'exists';
    }
    sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
      'created_at',
      String(Date.now()),
    );
    this.load();
    return 'created';
  }

  /** Read-only existence check (share.board_api). Never writes storage. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** TEST-ONLY: make the next `initialize()` throw (TC-12). */
  __testSetFailInitialize(fail: boolean): void {
    this.__testFailInitialize = fail;
  }

  /** TEST-ONLY: storage facts for integration tests. */
  async __testStorageInfo(): Promise<StorageInfo & { initializeCalls: number; initializeThrew: boolean }> {
    const sql = this.state.storage.sql;
    const tables = sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray<{ name: string }>()
      .map((r) => r.name);
    const createdAt = tables.includes('storage_meta')
      ? oneRow<{ value: string }>(sql, 'SELECT value FROM storage_meta WHERE key = ?', 'created_at')
          ?.value ?? null
      : null;
    const updatesCount = tables.includes('updates')
      ? sql.exec('SELECT COUNT(*) AS c FROM updates').toArray<{ c: number }>()[0].c
      : 0;
    const snapshotCount = tables.includes('snapshot_chunks')
      ? sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray<{ c: number }>()[0].c
      : 0;
    return {
      tables,
      createdAt,
      updatesCount,
      snapshotCount,
      initializeCalls: BoardRoom.__testInitializeCalls,
      initializeThrew: BoardRoom.__testInitializeThrew,
    };
  }

  /** TEST-ONLY: seed legacy `updates` rows without `created_at` (TC-08, e2e TC-31). */
  async __testSeed(updates: Uint8Array[]): Promise<void> {
    this.store.migrate();
    for (const u of updates) this.store.append(u);
  }

  /** Loads the board into a fresh doc. Sets roomState accordingly. */
  private load(): void {
    const doc = new Y.Doc();
    let result;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false as const, reason: 'sql-error' as const, error: String(e) };
    }
    if (result.ok) {
      this.doc = doc;
      this.attachUpdateHandler(doc);
      this.roomState = 'ready';
      this.__testEvents.push(`state:ready (quarantined=${result.quarantined})`);
    } else {
      this.doc = null;
      this.roomState = 'load-failed';
      this.loadFailedAt = Date.now();
      this.__testEvents.push(`state:load-failed (${result.reason})`);
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'board load failed',
          reason: result.reason,
          error: result.error,
        }),
      );
    }
  }

  /** Wires the doc's update handler: persist before broadcast, then compact. */
  private attachUpdateHandler(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Never persist or echo updates we just loaded from storage.
      if (origin === LOAD_ORIGIN) return;
      // Append-before-broadcast: the write must succeed before any client sees it.
      try {
        if (this.__testFailAppend) {
          this.__testFailAppend = false;
          throw new Error('injected storage failure');
        }
        this.store.append(update);
      } catch (e) {
        this.onStorageFailure();
        return;
      }
      this.broadcast(update, origin);
      this.store.compactIfNeeded(doc);
    });
  }

  /** A storage write failed: discard the doc, close every socket, go storage-failed. */
  private onStorageFailure(): void {
    this.roomState = 'storage-failed';
    this.doc = null;
    this.__testEvents.push('state:storage-failed');
    for (const ws of this.webSockets()) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        /* socket already gone */
      }
    }
    console.error(JSON.stringify({ level: 'error', msg: 'storage failure, resetting room' }));
  }

  /** Open sockets, via the hibernation API or the fallback Set. */
  private webSockets(): Iterable<WorkersWebSocket> {
    if (this.useHibernation && this.ctx) {
      return Array.from(this.ctx.getWebSockets()) as unknown as WorkersWebSocket[];
    }
    return this.sockets;
  }

  /** Broadcasts a framed sync update to every open socket except `except`. */
  private broadcast(update: Uint8Array, except: unknown): void {
    const encoder = createEncoder();
    sync.writeUpdate(encoder, update);
    const payload = toUint8Array(encoder);
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_SYNC;
    frame.set(payload, 1);
    for (const ws of this.webSockets()) {
      if (ws === except) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          /* drop dead socket */
        }
      }
    }
  }

  /** Relays raw awareness bytes to every open socket (including the sender). */
  private relayAwareness(payload: Uint8Array): void {
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_AWARENESS;
    frame.set(payload, 1);
    for (const ws of this.webSockets()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          /* drop dead socket */
        }
      }
    }
  }

  /**
   * Accepts the connection and returns the response to send.
   * - Hibernation: `ctx.acceptWebSocket(client)` returns the response to use; the
   *   client end is used for webSocketMessage/send. The returned response MUST be
   *   the one from acceptWebSocket (not a hand-built one).
   * - Fallback: the server end is accepted + read from; the client end is returned.
   */
  private registerSocket(client: WorkersWebSocket, server: WorkersWebSocket): Response {
    if (this.useHibernation && this.ctx) {
      const response = this.ctx.acceptWebSocket(client as unknown as WebSocket);
      this.sendSyncStep1(client);
      return response;
    }
    server.accept();
    server.binaryType = 'arraybuffer';
    server.onmessage = (e: { data: unknown }) => {
      this.handleMessage(server, e.data as string | ArrayBuffer);
    };
    server.onclose = () => this.sockets.delete(server);
    server.onerror = () => this.sockets.delete(server);
    this.sockets.add(server);
    this.sendSyncStep1(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends SyncStep1 (our state vector) to a newly accepted socket. */
  private sendSyncStep1(server: WorkersWebSocket): void {
    const doc = this.doc!;
    const step1Encoder = createEncoder();
    sync.writeSyncStep1(step1Encoder, doc);
    const step1Payload = toUint8Array(step1Encoder);
    const step1Frame = new Uint8Array(1 + step1Payload.length);
    step1Frame[0] = MESSAGE_SYNC;
    step1Frame.set(step1Payload, 1);
    server.send(step1Frame);
    this.__testEvents.push('accept');
  }

  /** Accepts a socket and closes it immediately with `code` (load/storage failure). */
  private acceptAndClose(client: WorkersWebSocket, server: WorkersWebSocket, code: number, reason: string): Response {
    if (this.useHibernation && this.ctx) {
      const response = this.ctx.acceptWebSocket(client as unknown as WebSocket);
      this.__testEvents.push(`close:${code} (${reason})`);
      client.close(code, reason);
      return response;
    }
    server.accept();
    this.__testEvents.push(`close:${code} (${reason})`);
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(_req: Request, _env: unknown, ctx: DurableObjectCtx): Promise<Response> {
    this.ctx = ctx;
    this.useHibernation = !!(ctx && typeof (ctx as DurableObjectCtx).acceptWebSocket === 'function');

    // Unknown boards are rejected BEFORE a connection is accepted (share.not_found):
    // rooms can no longer be created implicitly by connecting.
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0] as unknown as WorkersWebSocket;
    const server = pair[1] as unknown as WorkersWebSocket;

    // The constructor no longer loads: load on first use (and after a storage
    // failure), throttling reloads while load-failed.
    if (this.doc === null) {
      if (this.roomState === 'load-failed') {
        const elapsed = Date.now() - this.loadFailedAt;
        if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
          this.loadFailedAt = Date.now();
          this.load();
        }
      } else {
        this.load();
      }
      if ((this.roomState as RoomState) !== 'ready') {
        return this.acceptAndClose(client, server, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      }
    }

    // Ready: accept (hibernation or fallback) and send our state vector.
    return this.registerSocket(client, server);
  }

  /** Hibernation-API message handler (real workerd). */
  webSocketMessage(ws: WorkersWebSocket, message: string | ArrayBuffer): void {
    this.handleMessage(ws, message);
  }

  /** Hibernation-API close handler. */
  webSocketClose(ws: WorkersWebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.sockets.delete(ws);
  }

  /** Hibernation-API error handler. */
  webSocketError(ws: WorkersWebSocket, _error: Error): void {
    this.sockets.delete(ws);
  }

  /** Shared message processing (sync / awareness). Used by both paths. */
  private handleMessage(ws: WorkersWebSocket, message: string | ArrayBuffer): void {
    // State gates first: a non-ready room never processes traffic.
    if (this.roomState === 'load-failed') {
      this.__testEvents.push('close:4500 (message while load-failed)');
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.roomState === 'storage-failed') {
      this.__testEvents.push('close:1011 (message while storage-failed)');
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const doc = this.doc!;

    let decoded;
    try {
      decoded = decodeMessage(message as ArrayBuffer | string);
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'decode error');
      return;
    }
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        const decoder = createDecoder(decoded.payload);
        const replyEncoder = createEncoder();
        sync.readSyncMessage(decoder, replyEncoder, doc, ws, (_error: Error) => {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'sync decode/apply error');
        });
        const reply = toUint8Array(replyEncoder);
        if (reply.length > 0) {
          const frame = new Uint8Array(1 + reply.length);
          frame[0] = MESSAGE_SYNC;
          frame.set(reply, 1);
          ws.send(frame);
        }
      } catch {
        ws.close(CLOSE_UNSUPPORTED_DATA, 'sync decode/apply error');
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
      return;
    }
  }
}
