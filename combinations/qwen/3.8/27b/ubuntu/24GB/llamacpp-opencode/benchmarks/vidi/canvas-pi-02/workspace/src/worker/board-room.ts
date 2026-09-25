import { DurableObject, type DurableObjectStorage } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  decodeMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, shouldCompact, type LoadResult } from './board-store';
import { nextRoomState, type RoomState } from './room-state';
import { TEST_HOOK_HOST } from './test-hooks';

/**
 * One BoardRoom per board (story 4 — persistent).
 *
 * The board's Y.Doc is reloaded from the object's SQLite storage on
 * construction (and on every wake) by a `BoardStore`; every accepted update
 * is appended to the `updates` log BEFORE it is broadcast (the platform's
 * output gates hold the broadcast until the write is confirmed durable), and
 * the log is compacted into a chunked snapshot once it grows past the
 * threshold. An unreadable snapshot or a SQL read error puts the room into
 * `load-failed`: new connections are closed with CLOSE_BOARD_LOAD_FAILED
 * (4500) and a load is retried at most once per LOAD_RETRY_MIN_INTERVAL_MS.
 * An update whose insert fails puts the room into `storage-failed`: every
 * socket is closed with CLOSE_STORAGE_FAILURE (1011), the in-memory doc is
 * discarded, and the next connection reloads (open tabs re-send their
 * unsaved changes through the sync handshake, so nothing is lost).
 *
 * Sockets are accepted with `ctx.acceptWebSocket` (the hibernation API): an
 * idle board with open sockets consumes no compute, and a message or a new
 * connection wakes the object — the platform reconstructs the instance
 * (constructor runs again, doc reloaded) before dispatching the event.
 *
 * y-websocket protocol (unchanged from story 3): a joiner's SyncStep1 is
 * answered with SyncStep2 (everything the client is missing) and a separate
 * SyncStep1 (a request for the client's state) — two frames, because the
 * y-websocket client processes at most one top-level message per WebSocket
 * frame. Later SyncStep2/Update frames are persisted and broadcast to every
 * other socket. Awareness frames are relayed verbatim to everyone, sender
 * included, which doubles as the keep-alive each client's 30 s watchdog
 * needs while everyone idles.
 */
export class BoardRoom extends DurableObject {
  private readonly store: BoardStore;
  /** The in-memory doc; null while (re)loading, after a failed load, or after a storage failure. */
  private doc: Y.Doc | null;
  /** Consolidated peer presence; rebuilt on every load. */
  private roomAwareness: awarenessProtocol.Awareness | null;
  private state: RoomState = 'loading';
  /** When the last failed load attempt happened (retry-interval gate). */
  private lastLoadFailedAt: number | null = null;
  /**
   * Size of the updates log, kept in memory (seeded at load, bumped per
   * append, reset after compaction) so the compaction threshold check costs
   * O(1) instead of a full log scan per update.
   */
  private logCount = 0;
  private logBytes = 0;
  private readonly docUpdateHandler: (update: Uint8Array, origin: unknown) => void;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.doc = null;
    this.roomAwareness = null;
    this.docUpdateHandler = (update, origin) => this.onDocUpdate(update, origin);
    // Load before anything else may run on this instance.
    const done = Promise.resolve(this.loadNow());
    ctx.blockConcurrencyWhile(() => done);
  }

  /** Number of sockets currently attached (observability and tests). */
  get connectionCount(): number {
    return this.ctx.getWebSockets().length;
  }

  /** The board's store (tests use it to inject storage failures). */
  get storeForTest(): BoardStore {
    return this.store;
  }

  /**
   * Test seam: compact now, regardless of the size thresholds (keeps the
   * room's in-memory counters consistent with the log).
   */
  compactForTest(): boolean {
    if (this.doc === null || this.state !== 'ready') return false;
    const ok = this.store.compact(this.doc);
    if (ok) {
      this.logCount = 0;
      this.logBytes = 0;
    }
    return ok;
  }

  /** Test seam: raw storage access (tests corrupt snapshot chunks). */
  get storageForTest(): DurableObjectStorage {
    return this.ctx.storage;
  }

  /**
   * Test seam (TC-24, gated behind TEST_HOOKS in the worker entry): break the
   * board's snapshot the way a corrupted write would — chunk 0 is replaced
   * with garbage, the original saved in `test_corrupt` so `repairSnapshotForTest`
   * can restore it. The in-memory doc is untouched: the corruption takes
   * effect at the next load, which is exactly the failure mode under test.
   */
  async corruptSnapshotForTest(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
      .toArray();
    if (rows.length === 0) {
      throw new Error('no snapshot chunk 0 to corrupt (compact the board first)');
    }
    const original = new Uint8Array(rows[0]!.data as ArrayBuffer);
    sql.exec('CREATE TABLE IF NOT EXISTS test_corrupt (idx INTEGER PRIMARY KEY, data BLOB)');
    sql.exec('DELETE FROM test_corrupt');
    sql.exec('INSERT INTO test_corrupt (idx, data) VALUES (0, ?1)', original);
    sql.exec('UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0', new Uint8Array(64).fill(0xff));
  }

  /**
   * Test seam (TC-24, paired with `corruptSnapshotForTest`): restore snapshot
   * chunk 0 from the saved original. Throws when nothing was corrupted.
   */
  async repairSnapshotForTest(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec('SELECT data FROM test_corrupt WHERE idx = 0').toArray();
    if (rows.length === 0) throw new Error('nothing to repair (corrupt first)');
    const original = new Uint8Array(rows[0]!.data as ArrayBuffer);
    sql.exec('UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0', original);
    sql.exec('DELETE FROM test_corrupt');
  }

  /**
   * Test seam: simulate hibernation — discard the in-memory state (doc,
   * awareness, ready state) while the platform keeps the accepted sockets;
   * the next message or connection wakes the room and reloads from storage,
   * exactly as the platform does when it reconstructs a hibernated object.
   */
  resetForTest(): void {
    if (this.doc !== null) {
      this.doc.off('update', this.docUpdateHandler);
      this.doc = null;
    }
    this.roomAwareness = null;
    if (this.state !== 'load-failed') {
      this.state = 'hibernated';
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Private test-hook call forwarded by the worker (story 4, TC-24): no
    // socket, just run the storage operation. A public request can never
    // carry this hostname — the worker is the only thing that constructs
    // these requests, and only when TEST_HOOKS is enabled.
    const hookUrl = new URL(request.url);
    if (hookUrl.hostname === TEST_HOOK_HOST) {
      try {
        if (hookUrl.pathname === '/corrupt-snapshot') {
          await this.corruptSnapshotForTest();
        } else if (hookUrl.pathname === '/repair') {
          await this.repairSnapshotForTest();
        } else if (hookUrl.pathname === '/hibernate') {
          // Discard the in-memory state so the NEXT connection must load from
          // storage — the same transition the platform makes when it
          // reconstructs a hibernated object (deterministic in a test).
          this.resetForTest();
        } else {
          return new Response('Not Found', { status: 404 });
        }
        return new Response(null, { status: 204 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`test hook failed: ${message}`, { status: 500 });
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // A new connection wakes a hibernated or storage-failed room and may
    // retry a failed load (at most once per retry interval).
    if (this.state === 'hibernated') {
      this.state = nextRoomState('hibernated', { type: 'woken' });
      this.blockLoad(() => this.loadNow());
    } else if (this.state === 'storage-failed') {
      this.state = nextRoomState('storage-failed', { type: 'connected', retryAllowed: true });
      this.blockLoad(() => this.loadNow());
    } else if (this.state === 'load-failed') {
      const retryAllowed =
        this.lastLoadFailedAt === null ||
        Date.now() - this.lastLoadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS;
      this.state = nextRoomState('load-failed', { type: 'connected', retryAllowed });
      if (this.state === 'loading') {
        this.blockLoad(() => this.loadNow());
      }
    }

    if (this.state !== 'ready' || this.doc === null) {
      // The board is unreadable (or the retry interval has not elapsed):
      // accept, then refuse with the dedicated close code.
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return new Response(null, { status: 101, webSocket: client });
    }

    // A joiner learns about the editors already in the room right away
    // (otherwise only at the next ~15 s awareness keep-alive).
    server.binaryType = 'arraybuffer';
    const clientIDs = Array.from(this.roomAwareness?.getStates().keys() ?? []);
    if (clientIDs.length > 0) {
      this.safeSend(server, this.awarenessFrameFor(clientIDs));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- hibernation-API socket handlers -------------------------------------

  webSocketMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.state === 'storage-failed') {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    if (this.state === 'hibernated') {
      // Test-seam wake (the platform reconstructs real hibernated objects
      // before dispatching, so this branch only runs for resetForTest()).
      this.state = nextRoomState('hibernated', { type: 'woken' });
      this.blockLoad(() => this.loadNow());
    }
    if (this.state !== 'ready' || this.doc === null) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'room unavailable');
      return;
    }
    try {
      this.onMessage(socket, data);
    } catch {
      // A handler bug must never take the room down for everyone else.
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'internal error');
    }
  }

  webSocketClose(_socket: WebSocket, _code: number, _reason: string): void {
    // The platform already removed the socket from getWebSockets(); the
    // awareness module prunes vanished peers on its 30 s timeout — the same
    // cleanup each client does locally.
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'socket error');
  }

  // --- loading ---------------------------------------------------------------

  /**
   * Run a synchronous load while blocking concurrent handlers on this
   * instance. The load must run NOW, not inside the thunk: workerd defers
   * the thunk passed to `blockConcurrencyWhile`, so callers that continue
   * after this line (fetch, webSocketMessage) would observe a stale state.
   * The already-settled promise is the concurrency-block token.
   */
  private blockLoad(load: () => void): void {
    const done = Promise.resolve(load());
    this.ctx.blockConcurrencyWhile(() => done);
  }

  /** Migrate + load the persisted state into a fresh doc; set the room state. */
  private loadNow(): void {
    this.state = 'loading';
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      result = this.store.load(doc);
    } catch (err) {
      result = { ok: false, reason: 'sql-error', error: String(err) };
    }
    if (!result.ok) {
      // Unreadable snapshot or SQL error: refuse to serve an empty doc.
      this.doc = null;
      this.roomAwareness = null;
      this.state = 'load-failed';
      this.lastLoadFailedAt = Date.now();
      return;
    }
    this.doc = doc;
    this.roomAwareness = new awarenessProtocol.Awareness(doc);
    this.roomAwareness.setLocalState(null);
    this.doc.on('update', this.docUpdateHandler);
    this.logCount = result.logCount;
    this.logBytes = result.logBytes;
    this.state = nextRoomState('loading', { type: 'loaded', quarantined: result.quarantined });
  }

  // --- persistence hook ------------------------------------------------------

  /**
   * Fires for every update applied to the doc, in the middle of the
   * applying `applyUpdate` call: persist first (a throw becomes
   * storage-failed), then broadcast to everyone except the origin (output
   * gates hold the sends until the write is durable), then compact if the
   * log crossed a threshold.
   */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    try {
      this.store.append(update);
    } catch {
      this.failStorage();
      return;
    }
    if (this.state !== 'ready') return; // failStorage moved it (defensive)
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    const originSocket = origin instanceof WebSocket ? origin : null;
    this.broadcast(originSocket, toUint8Array(frame), /* includeSender= */ false);
    this.logCount += 1;
    this.logBytes += update.byteLength;
    if (shouldCompact(this.logCount, this.logBytes)) {
      this.state = nextRoomState(this.state, { type: 'compaction-start' });
      const success = this.doc !== null && this.store.compact(this.doc);
      if (success) {
        // The transaction truncated the log; restart the counters.
        this.logCount = 0;
        this.logBytes = 0;
      }
      this.state = nextRoomState(this.state, { type: 'compaction-done', success });
    }
  }

  /**
   * An insert failed: the change is not broadcast, every socket is closed
   * with 1011, and the in-memory doc is discarded. Reconnecting clients
   * re-send what the server lacks through the sync handshake, so unsaved
   * changes are retried from open pages.
   */
  private failStorage(): void {
    this.state = nextRoomState(this.state, { type: 'storage-failed' });
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'storage failure');
    }
    if (this.doc !== null) {
      this.doc.off('update', this.docUpdateHandler);
      this.doc = null;
    }
    this.roomAwareness = null;
  }

  // --- inbound frames ------------------------------------------------------

  private onMessage(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(socket, decoded.payload);
        return;
      case 'awareness':
        if (this.roomAwareness === null) return;
        try {
          awarenessProtocol.applyAwarenessUpdate(this.roomAwareness, decoded.payload, socket);
        } catch {
          // Structurally valid frame with corrupt content (e.g. bad JSON
          // state): ignore it rather than dropping the connection over
          // ephemeral presence data.
        }
        // Relay to everyone, sender included (see the class doc for why).
        const frame = createEncoder();
        writeVarUint(frame, MESSAGE_AWARENESS);
        writeVarUint8Array(frame, decoded.payload);
        this.broadcast(socket, toUint8Array(frame), /* includeSender= */ true);
        return;
      case 'query-awareness': {
        const clientIDs = Array.from(this.roomAwareness?.getStates().keys() ?? []);
        if (clientIDs.length > 0) {
          this.safeSend(socket, this.awarenessFrameFor(clientIDs));
        }
        return;
      }
    }
  }

  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const doc = this.doc;
    if (doc === null) return;
    const decoder = createDecoder(payload);
    const type = readVarUint(decoder);
    switch (type) {
      case SYNC_STEP1: {
        const clientStateVector = readVarUint8Array(decoder);
        // Everything the client is missing, plus a request for what we are.
        // A 0-byte state vector means "the client knows nothing", in which
        // case the SyncStep2 carries the whole document. (yjs itself throws
        // on an empty binary state vector, so stand in one from a fresh
        // doc — a client id the room has certainly never seen.)
        const step2 = createEncoder();
        writeVarUint(step2, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(
          step2,
          doc,
          clientStateVector.length > 0 ? clientStateVector : Y.encodeStateVector(new Y.Doc()),
        );
        this.safeSend(socket, toUint8Array(step2));
        // The request for the client's state MUST be a separate WebSocket
        // message: the y-websocket client processes at most one top-level
        // message per frame, so a [Step2, Step1] pair in one frame would
        // drop the Step1 and the client would never send its own (pre-
        // connection) content to the room.
        const step1 = createEncoder();
        writeVarUint(step1, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(step1, doc);
        this.safeSend(socket, toUint8Array(step1));
        return;
      }
      case SYNC_STEP2:
      case SYNC_UPDATE: {
        const update = readVarUint8Array(decoder);
        this.ingestUpdate(socket, update);
        return;
      }
      default:
        // decodeMessage has already rejected unknown sync types; belt and braces.
        this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'unknown sync message type');
    }
  }

  /**
   * Apply an inbound update to the room doc. Undecodable or rejected
   * updates close the sender with 1003 and are never stored. Persist and
   * broadcast happen in the doc's 'update' hook (write before broadcast).
   */
  private ingestUpdate(socket: WebSocket, update: Uint8Array): void {
    const doc = this.doc;
    if (update.length === 0 || doc === null) return;
    try {
      Y.applyUpdate(doc, update, socket);
    } catch {
      this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
    }
  }

  // --- outbound frames -----------------------------------------------------

  private awarenessFrameFor(clientIDs: number[]): Uint8Array {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_AWARENESS);
    writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.roomAwareness, clientIDs),
    );
    return toUint8Array(encoder);
  }

  private broadcast(sender: WebSocket | null, frame: Uint8Array, includeSender: boolean): void {
    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket === sender && !includeSender) {
        continue;
      }
      this.safeSend(socket, frame);
    }
  }

  private safeSend(socket: WebSocket, frame: Uint8Array): void {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      }
    } catch {
      // The socket closed between the readyState check and the send.
      // Dropping the frame is correct.
    }
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already closing or closed.
    }
  }
}
