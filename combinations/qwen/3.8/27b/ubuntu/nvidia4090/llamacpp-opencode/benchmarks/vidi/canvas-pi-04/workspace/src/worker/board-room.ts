// Story 4: BoardRoom Durable Object (anchors: persist.store, persist.room,
// persist.client_status).
//
// The room owns one Y.Doc per board, loaded from and persisted to the Durable
// Object's SQLite storage (BoardStore):
//
// - construct / wake: load snapshot + update log into a fresh doc. Any load
//   failure (unreadable snapshot OR SQL error) puts the room in load-failed:
//   connections are accepted then closed with 4500, and the load is retried
//   on a new connection at most every LOAD_RETRY_MIN_INTERVAL_MS (TC-26).
// - every update applied from a client is stored as one updates row BEFORE it
//   is broadcast (the Durable Object holds outbound messages until pending
//   writes commit, so no peer ever observes an unsaved change).
// - an append failure discards the doc, closes every socket with 1011
//   (storage-failed); the next connection reloads from storage, which
//   restores everything durably stored. Reconnecting clients re-send what the
//   room lacks through the sync exchange, so unsaved changes are retried
//   (persist.save_failure, TC-14/TC-15).
// - when the log exceeds the thresholds the room compacts: snapshot chunks
//   replace the log inside ONE transaction; a failure rolls back and keeps
//   the previous snapshot + log (TC-11, TC-17).
//
// Sockets use the hibernation API (ctx.acceptWebSocket / ctx.getWebSockets):
// they survive hibernation, and a message or a new connection wakes the
// object, which reconstructs its doc from storage before serving (TC-18).
//
// Wire protocol: y-websocket frames (story 3): sync frames are processed with
// y-protocols; awareness frames are relayed verbatim to ALL sockets including
// the sender (the client's watchdog requires it); query-awareness is ignored;
// anything decodeMessage marks invalid closes the SENDER's socket with
// CLOSE_UNSUPPORTED_DATA (1003).

import { DurableObject, DurableObjectNamespace } from 'cloudflare:workers';
import { createDecoder } from 'lib0/decoding';
import {
  createEncoder,
  length,
  toUint8Array,
  writeVarUint,
} from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../shared/protocol';
import {
  BoardStore,
  LOAD_ORIGIN,
  shouldCompact,
  type LoadResult,
} from './board-store';
import { nextRoomState, type RoomLifecycle } from './room-state';
import { STICKY_COLORS, type StickyColor } from '../shared/config';
import { createStickyAt, snapshot } from '../shared/board-model';

/** Worker bindings (see wrangler.jsonc). */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' on the e2e dev server: enables the /__test/ routes (test-hooks.ts). */
  TEST_HOOKS?: string;
}

export class BoardRoom extends DurableObject<Env> {
  private lifecycle: RoomLifecycle = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  /** When the room entered load-failed (drives the retry interval, TC-26). */
  private loadFailedAt = 0;
  /** Construction count; test hooks report it to prove a wake reconstructed. */
  private static constructions = 0;
  /** Set when the last construction failed to load (test observability). */
  private lastLoadResult: LoadResult | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    BoardRoom.constructions += 1;
    // The object is reconstructed on every hibernation wake; the load runs
    // before any event (fetch or webSocketMessage) is served.
    void this.ctx.blockConcurrencyWhile(() => this.load());
  }

  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get('Upgrade');
    if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
      return new Response('Upgrade Required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = pair;
    this.ctx.acceptWebSocket(server);
    // Deliver binary frames as ArrayBuffer (the WebSocket spec default is
    // 'blob'; pin it so the workerd test pool and wrangler dev match).
    server.binaryType = 'arraybuffer';

    // StorageFailed: the previous doc was discarded; rebuild from storage
    // before serving (no minimum interval).
    if (this.lifecycle === 'storage-failed') {
      this.lifecycle = nextRoomState(this.lifecycle, { type: 'next-connection' });
      await this.ctx.blockConcurrencyWhile(() => this.load());
    }

    // LoadFailed: retry the load only once per LOAD_RETRY_MIN_INTERVAL_MS;
    // otherwise accept-then-close with the dedicated code (TC-24, TC-26).
    if (this.lifecycle === 'load-failed') {
      const elapsedMs = Date.now() - this.loadFailedAt;
      const next = nextRoomState(this.lifecycle, { type: 'connection-attempt', elapsedMs });
      this.lifecycle = next;
      if (next === 'loading') {
        await this.ctx.blockConcurrencyWhile(() => this.load());
      }
      if (this.lifecycle === 'load-failed') {
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    if (this.doc === null) {
      // Defensive: unreachable (a failed reload lands in load-failed above).
      server.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Our state vector tells a fresh client exactly what to request.
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeSyncStep1(enc, this.doc);
    this.send(server, toUint8Array(enc).buffer as ArrayBuffer);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    // A socket that survives hibernation may message us right after the
    // wake load; if the board could not be (re)loaded, close it with the
    // dedicated code so the client shows the load failure (TC-24, TC-26).
    if (this.lifecycle === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.lifecycle === 'storage-failed' || this.doc === null) {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    // (loading/compacting are not observable here: loads block events and
    // compaction is synchronous.)

    const decoded = decodeMessage(msg);
    if (decoded.kind === 'invalid') {
      // Malformed frame: drop this socket; the others keep working.
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // ignored until the presence story
    }
    if (decoded.kind === 'awareness') {
      // Verbatim relay to everyone, INCLUDING the sender (watchdog).
      const frame = new Uint8Array(decoded.payload.length + 1);
      frame[0] = MESSAGE_AWARENESS;
      frame.set(decoded.payload, 1);
      this.sendAll(frame.buffer as ArrayBuffer, null);
      return;
    }

    // sync
    const dec = createDecoder(decoded.payload);
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    try {
      // readSyncStep2 swallows applyUpdate errors unless given an error
      // handler: rethrow here so the catch closes the socket. Applying an
      // update the room lacks fires the doc update handler, which stores and
      // broadcasts it to the OTHER sockets (persist.store).
      readSyncMessage(dec, enc, this.doc, ws, (error) => {
        throw error;
      });
    } catch {
      // Framing was valid but the doc rejects the update: same close code.
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    // A response (if any) goes only to the sender.
    if (length(enc) > 1) {
      this.send(ws, toUint8Array(enc).buffer as ArrayBuffer);
    }
  }

  // With the hibernation API the runtime owns the socket lifecycle: no
  // mirror-close bookkeeping is needed (that was a story-3 workerd quirk of
  // the non-hibernating WebSocketPair API).
  webSocketClose(_ws: WebSocket, _code: number, _reason: string): void {
    // The socket is already gone from the runtime's set.
  }

  webSocketError(_ws: WebSocket): void {
    // Nothing to do: the runtime drops the socket.
  }

  // -------------------------------------------------------------------------
  // Load / persistence.
  // -------------------------------------------------------------------------

    /** Reconstruct the doc from storage (construct, retry, wake). */
  private async load(): Promise<void> {
    const doc = new Y.Doc();
    let result: LoadResult;
    try {
      // Reuse the object's store when present: it is the same wrapper the
      // test-only fault injection (TC-26 "load-select") targets, and the DO
      // storage it wraps is unchanged by a reload.
      const store = this.store ?? (this.store = new BoardStore(this.ctx.storage));
      store.migrate();
      result = store.load(doc);
      if (!result.ok) {
        console.error({
          kind: 'board-load-failed',
          reason: result.reason,
          error: result.error,
        });
      }
    } catch (error) {
      result = { ok: false, quarantined: 0, reason: 'sql-error', error: String(error) };
      console.error({ kind: 'board-load-failed', reason: 'sql-error', error: String(error) });
    }
    this.lastLoadResult = result;
    if (result.ok) {
      doc.on('update', (update, origin) => this.onDocUpdate(update, origin));
      this.doc = doc;
      this.lifecycle = nextRoomState('loading', { type: 'load-success', quarantined: result.quarantined });
    } else {
      doc.destroy();
      this.doc = null;
      this.store = null;
      this.lifecycle = nextRoomState('loading', { type: 'load-failed', reason: result.reason ?? 'unknown' });
      this.loadFailedAt = Date.now();
    }
  }

  /** The doc update handler: store, then broadcast, then maybe compact. */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    // Updates applied while loading from storage are neither re-stored nor
    // re-broadcast.
    if (origin === LOAD_ORIGIN) {
      return;
    }
    if (this.doc === null || this.store === null) {
      return;
    }
    if (this.lifecycle === 'load-failed' || this.lifecycle === 'storage-failed') {
      return;
    }
    try {
      // The row is durably written before the broadcast below leaves the
      // object (outbound messages are held until pending writes commit).
      this.store.append(update);
    } catch (error) {
      // Storage failure: drop the doc, close everyone with 1011; the next
      // connection reloads (persist.save_failure).
      console.error({ kind: 'board-append-failed', error: String(error) });
      this.resetRoom();
      return;
    }
    this.lifecycle = nextRoomState(this.lifecycle, { type: 'update-applied' });
    this.broadcastUpdate(update, origin);
    this.maybeCompact();
  }

  /** Compact the log when the thresholds are exceeded (TC-17). */
  private maybeCompact(): void {
    const doc = this.doc;
    const store = this.store;
    if (doc === null || store === null) {
      return;
    }
    const stats = store.stats;
    // The threshold check lives in the store (shouldCompact) so the unit and
    // integration tests share the exact boundary.
    if (!shouldCompact(stats.count, stats.bytes)) {
      return;
    }
    this.lifecycle = nextRoomState(this.lifecycle, { type: 'log-exceeds-threshold' });
    const committed = store.compactIfNeeded(doc);
    this.lifecycle = nextRoomState(
      this.lifecycle,
      committed ? { type: 'compaction-committed' } : { type: 'compaction-rolled-back' },
    );
  }

  /** Storage failure reset (design decision 3). */
  private resetRoom(): void {
    this.lifecycle = nextRoomState(this.lifecycle, { type: 'insert-throws' });
    this.doc?.destroy();
    this.doc = null;
    this.store = null;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // already closing
      }
    }
  }

  /** Frame a doc update as a sync update and send it to all but `origin`. */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeUpdate(enc, update);
    this.sendAll(toUint8Array(enc).buffer as ArrayBuffer, origin === undefined ? null : (origin as WebSocket | null));
  }

  private send(ws: WebSocket, frame: ArrayBuffer): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      ws.send(frame);
    } catch {
      // The socket is dropped by the runtime; nothing else to do.
    }
  }

  private sendAll(frame: ArrayBuffer, except: WebSocket | null = null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) {
        continue;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        ws.send(frame);
      } catch {
        // dropping
      }
    }
  }

  // -------------------------------------------------------------------------
  // Test-only surface.
  //
  // Reached two ways: (1) directly, via the DO stub, from the workerd
  // integration pool; (2) over HTTP through the /__test/ routes in
  // test-hooks.ts (guarded by env.TEST_HOOKS === '1'). None of this is used
  // by the product path.
  // -------------------------------------------------------------------------

  /** The room's lifecycle state (integration tests). */
  async testGetLifecycle(): Promise<RoomLifecycle> {
    return this.lifecycle;
  }

  /** How many live sockets the runtime is holding (hibernation API). */
  async testGetSocketCount(): Promise<number> {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length;
  }

  /** How many times this object has been constructed (wake proof, TC-18). */
  async testGetConstructions(): Promise<number> {
    return BoardRoom.constructions;
  }

  /** The last load result (integration tests). */
  async testGetLastLoadResult(): Promise<LoadResult | null> {
    return this.lastLoadResult;
  }

  /** Append a batch of pre-made update bytes straight to the store (TC-03..). */
  async testStoreAppendBatch(updates: Uint8Array[]): Promise<{ rows: number }> {
    const store = this.testEnsureStore();
    for (const update of updates) {
      store.append(update);
    }
    return { rows: store.stats.count };
  }

  /** Load snapshot+log into a fresh doc and return its full-state bytes (TC-05..). */
  async testStoreLoad(): Promise<{ ok: boolean; reason?: string; quarantined: number; state: ArrayBuffer | null }> {
    const store = this.testEnsureStore();
    const doc = new Y.Doc();
    const result = store.load(doc);
    let state: ArrayBuffer | null = null;
    if (result.ok) {
      const encoded = Y.encodeStateAsUpdate(doc);
      // Copy: the returned view may not own its buffer (RPC needs an exact
      // ArrayBuffer).
      const copy = new Uint8Array(encoded.length);
      copy.set(encoded);
      state = copy.buffer;
    }
    doc.destroy();
    return {
      ok: result.ok,
      reason: result.reason,
      quarantined: result.quarantined,
      state,
    };
  }

  /**
   * Compact the store's current state. Rebuilds a doc from storage first, so
   * this works even when the room's own doc is empty (store-level tests).
   * `force` skips the threshold check (TC-07, TC-10, TC-11).
   */
  async testStoreCompact(force = false): Promise<{ committed: boolean; chunks: number; updatesRows: number }> {
    const store = this.testEnsureStore();
    const doc = new Y.Doc();
    const result = store.load(doc);
    const committed =
      result.ok && (force ? store.testForceCompact(doc) : store.compactIfNeeded(doc));
    doc.destroy();
    return {
      committed,
      chunks: store.testInspectStorage().snapshotChunkCount,
      updatesRows: store.testInspectStorage().updatesRows.length,
    };
  }

  /** Store statistics (row count/bytes, seqs, chunk count). */
  async testStoreStats(): Promise<{ count: number; bytes: number; maxSeq: number; throughSeq: number; chunks: number }> {
    const store = this.testEnsureStore();
    const stats = store.stats;
    const chunks = store.testInspectStorage().snapshotChunkCount;
    return { ...stats, chunks };
  }

  /** Inspect the storage tables (integration tests). */
  async testInspectStorage(): Promise<ReturnType<BoardStore['testInspectStorage']>> {
    return this.testEnsureStore().testInspectStorage();
  }

  /** Make the next append throw once (TC-14). */
  async testFailNextAppend(): Promise<void> {
    this.testEnsureStore().testInjectFault('append');
  }

  /** Make the next load's SELECT throw (TC-26). */
  async testFailLoadSelect(): Promise<void> {
    this.testEnsureStore().testInjectFault('load-select');
  }

  /** Make the next compaction fail after the chunk delete (TC-11). */
  async testFailCompactionAfterChunkDelete(): Promise<void> {
    this.testEnsureStore().testInjectFault('compaction-after-chunk-delete');
  }

  /** Overwrite one updates row with damaged bytes (TC-09, TC-14). */
  async testCorruptUpdateRow(seq: number, mode: 'random' | 'truncate'): Promise<{ ok: boolean; reason?: string }> {
    return this.testEnsureStore().testCorruptUpdateRow(seq, mode);
  }

  /** Corrupt snapshot chunk 0 (backs it up for /repair; TC-24). */
  async testCorruptSnapshotChunk0(): Promise<{ ok: boolean; reason?: string }> {
    return this.testEnsureStore().testCorruptSnapshotChunk0();
  }

  /** Restore snapshot chunk 0 from the corruption backup (TC-24). */
  async testRepairSnapshotChunk0(): Promise<{ ok: boolean; reason?: string }> {
    return this.testEnsureStore().testRepairSnapshotChunk0();
  }

  /**
   * Simulate a hibernation wake: re-run the load exactly as a reconstructed
   * object would (TC-18, and the TC-24 "reopen" when the local dev runtime
   * keeps the object alive instead of hibernating it).
   */
  async testWake(): Promise<{ lifecycle: RoomLifecycle; constructions: number }> {
    this.lifecycle = nextRoomState(this.lifecycle, { type: 'wake' });
    await this.ctx.blockConcurrencyWhile(() => this.load());
    return { lifecycle: this.lifecycle, constructions: BoardRoom.constructions };
  }

  /** Re-run a load from the current lifecycle (e2e "wake" hook). */
  async testReload(): Promise<{ lifecycle: RoomLifecycle }> {
    const event = this.lifecycle === 'load-failed' ? 'wake' : 'next-connection';
    this.lifecycle = nextRoomState(this.lifecycle, { type: event });
    await this.ctx.blockConcurrencyWhile(() => this.load());
    return { lifecycle: this.lifecycle };
  }

  /** Compact the room's LIVE doc regardless of the thresholds (e2e hook). */
  async testForceCompact(): Promise<boolean> {
    if (this.doc === null || this.store === null) {
      return false;
    }
    return this.store.testForceCompact(this.doc);
  }

  /**
   * Number of stickies in the room's doc (e2e "notes" hook). A note is here
   * only once its update has been applied to the room — and by the room's
   * durability ordering it is persisted before that — so this is a
   * server-side ground truth for "how many notes are durably stored".
   */
  async testNoteCount(): Promise<number> {
    return this.doc === null ? 0 : snapshot(this.doc).length;
  }

  /**
   * Seed the room doc with `count` stickies (e2e hook for TC-21). Each note is
   * a separate transaction, so each is appended as a small updates row and the
   * log compacts as it grows — exactly like an organically grown board. Every
   * note is durable in storage before this returns.
   */
  async testSeedNotes(count: number): Promise<number> {
    const doc = this.doc;
    if (doc === null || this.store === null || this.lifecycle !== 'ready') {
      return 0;
    }
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      const x = 40 + (i % 40) * 220;
      const y = 40 + Math.floor(i / 40) * 220;
      createStickyAt(doc, x, y, color);
    }
    return count;
  }

  /** A store bound to this object's storage (test methods). */
  private testEnsureStore(): BoardStore {
    if (this.store === null) {
      const store = new BoardStore(this.ctx.storage);
      store.migrate();
      this.store = store;
    }
    return this.store;
  }
}
