/**
 * Story 4 · the persistent, hibernating BoardRoom (design "Persistent,
 * hibernating board room").
 *
 * One instance per board. It holds the board's `Y.Doc` in memory *and* mirrors
 * every change to SQLite-backed Durable Object storage:
 *
 *  - The lifecycle starts in `hibernated` (= "no doc yet"). A construct, a new
 *    connection or a hibernated socket message moves it to `loading`, and the
 *    doc is reloaded inside `ctx.blockConcurrencyWhile`, so a restarted or
 *    evicted room serves the board exactly as it was left
 *    (persist.reopen / persist.restart).
 *  - Every update is appended to storage *before* it is broadcast (design
 *    decision 1, write-before-broadcast): the runtime's output gates hold
 *    sends until pending storage writes are confirmed, so nothing can be
 *    *seen* that is not durably saved (persist.seen_is_saved).
 *  - Sockets are accepted with `ctx.acceptWebSocket` (hibernation): the socket
 *    set is `ctx.getWebSockets()`, so an idle board costs no compute and open
 *    sockets survive eviction.
 *  - A snapshot that cannot be read (or a SQL error while reading) puts the
 *    room in `load-failed`: clients are closed with 4500 and retried, instead
 *    of being served a misleadingly empty board (persist.load_failure). A
 *    failing write puts it in `storage-failed`: sockets close with 1011, the
 *    doc is discarded and the next connection reloads, so clients re-send what
 *    the server never stored (persist.save_failure).
 *
 * `room-state.ts` is the executable copy of the design's lifecycle diagram;
 * every transition in this class goes through `nextRoomState`.
 */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  toArrayBuffer,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, loadRetryIntervalMs } from './board-store';
import { closeCodeForState, nextRoomState, type RoomState } from './room-state';
import {
  corruptSnapshot,
  parseTestHook,
  repairSnapshot,
} from './test-hooks';

interface Env {
  [key: string]: unknown;
}

export class BoardRoom extends DurableObject<Env> {
  /** Room lifecycle state; see `room-state.ts` (starts unloaded). */
  private roomState: RoomState = 'hibernated';
  /** The board document, or `null` while unloaded / after a storage failure. */
  private ydoc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  /** When the last load attempt happened, for the retry-interval gate. */
  private lastLoadAttemptAt = 0;
  /**
   * Updates produced by the frame currently being handled. Nothing is stored
   * until the whole frame has decoded and applied cleanly (design decision 2).
   */
  private staged: Uint8Array[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Design: the constructor reloads the doc inside `blockConcurrencyWhile`,
    // so no message or connection is handled before the load settles.
    this.ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  // ---- loading -----------------------------------------------------------

  /** Ready means: loaded, and a doc + store are in memory. */
  private get ready(): boolean {
    return this.roomState === 'ready' && this.ydoc !== null && this.store !== null;
  }

  /**
   * Load snapshot + log into a fresh doc (design "Sequence: object wakes and
   * loads"). Hibernated → Loading → Ready / LoadFailed.
   */
  private async loadDoc(): Promise<RoomState> {
    this.roomState = nextRoomState(this.roomState, 'wake');
    this.lastLoadAttemptAt = Date.now();
    try {
      const doc = new Y.Doc();
      const store = new BoardStore(this.ctx.storage);
      store.migrate();
      const result = store.load(doc);
      if (!result.ok) {
        this.ydoc = null;
        this.store = null;
        this.roomState = nextRoomState(this.roomState, 'load-failed');
        return this.roomState;
      }
      this.ydoc = doc;
      this.store = store;
      this.roomState = nextRoomState(
        this.roomState,
        result.quarantined > 0 ? 'load-quarantined' : 'load-success',
      );
      this.watchDoc(doc);
      return this.roomState;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'load-failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      this.ydoc = null;
      this.store = null;
      this.roomState = nextRoomState(this.roomState, 'load-failed');
      return this.roomState;
    }
  }

  /** Wire the doc's update feed: collect changes, commit them later. */
  private watchDoc(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Updates applied while loading are already durable: never re-store and
      // never rebroadcast them.
      if (origin === LOAD_ORIGIN) return;
      const batch = this.staged;
      if (batch !== null) {
        // Inside a client message: the handler decides whether this is stored.
        batch.push(update.slice());
        return;
      }
      // Outside a message (no writer path today): keep the same guarantee.
      this.commit([update.slice()], origin);
    });
  }

  /**
   * Write-before-broadcast: the whole batch is stored first, and only then
   * handed to the sockets, so a change nobody has saved is never broadcast.
   * A failed write resets the room (design decision 3) and returns false.
   */
  private commit(updates: Uint8Array[], except: unknown): boolean {
    const store = this.store;
    if (store === null) return false;
    if (updates.length > 0) {
      try {
        for (const update of updates) store.append(update);
      } catch (error) {
        this.failStorage(error);
        return false;
      }
      for (const update of updates) this.broadcast(update, except);
    }
    // Compaction is the only other use of the write path. It never throws: a
    // failure rolls its transaction back and leaves the log intact.
    const doc = this.ydoc;
    if (doc === null) return true;
    this.roomState = nextRoomState(this.roomState, 'update');
    this.roomState = nextRoomState(this.roomState, 'compact-start');
    const compacted = store.compactIfNeeded(doc);
    this.roomState = nextRoomState(this.roomState, compacted ? 'compact-done' : 'compact-error');
    return true;
  }

  /** Forget the in-memory doc and store; the next connection reloads them. */
  private discardDoc(): void {
    this.ydoc = null;
    this.store = null;
  }

  /**
   * Storage write failure (design decision 3): the change is *not* broadcast,
   * every socket closes with 1011 and the doc is discarded. The next
   * connection reloads from storage, and clients that still hold the unsaved
   * change re-send it through the story 3 SyncStep1 / SyncStep2 exchange.
   */
  private failStorage(error: unknown): void {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'storage-failure',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    this.roomState = nextRoomState(this.roomState, 'storage-error');
    this.discardDoc();
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'storage failure');
    }
  }

  // ---- connections --------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    // Test-only storage surgery (story 4, TC-24). Only reachable through the
    // Worker, which registers these routes when `TEST_HOOKS=1` and hides them
    // otherwise; the e2e environment is the only place that sets it.
    const hook = parseTestHook(pathname);
    if (hook !== null) {
      const kv = {
        get: (key: string, type: 'arrayBuffer') =>
          this.ctx.storage.get<ArrayBuffer>(key, { type: 'arrayBuffer' }),
        put: (key: string, value: Uint8Array) =>
          this.ctx.storage.put(key, value.slice()),
        delete: (key: string) => this.ctx.storage.delete(key),
      };
      const sql = {
        exec: (query: string, ...bindings: unknown[]) =>
          this.ctx.storage.sql.exec(query, ...bindings),
      };

      let result;
      if (hook.action === 'corrupt-snapshot') {
        // A small live board has no snapshot yet (compaction is threshold
        // driven), so give the test something to damage first.
        const store = this.store;
        const doc = this.ydoc;
        const existing = sql.exec(`SELECT COUNT(*) AS cnt FROM snapshot_chunks`).toArray()[0];
        if (store !== null && doc !== null && Number(existing?.['cnt'] ?? 0) === 0) {
          store.compactIfNeeded(doc, true);
        }
        result = await corruptSnapshot(kv, sql);
      } else {
        result = await repairSnapshot(kv, sql);
      }

      // The hooks only mean anything if the room stops serving the copy it
      // already has: forget it, then either fail honestly or reload at once.
      this.discardDoc();
      if (hook.action === 'corrupt-snapshot') {
        // Behave exactly like a room that just tried to load and could not:
        // every connection is told 4500, and the retry gate starts now.
        this.roomState = nextRoomState('loading', 'load-failed');
        this.lastLoadAttemptAt = Date.now();
        for (const socket of this.ctx.getWebSockets()) {
          this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
        }
      } else {
        // Repair: reload straight away, so the next connection is served from
        // the restored snapshot instead of waiting out the retry gate.
        this.roomState = 'loading';
        await this.loadDoc();
      }
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      // Not a collab connection (an internal call, or a request that skipped
      // the Worker's routing): nothing to upgrade.
      return new Response('Upgrade Required', { status: 426 });
    }

    if (!this.ready) {
      // A room without a doc retries the load. `storage-failed` reloads on the
      // next connection straight away (design: StorageFailed → Loading); a
      // `load-failed` room only retries once LOAD_RETRY_MIN_INTERVAL_MS has
      // passed, so a broken board is not hammered (persist.load_failure).
      const interval = loadRetryIntervalMs();
      const event =
        this.roomState === 'storage-failed'
          ? 'wake'
          : Date.now() - this.lastLoadAttemptAt >= interval
            ? 'retry-load'
            : 'retry-load-early';
      const nextState = nextRoomState(this.roomState, event);
      if (nextState === 'loading') {
        this.roomState = nextState;
        await this.loadDoc();
      }
    }

    if (!this.ready) {
      // Honest failure: accept so the client learns *why*, then close. The
      // board is never served as a misleadingly empty, editable board.
      this.ctx.acceptWebSocket(server);
      this.closeSocket(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    const doc = this.ydoc as Y.Doc;
    server.binaryType = 'arraybuffer';
    // Hibernating accept: the socket survives eviction and broadcasts iterate
    // `ctx.getWebSockets()`.
    this.ctx.acceptWebSocket(server);

    // Greet with SyncStep1, so a (re)connecting client can repopulate a room
    // that reloaded (story 3 handshake, unchanged) — including the room that
    // discarded its doc after a storage failure.
    const greeting = encoding.createEncoder();
    encoding.writeVarUint(greeting, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(greeting, doc);
    this.send(server, encoding.toUint8Array(greeting));

    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (!this.ready) {
      // A room that cannot serve the board says so instead of pretending:
      // 4500 for a load failure, 1011 for a storage failure (the client keeps
      // its unsaved changes and re-sends them after reconnecting).
      const code = closeCodeForState(this.roomState) ?? CLOSE_STORAGE_FAILURE;
      this.closeSocket(ws, code, 'room cannot serve this board');
      return;
    }
    const doc = this.ydoc as Y.Doc;

    const buffer = toArrayBuffer(message);
    if (buffer === null) {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'text frame');
      return;
    }
    const decoded = decodeMessage(buffer);
    if (decoded.kind === 'invalid') {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (decoded.kind === 'awareness') {
      // Awareness is presence, not board state: relayed verbatim to everybody
      // (including the sender, so idle clients keep receiving traffic) and
      // never stored.
      for (const socket of this.ctx.getWebSockets()) {
        this.send(socket, decoded.payload);
      }
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return; // No stored awareness in this story (story 6 owns it).
    }

    // A sync frame: validate by applying (design decision 2). Updates produced
    // while decoding are collected into `staged` instead of being written
    // straight away, so a frame that fails to apply is neither stored nor
    // broadcast. The doc is then rebuilt from storage on the next connection:
    // the room never serves a half-applied board (which would also leak into
    // the next snapshot).
    const staged: Uint8Array[] = [];
    const outer = this.staged;
    this.staged = staged;
    const decoder = decoding.createDecoder(decoded.payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let undecodable = false;
    try {
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws, () => {
        undecodable = true;
      });
    } catch {
      undecodable = true;
    }
    this.staged = outer;

    if (undecodable) {
      this.discardDoc();
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'undecodable sync');
      return;
    }

    if (!this.commit(staged, ws)) return;

    if (encoding.length(encoder) > 1) {
      this.send(ws, encoding.toUint8Array(encoder));
    }
  }

  override webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // Nothing to forget: `ctx.getWebSockets()` no longer includes the socket.
  }

  override webSocketError(_ws: WebSocket, _error: unknown): void {
    // A dead socket is dropped by the runtime; broadcasts skip non-open ones.
  }

  // ---- messaging ----------------------------------------------------------

  private send(ws: WebSocket, bytes: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      // `slice()` hands each frame a freshly owned buffer (no shared
      // AliasedBuffer between frames).
      ws.send(bytes.slice().buffer);
    } catch {
      // A socket that throws mid-send is gone; there is nothing to track.
    }
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  /** Broadcast to every accepted socket except the origin (no echo, TC-08). */
  private broadcast(update: Uint8Array, except: unknown): void {
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, MESSAGE_SYNC);
    syncProtocol.writeUpdate(message, update);
    const bytes = encoding.toUint8Array(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.send(socket, bytes);
    }
  }
}
