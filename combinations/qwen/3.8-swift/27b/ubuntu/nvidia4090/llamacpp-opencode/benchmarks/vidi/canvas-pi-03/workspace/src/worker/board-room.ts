/**
 * Story 4: persistent, hibernating BoardRoom.
 *
 * One Durable Object per board. The board's Y.Doc is reloaded from SQLite
 * storage on every construct/wake (the hibernation API re-runs the
 * constructor), so a board survives everyone leaving and service restarts.
 *
 * - **Write before broadcast**: the doc's `update` handler appends to storage
 *   first; the platform's output gates hold the broadcast until the write is
 *   durable, so no client ever sees an unsaved change (persist.seen_is_saved).
 * - **Hibernation**: sockets are accepted with `ctx.acceptWebSocket`;
 *   `ctx.getWebSockets()` is the source of truth (survives hibernation). Idle
 *   boards cost no compute.
 * - **LoadFailed**: a board that cannot be loaded refuses to serve an empty
 *   doc; connections are closed with CLOSE_BOARD_LOAD_FAILED and the room
 *   retries its own load at most every LOAD_RETRY_MIN_INTERVAL_MS.
 * - **StorageFailed**: a failed insert closes every socket with
 *   CLOSE_STORAGE_FAILURE and discards the doc; reconnecting clients re-send
 *   unsaved changes via the SyncStep1/2 exchange (persist.save_failure).
 *
 * Framing is y-websocket (story 3): sync + awareness. A string / undecodable /
 * unknown-type frame, or an update Yjs rejects, closes only that socket with
 * CLOSE_UNSUPPORTED_DATA and is never stored.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { initDoc } from 'src/shared/board-model';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  decodeMessage,
  encodeSyncFrame,
} from 'src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from 'src/shared/config';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { handleTestOp } from './test-ops';
import {
  nextRoomState,
  restingState,
  type RoomLifecycle,
} from './room-state';

export interface RoomEnv {
  BOARD_ROOM: unknown;
  ASSETS: unknown;
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closing/closed
  }
}

export class BoardRoom extends DurableObject<RoomEnv> {
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private state: RoomLifecycle = 'loading';

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Reload on every construct/wake; block concurrent fetches until done.
    ctx.blockConcurrencyWhile(() => Promise.resolve(this.load()));
  }

  private load(): void {
    this.store.migrate();
    const now = Date.now();
    const status = this.store.loadStatus();
    // Honor the LoadFailed retry interval: if a recent attempt failed, do not
    // re-load yet — stay LoadFailed (fetch will close the socket with 4500).
    if (status.failed && now - status.lastAttemptAt < LOAD_RETRY_MIN_INTERVAL_MS) {
      this.doc = null;
      this.state = 'load-failed';
      return;
    }

    const doc = new Y.Doc();
    const result = this.store.load(doc);
    this.store.recordLoadAttempt(now, result.ok);

    if (result.ok) {
      // Attach the update handler before seeding the schema so a fresh board's
      // init op is stored (and would be broadcast to any concurrent peer).
      this.attachDocListeners(doc);
      initDoc(doc);
      this.doc = doc;
      this.state = nextRoomState('loading', { type: 'loaded' });
    } else {
      this.doc = null;
      this.state = nextRoomState('loading', { type: 'load-failed' });
      console.error(
        JSON.stringify({
          event: 'board.room.load_failed',
          reason: result.reason,
          error: result.error,
        }),
      );
    }
  }

  async fetch(req: Request): Promise<Response> {
    // Test-only ops (only routed here by the worker when TEST_HOOKS is on).
    const url = new URL(req.url);
    if (url.pathname.startsWith('/__test/boards/')) {
      // fail-append arms the DO's own store (not a separate instance), so the
      // DO's update handler sees the injected failure on the next real update.
      if (url.pathname.endsWith('/fail-append')) {
        this.store.armAppendFailure();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handleTestOp(this.ctx.storage, req);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation accept: the socket is tracked by ctx and survives hibernation.
    this.ctx.acceptWebSocket(server);

    // LoadFailed retry: a new connection after LOAD_RETRY_MIN_INTERVAL_MS
    // re-loads the board (it may have been repaired in storage), so a failing
    // board recovers without a process restart. Before the interval it stays
    // LoadFailed and the socket is refused with 4500.
    if (restingState(this.state) === 'load-failed') {
      const now = Date.now();
      const status = this.store.loadStatus();
      this.state = nextRoomState(this.state, {
        type: 'connection-attempt',
        now,
        lastAttemptAt: status.lastAttemptAt,
      });
      if (this.state === 'loading') this.load();
      if (restingState(this.state) === 'load-failed') {
        closeQuietly(server, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
      // The board loaded successfully on retry: fall through and serve the doc.
    }
    if (restingState(this.state) === 'storage-failed') {
      closeQuietly(server, CLOSE_STORAGE_FAILURE, 'storage failure');
      return new Response(null, { status: 101, webSocket: client });
    }

    const doc = this.doc;
    if (!doc) {
      closeQuietly(server, CLOSE_STORAGE_FAILURE, 'no doc');
      return new Response(null, { status: 101, webSocket: client });
    }
    // Send our SyncStep1 so the newcomer (re)syncs; the client replies with its
    // own SyncStep1 and we answer with a SyncStep2 if it lacks state.
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(step1, doc);
    server.send(encoding.toUint8Array(step1));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    const resting = restingState(this.state);
    if (resting === 'load-failed') {
      closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (resting === 'storage-failed') {
      closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(ws, decoded.payload);
        return;
      case 'awareness':
        this.relayAwareness(data);
        return;
      case 'query-awareness':
        // No stored awareness in this story: ignore.
        return;
      case 'invalid':
        closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
        return;
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // The hibernation API removes the socket from getWebSockets(); the doc
    // persists, so there is nothing to clean up here.
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // Nothing to clean up.
  }

  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.doc;
    if (!doc) {
      closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'no doc');
      return;
    }
    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.hasContent(encoder)) {
        ws.send(encodeSyncFrame(encoding.toUint8Array(encoder)));
      }
    } catch {
      closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
    }
  }

  private relayAwareness(data: string | ArrayBuffer): void {
    // Relay the original frame verbatim to everyone, sender included, to keep
    // idle y-websocket clients alive.
    const frame =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    for (const s of this.ctx.getWebSockets()) {
      try {
        s.send(frame);
      } catch {
        // drop dead socket
      }
    }
  }

  private attachDocListeners(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Updates applied during load are neither stored nor broadcast.
      if (origin === LOAD_ORIGIN) return;
      // Write before broadcast; a failure resets the room.
      try {
        this.store.append(update);
      } catch {
        this.onStorageFailure();
        return;
      }
      this.broadcast(update, origin);
      this.store.compactIfNeeded(doc);
    });
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const frame = encoding.toUint8Array(enc);
    for (const s of sockets) {
      if (s === except) continue;
      try {
        s.send(frame);
      } catch {
        // drop dead socket
      }
    }
  }

  private onStorageFailure(): void {
    this.state = nextRoomState(this.state, { type: 'storage-failed' });
    for (const s of this.ctx.getWebSockets()) {
      closeQuietly(s, CLOSE_STORAGE_FAILURE, 'storage failure');
    }
    this.doc = null;
  }
}
