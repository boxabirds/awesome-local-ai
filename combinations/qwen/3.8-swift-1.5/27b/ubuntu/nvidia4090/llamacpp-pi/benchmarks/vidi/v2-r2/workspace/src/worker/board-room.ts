import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../shared/protocol';
import { snapshot } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN, type BoardStorage } from './board-store';
import { nextRoomState, type RoomState, type RoomEvent } from './room-state';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

/**
 * A collaborative whiteboard room backed by persistent Durable Object
 * SQLite storage.
 *
 * Hibernation model (Cloudflare durable objects hibernation API):
 *  - `ctx.acceptWebSocket(server)` on connect; the runtime freezes the object
 *    when there is no other pending work and wakes it on the next message.
 *  - The constructor loads the board from storage (load-ok → ready,
 *    load-failed → the room keeps retrying on each wake).
 *  - Every doc update is appended to the log BEFORE it is broadcast
 *    (store-before-broadcast): a failed append drops the room into
 *    storage-failed and every socket is closed with 1011.
 *  - A snapshot compaction runs (on a threshold) after a successful append.
 */

// ---------------------------------------------------------------------------
// Test-only fault injection
// ---------------------------------------------------------------------------

export interface FaultConfig {
  /** Remaining appends that should throw (one-shot failures). */
  appendFailures: number;
  /** When set, SELECT statements whose SQL contains this substring throw. */
  failSelectsMatching: string | null;
}

// Registry keyed by board id (DO name). Mutable objects: the live store
// instance reads through them on every call, so hooks can arm faults at
// runtime without reconstructing the room.
const faultRegistry = new Map<string, FaultConfig>();

function faultFor(boardId: string): FaultConfig | undefined {
  return faultRegistry.get(boardId);
}

class FaultyStorage implements BoardStorage {
  constructor(
    private inner: BoardStorage,
    private boardId: string,
  ) {}
  sql = {
    exec: (query: string, ...bindings: unknown[]) => {
      const fault = faultFor(this.boardId);
      if (fault?.failSelectsMatching && query.toUpperCase().includes(fault.failSelectsMatching.toUpperCase())) {
        throw new Error(`injected select failure (${fault.failSelectsMatching})`);
      }
      return this.inner.sql.exec(query, ...bindings);
    },
  };
  transactionSync(fn: () => void): void {
    this.inner.transactionSync(fn);
  }
}

class FaultyBoardStore extends BoardStore {
  constructor(storage: BoardStorage, private boardId: string) {
    super(storage);
  }
  override append(update: Uint8Array): void {
    const fault = faultFor(this.boardId);
    if (fault && fault.appendFailures > 0) {
      fault.appendFailures--;
      throw new Error('injected append failure');
    }
    super.append(update);
  }
}

// The store factory is swappable so test hooks can install fault-injecting
// stores. The default factory produces plain stores.
let storeFactory: (boardId: string, storage: BoardStorage) => BoardStore = (
  _boardId,
  storage,
) => new BoardStore(storage);

/** Test-only: install the fault-injecting store factory. */
export function __installFaultyStoreFactory(): void {
  storeFactory = (boardId, storage) => new FaultyBoardStore(new FaultyStorage(storage, boardId), boardId);
}

/** Test-only: set (or reset) the fault config for a board. */
export function __setFaults(boardId: string, fault: FaultConfig | null): void {
  if (fault === null) faultRegistry.delete(boardId);
  else faultRegistry.set(boardId, fault);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frameSync(payload: Uint8Array): Uint8Array {
  // y-websocket framing: [message_type: varuint][raw payload] — the sync
  // payload is NOT length-prefixed.
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = MESSAGE_SYNC;
  frame.set(payload, 1);
  return frame;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// BoardRoom
// ---------------------------------------------------------------------------

export class BoardRoom extends DurableObject {
  state: RoomState = 'loading';
  doc: Y.Doc | null = null;
  store: BoardStore | null = null;
  private lastLoadAttemptAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = 'loading';
    this.ctx.blockConcurrencyWhile(async () => {
      this.doLoad();
    });
  }

  /** Stable opaque identity of this DO instance (fault-registry key). */
  private get doId(): string {
    return this.ctx.id.toString();
  }

  private get boardStorage(): BoardStorage {
    // The legacy sql() statement API (bind/raw) is what BoardStore consumes;
    // the newer typed SqlStorage surface is not structurally compatible.
    return this.ctx.storage as unknown as BoardStorage;
  }

  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // A new connection wakes the room. A storage-failed room always reloads;
    // a load-failed room retries at most once per LOAD_RETRY_MIN_INTERVAL_MS.
    if (this.state === 'storage-failed' || this.state === 'load-failed') {
      const now = Date.now();
      const next = nextRoomState(this.state, { type: 'wake', elapsedMs: now - this.lastLoadAttemptAt });
      if (next === 'loading') {
        this.state = 'loading';
        this.ctx.blockConcurrencyWhile(async () => {
          this.doLoad();
        });
      }
    }

    if (this.state !== 'ready') {
      // Accept the socket but send nothing: the room is not serving. The
      // close (4500/1011) is delivered from webSocketMessage once the client
      // speaks — real clients always send a SyncStep1 on connect. A close
      // initiated from this fetch context (even deferred) is not delivered by
      // the runtime and can corrupt the freshly-upgraded socket.
      return new Response(null, { status: 101, statusText: 'Switching Protocols', webSocket: client });
    }

    this.sendSyncStep1(server);
    return new Response(null, { status: 101, statusText: 'Switching Protocols', webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    // The room is not serving right now: tell the client to retry later.
    if (this.state === 'load-failed') {
      try {
        ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      } catch {
        // already closed
      }
      return;
    }
    if (this.state !== 'ready') {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'room not ready');
      } catch {
        // already closed
      }
      return;
    }

    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      } catch {
        // already closed
      }
      return;
    }
    if (decoded.kind === 'unknown' || decoded.kind === 'query-awareness') {
      return; // ignored (forward compatibility)
    }

    if (decoded.kind === 'awareness') {
      const frameEncoder = encoding.createEncoder();
      encoding.writeVarUint(frameEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(frameEncoder, decoded.payload);
      const frame = encoding.toUint8Array(frameEncoder);
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(frame);
          } catch {
            // socket gone
          }
        }
      }
      return;
    }

    // Yjs sync message
    const doc = this.doc;
    if (!doc) return;
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(decoded.payload);
    try {
      // y-protocols swallows Yjs apply errors unless an errorHandler is
      // provided; re-throw them so the socket is closed with 1003.
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, (e: Error) => {
        throw e;
      });
      const replyBytes = encoding.toUint8Array(encoder);
      if (replyBytes.length > 0) {
        try {
          ws.send(frameSync(replyBytes));
        } catch {
          // socket gone
        }
      }
    } catch (e) {
      console.error('[board-room] rejected Yjs update', { error: String(e) });
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid Yjs update');
      } catch {
        // already closed
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Nothing to clean up: storage is durable and the doc lives with the object.
    void ws;
    void code;
    void reason;
  }

  webSocketError(ws: WebSocket, error: Error): void {
    console.error('[board-room] websocket error', { error: String(error) });
    void ws;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private doLoad(): void {
    this.lastLoadAttemptAt = Date.now();
    const doc = new Y.Doc();
    const store = storeFactory(this.doId, this.boardStorage);
    store.migrate();
    const result = store.load(doc);
    if (result.ok) {
      this.store = store;
      this.doc = doc;
      this.setupDocListeners(doc);
      this.transition({ type: 'load-ok', quarantined: result.quarantined });
    } else {
      this.store = null;
      this.doc = null;
      this.transition({ type: 'load-failed', reason: result.reason });
    }
  }

  private setupDocListeners(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Updates applied during load are never stored or broadcast.
      if (origin === LOAD_ORIGIN) return;

      const store = this.store;
      if (!store) return;

      // Store BEFORE broadcast: an update that cannot be saved is not
      // shared, and the room drops into storage-failed.
      try {
        store.append(update);
      } catch (e) {
        console.error('[board-room] storage append failed; resetting room', {
          error: String(e),
        });
        this.transition({ type: 'storage-failed' });
        this.doc = null;
        this.store = null;
        for (const socket of this.ctx.getWebSockets()) {
          try {
            socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
          } catch {
            // already closed
          }
        }
        return;
      }

      this.transition({ type: 'update' });
      this.broadcast(update, origin);
      this.maybeCompact(doc);
    });
  }

  private maybeCompact(doc: Y.Doc): void {
    const store = this.store;
    if (!store) return;
    this.transition({ type: 'compact-start' });
    const compacted = store.compactIfNeeded(doc);
    this.transition({ type: compacted ? 'compact-done' : 'compact-rolled-back' });
    void doc;
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  private sendSyncStep1(ws: WebSocket): void {
    const doc = this.doc;
    if (!doc) return;
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    try {
      ws.send(frameSync(encoding.toUint8Array(encoder)));
    } catch {
      // socket gone
    }
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frame = frameSync(encoding.toUint8Array(encoder));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(frame);
        } catch {
          // socket gone
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Test-only RPC methods (guarded by TEST_HOOKS on the worker side)
  // -------------------------------------------------------------------------

  /** Test-only: run SQL directly against this board's storage. */
  async __testSql(
    query: string,
    params: (string | number | { b64: string })[] = []
  ): Promise<unknown[][]> {
    const bindings = params.map((p) => (typeof p === 'object' ? fromBase64(p.b64) : p));
    const out: unknown[][] = [];
    for (const row of this.boardStorage.sql.exec(query, ...bindings).raw()) {
      out.push((row as unknown[]).map((v) =>
        v instanceof Uint8Array ? { b64: toBase64(v) } : v instanceof ArrayBuffer ? { b64: toBase64(new Uint8Array(v)) } : v
      ));
    }
    return out;
  }

  /** Test-only: run BoardStore operations against this board's storage. */
  async __testStore(op: string, updateB64?: string, selectMatch?: string, updatesB64?: string[]): Promise<Record<string, unknown>> {
    const boardId = this.doId;
    const failSelect = selectMatch
      ? { appendFailures: 0, failSelectsMatching: selectMatch }
      : undefined;
    const storage: BoardStorage = failSelect
      ? new FaultyStorage(this.boardStorage, boardId)
      : this.boardStorage;
    const store = new BoardStore(storage);
    store.migrate();
    switch (op) {
      case 'append': {
        store.append(fromBase64(updateB64 ?? ''));
        return { ok: true };
      }
      case 'append-many': {
        for (const b64 of updatesB64 ?? []) store.append(fromBase64(b64));
        return { ok: true, appended: (updatesB64 ?? []).length };
      }
      case 'load': {
        const doc = new Y.Doc();
        const res = store.load(doc);
        return res.ok
          ? { ok: true, quarantined: res.quarantined, notes: snapshot(doc) }
          : { ok: false, reason: res.reason };
      }
      case 'compact': {
        const doc = new Y.Doc();
        const res = store.load(doc);
        if (!res.ok) return { ok: false, reason: res.reason };
        const compacted = store.compactIfNeeded(doc);
        return { ok: true, compacted, notes: snapshot(doc) };
      }
      case 'force-compact': {
        const doc = new Y.Doc();
        const res = store.load(doc);
        if (!res.ok) return { ok: false, reason: res.reason };
        const chunks = store.forceCompact(doc);
        return { ok: true, compacted: true, chunks, notes: snapshot(doc) };
      }
      case 'compact-fault': {
        // Fail the statement right after DELETE snapshot_chunks:
        // the first INSERT INTO snapshot_chunks. Everything outside the
        // transaction (the DELETE) already committed when the INSERT throws,
        // and the transaction rolls back — verifying rollback integrity.
        const base = this.boardStorage;
        const failingStorage: BoardStorage = {
          sql: {
            exec: (query: string, ...bindings: unknown[]) => {
              if (query.includes('INSERT INTO snapshot_chunks')) {
                throw new Error('injected compact insert failure');
              }
              return base.sql.exec(query, ...bindings);
            },
          },
          transactionSync: (fn: () => void) => base.transactionSync(fn),
        };
        const doc = new Y.Doc();
        const faultyStore = new BoardStore(failingStorage);
        faultyStore.migrate();
        const res = faultyStore.load(doc);
        if (!res.ok) return { ok: false, reason: res.reason };
        const compacted = faultyStore.compactIfNeeded(doc);
        return { ok: true, compacted, notes: snapshot(doc) };
      }
      default:
        throw new Error(`unknown test op: ${op}`);
    }
  }

  /**
   * Test-only: simulate hibernation + reconstruction. Discards the in-memory
   * doc/store and reloads from storage exactly like the constructor does.
   * (`wrangler dev` keeps DO instances alive across client disconnects, so
   * tests use this to get a "fresh room instance over the same storage".)
   */
  async __testReset(): Promise<Record<string, unknown>> {
    this.doc = null;
    this.store = null;
    this.state = 'loading';
    this.lastLoadAttemptAt = 0;
    await this.ctx.blockConcurrencyWhile(async () => {
      this.doLoad();
    });
    return { ok: true, state: this.state };
  }

  /** Test-only: corrupt or repair the snapshot's chunk 0. */
  async __testCorruptSnapshot(mode: 'corrupt' | 'repair'): Promise<{ ok: boolean; detail?: string }> {
    const boardId = this.doId;
    // Ensure a snapshot exists (boards below the compaction threshold have none).
    const countRows = await this.__testSql('SELECT COUNT(*) FROM snapshot_chunks');
    const hasSnapshot = Number(countRows[0]?.[0] ?? 0) > 0;
    if (!hasSnapshot) {
      const r = await this.__testStore('force-compact');
      if (!r.ok) return { ok: false, detail: 'force-compact failed' };
    }

    const rows = await this.__testSql('SELECT data FROM snapshot_chunks WHERE idx = 0');
    if (rows.length !== 1) return { ok: false, detail: 'chunk 0 not found' };
    const originalB64 = (rows[0][0] as { b64: string }).b64;
    const original = fromBase64(originalB64);

    if (mode === 'corrupt') {
      // A deterministic byte sequence that Y.applyUpdate is guaranteed to
      // reject (varuint header 0xde declares a 30-byte payload that is not
      // there). Byte-inversion of the original is NOT reliable: some inverted
      // sequences decode as skippable garbage that Yjs silently ignores,
      // which would let a corrupted board "load" as empty.
      const corrupted = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]);
      await this.__testSql('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', [
        { b64: toBase64(corrupted) },
      ]);
      snapshotOriginals.set(boardId, original);
      return { ok: true };
    }

    // repair
    if (!snapshotOriginals.has(boardId)) {
      return { ok: false, detail: 'no original snapshot to restore' };
    }
    const orig = snapshotOriginals.get(boardId)!;
    await this.__testSql('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', [
      { b64: toBase64(orig) },
    ]);
    snapshotOriginals.delete(boardId);
    return { ok: true };
  }
}

// Module-level: original snapshot chunk 0 per board (for repair).
const snapshotOriginals = new Map<string, Uint8Array>();
