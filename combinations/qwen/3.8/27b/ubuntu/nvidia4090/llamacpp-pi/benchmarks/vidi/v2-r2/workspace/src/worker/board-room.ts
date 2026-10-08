/**
 * BoardRoom: one Durable Object per board — persistent (story 4).
 *
 * The board's Y.Doc is reconstructed from the Durable Object's SQLite
 * storage on every construction (cold start or post-eviction wake), inside
 * `ctx.blockConcurrencyWhile` (design: "object wakes and loads"). While
 * `ready`, every client update is applied, STORED, then broadcast — the
 * platform's output gate holds the broadcast until the write is durable
 * (persist.seen_is_saved). Sockets are accepted with
 * `ctx.acceptWebSocket` so idle boards can hibernate; on wake the
 * constructor rebuilds the doc from storage and
 * `ctx.getWebSockets()` still yields the pre-eviction sockets.
 *
 * Failure policy (design key decisions 3 and 5):
 * - Load failure (unreadable snapshot or SQL error on read): the room
 *   refuses to serve an empty doc. New connections are closed with
 *   CLOSE_BOARD_LOAD_FAILED (4500, transient for y-websocket → the client
 *   retries on its normal backoff); the room re-attempts a load at most
 *   every LOAD_RETRY_MIN_INTERVAL_MS.
 * - Write failure (append throws): the change is not broadcast, every
 *   socket is closed with CLOSE_STORAGE_FAILURE (1011), and the in-memory
 *   doc is discarded; reconnecting clients re-send what the server lacks
 *   (story 3 SyncStep1/SyncStep2), so unsaved edits are retried.
 * - Garbage (Yjs rejects the update): the socket is closed with 1003 and
 *   nothing is stored.
 *
 * The room owns `meta.schemaVersion`: it is applied under LOAD_ORIGIN
 * after a successful load, so opening a never-edited board stores no rows
 * (TC-25).
 *
 * `store`, `state` and `lastLoadAttemptMs` are public deliberately: the
 * room is the unit under test and integration tests reach into the live
 * instance through `runInDurableObject` (spy on `store.load`, inject
 * failing storage, refresh the retry clock). There is no mock boundary
 * inside the Durable Object.
 */

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync.js';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { initDoc } from '../shared/board-model';
import {
  INITIAL_ROOM_STATE,
  nextRoomState,
  type LoadFailureReason,
  type RoomState,
} from '../shared/room-state';
import {
  BoardStore,
  LOAD_ORIGIN,
  fromStorage,
} from './board-store';
import {
  TEST_HOOK_BACKUP_KEY,
  ensureSnapshotChunk0,
  fromHex,
  overwriteChunk0,
  parseTestHookAction,
  toHex,
} from './test-hooks';
import type { Env } from './index';

/** True when two byte arrays are identical (length + every byte). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// A no-op sync message still yields a 2-byte "empty" Yjs update, so gate
// persistence on the canonical empty encoding rather than byte length. (A
// state-vector comparison would miss deletes: tombstones do not change the
// per-client clocks.)
//
// The canonical empty update is always the 2 bytes `00 00` (verified for
// empty and non-empty docs; deterministic). It is hardcoded rather than
// computed at module scope because computing it needs `new Y.Doc()`, whose
// constructor generates a random client id — a disallowed operation at
// Workers global (module) scope, which crashes `wrangler dev` on start.
const EMPTY_YJS_UPDATE: Uint8Array = new Uint8Array([0, 0]);

export class BoardRoom extends DurableObject<Env> {
  /** Public: integration tests spy/inject through the live instance. */
  store: BoardStore;
  /** Public: mirrors the design state diagram; tests assert on it. */
  state: RoomState = INITIAL_ROOM_STATE;
  /** Public: the retry clock (TC-16 drives it). */
  lastLoadAttemptMs = 0;
  /** Why the current load failed, for logs (null when not load-failed). */
  loadFailureReason: LoadFailureReason | null = null;

  private doc: Y.Doc | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(fromStorage(ctx.storage));
    // The constructor cannot await: the registered lock makes the first
    // request (fetch upgrade or runInDurableObject) wait for the load to
    // finish, so no handler ever sees a half-loaded room.
    void this.ctx.blockConcurrencyWhile(async () => {
      this.loadBoard();
    });
  }

  /**
   * Re-runs the wake path on a live instance and AWAITS the load. Used by
   * onSocketOpen (wake/retry) and by tests to emulate a post-eviction wake
   * (TC-18): workerd cannot be told to evict a DO mid-test, so this is the
   * same code path the constructor runs, while ctx-accepted sockets survive.
   */
  async reload(): Promise<void> {
    this.doc = null;
    this.state = INITIAL_ROOM_STATE;
    this.loadFailureReason = null;
    await this.ctx.blockConcurrencyWhile(async () => {
      this.loadBoard();
    });
  }

  /**
   * RPC (story 5, share.board_api): mark this board as created. Migrates
   * the tables (if missing) and records `created_at` (epoch ms) exactly
   * once; a second call reports the board already exists and leaves
   * `created_at` unchanged (TC-15). The only storage write performed by
   * board creation.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const sql = this.store.storage.sql;
    const existing = sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray();
    if (existing.length > 0) {
      return 'exists';
    }
    sql.exec("INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)", Date.now()).toArray();
    return 'created';
  }

  /** RPC (story 5): read-only existence check (created_at or legacy data). */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** Wake path: load, apply room-owned meta (design sequence).
   *  Story 5: no migrate here — construct must not write, so probing an
   *  unknown link leaves no storage behind (TC-06/TC-09). */
  private loadBoard(): void {
    this.state = INITIAL_ROOM_STATE;
    this.lastLoadAttemptMs = Date.now();
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    if (!result.ok) {
      this.state = nextRoomState(this.state, {
        type: 'load-failure',
        reason: result.reason,
      });
      this.loadFailureReason = result.reason;
      this.doc = null;
      console.error(
        'BoardRoom: board load failed (' + result.reason + '): ' + result.error,
      );
      return;
    }
    if (result.quarantined > 0) {
      console.warn('BoardRoom: quarantined ' + result.quarantined + ' damaged update(s)');
    }
    initDoc(doc, LOAD_ORIGIN);
    this.doc = doc;
    this.state = nextRoomState(this.state, {
      type: 'load-success',
      quarantined: result.quarantined,
    });
  }

  /** True when a LoadFailed room may re-attempt a load now. */
  private retryDue(): boolean {
    return Date.now() - this.lastLoadAttemptMs >= LOAD_RETRY_MIN_INTERVAL_MS;
  }

  /** WebSocket upgrade, or a test-only storage hook (TC-24, TC-31). */
  async fetch(request: Request): Promise<Response> {
    // The worker routes these here only when TEST_HOOKS is '1'; in
    // production they are never registered (requests serve the SPA).
    const action = parseTestHookAction(new URL(request.url).pathname);
    if (action !== null) {
      if (action === 'seed-legacy') {
        return this.testSeedLegacy(request);
      }
      return action === 'corrupt-snapshot'
        ? this.testCorruptSnapshot()
        : this.testRepairSnapshot();
    }
    // Story 5 (share.not_found): rooms can no longer be created implicitly
    // by connecting. Unknown boards are rejected BEFORE accepting a socket;
    // the check is read-only, so probing a link leaves no storage behind.
    if (!this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // ctx-accepted sockets survive hibernation (design key decision 4).
    this.ctx.acceptWebSocket(server);
    // Awaited: a wake/retry must have finished loading (or failed) before
    // we decide whether to sync or close the new socket.
    await this.onSocketOpen(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** New-connection wake/retry logic (design: client opens a failing board). */
  private async onSocketOpen(ws: WebSocket): Promise<void> {
    ws.binaryType = 'arraybuffer';
    if (this.state === 'storage-failed' || this.state === 'hibernated') {
      // A connection after a failed write (or an eviction) is a wake.
      await this.reload();
    } else if (this.state === 'load-failed') {
      // Retry at most every LOAD_RETRY_MIN_INTERVAL_MS; too-early
      // connections get 4500 without a reload attempt (TC-16).
      if (this.retryDue()) {
        await this.reload();
      }
    }
    if (this.state !== 'ready' && this.state !== 'compacting') {
      this.closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc as Y.Doc);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  webSocketMessage(ws: WebSocket, data: MessageEvent['data']): void {
    // A LoadFailed room never applies or stores anything (TC-15).
    if (this.doc === null || this.state !== 'ready' && this.state !== 'compacting') {
      this.closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.reject(ws, decoded.reason);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // No stored awareness in this story (story 6 interprets it).
      return;
    }
    if (decoded.kind === 'awareness') {
      // Relay verbatim to every accepted socket, including the sender:
      // it is also the keepalive traffic that holds idle connections
      // open through hibernation.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, decoded.payload);
      const frame = encoding.toUint8Array(encoder);
      for (const socket of [...this.ctx.getWebSockets()]) {
        this.send(socket, frame);
      }
      return;
    }
    // kind === 'sync'
    this.handleSync(ws, decoded.payload);
  }

  webSocketClose(_ws: WebSocket): void {
    // The runtime tracks accepted sockets itself; when the last one is
    // gone the object may be evicted (design: Ready -> Hibernated).
    if (this.state === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.state = nextRoomState(this.state, { type: 'hibernate' });
    }
  }

  webSocketError(_ws: WebSocket): void {
    // The runtime closes errored sockets; webSocketClose handles state.
  }

  /** Apply, store, then broadcast one sync message from `ws` (TC-12/14/17). */
  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.doc as Y.Doc;
    // State vector delta = the exact bytes this message applied; nothing
    // applied (already known, or rejected) means nothing is stored.
    const before = Y.encodeStateVector(doc);
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    let failed = false;
    try {
      readSyncMessage(decoder, encoder, doc, ws, (error: Error): void => {
        failed = true;
        console.error('BoardRoom: rejected Yjs update: ' + error.message);
      });
    } catch (error) {
      failed = true;
      console.error('BoardRoom: rejected sync message: ' + String(error));
    }
    if (failed) {
      this.reject(ws, 'unsupported data');
      return;
    }
    // Persist and fan out only what this message added to the room's doc, so
    // constructor-time init (meta) never reaches the log. A no-op message
    // (e.g. the handshake) still encodes a 2-byte empty update, so gate on
    // the canonical empty encoding rather than the delta's byte length.
    const delta = Y.encodeStateAsUpdate(doc, before);
    if (!bytesEqual(delta, EMPTY_YJS_UPDATE)) {
      this.storeAndBroadcast(ws, delta);
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 0) {
      // y-protocols writes bare sync sub-messages; the y-websocket wire
      // format appends them RAW after the MESSAGE_SYNC type byte
      // (no length prefix — see protocol.ts).
      const outer = encoding.createEncoder();
      encoding.writeVarUint(outer, MESSAGE_SYNC);
      encoding.writeUint8Array(outer, reply);
      this.send(ws, encoding.toUint8Array(outer));
    }
  }

  /** Store before broadcast; a write failure resets the room (TC-14). */
  private storeAndBroadcast(sender: WebSocket, delta: Uint8Array): void {
    const doc = this.doc as Y.Doc;
    try {
      this.store.append(delta);
    } catch (error) {
      console.error('BoardRoom: storage write failed: ' + String(error));
      this.state = nextRoomState(this.state, { type: 'storage-failure' });
      this.doc = null;
      for (const socket of [...this.ctx.getWebSockets()]) {
        this.closeQuietly(socket, CLOSE_STORAGE_FAILURE, 'storage failure');
      }
      return;
    }
    this.state = nextRoomState(this.state, { type: 'update' });
    this.broadcast(sender, delta);
    if (this.store.needsCompaction()) {
      this.state = nextRoomState(this.state, { type: 'compaction-start' });
      const compacted = this.store.compactIfNeeded(doc);
      this.state = nextRoomState(this.state, {
        type: compacted ? 'compaction-success' : 'compaction-rollback',
      });
    }
  }

  /** Forward one document update to every accepted socket but its origin. */
  private broadcast(origin: WebSocket, update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of [...this.ctx.getWebSockets()]) {
      if (socket !== origin) {
        this.send(socket, frame);
      }
    }
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      // A send to a dead socket must not take the room down: just drop it.
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    this.closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, reason);
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /**
   * Test-only (TC-24): corrupt the board's compacted snapshot. Saves the
   * original chunk 0 to KV, overwrites it with same-length junk, then re-runs
   * the REAL load path so the room loads the damaged snapshot and enters
   * load-failed (new sockets are closed 4500 -> client load_failed).
   */
  private async testCorruptSnapshot(): Promise<Response> {
    const chunk0 = ensureSnapshotChunk0(this.store);
    if (chunk0 === null) {
      return hookJson({ ok: false, error: 'empty board: no snapshot to corrupt' }, 400);
    }
    await this.ctx.storage.put(TEST_HOOK_BACKUP_KEY, toHex(chunk0));
    overwriteChunk0(this.store, new Uint8Array(chunk0.byteLength).fill(0xab));
    await this.reload();
    return hookJson({ ok: true, action: 'corrupt-snapshot', bytes: chunk0.byteLength });
  }

  /**
   * Test-only (story 5 TC-31): seed a LEGACY board — real tables plus
   * `updates` rows but NO `created_at` marker, exactly the shape of a
   * story-4-era board with saved content. The request body is a
   * hex-encoded Yjs update; it is verified against a scratch doc first.
   */
  private async testSeedLegacy(request: Request): Promise<Response> {
    const hex = (await request.text()).trim();
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      return hookJson({ ok: false, error: 'body must be a hex-encoded Yjs update' }, 400);
    }
    const bytes = fromHex(hex);
    const scratch = new Y.Doc();
    try {
      Y.applyUpdate(scratch, bytes);
    } catch (error) {
      return hookJson({ ok: false, error: 'update does not apply: ' + String(error) }, 400);
    }
    // Legacy shape: the old migrate() (tables + schema version) and log
    // rows, but no created_at — existsReadOnly() must find it via the
    // updates rows (share.legacy_boards).
    this.store.migrate();
    this.store.append(bytes);
    // The room's in-memory doc predates the seed: re-run the real load path
    // so the room serves the seeded board.
    await this.reload();
    return hookJson({ ok: true, action: 'seed-legacy', bytes: bytes.byteLength });
  }

  /**
   * Test-only (TC-24): restore the snapshot from the corrupt hook's backup.
   * Deliberately does NOT reload: the room stays load-failed and the
   * client's next retry (after LOAD_RETRY_MIN_INTERVAL_MS) reloads the
   * repaired snapshot — the board appears without a page reload.
   */
  private async testRepairSnapshot(): Promise<Response> {
    // The stored backup is a hex string (see test-hooks.ts).
    const hex = (await this.ctx.storage.get(TEST_HOOK_BACKUP_KEY)) as string | null;
    if (hex === null) {
      return hookJson({ ok: false, error: 'no snapshot backup to restore' }, 400);
    }
    const bytes = fromHex(hex);
    overwriteChunk0(this.store, bytes);
    return hookJson({ ok: true, action: 'repair', bytes: bytes.byteLength });
  }
}

function hookJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
