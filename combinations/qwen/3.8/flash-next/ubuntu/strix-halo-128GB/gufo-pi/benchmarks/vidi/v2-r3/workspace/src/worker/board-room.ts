import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import type { StickyColor } from '../shared/config';
import { initDoc, createSticky, snapshot } from '../shared/board-model';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { LoadResult } from './board-store';
import { nextRoomState } from './room-state';
import type { RoomState, RoomEvent } from './room-state';
import type { Env } from './index';

/**
 * BoardRoom: one instance per board.
 * Holds the board's Y.Doc in memory, persists updates to SQLite before
 * broadcasting, and relays Yjs sync + awareness messages over WebSockets.
 * Uses hibernation API so idle boards consume no compute.
 */
export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private roomState: RoomState = 'loading';
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.doLoad();
    });
  }

  /**
   * RPC: Initialize a new board. Creates tables and sets created_at.
   * Returns 'created' on first call, 'exists' if already initialized.
   */
  async initialize(): Promise<'created' | 'exists'> {
    const store = new BoardStore(this.ctx.storage);
    store.migrate();
    const sql = this.ctx.storage.sql;
    const existing = sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'created_at'`,
    ).toArray();
    if (existing.length > 0) return 'exists';
    sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)`,
      String(Date.now()),
    );
    return 'created';
  }

  /**
   * RPC: Check if board exists. Read-only; never creates tables.
   */
  async exists(): Promise<boolean> {
    const store = new BoardStore(this.ctx.storage);
    return store.existsReadOnly();
  }

  /** Runs load (no migrate) and sets roomState accordingly. Returns true if ready. */
  private doLoad(): boolean {
    this.roomState = 'loading';
    this.store = new BoardStore(this.ctx.storage);

    // Test-only: simulate a SQL read error on the next load (TC-26).
    if (this._failNextLoadFlag) {
      this._failNextLoadFlag = false;
      this.roomState = 'load-failed';
      this.loadFailedAt = Date.now();
      this.doc = null;
      console.error(JSON.stringify({ event: 'board-load-failed', reason: 'sql-error', error: 'injected' }));
      return false;
    }

    const doc = new Y.Doc();
    const result = this.store.load(doc);
    const loaded = this.handleLoadResult(result, doc);
    return loaded;
  }

  private handleLoadResult(result: LoadResult, doc: Y.Doc): boolean {
    if (result.ok) {
      this.doc = doc;
      this.setupDocListener(doc);
      this.transition({ type: result.quarantined > 0 ? 'load-success-quarantined' : 'load-success' });
      return true;
    } else {
      this.roomState = 'load-failed';
      this.loadFailedAt = Date.now();
      this.doc = null;
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      return false;
    }
  }

  private transition(event: RoomEvent): void {
    this.roomState = nextRoomState(this.roomState, event);
  }

  private setupDocListener(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Don't store/broadcast updates that came from loading
      if (origin === LOAD_ORIGIN) return;

      // Store before broadcasting
      try {
        if (this._testFailNextAppend > 0) {
          this._testFailNextAppend--;
          throw new Error('injected storage write failure');
        }
        if (this.store) {
          this.store.append(update);
        }
      } catch (e: unknown) {
        // Storage failure: close all sockets, discard doc
        console.error(JSON.stringify({ event: 'storage-failure', error: e instanceof Error ? e.message : String(e) }));
        this.transition({ type: 'storage-error' });
        const closeFrame = CLOSE_STORAGE_FAILURE;
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(closeFrame, 'storage failure');
          } catch {
            // already closed
          }
        }
        this.doc = null;
        return;
      }

      // Broadcast to all other sockets
      const syncEnc = encoding.createEncoder();
      writeUpdate(syncEnc, update);
      const syncPayload = encoding.toUint8Array(syncEnc);

      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
      encoding.writeUint8Array(enc, syncPayload);
      const frame = encoding.toUint8Array(enc);

      for (const ws of this.ctx.getWebSockets()) {
        if (ws === origin) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
          ws.send(frame);
        } catch {
          // Socket is dead, will be cleaned up
        }
      }

      // Compact if needed
      if (this.store && this.doc) {
        this.store.compactIfNeeded(this.doc);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    // Check board existence before accepting WebSocket
    if (!this.store) {
      this.store = new BoardStore(this.ctx.storage);
    }
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Handle LoadFailed state
    if (this.roomState === 'load-failed') {
      const elapsed = Date.now() - this.loadFailedAt;
      if (elapsed < LOAD_RETRY_MIN_INTERVAL_MS) {
        // Too soon to retry - reject with 4500.
        return this.rejectWebSocket(CLOSE_BOARD_LOAD_FAILED, 'board failed to load');
      }
      // Retry load
      this.transition({ type: 'retry-load-elapsed' });
      const loaded = this.doLoad();
      if (!loaded) {
        return this.rejectWebSocket(CLOSE_BOARD_LOAD_FAILED, 'board failed to load');
      }
    }

    // Handle StorageFailed state - reload
    if (this.roomState === 'storage-failed') {
      this.transition({ type: 'wake' });
      const loaded = this.doLoad();
      if (!loaded) {
        return this.rejectWebSocket(CLOSE_BOARD_LOAD_FAILED, 'board failed to load after storage error');
      }
    }

    if (!this.doc) {
      // Should not reach here but guard just in case
      return new Response('Internal error: no document', { status: 500 });
    }

    const doc = this.doc;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Send SyncStep1 to the new client so it can respond with its state
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
    writeSyncStep1(enc, doc);
    const frame = encoding.toUint8Array(enc);
    server.send(frame);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Reject a WebSocket connection with a close code. Uses the standalone
   * `accept()` + `close()` pattern (not hibernation) so the close code is
   * reliably delivered to the client.
   */
  private rejectWebSocket(code: number, reason: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Check room state first
    if (this.roomState === 'load-failed') {
      try {
        ws.close(CLOSE_BOARD_LOAD_FAILED, 'board failed to load');
      } catch {
        // already closed
      }
      return;
    }
    if (this.roomState === 'storage-failed') {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // already closed
      }
      return;
    }

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      try {
        ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      } catch {
        // already closed
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return; // Ignored
    }

    if (decoded.kind === 'awareness') {
      // Relay awareness bytes verbatim to ALL open sockets including sender
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
      encoding.writeUint8Array(enc, decoded.payload);
      const frame = encoding.toUint8Array(enc);
      for (const s of this.ctx.getWebSockets()) {
        if (s.readyState !== WebSocket.OPEN) continue;
        try {
          s.send(frame);
        } catch {
          // dead socket
        }
      }
      return;
    }

    // Sync message
    if (decoded.kind === 'sync') {
      if (!this.doc) {
        try { ws.close(CLOSE_BOARD_LOAD_FAILED, 'no document'); } catch {}
        return;
      }
      const doc = this.doc;
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const encoder = encoding.createEncoder();
        readSyncMessage(decoder, encoder, doc, ws);
        const reply = encoding.toUint8Array(encoder);
        if (reply.byteLength > 0) {
          const outerEnc = encoding.createEncoder();
          encoding.writeVarUint(outerEnc, 0); // MESSAGE_SYNC
          encoding.writeUint8Array(outerEnc, reply);
          const outerFrame = encoding.toUint8Array(outerEnc);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(outerFrame);
          }
        }
      } catch {
        try {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid yjs sync data');
        } catch {
          // already closed
        }
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    // Socket removed automatically from ctx.getWebSockets()
  }

  webSocketError(ws: WebSocket): void {
    // Socket removed automatically from ctx.getWebSockets()
  }

  // ---------------------------------------------------------------------------
  // Test-only surface. Never invoked in production: reachable only via
  // runInDurableObject (integration tests) or the TEST_HOOKS routes in
  // src/worker/test-hooks.ts (e2e, gated on env.TEST_HOOKS === '1').
  // ---------------------------------------------------------------------------

  /** Inject a failure of the next `n` storage appends (persist.save_failure / TC-14). */
  _testFailNextAppends(n = 1): void {
    this._testFailNextAppend = n;
  }
  private _testFailNextAppend = 0;

  /** Make the next load report a SQL read error (TC-26). */
  private _failNextLoadFlag = false;
  _testFailNextLoad(): void {
    this._failNextLoadFlag = true;
  }

  /** Reset the load-failed timestamp so a retry is allowed immediately. */
  _testSetLoadFailedAt(t: number): void {
    this.loadFailedAt = t;
  }

  _testRoomState(): string {
    return this.roomState;
  }

  /** Number of rows in the updates log. */
  _testUpdatesRowCount(): number {
    return this.ctx.storage.sql
      .exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`)
      .toArray()[0].cnt;
  }

  _testSnapshotChunkCount(): number {
    return this.ctx.storage.sql
      .exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM snapshot_chunks`)
      .toArray()[0].cnt;
  }

  /** Load a fresh Y.Doc straight from storage and return its object count. */
  _testFreshDocNoteCount(): number {
    const store = new BoardStore(this.ctx.storage);
    const doc = new Y.Doc();
    const res = store.load(doc);
    if (!res.ok) return -1;
    return doc.getMap('objects').size;
  }

  /** Force a fresh load from storage now (re-enters Loading then Ready/LoadFailed). */
  _testReload(): void {
    this.doLoad();
  }

  /** Seed legacy board: updates rows WITHOUT created_at. Returns note count. */
  _testSeedLegacyNotes(count: number): number {
    const store = new BoardStore(this.ctx.storage);
    store.migrate();
    // Remove created_at if it was set (legacy boards don't have it)
    this.ctx.storage.sql.exec(`DELETE FROM storage_meta WHERE key = 'created_at'`);
    // Seed notes via a fresh doc
    const doc = new Y.Doc();
    const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    initDoc(doc);
    doc.transact(() => {
      for (let i = 0; i < count; i++) {
        const x = (i % 5) * 220;
        const y = Math.floor(i / 5) * 220;
        const color = COLORS[i % COLORS.length];
        const id = createSticky(doc, { x, y }, color);
        if (id) {
          const t = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
          t.insert(0, `Legacy note ${i}`);
        }
      }
    });
    // Encode the doc state as a single update and write it
    const update = Y.encodeStateAsUpdate(doc);
    store.append(update);
    // Make sure created_at is still absent (append doesn't add it, but migrate might not add it either)
    this.ctx.storage.sql.exec(`DELETE FROM storage_meta WHERE key = 'created_at'`);
    // Force reload from storage so the in-memory doc has the seeded data
    this.doc = null;
    this.store = null;
    this.doLoad();
    return count;
  }

  /**
   * Seed `count` sticky notes directly on the room's document (they persist
   * through the normal append path). Used to build large boards for load-time
   * measurement without driving thousands of browser interactions.
   */
  _testSeedNotes(count: number): number {
    if (!this.doc) return 0;
    const doc = this.doc;
    const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    initDoc(doc);
    doc.transact(() => {
      for (let i = 0; i < count; i++) {
        const x = (i % 50) * 210;
        const y = Math.floor(i / 50) * 210;
        const color = COLORS[i % COLORS.length];
        const id = createSticky(doc, { x, y }, color);
        if (id) {
          const t = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
          t.insert(0, `Seeded note ${i} with realistic text content for load testing.`);
        }
      }
    });
    return snapshot(doc).length;
  }

  /** Put the room straight into load-failed with loadFailedAt = now. */
  _testEnterLoadFailedNow(): void {
    this.roomState = 'load-failed';
    this.loadFailedAt = Date.now();
    this.doc = null;
  }

  /** Force compaction now regardless of thresholds (for seeding test fixtures). */
  _testForceCompact(): boolean {
    if (!this.store || !this.doc) return false;
    return this.store.forceCompact(this.doc);
  }

  /** Corrupt snapshot chunk 0, saving the original so it can be repaired. */
  _testCorruptSnapshot(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>(`SELECT data FROM snapshot_chunks WHERE idx = 0`)
      .toArray();
    if (row.length === 0) return false;
    const bytes = new Uint8Array(row[0].data.slice(0));
    bytes[0] = bytes[0] ^ 0xff; // flip bits in the length varint → applyUpdate throws
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = 0`, bytes);
    });
    return true;
  }

  /** Restore snapshot chunk 0 by reversing the corruption XOR (survives restart). */
  _testRepairSnapshot(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>(`SELECT data FROM snapshot_chunks WHERE idx = 0`)
      .toArray();
    if (row.length === 0) return false;
    const bytes = new Uint8Array(row[0].data.slice(0));
    bytes[0] = bytes[0] ^ 0xff; // XOR is self-inverse → restores the original
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = 0`, bytes);
    });
    return true;
  }
}
