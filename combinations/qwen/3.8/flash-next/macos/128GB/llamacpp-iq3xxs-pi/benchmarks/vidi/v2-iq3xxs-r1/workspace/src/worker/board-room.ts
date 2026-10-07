import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, chunkBytes, type LoadResult } from './board-store';
import type { Env } from './index';

/** `WebSocket.OPEN` (readyState 1); the runtime does not expose the constant. */
const WS_OPEN = 1;

/**
 * The board room (story 3 `sync.room` + story 4 `persist.room`).
 *
 * One Durable Object per board id. The Y.Doc is the single source of truth: every
 * update received from a socket is applied, stored in SQLite and broadcast to the
 * other sockets of the *same* object instance only (TC-11, TC-12).
 *
 * It uses the Durable Object **hibernation** API (`ctx.acceptWebSocket` plus the
 * `webSocketMessage`/`webSocketClose`/`webSocketError` handlers). Story 3 avoided
 * hibernation only because the document lived in memory; story 4 moves the document
 * to SQLite, so an idle board now costs no compute — the document is dropped when
 * the last socket leaves and reloaded from storage on the next connection, and a
 * hibernated object reloads from the same log when the runtime wakes it (PRD
 * persist.reload, persist.wake).
 *
 * Every change is stored in the same turn it is applied and *before* it is
 * broadcast (PRD persist.save_first): a client is never told a change landed that
 * SQLite did not accept.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly store: BoardStore;
  private doc: Y.Doc | undefined;
  /** Coarse lifecycle status; `room-state.ts` holds the full transition table. */
  private status:
    | 'unknown' // nothing stored at this id: it was never created (story 5)
    | 'loading'
    | 'ready'
    | 'load-failed'
    | 'storage-failed'
    | 'hibernated' = 'unknown';
  private loadFailedAt = 0;

  /** Board id for logs: the deterministic id the namespace derived from the slug. */
  private readonly boardId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.boardId = String(ctx.id);
    this.store = new BoardStore(ctx.storage, this.boardId);
    // Finish the first load before any request is handled (design "cold start").
    ctx.blockConcurrencyWhile(async () => {
      this.bootstrap();
    });
  }

  // ------------------------------------------------------- board existence (RPC)
  //
  // Story 5 makes a board's existence an explicit fact instead of a side effect of
  // someone connecting. Both methods are callable over Durable Object RPC from the
  // Worker (`POST /api/boards`, `GET /api/boards/:id`), and neither is reached for a
  // malformed id — the Worker validates the address first (TC-07).

  /**
   * Create this board: build the tables and stamp `created_at` once. `created` the
   * first time, `exists` for every call afterwards, so a board can never be
   * re-initialised over real work (TC-15). Called by `createBoard()` only.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const stamped = this.store.markCreatedAt(Date.now());
    if (!stamped) return 'exists';
    // The board is now real; from here it behaves like any existing (possibly
    // still-empty) board, whose document is loaded when the first socket arrives.
    if (this.status === 'unknown') this.status = 'hibernated';
    return 'created';
  }

  /**
   * Read-only answer to "does this board exist?" (PRD share.open_link, share.not_found).
   * It never creates a table, so a person poking at made-up links leaves nothing behind.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** WebSocket upgrade only; everything else is refused without closing anything. */
  async fetch(request: Request): Promise<Response> {
    // A board that does not exist is not served, and not created on the way (PRD
    // share.not_found): connecting to a mistyped or truncated link gets 404 instead of
    // an empty board that quietly saves under the wrong address.
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket connection', { status: 426 });
    }
    // Story 3 rejected the sync protocol path rather than serve two protocols.
    const protocol = new URL(request.url).searchParams.get('format');
    if (protocol === 'sync') {
      return new Response('the realtime sync protocol is not enabled in this story', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const gate = this.allowConnection();
    this.ctx.acceptWebSocket(server);
    if (!gate.ok) {
      server.close(gate.code); // the client still sees the code after the handshake
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ask the newcomer for its state: a client reconnecting to a restarted or
    // hibernated room answers with everything the room is missing.
    if (this.doc) this.send(server, syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc!)));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Decide whether a new socket may be served, loading the document first if the
   * room is cold. Returns the close code to send when the board cannot be served:
   * `4500` for a failed load (throttled), `1011` for a storage failure.
   */
  private allowConnection(): { ok: true } | { ok: false; code: number } {
    // A failed load is retried, but never more than once per LOAD_RETRY_MIN_INTERVAL_MS.
    if (this.status === 'load-failed' && Date.now() - this.loadFailedAt < LOAD_RETRY_MIN_INTERVAL_MS) {
      return { ok: false, code: CLOSE_BOARD_LOAD_FAILED };
    }
    if (this.doc) return { ok: true }; // warm: already loaded

    const result = this.loadIntoFreshDoc(); // cold, waking, or recovering from a storage failure
    if (result.ok) return { ok: true };
    return { ok: false, code: result.code };
  }

  // -------------------------------------------------------------- websocket API

  webSocketMessage(webSocket: WebSocket, data: string | ArrayBuffer): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Close exactly this socket; the room and the others carry on (TC-15).
      this.close(webSocket, CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (decoded.kind === 'query-awareness') return; // no stored awareness in this story
    if (decoded.kind === 'awareness') {
      // Relay verbatim, including to the sender, to keep idle clients alive (TC-16).
      this.broadcast(new Uint8Array(data as ArrayBuffer), null);
      return;
    }

    const doc = this.doc;
    if (!doc) return; // a room that is not serving a document ignores document traffic

    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let unreadable: unknown = null;
    try {
      // Applying here fires `doc.on('update')`, which stores and relays the change.
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        reply,
        doc,
        webSocket, // origin: the update listener skips the echo back to the sender
        (error: unknown) => {
          unreadable = error; // y-protocols reports a broken update here, not by throwing
        },
      );
    } catch (error) {
      unreadable = error;
    }
    if (unreadable) {
      this.close(webSocket, CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (encoding.length(reply) > 1) this.send(webSocket, encoding.toUint8Array(reply));
  }

  webSocketClose(): void {
    // When the last socket goes, drop the document: an idle board then costs no
    // memory or compute, and the next connection reloads it from storage (TC-13).
    if (this.ctx.getWebSockets().length === 0) this.goCold();
  }

  webSocketError(webSocket: WebSocket): void {
    this.close(webSocket, CLOSE_STORAGE_FAILURE);
    if (this.ctx.getWebSockets().length === 0) this.goCold();
  }

  // ------------------------------------------------------------- document + store

  /** The room is cold: no document in memory, but the log is untouched on disk. */
  private goCold(): void {
    this.doc = undefined;
    if (this.status === 'ready') this.status = 'hibernated';
  }

  /**
   * First load in the constructor, and only for a board that exists: reading a
   * never-created board's storage must leave it empty (PRD share.not_found), so this
   * asks `existsReadOnly()` first and creates nothing itself.
   */
  private bootstrap(): void {
    if (!this.store.existsReadOnly()) {
      this.status = 'unknown';
      return;
    }
    // `hibernated` and `unknown` are the only states a cold object can start in here;
    // `loadIntoFreshDoc` moves it to `ready` or `load-failed`.
    this.status = 'hibernated';
    const result = this.loadIntoFreshDoc();
    if (!result.ok && result.code === CLOSE_BOARD_LOAD_FAILED) this.loadFailedAt = Date.now();
  }

  /**
   * Build a document from storage and make it the served one, or record the failure
   * and leave `doc` undefined so nothing half-built is ever served.
   */
  private loadIntoFreshDoc(): { ok: true } | { ok: false; code: number } {
    this.status = 'loading';
    const doc = this.makeDoc();
    let result: LoadResult;
    try {
      // No `migrate()` here: `load()` reads the tables that exist (and reports an
      // empty board when they do not), and the first `append()` creates them.
      result = this.store.load(doc);
    } catch (error) {
      // Reading storage itself blew up: refuse to serve, and tell the client 1011.
      return this.failLoad('sql-error', error);
    }
    if (result.ok) {
      this.doc = doc;
      this.status = 'ready';
      return { ok: true };
    }
    return this.failLoad(result.reason, result.error);
  }

  private failLoad(reason: string, error: unknown): { ok: false; code: number } {
    // Any load failure — an unreadable snapshot or a SQL read error — is the same
    // outcome to the client: refuse to serve, close with 4500, and throttle retries
    // (design TC-26: a SQL read failure closes new sockets with 4500 too). A
    // `storage-failed` room is different: it is only ever reached from a *write*
    // failure while connected, and simply reloads on the next connection.
    this.doc = undefined;
    this.status = 'load-failed';
    this.loadFailedAt = Date.now();
    console.error(
      JSON.stringify({
        level: 'error',
        board: this.boardId,
        event: 'load_rejected',
        reason,
        code: CLOSE_BOARD_LOAD_FAILED,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 100),
      }),
    );
    return { ok: false, code: CLOSE_BOARD_LOAD_FAILED };
  }

  private makeDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Changes read back out of storage are not new and must not be re-stored.
      if (origin === LOAD_ORIGIN) return;
      try {
        this.store.append(update); // store FIRST, in this same synchronous turn
      } catch (error) {
        // A board we cannot write must not keep being served (PRD persist.save_failure).
        this.handleStorageFailure(error);
        return; // do NOT broadcast a change we failed to store
      }
      // `origin` is the socket the update arrived on; the sender never sees its own change.
      this.broadcast(syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)), origin);
    });
    return doc;
  }

  /**
   * SQLite refused to store a change: close every client with 1011 (they reconnect),
   * drop the in-memory document, and mark the room storage-failed. A later
   * connection retries the load once storage has recovered (TC-16).
   */
  private handleStorageFailure(error: unknown): void {
    this.status = 'storage-failed';
    console.error(
      JSON.stringify({
        level: 'error',
        board: this.boardId,
        event: 'storage_write_failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 100),
      }),
    );
    for (const socket of this.ctx.getWebSockets()) this.close(socket, CLOSE_STORAGE_FAILURE);
    this.doc = undefined;
  }

  // ------------------------------------------------------------------ websocket

  private broadcast(bytes: Uint8Array, except: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WS_OPEN) continue;
      this.send(socket, bytes);
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    if (socket.readyState !== WS_OPEN) return;
    try {
      socket.send(bytes);
    } catch {
      // A peer we can no longer write to; the runtime has already dropped it.
    }
  }

  private close(socket: WebSocket, code: number): void {
    try {
      socket.close(code);
    } catch {
      // already closing: nothing to do
    }
  }

  // ------------------------------------------------------------------- test hooks

  /**
   * Test-only (PRD share.legacy_boards, e2e TC-31): put real Yjs updates in this
   * board's log **without** `created_at`, which is exactly what a board created
   * before story 5 looked like. Reached only through the `TEST_HOOKS` route.
   */
  async testSeedLegacy(updates: string[]): Promise<{ rows: number }> {
    this.store.migrate();
    let rows = 0;
    for (const update of updates) {
      const bytes = base64ToBytes(update);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      this.ctx.storage.sql.exec(
        'INSERT INTO updates (data, bytes) VALUES (?, ?)',
        buffer,
        bytes.byteLength,
      );
      rows += 1;
    }
    return { rows };
  }
  // Reached only through the `/__test/boards/:id/...` routes, which are registered
  // only when `env.TEST_HOOKS === '1'` (never in production). They exist so an e2e
  // test can put a *real, compacted* board into a damaged state and then repair it,
  // to prove the client shows an honest load failure and recovers without reload
  // (design TC-24). They drive the same SQLite the room itself uses.

  /**
   * Fold the stored board into a real snapshot through the same chunking code the
   * room uses, then damage snapshot chunk 0 so a later load fails with
   * `snapshot-unreadable`. The original bytes are kept so `testRepairSnapshot` can
   * put them back. Called through the gated route only.
   */
  async testCorruptSnapshot(): Promise<{ chunks: number }> {
    this.store.migrate();
    const doc = new Y.Doc();
    const result: LoadResult = this.store.load(doc);
    if (!result.ok) throw new Error('cannot corrupt a board that does not load');

    const encoded = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(encoded);
    const maxSeq =
      this.ctx.storage.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates').one().m ?? 0;
    this.ctx.storage.sql.exec('DELETE FROM snapshot_chunks');
    chunks.forEach((chunk, idx) => {
      const buf = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buf).set(chunk);
      this.ctx.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, buf);
    });
    if (maxSeq > 0) this.ctx.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
    this.setMeta('snapshot_through_seq', String(maxSeq));

    // Keep the true chunk 0, then overwrite it with garbage of the same length.
    const original = new Uint8Array(
      this.ctx.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data,
    );
    this.setMeta('test_orig_chunk0', bytesToBase64(original));
    // Full random bytes, not a scramble: Yjs tolerates a deterministically
    // transformed update but rejects a genuinely malformed one (the same damage the
    // unit/integration store tests use to prove `snapshot-unreadable`).
    const garbage = new Uint8Array(original.byteLength);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (Math.floor(Math.random() * 255) + 1) & 0xff;
    const gbuf = new ArrayBuffer(garbage.byteLength);
    new Uint8Array(gbuf).set(garbage);
    this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', gbuf);
    return { chunks: chunks.length };
  }

  /** Read-only diagnostic: what storage currently holds, and whether it loads. */
  async testBoardSummary(): Promise<{
    chunks: number;
    updates: number;
    through: number;
    loadOk: boolean;
    reason?: string;
    notes: number;
  }> {
    this.store.migrate();
    const sql = this.ctx.storage.sql;
    const chunks = sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
    const updates = sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates').one().c;
    const through =
      Number(this.getMeta('snapshot_through_seq') ?? '0') || 0;
    const doc = new Y.Doc();
    const result = this.store.load(doc);
    const notes = Array.from(doc.getMap('notes').keys()).length;
    return {
      chunks,
      updates,
      through,
      loadOk: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
      notes,
    };
  }

  /** Restore the saved chunk 0, making the snapshot loadable again. */
  async testRepairSnapshot(): Promise<void> {
    const saved = this.getMeta('test_orig_chunk0');
    if (saved === undefined) throw new Error('nothing to repair: no saved chunk 0');
    const original = base64ToBytes(saved);
    const buf = new ArrayBuffer(original.byteLength);
    new Uint8Array(buf).set(original);
    this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', buf);
    this.ctx.storage.sql.exec('DELETE FROM storage_meta WHERE key = ?', 'test_orig_chunk0');
    // A load that had failed is retried only after LOAD_RETRY_MIN_INTERVAL_MS; drop the
    // throttle so the still-open client's next reconnect loads immediately.
    this.loadFailedAt = 0;
    this.status = this.doc ? 'ready' : 'hibernated';
    this.doc = undefined;
  }

  private getMeta(key: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
      .next();
    return row.done ? undefined : row.value.value;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** One y-websocket sync frame: type byte + y-protocols message. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
