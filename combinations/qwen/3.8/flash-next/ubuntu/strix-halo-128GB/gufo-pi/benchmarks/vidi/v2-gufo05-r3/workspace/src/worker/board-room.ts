/**
 * `BoardRoom` — one Durable Object per board.
 *
 * Responsibilities:
 *
 * 1. **Keep the board** (story 4): the object's SQLite storage holds it, through
 *    {@link BoardStore}; the `Y.Doc` in memory is a cache of that. The board is
 *    read before the object answers anything, and a board that cannot be read is
 *    *reported* — never presented as an empty board.
 * 2. **Save before telling**: an update is applied and written in the same turn,
 *    and only then relayed. If the write fails, nobody has been shown that
 *    change: every socket closes with 1011 and each page keeps its own copy, to
 *    send again when it reconnects.
 * 3. **Relay in real time** (story 2): apply the update, broadcast it to the others.
 * 4. **Reconcile on connect** (story 3): `SyncStep1` asks a newcomer for what the
 *    room lacks, so a page reload, a reconnect after an outage and a late joiner
 *    all work.
 *
 * Sockets are accepted with the hibernation API (`ctx.acceptWebSocket`) and listed
 * with `ctx.getWebSockets()` — the room keeps no socket set of its own, so the
 * runtime is free to evict this object between events. A woken room reloads the
 * board and carries on: a socket that was accepted before the eviction is still
 * open, and the board in memory comes from storage either way.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import type { Env } from './index';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { isLoadRetryDue, nextRoomState, type RoomStateName } from './room-state';
import { parseTestHook, testHooksEnabled, type TestHookName } from './test-hooks';

/** Close reasons: what a debugging client sees, never what a person reads. */
const REASON_LOAD_FAILED = 'this board could not be loaded';
const REASON_STORAGE_FAILURE = 'this board could not be saved';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export class BoardRoom extends DurableObject<Env> {
  /**
   * The board's storage. Public so a test can drive it into the states a real
   * database reaches on its own (an insert that throws, a load that fails).
   */
  readonly store: BoardStore;

  /** The board in memory, or `null` whenever the room cannot serve it. */
  private boardDoc: Y.Doc | null = null;
  private state: RoomStateName = 'loading';
  /** When the board last failed to load: the retry interval starts here. */
  private loadFailedAt = 0;
  /** The load in flight, shared by everything that asks while it runs. */
  private loading: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Nothing is processed before the board is in memory — not a connection, not
    // a message. The load is synchronous work, so this holds for one microtask.
    ctx.blockConcurrencyWhile(async () => {
      await this.ensureReady();
    });
  }

  // --- loading and failure states -------------------------------------------

  /**
   * Make the board available, honouring the retry interval after a failed load.
   * Resolves `true` when the room can serve the board.
   */
  private ensureReady(): Promise<boolean> {
    if (this.state === 'ready' && this.boardDoc !== null) return Promise.resolve(true);
    if (this.state === 'load-failed' && !isLoadRetryDue(Date.now() - this.loadFailedAt)) {
      return Promise.resolve(false);
    }
    if (this.loading === null) {
      this.loading = this.loadBoard().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  /**
   * Read storage into a fresh document: create the tables if needed, apply the
   * snapshot and the updates after it. An empty board is a successful load, and so
   * is a board that opened after one damaged update was quarantined.
   */
  private async loadBoard(): Promise<boolean> {
    const previous = this.state;
    this.state =
      previous === 'load-failed'
        ? nextRoomState(previous, {
            type: 'connect',
            elapsedMs: Date.now() - this.loadFailedAt,
          })
        : nextRoomState(
            previous,
            previous === 'storage-failed' ? { type: 'next-connection' } : { type: 'woken' },
          );

    const doc = new Y.Doc();
    try {
      this.store.migrate();
    } catch (error) {
      doc.destroy();
      return this.failLoad('storage unavailable', error);
    }

    const result: LoadResult = this.store.load(doc);
    if (!result.ok) {
      doc.destroy();
      return this.failLoad(result.reason, new Error(result.error));
    }
    if (result.quarantined > 0) {
      console.warn(
        JSON.stringify({ event: 'board-loaded-with-damaged-updates', quarantined: result.quarantined }),
      );
    }

    doc.on('update', this.onDocUpdate);
    this.boardDoc = doc;
    this.state = nextRoomState(this.state, { type: 'load-succeeded' });
    return true;
  }

  /**
   * The board could not be read. Every socket is closed with
   * {@link CLOSE_BOARD_LOAD_FAILED}, which `y-websocket` treats as "try again
   * later" — so each page keeps retrying on its own, and says so.
   */
  private failLoad(stage: string, error: unknown): false {
    this.state = nextRoomState('loading', { type: 'load-failed' });
    this.loadFailedAt = Date.now();
    this.boardDoc = null;
    console.error(JSON.stringify({ event: 'board-load-failed', stage, error: describe(error) }));
    this.closeAll(CLOSE_BOARD_LOAD_FAILED, REASON_LOAD_FAILED);
    return false;
  }

  /**
   * A write failed. The update that hit it was never broadcast, so nobody is
   * looking at something that is not kept. The document is dropped rather than
   * kept, because from here on the room cannot promise that anything it holds is
   * saved; the next connection reads storage again.
   */
  private storageFailed(error: unknown): void {
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    if (this.boardDoc) this.boardDoc.off('update', this.onDocUpdate);
    this.boardDoc = null;
    console.error(JSON.stringify({ event: 'board-storage-failure', error: describe(error) }));
    this.closeAll(CLOSE_STORAGE_FAILURE, REASON_STORAGE_FAILURE);
  }

  private closeAll(code: number, reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(code, reason);
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * Forget the board in memory and read it from storage again — what a room does
   * when the runtime wakes it, and what a test uses to check that the room relies
   * on storage and on the runtime's socket list rather than on anything it holds.
   */
  async reload(): Promise<void> {
    if (this.boardDoc) {
      this.boardDoc.off('update', this.onDocUpdate);
      this.boardDoc = null;
    }
    this.state = 'hibernated';
    await this.ensureReady();
  }

  // --- Durable Object entry points ------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (testHooksEnabled(this.env)) {
      const hook = parseTestHook(new URL(request.url).pathname);
      if (hook) return this.runTestHook(hook.hook, request);
    }

    const upgrade = request.headers.get('upgrade')?.toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    const canServe = await this.ensureReady();

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // The 101 must be built *before* the socket is handed to the runtime: the
    // runtime refuses to hand out a socket in a Response once it is accepted.
    const switching = new Response(null, { status: 101, webSocket: client });
    this.ctx.acceptWebSocket(server);

    if (!canServe) {
      // The honest failure. `y-websocket` retries 4500 with its backoff, so the
      // page keeps trying and shows "This board couldn't be loaded. Retrying…".
      try {
        server.close(CLOSE_BOARD_LOAD_FAILED, REASON_LOAD_FAILED);
      } catch {
        /* already gone */
      }
      return switching;
    }

    // Ask the newcomer for its state: it answers with a SyncStep2 carrying
    // whatever this room does not have — a late joiner's board, a reloaded page's
    // changes, or a change the service failed to store.
    this.sendSyncStep1(server, this.boardDoc!);
    return switching;
  }

  /**
   * A message on a socket we may have inherited from a previous instance of this
   * object: the board is loaded first (the constructor already did that for a
   * freshly woken object; this covers a room that dropped it on a storage failure).
   */
  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void | Promise<void> {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, REASON_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, REASON_STORAGE_FAILURE);
      return;
    }
    if (this.boardDoc !== null) {
      this.handleMessage(ws, data, this.boardDoc);
      return;
    }
    return this.ensureReady().then((ready) => {
      if (!ready) {
        ws.close(CLOSE_BOARD_LOAD_FAILED, REASON_LOAD_FAILED);
        return;
      }
      this.handleMessage(ws, data, this.boardDoc!);
    });
  }

  /**
   * Nothing to tidy up: the runtime owns the socket list, so a closed socket is
   * simply absent from `ctx.getWebSockets()` from here on.
   */
  webSocketClose(): void {
    this.noteIdle();
  }

  webSocketError(): void {
    this.noteIdle();
  }

  /** With nobody left, the object is free to be evicted; sockets may hibernate. */
  private noteIdle(): void {
    if (this.state === 'ready' && this.ctx.getWebSockets().length === 0) {
      this.state = nextRoomState(this.state, { type: 'idle' });
    }
  }

  // --- the y-websocket wire (unchanged from story 3) -------------------------

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string, doc: Y.Doc): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.closeUnsupported(ws, decoded.reason);
      return;
    }
    // Awareness keeps idle connections alive; stored awareness and presence
    // semantics are story 6, so a query is simply ignored.
    if (decoded.kind === 'query-awareness') return;
    if (decoded.kind === 'awareness') {
      this.relay(decoded.payload);
      return;
    }

    const encoder = encoding.createEncoder();
    // The reply carries the same outer frame byte as the request; a reply is
    // only sent when the handler added something after it.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const decoder = decoding.createDecoder(decoded.payload);
    // `y-protocols` swallows (and logs) errors while applying an update, so it
    // reports them through this callback instead of throwing. A broken update
    // means that socket gets closed; nobody else is affected.
    const failure: { reason: string | null } = { reason: null };
    try {
      // SyncStep1 in → SyncStep2 out; SyncStep2 / Update in → applied to the doc,
      // which fires the `update` listener that stores it and broadcasts it.
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (error) => {
        failure.reason = error.message;
      });
    } catch (error) {
      failure.reason = describe(error);
    }
    if (failure.reason !== null) {
      this.closeUnsupported(ws, failure.reason);
      return;
    }
    if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
  }

  /** Send our state request so the client can (re)populate the room. */
  private sendSyncStep1(ws: WebSocket, doc: Y.Doc): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  /**
   * Relay awareness bytes verbatim to every open socket, sender included (that
   * is what keeps an idle connection's liveness traffic flowing both ways).
   */
  private relay(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    for (const ws of this.ctx.getWebSockets()) this.send(ws, frame);
  }

  /**
   * Send to one socket. A socket that cannot be written to is left alone: the
   * runtime drops it from `ctx.getWebSockets()`, so a dead peer can neither throw
   * during a broadcast nor block the others.
   */
  private send(ws: WebSocket, payload: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(payload.slice());
    } catch {
      /* the socket is gone */
    }
  }

  /** Close exactly one socket for breaking the framing contract. */
  private closeUnsupported(ws: WebSocket, reason: string): void {
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA, reason.slice(0, 120));
    } catch {
      // Already closing: nothing to do.
    }
  }

  // --- storage --------------------------------------------------------------

  /**
   * Everything that changed in the document arrives here: one client's update, or
   * the state a newcomer sent. It is written first, then relayed.
   *
   * Updates applied *from* storage carry {@link LOAD_ORIGIN} and are ignored — a
   * board loading itself is not a new change.
   */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return;
    const doc = this.boardDoc;
    if (doc === null) return;

    try {
      this.store.append(update);
    } catch (error) {
      this.storageFailed(error);
      return; // deliberately not broadcast: nobody is shown what is not kept
    }

    this.state = nextRoomState(this.state, { type: 'update-applied' });
    const frame = syncFrame(update);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      this.send(socket, frame);
    }

    if (this.store.compactionDue) {
      this.state = nextRoomState(this.state, { type: 'compaction-needed' });
      this.store.compactIfNeeded(doc);
      this.state = nextRoomState(this.state, { type: 'compaction-finished' });
    }
  };

  // --- test hooks (reachable only when TEST_HOOKS=1) -------------------------

  /**
   * Public because it is also the entry point integration tests use: they drive a
   * board into these states through the same code the gated route calls, instead
   * of reaching past the room into its tables. Nothing in the worker calls this
   * unless `TEST_HOOKS=1`.
   */
  async runTestHook(hook: TestHookName, request: Request): Promise<Response> {
    switch (hook) {
      case 'seed':
        return this.hookSeed(request);
      case 'compact':
        return this.hookCompact();
      case 'corrupt-snapshot':
        return this.hookCorruptSnapshot();
      case 'repair':
        return this.hookRepair();
      default:
        return json({ error: 'unknown hook' }, 404);
    }
  }

  /**
   * Apply an update to the board as though a person had made it: it goes through
   * the document, so it is stored and broadcast exactly like real content. The
   * e2e build needs this to reach the tested board size without clicking 2000
   * times.
   */
  private async hookSeed(request: Request): Promise<Response> {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!(await this.ensureReady())) return json({ ok: false, error: `board is ${this.state}` }, 503);
    try {
      Y.applyUpdate(this.boardDoc!, bytes);
    } catch (error) {
      return json({ ok: false, error: describe(error) }, 400);
    }
    return json({ ok: true, notes: this.noteCount(), ...this.store.stats() });
  }

  /** Fold the log now, whatever its size, so a small board can be compacted too. */
  private async hookCompact(): Promise<Response> {
    if (!(await this.ensureReady())) return json({ ok: false, error: `board is ${this.state}` }, 503);
    const compacted = this.store.compact(this.boardDoc!);
    return json({ ok: compacted, notes: this.noteCount(), ...this.store.stats() });
  }

  /**
   * Replace the first snapshot chunk with other bytes, keeping the table shape —
   * the in-place corruption the design names. The chunk is backed up in a
   * test-only table first, so {@link hookRepair} can put it back.
   *
   * The room then behaves as a room that has just failed to load: the document is
   * dropped and the state is the one a failing load produces. Without that, a
   * development server's in-memory document would keep serving content its
   * storage no longer holds, and the test would prove nothing.
   */
  private async hookCorruptSnapshot(): Promise<Response> {
    if (this.store.stats().chunks === 0) {
      return json({ ok: false, error: 'this board has no snapshot yet; compact it first' }, 409);
    }
    let bytes = 0;
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          'CREATE TABLE IF NOT EXISTS test_snapshot_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
        );
        const row = this.ctx.storage.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .toArray()[0]!;
        const original = new Uint8Array(row.data);
        bytes = original.byteLength;
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO test_snapshot_backup (idx, data) VALUES (0, ?)',
          original,
        );
        this.ctx.storage.sql.exec(
          'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
          new Uint8Array(original.byteLength).fill(0xab),
        );
      });
    } catch (error) {
      return json({ ok: false, error: describe(error) }, 500);
    }
    this.failLoad('injected-snapshot-corruption', new Error('a test hook replaced a snapshot chunk'));
    return json({ ok: true, corruptedChunk: 0, bytes });
  }

  /** Undo {@link hookCorruptSnapshot} and let the next connection load it at once. */
  private async hookRepair(): Promise<Response> {
    try {
      this.ctx.storage.transactionSync(() => {
        const row = this.ctx.storage.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM test_snapshot_backup WHERE idx = 0')
          .toArray()[0];
        if (!row) throw new Error('this board has no snapshot backup to repair');
        this.ctx.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', row.data);
        this.ctx.storage.sql.exec('DELETE FROM test_snapshot_backup');
      });
    } catch (error) {
      return json({ ok: false, error: describe(error) }, 409);
    }
    this.loadFailedAt = 0;
    return json({ ok: true, ...this.store.stats() });
  }

  private noteCount(): number {
    if (!this.boardDoc) return 0;
    let count = 0;
    for (const object of this.boardDoc.getMap('objects').values()) {
      if (!(object as { deleted?: boolean }).deleted) count += 1;
    }
    return count;
  }
}

/**
 * Wrap a bare Yjs update in a y-websocket frame: the outer message type
 * (`MESSAGE_SYNC`) plus the `y-protocols` update message. The outer byte is not
 * optional — without it the first byte of the payload would be read as the
 * message type and the update would be silently misparsed.
 */
function syncFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}
