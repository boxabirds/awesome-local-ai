import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  writeSyncStep1,
  writeSyncStep2,
  writeUpdate,
} from 'y-protocols/sync';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrame,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type CompactHooks, type LoadResult } from './board-store';
import { nextRoomState, type RoomState } from './room-state';
import { runTestHook } from './test-hooks';
import type { Env } from './index';

/**
 * The storage interface the room depends on. BoardStore implements it; the
 * test hooks swap in a delegating wrapper to inject failures (the wrapper
 * sits outside SQLite — real transactions keep their real semantics).
 */
export interface BoardStoreLike {
  migrate(): void;
  append(update: Uint8Array): void;
  load(doc: Y.Doc): LoadResult;
  existsReadOnly(): boolean;
  compactIfNeeded(doc: Y.Doc, hooks?: CompactHooks): boolean;
  compact(doc: Y.Doc, hooks?: CompactHooks): boolean;
  needsCompaction(): boolean;
}

export interface InjectSpec {
  append?: 'once' | 'always';
  load?: 'once' | 'always';
  reset?: boolean;
}

/**
 * One BoardRoom per board. The board's Y.Doc is loaded from the Durable
 * Object's SQLite on construction (and again after any storage failure),
 * every accepted update is appended to the log BEFORE it is broadcast, and
 * sockets are accepted with the hibernation API so a board with no open
 * sockets can hibernate and be re-loaded on the next connection.
 *
 * Lifecycle (see room-state.ts for the unit-tested machine):
 *  - loading      -> ready (load applied) | load-failed (unreadable snapshot
 *                   or SQL error): the room accepts connections and closes
 *                   them with 4500, retrying the load at most once per
 *                   LOAD_RETRY_MIN_INTERVAL_MS;
 *  - ready        -> storage-failed when an append throws: the update is not
 *                   broadcast, all sockets close with 1011, the doc is
 *                   discarded and the next connection reloads from storage;
 *  - ready        -> compacting -> ready when the log crosses a threshold
 *                   (the transaction either commits or rolls back whole).
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | undefined;
  private state: RoomState = 'loading';
  private loadFailedAt = 0;
  private store: BoardStoreLike;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // SQLite is synchronous in workerd; block concurrent fetches until the
    // board has been loaded (or marked load-failed).
    ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  private load(): void {
    const doc = new Y.Doc();
    // Subscribe once for the lifetime of the doc: every non-load update is
    // stored and broadcast; load-origin updates are neither.
    doc.on('update', (update, origin) => {
      this.onDocUpdate(update, origin);
    });
    this.doc = doc;
    this.state = 'loading';
    // Story 5: no migration here — an unknown board must stay unmaterialized
    // (share.not_found). load() on a tableless board yields an empty board.
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (err) {
      result = { ok: false, reason: 'sql-error', error: String(err) };
    }
    if (result.ok) {
      this.state = nextRoomState(this.state, {
        type: 'load-succeeded',
        quarantined: result.quarantined,
      });
    } else {
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      // A partially applied doc must never be served or extended.
      this.doc = undefined;
      console.error({ event: 'board-load-failed', reason: result.reason, error: result.error });
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Story 5 (share.not_found): rooms can no longer be created implicitly
    // by connecting. An unknown board never upgrades; no storage is
    // materialized for it.
    if (!this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }

    if (this.state === 'storage-failed') {
      // persist.save_failure: the next connection asks the room to load
      // again; clients reconnect and re-send their still-held changes.
      this.state = nextRoomState(this.state, { type: 'reload-requested' });
      this.load();
    } else if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      this.state = nextRoomState(this.state, {
        type: 'connection',
        elapsedMs: elapsed,
        retryIntervalMs: LOAD_RETRY_MIN_INTERVAL_MS,
      });
      if (this.state === 'loading') {
        this.load();
      }
    }

    if (this.state === 'load-failed' || this.doc === undefined) {
      // Honest failure: accept, then close with 4500 so the client shows
      // "couldn't be loaded" and keeps retrying. Deferred past the response:
      // workerd drops sends issued before the 101 has been flushed.
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      const closeKick = new Promise<void>((resolve) => {
        setTimeout(() => {
          this.closeQuietly(server, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          resolve();
        }, 50);
      });
      this.ctx.waitUntil(closeKick);
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: workerd routes message/close/error on accepted
    // sockets to the webSocket* methods below, and the object may
    // hibernate once no sockets are open (verified with this workerd).
    this.ctx.acceptWebSocket(server);
    const ws: WebSocket = server;

    const response = new Response(null, { status: 101, webSocket: client });
    // On (re)connect the room offers its state; a reconnecting client whose
    // doc is newer answers with everything the room lacks (restart safety).
    const step1 = encoding.createEncoder();
    writeSyncStep1(step1, this.doc);
    const kickoff = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeFrame(MESSAGE_SYNC, encoding.toUint8Array(step1)));
        }
        resolve();
      }, 50);
    });
    this.ctx.waitUntil(kickoff);
    return response;
  }

  /**
   * Story 5 (share.board_api): idempotently create this board. Runs the
   * migration and writes the board's created_at exactly once; a repeat
   * call (including by a racing creator) reports `exists` and leaves
   * created_at untouched.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const sql = this.ctx.storage.sql;
    const existing = sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'created_at').raw().next();
    if (!existing.done) return 'exists';
    sql.exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', 'created_at', String(Date.now()));
    return 'created';
  }

  /** Story 5 (share.board_api): read-only exists() RPC for GET /api/boards/:id. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** Hibernation API entry point for accepted sockets. */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      // Must not store updates served from a failed room.
      this.closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.doc === undefined) {
      this.closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    this.onMessage(ws, message);
  }

  /**
   * workerd delivers the client's close frame as an event; the object
   * answers it to complete the handshake (verified with this workerd: a
   * close frame that is not answered leaves the client hanging).
   */
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    void wasClean;
    this.closeQuietly(ws, code, reason);
  }

  /** The socket is already removed by workerd; nothing to clean up. */
  webSocketError(ws: WebSocket, error: unknown): void {
    void ws;
    void error;
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    if (this.state !== 'ready' || this.doc === undefined) return;
    // Write-before-broadcast: the update is in storage before anyone else
    // can see it, so a crash right after the broadcast loses nothing.
    try {
      this.store.append(update);
    } catch (err) {
      this.onStorageWriteFailed(err);
      return;
    }
    this.state = nextRoomState(this.state, { type: 'update-applied' });
    this.broadcast(update, origin);
    if (this.store.needsCompaction()) {
      this.state = nextRoomState(this.state, { type: 'compaction-start' });
      const committed = this.store.compactIfNeeded(this.doc);
      this.state = nextRoomState(
        this.state,
        committed ? { type: 'compaction-commit' } : { type: 'compaction-rollback' },
      );
    }
  }

  private onStorageWriteFailed(err: unknown): void {
    console.error({ event: 'storage-write-failed', error: String(err) });
    this.state = nextRoomState(this.state, { type: 'storage-write-failed' });
    // The change is NOT broadcast, and the doc is discarded so it can never
    // leak back in from this instance.
    this.doc = undefined;
    for (const ws of this.ctx.getWebSockets()) {
      this.closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
    }
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    const message = encodeFrame(MESSAGE_SYNC, encoding.toUint8Array(enc));
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(message);
      } catch {
        // dead socket: workerd removes it from getWebSockets()
      }
    }
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const decoded = decodeMessage(data as ArrayBuffer | string);
    if (decoded.kind === 'invalid') {
      this.closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story: ignore.
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay the full frame verbatim to every socket including the sender:
      // y-websocket clients drop sockets that go quiet, so idle clients must
      // keep receiving traffic.
      const message = encodeFrame(MESSAGE_AWARENESS, decoded.payload);
      for (const other of this.ctx.getWebSockets()) {
        if (other.readyState !== WebSocket.OPEN) continue;
        try {
          other.send(message);
        } catch {
          // dead socket
        }
      }
      return;
    }
    // kind === 'sync'
    const doc = this.doc;
    if (doc === undefined) {
      this.closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(decoded.payload);
    try {
      // A sync frame can carry several messages (e.g. a step2+step1 reply);
      // process every one. Origin is the sending socket: its own update is
      // not echoed back. Accepted updates are stored+broadcast by the doc
      // listener before the loop continues; garbage is rejected with 1003.
      // (y-protocols' own readSyncMessage is not used: it swallows
      // applyUpdate errors, which would let a malformed frame partially
      // integrate and poison the room doc.)
      while (decoding.hasContent(decoder)) {
        const messageType = decoding.readVarUint(decoder);
        if (messageType === messageYjsSyncStep1) {
          writeSyncStep2(encoder, doc, decoding.readVarUint8Array(decoder));
        } else if (
          messageType === messageYjsSyncStep2 ||
          messageType === messageYjsUpdate
        ) {
          this.applyGuarded(doc, decoding.readVarUint8Array(decoder), ws);
        } else {
          throw new Error(`unknown sync message type: ${messageType}`);
        }
      }
    } catch {
      this.closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 0) {
      try {
        ws.send(encodeFrame(MESSAGE_SYNC, reply));
      } catch {
        // dead socket
      }
    }
  }

  /**
   * Applies a wire-received update to the room doc, validated on a scratch
   * doc first. A Yjs update whose tail is cut mid-item decodes far enough
   * to partially integrate before throwing; applied to the room doc that
   * partial state would poison later updates. The scratch doc absorbs the
   * failure; a row that applies on the scratch applies identically on the
   * room doc (same origin, same data).
   */
  private applyGuarded(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, update, origin);
    Y.applyUpdate(doc, update, origin);
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      // CLOSING is included on purpose: when the client's close frame
      // arrives (webSocketClose) the socket is in CLOSING state and this
      // call is exactly what answers the handshake — without it the
      // client hangs (verified with this workerd build).
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.CLOSING
      ) {
        ws.close(code, reason);
      }
    } catch {
      // already closed
    }
  }

  /**
   * Test-only entry point (enabled with env.TEST_HOOKS === '1'); production
   * deployments do not set the variable and every hook no-ops.
   */
  __testHook(boardId: string, op: string, body: Record<string, unknown>): unknown {
    if (this.env.TEST_HOOKS !== '1') {
      return { ok: false, error: 'test hooks disabled' };
    }
    return runTestHook(this.ctx.storage, this, boardId, op, body);
  }

  /** Test-only: swap in a store wrapper that injects failures (TC-14, TC-26). */
  __testInject(spec: InjectSpec): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    const real = this.store;
    const counts = { append: 0, load: 0 };
    this.store = {
      migrate: () => real.migrate(),
      existsReadOnly: () => real.existsReadOnly(),
      append: (update) => {
        if (spec.append) {
          counts.append += 1;
          if (spec.append === 'always' || counts.append === 1) {
            throw new Error('injected append failure');
          }
        }
        return real.append(update);
      },
      load: (doc) => {
        if (spec.load) {
          counts.load += 1;
          if (spec.load === 'always' || counts.load === 1) {
            throw new Error('injected load failure');
          }
        }
        return real.load(doc);
      },
      compactIfNeeded: (doc, hooks) => real.compactIfNeeded(doc, hooks),
      compact: (doc, hooks) => real.compact(doc, hooks),
      needsCompaction: () => real.needsCompaction(),
    };
    if (spec.reset) {
      this.doc = undefined;
      this.state = 'storage-failed';
    }
  }

  /** Test-only: discard the doc and force a reload on the next connection. */
  __testReset(): void {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    this.doc = undefined;
    this.state = 'storage-failed';
  }

  /** Test-only: force a compaction regardless of the thresholds. */
  __testCompactNow(): boolean {
    if (this.env.TEST_HOOKS !== '1') throw new Error('test hooks disabled');
    if (this.doc === undefined) return false;
    return this.store.compact(this.doc);
  }
}
