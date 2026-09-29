// One BoardRoom Durable Object per board: the board's Y.Doc in memory, a relay
// of Yjs sync and awareness messages between the sockets on this board, and —
// from story 4 — the durable copy of the board in the object's own SQLite
// storage. See design "Persistent, hibernating board room".
//
// The room has exactly one of four states at any moment (`ready`,
// `load-failed`, `storage-failed`, plus `loading` while the constructor's load
// runs). Every state change goes through `room-state.ts`'s transition function
// so the room cannot invent a state the design does not have.
//
// Sockets are accepted with `ctx.acceptWebSocket` (the hibernation API) and are
// never held in a field: `ctx.getWebSockets()` is the only list of connected
// clients, which is what lets the object go idle while its sockets stay open.

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from './index.ts';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol.ts';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store.ts';
import { nextRoomState, type RoomEvent, type RoomState } from './room-state.ts';
import {
  parseTestHook,
  testHookNotFound,
  testHooksEnabled,
  type TestStorageAction,
} from './test-hooks.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.ts';

/** Wrap a y-protocols sync sub-message in the y-websocket `messageSync` frame. */
function syncMessage(build: (enc: encoding.Encoder) => void): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  build(enc);
  return encoding.toUint8Array(enc);
}

/** Structured log line; the room never logs a whole update or a stack trace. */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** Test-only storage actions, routed here by the Worker entry (TC-24 scaffolding). */

export class BoardRoom extends DurableObject<Env> {
  /**
   * The board's durable store. Public so tests can wrap a method to inject a
   * storage failure (design "Mock vs real"); production code only ever calls it.
   */
  readonly store: BoardStore;

  /** The board document, or null while loading and after a storage failure. */
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  /** When the last load failed, to enforce LOAD_RETRY_MIN_INTERVAL_MS. */
  private loadFailedAt = 0;
  /** How many times this object has tried to load from storage. */
  private attempts = 0;
  /** Resolves once the constructor's load has finished. */
  private readonly loaded: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // The object does not serve any event until the board is in memory or the
    // load has failed.
    this.loaded = this.ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  /** Where the room is in the lifecycle diagram right now. */
  get roomState(): RoomState {
    return this.state;
  }

  /** How many times this object has read storage into a document. */
  get loadAttempts(): number {
    return this.attempts;
  }

  /**
   * How many sockets the runtime holds for this room. The room keeps no socket
   * list of its own — `ctx.getWebSockets()` is the only one — which is what lets
   * the object go idle while clients stay attached (design: hibernation).
   */
  get openSockets(): number {
    return this.ctx.getWebSockets().length;
  }

  // ---------------------------------------------------------------- loading

  /** Read storage into a fresh document and move to `ready` or `load-failed`. */
  private load(): LoadResult {
    this.attempts++;
    const doc = new Y.Doc();
    this.wireDoc(doc);
    let result: LoadResult;
    try {
      this.store.migrate();
      result = this.store.load(doc);
    } catch (err) {
      // load() already turns SQL trouble into a load failure; this is the
      // unexpected case, treated the same way rather than as a crash loop.
      result = { ok: false, reason: 'sql-error', error: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      this.doc = doc;
      this.transition({ type: result.quarantined > 0 ? 'load-ok-quarantined' : 'load-ok' });
      if (result.quarantined > 0) log('board-loaded-with-quarantined-rows', { quarantined: result.quarantined });
    } else {
      this.transition({ type: 'load-failed' });
      this.loadFailedAt = Date.now();
      log('board-load-failed', { reason: result.reason, error: result.error });
    }
    return result;
  }

  /**
   * Give a connecting socket a board it can be shown. A room that failed to
   * load retries only every LOAD_RETRY_MIN_INTERVAL_MS (the transition function
   * carries the close code for "too soon"); a room that failed to store reloads,
   * because its document was thrown away.
   */
  private ensureLoadable(): boolean {
    if (this.state === 'ready') return true;
    if (this.state === 'load-failed') {
      const next = nextRoomState(this.state, {
        type: 'load-retry',
        elapsedMs: Date.now() - this.loadFailedAt,
      });
      // Too soon to retry: refuse this connection without touching storage.
      if (next.state !== 'loading') return false;
      this.state = next.state;
    } else if (this.state === 'storage-failed') {
      this.state = nextRoomState(this.state, { type: 'reload-requested' }).state;
    } else {
      // 'loading' (the constructor's load has not finished) or 'compacting'.
      return false;
    }
    this.load();
    return this.state === 'ready';
  }

  // ------------------------------------------------------------- lifecycle

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/__test/boards/')) {
      const hook = parseTestHook(path);
      if (!hook || !testHooksEnabled(this.env)) return testHookNotFound();
      return this.handleTestHook(hook.action);
    }

    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    await this.loaded;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (!this.ensureLoadable()) {
      // Nothing to sync: hand the client its socket and close it with the
      // reason the client shows. The doc is not touched, so nothing is stored
      // and no empty board is served.
      this.ctx.acceptWebSocket(server);
      try {
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      } catch {
        /* already closing */
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    // Send our state vector so the client sends back anything we are missing —
    // this is how changes made while this object was away get stored.
    this.safeSend(server, syncMessage((enc) => syncProtocol.writeSyncStep1(enc, this.doc!)));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // A room that cannot serve the board says so and stops; nothing it receives
    // is applied or stored.
    if (this.state === 'load-failed') {
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE);
      return;
    }

    const decoded = decodeMessage(message);

    if (decoded.kind === 'invalid') {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relayed verbatim to every open socket *including* the sender, so idle
      // clients keep receiving traffic and never trip their no-message timeout.
      // Awareness semantics (who is here) are story 6 — we do not interpret it.
      for (const other of this.ctx.getWebSockets()) this.safeSend(other, message);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      // No stored awareness state in this story: ignore.
      return;
    }

    // kind === 'sync'. `onStoreUpdate` stores and broadcasts what this applies.
    const doc = this.doc;
    if (!doc) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE);
      return;
    }
    try {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const sub = decoding.createDecoder(decoded.payload);
      // Any Yjs apply error is rethrown so the offending socket is closed with
      // CLOSE_UNSUPPORTED_DATA rather than silently corrupting the room.
      syncProtocol.readSyncMessage(sub, reply, doc, ws, (err: unknown) => {
        throw err;
      });
      // A storage failure during the apply closed every socket already; the
      // document is gone, so there is nothing left to answer from.
      if (this.state !== 'ready' || !this.doc) return;
      if (encoding.length(reply) > 1) {
        this.safeSend(ws, encoding.toUint8Array(reply));
      }
    } catch {
      this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA);
    }
  }

  webSocketClose(): void {
    // `ctx.getWebSockets()` drops the socket by itself; there is no set to
    // update, and the board outlives every socket.
  }

  /**
   * TEST ONLY (TC-24): damage or repair this board's stored snapshot, then throw
   * the live document away so the board's fate is decided by a real load on the
   * next connection. `loadFailedAt` is back-dated past the retry throttle, so a
   * client that is already reconnecting gets a fresh attempt rather than a refusal
   * to go near storage — which is the point of the scenario.
   *
   * Sitting in `load-failed` here is a test injection of a state that production
   * can only reach through a failed load; the load itself is production code.
   */
  private async handleTestHook(action: TestStorageAction): Promise<Response> {
    // Let the constructor's load finish first: the tables must exist, and a
    // document loaded from the damaged state must not be kept alive.
    await this.loaded;

    const ok =
      action === 'corrupt-snapshot'
        ? this.store.corruptSnapshotForTests()
        : this.store.repairSnapshotForTests();
    if (!ok) {
      return Response.json(
        {
          ok: false,
          error:
            action === 'corrupt-snapshot'
              ? 'this board has no snapshot to damage'
              : 'nothing is backed up to repair',
        },
        { status: 409 },
      );
    }

    this.doc = null;
    this.state = 'load-failed';
    this.loadFailedAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS;
    log('test-storage-action', { action });
    return Response.json({ ok: true, action });
  }

  webSocketError(): void {
    this.webSocketClose();
  }

  // ------------------------------------------------------------ doc wiring

  /**
   * The single place an in-memory change becomes a stored change: store first,
   * broadcast only what the storage layer accepted, then fold the log into a
   * snapshot if it grew past the threshold.
   */
  private wireDoc(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Updates applied *from* storage are not a change to store or relay.
      if (origin === LOAD_ORIGIN) return;

      try {
        this.store.append(update);
      } catch (err) {
        this.handleStorageFailure(err);
        return;
      }

      const frame = syncMessage((enc) => syncProtocol.writeUpdate(enc, update));
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === origin) continue;
        this.safeSend(ws, frame);
      }

      // Opportunistic compaction after the change is durable; a rolled back
      // compaction leaves the log intact and costs nothing.
      this.store.compactIfNeeded(doc);
    });
  }

  /**
   * Storage stopped accepting writes: close every socket with 1011 and throw
   * the document away, so the next connection rebuilds the board from storage
   * instead of serving a document storage does not agree with.
   */
  private handleStorageFailure(err: unknown): void {
    log('storage-write-failed', { error: err instanceof Error ? err.message : String(err) });
    this.transition({ type: 'storage-write-failed' });
    for (const ws of this.ctx.getWebSockets()) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE);
    }
    this.doc = null;
  }

  // -------------------------------------------------------------- plumbing

  /**
   * Move to the state the transition function says this event leads to. The
   * room never sits in `compacting`: folding the log into a snapshot happens
   * synchronously inside the update handler, between storing and answering.
   */
  private transition(event: RoomEvent): RoomState {
    this.state = nextRoomState(this.state, event).state;
    return this.state;
  }

  /** Send bytes; a socket whose send throws is left for the runtime to drop. */
  private safeSend(ws: WebSocket, data: ArrayBuffer | Uint8Array | string): void {
    try {
      ws.send(data);
    } catch {
      /* the socket is gone; getWebSockets() will stop listing it */
    }
  }

  private closeSocket(ws: WebSocket, code: number): void {
    try {
      ws.close(code);
    } catch {
      /* already closing */
    }
  }
}
