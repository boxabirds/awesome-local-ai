import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomState, type RoomEvent } from './room-state';
import { initDoc } from '../shared/board-model';

export type Env = { BOARD_ROOM: DurableObjectNamespace<BoardRoom> };

/** Internal request paths for test hooks (only handled when TEST_HOOKS is set) */
const TEST_HOOK_CORRUPT = '__test/corrupt-snapshot';
const TEST_HOOK_REPAIR = '__test/repair';

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private state: RoomState = 'loading';
  private lastLoadFailedTime = 0;
  /** Sockets that have not yet completed their initial sync handshake */
  private pendingSync = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.blockConcurrencyWhile(async () => {
      await this.loadFromStorage();
    });
  }

  private transition(event: RoomEvent): void {
    const newState = nextRoomState(this.state, event);
    if (newState === 'load-failed') {
      this.lastLoadFailedTime = Date.now();
    }
    this.state = newState;
  }

  private async loadFromStorage(): Promise<boolean> {
    const storage = this.ctx.storage;
    const store = new BoardStore(storage);
    this.store = store;

    try {
      store.migrate();
    } catch (e) {
      console.error(JSON.stringify({ event: 'migrate_failed', error: String(e) }));
      this.transition({ type: 'load-failed' });
      return false;
    }

    const doc = new Y.Doc();
    // Initialize the server-side doc with schema before loading stored state.
    initDoc(doc);
    const loadResult: LoadResult = store.load(doc);

    if (!loadResult.ok) {
      console.error(JSON.stringify({ event: 'load_failed', reason: loadResult.reason, error: loadResult.error }));
      this.transition({ type: 'load-failed' });
      return false;
    }

    // Set up the update handler AFTER loading so load updates aren't stored/broadcast
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      this.handleDocUpdate(update, origin as WebSocket | undefined);
    });

    this.doc = doc;
    this.transition({ type: 'load-success', quarantined: loadResult.quarantined });
    return true;
  }

  private handleDocUpdate(update: Uint8Array, origin?: WebSocket): void {
    if (!this.store || !this.doc) return;
    if (this.state !== 'ready') return;

    // During a socket's initial sync handshake, don't store updates
    // (the client is sending its initial state like schemaVersion)
    const suppressStore = origin ? this.pendingSync.has(origin) : false;

    if (!suppressStore) {
      // Try to store before broadcasting
      try {
        this.store.append(update);
      } catch (e) {
        console.error(JSON.stringify({ event: 'storage_failure', error: String(e) }));
        this.transition({ type: 'storage-error' });
        this.discardDoc();
        return;
      }
    }

    // Always broadcast (except back to origin)
    this.broadcastUpdate(update, origin);

    if (!suppressStore) {
      // Check compaction only after real stores
      this.store.compactIfNeeded(this.doc);
    }
  }

  private discardDoc(): void {
    this.doc = null;
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE);
      } catch {
        // already closed
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, except?: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);

    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      if (ws === except) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          // Socket might be hibernated or closed
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Handle test hook requests (corrupt/repair storage)
    const url = new URL(request.url);
    if (url.pathname === `/${TEST_HOOK_CORRUPT}`) {
      return this.handleTestCorrupt();
    }
    if (url.pathname === `/${TEST_HOOK_REPAIR}`) {
      return this.handleTestRepair();
    }

    // Handle LoadFailed state
    if (this.state === 'load-failed') {
      const now = Date.now();
      const elapsed = now - this.lastLoadFailedTime;
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Transition to loading, then retry
        this.state = 'loading';
        const success = await this.loadFromStorage();
        if (!success) {
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED);
          return new Response(null, { status: 101, webSocket: client });
        }
        // Fall through to serve the successfully loaded doc
      } else {
        // Too soon, reject immediately
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED);
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Handle StorageFailed state
    if (this.state === 'storage-failed') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_STORAGE_FAILURE);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ready state: accept the WebSocket
    if (!this.doc) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.close(CLOSE_STORAGE_FAILURE);
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Mark as pending sync: suppress storing updates from this socket's initial handshake
    this.pendingSync.add(server);

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    server.send(encoding.toUint8Array(syncEncoder));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // Check state first
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    if (!this.doc) {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }

    const decoded = decodeMessage(message);

    switch (decoded.kind) {
      case 'sync': {
        try {
          const decoder = decoding.createDecoder(decoded.payload);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
          // Send reply if non-empty (more than just the varint type byte)
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
          // Clear pending sync after SyncStep2 or Update from client.
          // SyncStep1 (type 0) from client doesn't modify server's doc.
          if (this.pendingSync.has(ws) && syncType !== 0) {
            this.pendingSync.delete(ws);
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        break;
      }
      case 'awareness': {
        const frame = new Uint8Array(1 + decoded.payload.length);
        frame[0] = MESSAGE_AWARENESS;
        frame.set(decoded.payload, 1);
        const sockets = this.ctx.getWebSockets();
        for (const s of sockets) {
          if (s.readyState === WebSocket.OPEN) {
            try {
              s.send(frame);
            } catch {
              // ignore
            }
          }
        }
        break;
      }
      case 'query-awareness': {
        break;
      }
      case 'invalid': {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        break;
      }
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
  }

  /**
   * Test hook: corrupts snapshot chunk 0 (or creates a corrupt one if none exists).
   * Saves the original chunk in storage_meta for later repair.
   */
  private handleTestCorrupt(): Response {
    try {
      const rows = this.ctx.storage.sql.exec<{ data: ArrayBuffer }>(
        `SELECT data FROM snapshot_chunks WHERE idx = 0`,
      ).toArray();

      if (rows.length > 0) {
        // Corrupt existing snapshot
        const original = new Uint8Array(rows[0]!.data);
        // Save original chunk in meta (base64-encoded)
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('test_original_chunk_0', ?1)`,
          btoa(String.fromCharCode(...original)),
        );
        // Overwrite with garbage (random bytes of same length)
        const garbage = new Uint8Array(original.length);
        crypto.getRandomValues(garbage);
        this.ctx.storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          garbage,
        );
      } else {
        // No snapshot exists; create a corrupt one that will fail to apply
        const garbage = new Uint8Array(64);
        crypto.getRandomValues(garbage);
        this.ctx.storage.sql.exec(
          `INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?1)`,
          garbage,
        );
        // Mark snapshot_through_seq so the loader skips log rows (only snapshot is used)
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '9999999')`,
        );
      }

      return new Response('Corrupted', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${String(e)}`, { status: 500 });
    }
  }

  /**
   * Test hook: repairs snapshot chunk 0 from the saved original,
   * or removes the fake corrupt snapshot if no original was saved.
   */
  private handleTestRepair(): Response {
    try {
      const metaRows = this.ctx.storage.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'test_original_chunk_0'`,
      ).toArray();

      if (metaRows.length > 0) {
        // Restore original chunk 0 (case: existing snapshot was corrupted)
        const binary = atob(metaRows[0]!.value);
        const original = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) original[i] = binary.charCodeAt(i);

        this.ctx.storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          original,
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM storage_meta WHERE key = 'test_original_chunk_0'`,
        );
      } else {
        // No saved original: remove the fake corrupt snapshot and meta
        // (case: corrupt hook inserted a fake snapshot where none existed)
        this.ctx.storage.sql.exec(`DELETE FROM snapshot_chunks`);
        this.ctx.storage.sql.exec(
          `DELETE FROM storage_meta WHERE key = 'snapshot_through_seq'`,
        );
      }

      // Reset the room state so the next client connection triggers a reload
      this.doc = null;
      this.state = 'loading';
      this.lastLoadFailedTime = 0;

      return new Response('Repaired', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${String(e)}`, { status: 500 });
    }
  }
}
