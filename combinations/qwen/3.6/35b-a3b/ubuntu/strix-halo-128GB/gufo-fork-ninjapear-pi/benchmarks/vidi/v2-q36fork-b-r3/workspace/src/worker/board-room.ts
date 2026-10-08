/** BoardRoom Durable Object — persistent Y.Doc with SQLite-backed storage */

import * as Y from 'yjs';
import { readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '@shared/protocol';
import { BoardStore, LoadResult } from './board-store';
import {
  LOAD_RETRY_MIN_INTERVAL_MS,
  LOAD_ORIGIN,
} from '@shared/config';

// ─── Room state machine types ────────────────────────────────────

export type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'compacting' | 'hibernated';

/** Pure state transition function (TC-27). */
export function nextRoomState(state: RoomState, event: string): RoomState {
  switch (state) {
    case 'loading':
      if (event === 'load-ok') return 'ready';
      if (event === 'load-error') return 'load-failed';
      return state;
    case 'ready':
      if (event === 'append-fail') return 'storage-failed';
      if (event === 'compact-start') return 'compacting'; // transient
      if (event === 'no-messages') return 'hibernated';   // transient
      return state;
    case 'compacting':
      if (event === 'compact-done') return 'ready';
      return state;
    case 'hibernated':
      if (event === 'no-messages') return 'hibernated';   // stays hibernated
      if (event === 'update-applied') return 'loading';    // wakes to loading
      return state;
    case 'load-failed':
      if (event === 'retry-after-interval') return 'loading';
      return state;
    case 'storage-failed':
      if (event === 'reload-request') return 'loading';
      return state;
    default:
      return state;
  }
}

// ─── Close codes ─────────────────────────────────────────────────

export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

// ─── BoardRoom class ─────────────────────────────────────────────

interface TestSnapMeta {
  originalChunk0?: Uint8Array;
  repaired: boolean;
}

/** Type-only interface for SQL-capable DO storage (runtime provides it, types lag). */
interface SqlOps {
  execute(sql: string, ...bindings: unknown[]): { toArray(): any[] };
  prepare(sql: string): { bind(...b: unknown[]): { run(): void } };
  transactionSync<T>(fn: () => T): T;
}

export class BoardRoom implements DurableObject {
  private state: DurableObjectState;
  private doc: Y.Doc | null = null;
  private roomState: RoomState = 'loading';
  private loadFailedAt = 0;
  private _testMeta: TestSnapMeta = { repaired: false };
  readonly store: BoardStore; // Exposed for test hooks

  constructor(state: DurableObjectState) {
    this.state = state;
    this.store = new BoardStore(state.storage);
  }

  // ── blockConcurrencyWhile: load on wake ────────────────────────
  async blockConcurrencyWhile(): Promise<void> {
    // In production, this ensures only one instance initializes at a time.
    // In miniflare (wrangler dev), we also initialize eagerly in fetch() as fallback.
    await this._ensureInitialized();
  }

  /** Lazy initialization — called from both blockConcurrencyWhile and fetch. */
  private async _ensureInitialized(): Promise<void> {
    if (this.roomState === 'ready') return;
    // Yield to let concurrent init (e.g. blockConcurrencyWhile) complete first
    await new Promise<void>((r) => setTimeout(r, 0));
    if ((this as any).roomState === 'ready') return;
    await this.loadDoc();
  }

  /** Load persisted snapshot + log into `doc`. Sets room state. */
  private async loadDoc(): Promise<void> {
    try {
      this.store.migrate();
      console.log('[BoardRoom.loadDoc] loading from store...');

      const doc = new Y.Doc();
      const result: LoadResult = this.store.load(doc);

      if (!result.ok) {
        console.error({ event: 'room.load_failed', reason: result.reason });
        this.roomState = 'load-failed';
        this.loadFailedAt = Date.now();
        this.doc = null;
        return;
      }

      this.doc = doc;
      this.roomState = 'ready';
    } catch (err) {
      console.error({ event: 'room.load_error_unexpected', error: String(err) });
      this.roomState = 'load-failed';
      this.loadFailedAt = Date.now();
      this.doc = null;
    }
  }

  /** Get SQL operations interface from DO storage (runtime provided). */
  private _ops(): SqlOps {
    return this.state.storage as unknown as SqlOps;
  }

  // ── fetch: HTTP/WebSocket entry point ─────────────────────────
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Ensure room is initialized (loadDoc + migration)
    await this._ensureInitialized();

    // 1) Internal RPC via ?action=<name> — exposed to test harness
    const action = url.searchParams.get('action');
    if (action) {
      return this.handleRpcAction(action);
    }

    // 2) Internal RPC via /__rpc/* path — for direct DOStub access
    if (url.pathname.startsWith('/__rpc/')) {
      return this.handleRpc(url);
    }

    // 3) HTTP GET to board room without Upgrade header → 426 Upgrade Required
    // This ensures clients use proper WebSocket connection flow.
    const upgrade = request.headers.get('upgrade') || '';
    if (!upgrade.toLowerCase().includes('websocket')) {
      return new Response(
        JSON.stringify({ error: 'WebSocket upgrade required' }),
        { status: 426, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 4) WebSocket-related HTTP requests → route via index.ts handler
    return new Response('', { status: 200 });
  }

  /** Handle RPC via ?action=query-param — used by test harness. */
  private async handleRpcAction(action: string): Promise<Response> {
    switch (action) {
      case 'store-status':
        return new Response(JSON.stringify(this._getStoreStatus()), {
          headers: { 'Content-Type': 'application/json' },
        });
      default:
        return new Response(
          JSON.stringify({ error: `unknown action: ${action}` }),
          { status: 400 },
        );
    }
  }

  /** Handle RPC via /__rpc/* path — for direct DOStub access. */
  private async handleRpc(url: URL): Promise<Response> {
    const action = url.pathname.replace('/__rpc/', '').split('?')[0];

    switch (action) {
      case 'corrupt-snapshot':
        return new Response(JSON.stringify(await this._testCorruptSnapshot()), {
          headers: { 'Content-Type': 'application/json' },
        });
      case 'repair-snapshot':
        return new Response(JSON.stringify(await this._testRepairSnapshot()), {
          headers: { 'Content-Type': 'application/json' },
        });
      case 'get-store-status':
        return new Response(JSON.stringify(this._getStoreStatus()), {
          headers: { 'Content-Type': 'application/json' },
        });
      case 'set-append-fail':
        this.store._setAppendFail(true);
        return new Response(JSON.stringify({ ok: true }));
      case 'unset-append-fail':
        this.store._setAppendFail(false);
        return new Response(JSON.stringify({ ok: true }));
      default:
        return new Response(JSON.stringify({ error: 'unknown RPC' }), { status: 400 });
    }
  }

  // ── WebSocket message handling (hibernation-aware) ─────────────

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    // Check room state first
    if (this.roomState === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.roomState === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }

    if (ws.readyState !== WebSocket.OPEN || typeof msg === 'string') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    const arrBuf = msg as ArrayBuffer;

    let decoded: ReturnType<typeof decodeMessage>;
    try {
      decoded = decodeMessage(arrBuf);
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    switch (decoded.kind) {
      case 'sync': {
        if (!this.doc) { ws.close(CLOSE_UNSUPPORTED_DATA); return; }
        try {
          // Apply-before-store: validate the update against our doc first
          const encoder = encoding.createEncoder();
          const decoder = decoding.createDecoder(decoded.payload);
          readSyncMessage(decoder, encoder, this.doc, ws);
          const reply = encoding.toUint8Array(encoder);

          // Now store the original update bytes BEFORE broadcasting
          try {
            this.store.append(new Uint8Array(arrBuf));
          } catch (appendErr) {
            // Storage failure: close ALL sockets, discard doc
            this._resetRoom(String(appendErr));
            return;
          }

          // Reply to sender
          if (reply.length > 0) {
            ws.send(reply);
          }

          // Broadcast to other clients (output gates hold sends until durable)
          this._broadcastToOthers(ws);

          // Maybe compact
          this.store.compactIfNeeded(this.doc);
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        break;
      }
      case 'awareness': {
        this._broadcastAwareness(msg as ArrayBuffer, ws);
        break;
      }
      case 'query-awareness':
      case 'invalid':
        if (decoded.kind === 'invalid') ws.close(CLOSE_UNSUPPORTED_DATA);
        break;
    }
  }

  webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // Sockets survive hibernation; nothing to clean up manually
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // Error handler required for hibernation compatibility
  }

  // ── Test-only methods (exposed via RPC endpoint above) ────────

  async _testCorruptSnapshot(): Promise<{ ok: boolean; error?: string }> {
    try {
      const ops = this._ops();
      // Read chunk 0
      const rows = ops.execute('SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC').toArray();
      if (rows.length < 1) return { ok: false, error: 'no snapshot' };

      const chunk0Data = new Uint8Array(rows[0].data as ArrayBuffer);
      this._testMeta.originalChunk0 = new Uint8Array(chunk0Data);

      // Corrupt: overwrite with garbage of same length
      const garbage = new Uint8Array(chunk0Data.length);
      for (let i = 0; i < garbage.length; i++) garbage[i] = Math.floor(Math.random() * 256);

      ops.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = ?').bind(garbage, BigInt(0)).run();

      this._testMeta.repaired = false;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async _testRepairSnapshot(): Promise<{ ok: boolean; error?: string }> {
    if (!this._testMeta.originalChunk0) {
      return { ok: false, error: 'no original chunk to restore' };
    }
    try {
      const ops = this._ops();
      ops.prepare('UPDATE snapshot_chunks SET data = ? WHERE idx = ?').bind(this._testMeta.originalChunk0, BigInt(0)).run();

      this._testMeta.repaired = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  _getStoreStatus(): {
    roomState: RoomState;
    rowCount: number;
    totalBytes: number;
    snapshotThroughSeq: number;
  } {
    return {
      roomState: this.roomState,
      rowCount: this.store.meta.rowCount,
      totalBytes: this.store.meta.totalBytes,
      snapshotThroughSeq: this.store.meta.snapshotThroughSeq,
    };
  }

  // ── Private helpers ────────────────────────────────────────────

  private _broadcastToOthers(origin: WebSocket): void {
    if (!this.doc) return;
    const allWss = this.state.getWebSockets();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(this.doc));
    const msgBytes = encoding.toUint8Array(encoder);

    for (const client of allWss) {
      if (client !== origin && client.readyState === WebSocket.OPEN) {
        try { client.send(msgBytes); } catch { /* dead socket */ }
      }
    }
  }

  private _broadcastAwareness(data: ArrayBuffer, except: WebSocket): void {
    const allWss = this.state.getWebSockets();
    for (const client of allWss ?? []) {
      if (client !== except && client.readyState === WebSocket.OPEN) {
        try { client.send(data); } catch { /* dead */ }
      }
    }
  }

  private _resetRoom(errorReason: string): void {
    console.error({ event: 'room.storage_failed', error: errorReason });
    this.roomState = 'storage-failed';

    const allWss = this.state.getWebSockets();
    for (const client of allWss ?? []) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.close(CLOSE_STORAGE_FAILURE); } catch { /* already closing */ }
      }
    }

    // Discard in-memory doc
    this.doc = null;
  }
}
