import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  MESSAGE_SYNC,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type RoomState } from './room-state';

interface RoomEnv {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
}

/**
 * A persistent, hibernating board room.
 *
 * - Loads the board from Durable Object SQLite storage on construct/wake (inside
 *   `blockConcurrencyWhile`), so idle boards cost no compute and survive restarts.
 * - Stores every applied update BEFORE broadcasting it (write-before-broadcast), relying
 *   on the platform output gate so no client sees a change that is not durably written.
 * - A board that cannot be loaded puts the room in `load-failed`; new connections are
 *   accepted then closed with `CLOSE_BOARD_LOAD_FAILED`, and the load is retried at most
 *   every `LOAD_RETRY_MIN_INTERVAL_MS`.
 * - A storage failure puts the room in `storage-failed`: every socket is closed with
 *   `CLOSE_STORAGE_FAILURE`, the doc is discarded, and the next connection reloads.
 */
export class BoardRoom extends DurableObject<RoomEnv> {
  private store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  private lastLoadAttempt = 0;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private wasHibernated = false;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  async fetch(req: Request): Promise<Response> {
    // Test hooks
    const testHook = req.headers.get('x-test-hook');
    if (testHook === 'corrupt-snapshot') {
      this.store.corruptSnapshotForTesting();
      return new Response('ok', { status: 200 });
    }
    if (testHook === 'repair') {
      this.store.repairForTesting();
      return new Response('ok', { status: 200 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Wake / reload paths.
    if (this.state === 'storage-failed' || this.state === 'hibernated' || this.wasHibernated) {
      this.wasHibernated = false;
      this.state = nextRoomState(this.state, { type: 'wake' });
      this.load();
    } else if (this.state === 'load-failed') {
      const now = Date.now();
      if (now - this.lastLoadAttempt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        this.load();
      }
    }

    // A board that cannot be loaded is never presented as empty: accept then close 4500.
    if (this.state === 'load-failed') {
      this.ctx.acceptWebSocket(server, [client, server]);
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }

    // state is 'ready' here (doc is loaded).
    this.ctx.acceptWebSocket(server, [client, server]);
    this.addSocket(server);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.state === 'storage-failed' || !this.doc) {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    this.handleMessage(ws, msg);
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // When the last socket closes the room hibernates; flag it so the next
    // fetch re-runs load() to pick up any storage changes made while asleep.
    if (this.ctx.getWebSockets().length === 0) {
      this.wasHibernated = true;
    }
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // No per-socket state to clean up.
  }

  // --- internals ---

  private load(): void {
    const doc = new Y.Doc();
    this.state = 'loading';
    let result: LoadResult;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (e) {
      result = { ok: false, reason: 'snapshot-unreadable' };
    }

    if (result.ok) {
      this.doc = doc;
      this.attachUpdateHandler();
      this.state = nextRoomState(this.state, { type: 'load-success', quarantined: result.quarantined });
    } else {
      this.doc = null;
      this.updateHandler = null;
      this.state = nextRoomState(this.state, { type: 'load-failed' });
      this.lastLoadAttempt = Date.now();
      console.error({ event: 'board-load-failed', reason: result.reason });
    }
  }

  private attachUpdateHandler(): void {
    const doc = this.doc!;
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      // Updates applied while loading are neither stored nor broadcast.
      if (origin === LOAD_ORIGIN) return;

      // Write before broadcast. A storage failure resets the room (no broadcast).
      try {
        this.store.append(update);
      } catch {
        this.handleStorageFailure();
        return;
      }

      this.state = nextRoomState(this.state, { type: 'update-stored' });
      this.broadcastUpdate(update, origin as WebSocket | null);
      this.store.compactIfNeeded(doc);
    };
    doc.on('update', this.updateHandler);
  }

  private handleStorageFailure(): void {
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // ignore
      }
    }
    if (this.updateHandler && this.doc) {
      this.doc.off('update', this.updateHandler);
    }
    this.doc = null;
    this.updateHandler = null;
    console.error({ event: 'board-storage-failed' });
  }

  private addSocket(server: WebSocket): void {
    const doc = this.doc!;
    server.binaryType = 'arraybuffer';

    // Send SyncStep1 to the new socket (wrapped in y-websocket framing).
    const syncEncoder = encoding.createEncoder();
    sync.writeSyncStep1(syncEncoder, doc);
    const msg = this.frameSyncMessage(encoding.toUint8Array(syncEncoder));
    server.send(msg);
  }

  /** Wrap a sync protocol message in y-websocket framing: varInt(MESSAGE_SYNC) + bytes. */
  private frameSyncMessage(syncBytes: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarInt(encoder, MESSAGE_SYNC);
    encoding.writeUint8Array(encoder, syncBytes);
    return encoding.toUint8Array(encoder);
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return;
    }

    if (decoded.kind === 'awareness') {
      const bytes = decoded.payload;
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(bytes);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    if (decoded.kind === 'sync') {
      const doc = this.doc;
      if (!doc) {
        ws.close(CLOSE_STORAGE_FAILURE);
        return;
      }
      const payload = decoded.payload;
      try {
        const decoder = decoding.createDecoder(payload);
        const responseEncoder = encoding.createEncoder();
        const messageType = sync.readSyncMessage(decoder, responseEncoder, doc, ws);
        // When the client replies with SyncStep2 (its updates), also send the full
        // doc state so the client has the complete board (needed for hibernation wake
        // and late joiners).
        if (messageType === sync.messageYjsSyncStep2) {
          sync.writeSyncStep2(responseEncoder, doc);
        }
        const responseBytes = encoding.toUint8Array(responseEncoder);
        if (responseBytes.length > 0) {
          const framed = this.frameSyncMessage(responseBytes);
          ws.send(framed);
        }
      } catch {
        ws.close(CLOSE_UNSUPPORTED_DATA);
      }
    }
  }

  private broadcastUpdate(update: Uint8Array, origin: WebSocket | null): void {
    const syncEncoder = encoding.createEncoder();
    sync.writeUpdate(syncEncoder, update);
    const framed = this.frameSyncMessage(encoding.toUint8Array(syncEncoder));

    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue; // sender gets no echo
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(framed);
      } catch {
        // ignore
      }
    }
  }
}
