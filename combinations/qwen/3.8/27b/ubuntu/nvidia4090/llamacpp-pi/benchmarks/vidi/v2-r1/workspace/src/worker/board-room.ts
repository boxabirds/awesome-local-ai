// BoardRoom Durable Object (story 4): persistent, hibernating board room.
//
// The board's Y.Doc is reloaded from the BoardStore (SQLite) on every
// construction (first connection or wake from hibernation), every applied
// update is appended to the store before it is broadcast, and sockets are
// hibernating (ctx.acceptWebSocket) so an idle board costs no compute.
//
// Lifecycle: see room-state.ts (nextRoomState). State transitions the room
// performs itself: loading → ready | load-failed (constructor and reloads),
// ready → compacting → ready, ready → storage-failed, storage-failed/load-failed
// → loading (new connection). 'hibernate' is the runtime's state: an idle
// object reconstructs and re-enters 'loading' on the next event.
//
// Test hooks (corrupt/repair/seed/compact under /__test/) are handled in
// fetch and only reachable through routes the worker registers when
// env.TEST_HOOKS === '1' (never set in production config).

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, META_CREATED_AT, firstRow } from './board-store';
import { nextRoomState, type RoomState } from './room-state';
import { handleTestHook, isTestHookPath } from './test-hooks';
import type { Env } from './index';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BoardRoom extends DurableObject {
  /** Public for tests: failure injection wraps methods on the store (TC-14, TC-26). */
  store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private lastLoadAttemptAt = 0;

  constructor(ctx: DurableObjectState, _env: Env) {
    super(ctx, _env);
    this.store = new BoardStore(ctx.storage);
    console.log({ event: 'board_room.constructed' });
    // Load synchronously before any event runs: fetch and webSocketMessage
    // only observe 'ready' or 'load-failed'. Story 5: the load never writes
    // (an unknown board's missing tables are an empty board, not a failure),
    // so probing a link constructs the object without leaving storage behind.
    void ctx.blockConcurrencyWhile(() => this.runLoad());
  }

  /** Story 5 (share.board_api): initialise this board's storage. Runs the
   * migrations and records created_at exactly once; a second call (or a
   * collision on a fresh id) returns 'exists' without touching created_at.
   * The only RPC that writes storage. */
  async initialize(): Promise<'created' | 'exists'> {
    const sql = this.ctx.storage.sql;
    this.store.migrate();
    const existing = firstRow<{ value: string }>(sql, 'SELECT value FROM storage_meta WHERE key = ?1', META_CREATED_AT);
    if (existing !== null) return 'exists';
    sql.exec('INSERT INTO storage_meta (key, value) VALUES (?1, ?2)', META_CREATED_AT, String(Date.now()));
    return 'created';
  }

  /** Story 5 (share.board_api): read-only existence check (created_at, or
   * legacy updates/snapshot rows). Never writes. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (isTestHookPath(url)) {
      if (url.pathname === '/__test/reload') {
        // Test hook: force a reload from storage. Deterministic alternative
        // to waiting for a hibernation wake, so load-path tests (quarantine,
        // broken boards) do not depend on idle timing.
        this.state = 'loading';
        await this.runLoad();
        const state: RoomState = this.state as RoomState;
        return new Response(JSON.stringify({ state }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/__test/seed-legacy') {
        // Story 5 test hook (TC-31): seed a pre-story-5 board — the story 4
        // schema and an updates row, but no created_at — then reload the room
        // so it serves the seeded state. TEST_HOOKS-gated like every hook.
        const update = new Uint8Array(await req.arrayBuffer());
        const scratch = new Y.Doc();
        try {
          Y.applyUpdate(scratch, update);
        } catch {
          scratch.destroy();
          return new Response(JSON.stringify({ ok: false, error: 'invalid update' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        scratch.destroy();
        this.store.seedLegacy(update);
        this.state = 'loading';
        await this.runLoad();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const response = await handleTestHook(req, url, this.ctx.storage, this.store, this.doc);
      if (response !== null) return response;
    }

    // Story 5 (share.not_found): unknown boards are rejected before anything
    // is accepted. The check is read-only; no tables exist for an unknown id,
    // so probing a link leaves no storage behind.
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pairs = new WebSocketPair();
    const [client, server] = Object.values(pairs);
    const response = new Response(null, { status: 101, webSocket: client });

    if (this.state === 'load-failed' || this.state === 'storage-failed') {
      // A new connection is the room's chance to try loading again. A
      // load-failed room honours LOAD_RETRY_MIN_INTERVAL_MS; a storage-failed
      // room retries immediately (its failure was on the write path).
      const elapsed = Date.now() - this.lastLoadAttemptAt >= LOAD_RETRY_MIN_INTERVAL_MS;
      const next = nextRoomState(this.state, { type: 'connection', retryIntervalElapsed: elapsed });
      if (next === 'loading') {
        this.state = next;
        await this.runLoad();
      }
      // runLoad() may have transitioned to 'ready'; TS cannot see through
      // the call, so read the state without the stale narrowing.
      const state: RoomState = this.state as RoomState;
      if (state !== 'ready') {
        // Honest failure: accept, then close with the load-failed code.
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return response;
      }
    }

    this.ctx.acceptWebSocket(server);
    this.sendSyncStep1(server);
    return response;
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const doc = this.doc;
    if (doc === null || this.state !== 'ready') return; // loading: cannot happen (blockConcurrencyWhile)

    if (typeof msg === 'string') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    const decoded = decodeMessage(msg);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return;
    }
    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
      return;
    }

    this.handleSyncMessage(ws, doc, decoded.payload);
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernating sockets are tracked by the runtime; getWebSockets() is the
    // source of truth, so there is nothing to clean up.
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error({ event: 'board_room.socket_error', error: errorMessage(error) });
    ws.close(CLOSE_UNSUPPORTED_DATA);
  }

  // --- internals -----------------------------------------------------------

  private async runLoad(): Promise<void> {
    // Story 5: no migrate here — load() treats missing tables as an empty
    // board. migrate() runs from initialize() and lazily before the first
    // append, so an unknown board is never touched by a load or a probe.
    const fresh = new Y.Doc();
    const result = this.store.load(fresh);
    this.lastLoadAttemptAt = Date.now();
    if (result.ok) {
      fresh.on('update', (update: Uint8Array, origin: unknown) => {
        this.handleDocUpdate(update, origin);
      });
      this.doc = fresh;
      this.state = nextRoomState(this.state, { type: 'loaded', quarantined: result.quarantined });
    } else {
      this.doc = null;
      fresh.destroy();
      this.state = nextRoomState(this.state, { type: 'load-failed', reason: result.reason });
    }
  }

  /** A doc update was applied: store it, then broadcast, then maybe compact.
   * Updates replayed from storage (LOAD_ORIGIN) are neither stored nor sent. */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    const doc = this.doc;
    if (doc === null) return;
    if (this.state !== 'ready' && this.state !== 'compacting') return; // defensive

    try {
      this.store.append(update); // throws on SQL failure
    } catch (error) {
      this.onStorageFailure(error);
      return;
    }
    this.state = nextRoomState(this.state, { type: 'update-stored' });

    this.broadcastUpdate(update, origin);

    if (this.store.compactionDue()) {
      this.state = nextRoomState(this.state, { type: 'compact' });
      const compacted = this.store.compactIfNeeded(doc);
      this.state = nextRoomState(this.state, { type: 'compact-done', rolledBack: !compacted });
    }
  }

  /** Insert threw: discard the doc, close every socket with 1011. The next
   * connection reloads from storage and clients re-send their unsaved changes
   * through the story 3 handshake. */
  private onStorageFailure(error: unknown): void {
    console.error({ event: 'board_room.storage_failed', error: errorMessage(error) });
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    const doc = this.doc;
    this.doc = null;
    doc?.destroy();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // already closing
      }
    }
  }

  /** Sync sub-frames from a client. Applies happen with origin `ws`, so the
   * update handler skips echoing the sender. Garbage that Yjs rejects closes
   * this socket with 1003 and is never stored (validated on a scratch doc
   * first, because a truncated multi-item update can integrate partially). */
  private handleSyncMessage(ws: WebSocket, doc: Y.Doc, payload: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(payload);
      const subType = decoding.readVarUint(decoder);
      if (subType === sync.messageYjsSyncStep1) {
        const stateVector = decoding.readVarUint8Array(decoder);
        if (Y.encodeStateAsUpdate(doc, stateVector).length > 0) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          sync.writeSyncStep2(enc, doc, stateVector);
          ws.send(encoding.toUint8Array(enc));
        }
      } else if (subType === sync.messageYjsSyncStep2 || subType === sync.messageYjsUpdate) {
        const update = decoding.readVarUint8Array(decoder);
        if (update.length > 0) {
          this.assertValidUpdate(update);
          Y.applyUpdate(doc, update, ws);
        }
      } else {
        throw new Error('unknown sync sub-type');
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  /** Apply `update` to a scratch doc; throws when Yjs rejects it. */
  private assertValidUpdate(update: Uint8Array): void {
    const scratch = new Y.Doc();
    try {
      Y.applyUpdate(scratch, update);
    } finally {
      scratch.destroy();
    }
  }

  private sendSyncStep1(ws: WebSocket): void {
    const doc = this.doc;
    if (doc === null) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeSyncStep1(enc, doc);
    try {
      ws.send(encoding.toUint8Array(enc));
    } catch {
      // already closing
    }
  }

  /** Relay an awareness frame verbatim to every open socket, including the
   * sender (story 3 behaviour; also what keeps the object awake while
   * people are present). */
  private relayAwareness(payload: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeUint8Array(enc, payload);
    const bytes = encoding.toUint8Array(enc);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(bytes);
      } catch {
        // closing; the runtime drops it from getWebSockets()
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, except: unknown): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    const bytes = encoding.toUint8Array(enc);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(bytes);
      } catch {
        // closing; the runtime drops it from getWebSockets()
      }
    }
  }
}
