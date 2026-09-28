// BoardRoom Durable Object: one instance per board id - the single writer of
// that board's Yjs document, and the only thing that touches its storage.
//
// Story 4 added durability to story 3's relay, and kept every relay rule
// identical (a client never sees an echo of its own change; awareness frames are
// relayed verbatim to everyone including the sender; a malformed frame closes
// that socket only with 1003).
//
// Ordering rule. A client update is applied to the in-memory document and
// written to the SQLite update log in one `ctx.storage.transactionSync()`
// before it is broadcast, so nothing a client can observe is ever ahead of
// SQLite. That is the whole reason the append is not fire-and-forget.
//
// Wake-up. The document is read in the constructor inside
// `ctx.blockConcurrencyWhile()`, before any input is handled: the first client
// to reach a cold board is answered with the stored state, not with an empty
// document that it then has to re-teach the room.
//
// Hibernation. Connections are accepted with `ctx.acceptWebSocket()` and the
// message path starts in the static (class) `webSocketMessage` handler, so an
// instance that was woken by a frame - and is therefore not in memory - is
// still handled: the constructor loads the board first, then the frame is
// handled. The socket list is never cached; every relay goes through
// `ctx.getWebSockets()`.
//
// Failure. A load failure is terminal for the instance: every socket is closed
// with CLOSE_BOARD_LOAD_FAILED (4500) and nothing is written to storage until a
// load succeeds again. 4500 is deliberate - y-websocket treats 4400-4499 as
// "reconnecting cannot fix this" and stops, while 4500 keeps the client
// retrying, which is what eventually brings the board back. Retries are
// rate-limited by the lifecycle machine (LOAD_RETRY_MIN_INTERVAL_MS) and a retry
// discards the in-memory document first, so a retry is a real re-read and never
// a no-op against state that is already in memory.
//
// Everything below the "test-only" banner is unreachable from the network: the
// router only maps /__test/... to it when env TEST_HOOKS === '1', which nothing
// but the test worker and `wrangler dev --var TEST_HOOKS:1` ever sets.
import * as Y from 'yjs';
import * as YjsSync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DurableObject } from 'cloudflare:workers';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../shared/protocol.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.ts';
import type { InitializeResult } from './create-board.ts';
import { BoardStore, errorMessage, LOAD_ORIGIN, type BoardStorage, type SqlBinding } from './board-store.ts';
import {
  nextLifecycleState,
  roomState,
  type LifecycleEvent,
  type LifecycleState,
  type LifecycleTransition,
} from './room-state.ts';
import type { Env } from './index.ts';

/**
 * What a room reports about itself: the lifecycle machine, whether it is
 * serving, and the real row counts read out of its SQLite. Used by the tests
 * only - no client ever sees it.
 */
export interface RoomStats {
  lifecycle: LifecycleState;
  state: ReturnType<typeof roomState>;
  loadError: string | null;
  serving: boolean;
  updateCount: number;
  updateBytes: number;
  logRows: number;
  logBytes: number;
  chunks: number;
  chunkSizes: number[];
  throughSeq: number;
  quarantined: number;
  sockets: number;
  compacting: boolean;
}

/** Bytes that parse as a Yjs update and then fail when applied. */
function unreadableChunk(): Uint8Array {
  // A huge declared update length with nothing behind it: the update header
  // decodes, the content is missing. Y.applyUpdate throws on it.
  return new Uint8Array([0x00, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x01]);
}

export class BoardRoom extends DurableObject<Env> {
  /** The live document, or null whenever the room has nothing trustworthy. */
  private ydoc: Y.Doc | null = null;
  private readonly store: BoardStore;
  private lifecycle: LifecycleState = 'loading';
  /** When the current load failure happened (drives the retry rate limit). */
  private failedAt: number | null = null;
  /**
   * Once this instance has seen its board exist, it stays existing: boards are
   * never deleted, and re-reading the catalogue on every reconnect buys nothing.
   */
  private existsNow = false;
  private loadError: string | null = null;
  /** Update chunks received for a socket but not yet applied + appended. */
  private pending = new Map<WebSocket, Uint8Array[]>();
  private compacting = false;
  /** Test-only backup of a snapshot chunk that was deliberately corrupted. */
  private chunkBackup: Uint8Array | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(this.ctx.storage as unknown as BoardStorage);
    // Nothing is handled - no connection, no frame - until the board has been
    // read or the read has definitively failed.
    this.ctx.blockConcurrencyWhile(async () => {
      this.loadNow();
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  // One transition of the machine in room-state.ts. An event that is illegal for
  // the current state leaves the state alone, so a stray frame can never take a
  // serving board down.
  private fire(event: LifecycleEvent): LifecycleTransition {
    const transition = nextLifecycleState(this.lifecycle, event);
    this.lifecycle = transition.state;
    return transition;
  }

  // Whether this room may take a client change. Compaction is included on
  // purpose: it is a single synchronous transaction, so a change that arrives
  // while it runs is either fully in the snapshot or fully after it, and
  // refusing it would be silent data loss.
  private get serving(): boolean {
    return this.ydoc !== null && (this.lifecycle === 'ready' || this.lifecycle === 'compacting');
  }

  // Read the board into a fresh document. Never throws: the two outcomes are
  // 'ready' (state loaded, quarantined rows already moved aside) and
  // 'load-failed' (every socket closed with 4500, nothing written).
  private loadNow(): void {
    if (this.lifecycle !== 'loading') {
      // Callers must move the machine to 'loading' first; getting here anyway
      // is a bug, and re-reading storage behind the machine's back is the one
      // thing that could double-apply, so it is refused.
      console.error(`[board] load requested while ${this.lifecycle}`);
      return;
    }
    const doc = new Y.Doc();
    // The listener is installed BEFORE anything is applied, so no byte that the
    // load reads back can be mistaken for a client change and written again.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.onDocUpdate(doc, update, origin);
    });

    let result: ReturnType<BoardStore['load']>;
    try {
      // No `migrate()` here. A room is constructed for a board that merely got a
      // request - including a link that somebody mistyped - and laying the
      // schema down at construct would turn every probe into a created board.
      // `initialize()` (story 5) and the first `append()` are what create it.
      result = this.store.load(doc);
    } catch (err) {
      result = { ok: false as const, reason: 'sql-error' as const, error: errorMessage(err) };
    }

    if (!result.ok) {
      doc.destroy();
      this.discardDoc();
      this.loadError = result.error;
      this.failedAt = Date.now();
      this.fire({ type: 'load-error' });
      console.error(`[board] could not load the board (${result.reason}): ${result.error}`);
      this.closeAll(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }

    this.ydoc = doc;
    this.loadError = null;
    this.failedAt = null;
    this.fire(result.quarantined > 0 ? { type: 'load-ok-quarantined' } : { type: 'load-ok' });
  }

  // Forget the in-memory document. Called whenever the room stops trusting it,
  // so a later retry cannot succeed by accident against stale state.
  private discardDoc(): void {
    const doc = this.ydoc;
    this.ydoc = null;
    this.pending.clear();
    if (doc) {
      try {
        doc.destroy();
      } catch {
        /* already gone */
      }
    }
  }

  // The document's update handler. Its only job is to refuse to write back what
  // it did not receive from a client: `store.append()` is called by
  // persistBatch() with the socket as origin, so an update that arrives here is
  // either what storage just handed us (LOAD_ORIGIN), a room-internal apply, or
  // an update that is already durable. Anything else would be a second writer.
  private onDocUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return; // read back from storage
    if (origin === doc) return; // the document's own bookkeeping
    if (origin instanceof WebSocket || origin === null || origin === undefined) {
      // A client update: persistBatch() already appended it in the same
      // transaction that applied it. Writing here too would double the log.
      return;
    }
    // Anything else has no business reaching storage. It is dropped, and
    // logged, rather than silently persisted through a side door.
    console.error(`[board] ignored an update from an unexpected origin (${this.lifecycle})`);
    void update;
  }

  // ==========================================================================
  // HTTP: WebSocket upgrades (and the test-only hooks)
  // ==========================================================================

  // ==========================================================================
  // Board existence and creation (story 5)
  //
  // These two are RPC: the Worker calls them on the board's stub and nothing
  // else can. `initialize()` is the only thing in the whole system that brings a
  // board into existence, and `exists()` is the only thing that answers whether
  // a link belongs to one. `exists()` reads and writes nothing, which is what
  // lets a mistyped or made-up link be answered without leaving a board behind
  // (PRD share.not_found).
  // ==========================================================================

  /**
   * Create this board if it does not already exist. Returns 'created' for the
   * one call that actually created it and 'exists' for every call after that,
   * so a code that is already somebody's board is never handed to a new board
   * and never re-initialised (PRD share.unique).
   */
  async initialize(): Promise<InitializeResult> {
    let created = false;
    // One synchronous transaction: the stamp is read and written with nothing
    // able to interleave, so two requests that raced each other for the same
    // code cannot both be told they made a board.
    this.ctx.storage.transactionSync(() => {
      this.store.migrate();
      created = this.store.setCreatedAtIfAbsent(Date.now());
    });
    this.existsNow = true;
    return created ? 'created' : 'exists';
  }

  /** Whether this board exists. Read-only: never creates a table or a row. */
  async exists(): Promise<boolean> {
    if (this.existsNow) return true;
    const exists = this.store.existsReadOnly();
    if (exists) this.existsNow = true;
    return exists;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (this.env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return this.testHook(url, request);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // A board that was never created is not served, and is not created by being
    // asked: connecting to an unknown link is a 404, not an empty board. This is
    // the rule that closes the story 3 hole where any address at all could start
    // a board just by dialling it.
    if (!(await this.exists())) {
      return new Response('Board not found', { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // The board is unreadable, or was. The lifecycle decides whether this
    // connection is allowed to try again yet.
    if (this.lifecycle === 'load-failed') {
      const elapsed = this.failedAt === null ? LOAD_RETRY_MIN_INTERVAL_MS : Date.now() - this.failedAt;
      const transition = this.fire({ type: 'connect', elapsedMs: elapsed });
      if (transition.closeCode !== null) {
        return this.refuse(server, client, transition.closeCode, 'board could not be loaded');
      }
      this.loadNow();
      if (!this.serving) {
        return this.refuse(server, client, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      }
    } else if (this.lifecycle === 'storage-failed' || this.lifecycle === 'hibernated') {
      // The room stopped writing after a storage failure; a new connection is
      // what re-reads the last durable state.
      this.fire({ type: 'reload' });
      this.loadNow();
      if (!this.serving) {
        return this.refuse(server, client, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      }
    }

    if (!this.serving) {
      // 'loading' (the constructor's read has not finished - cannot happen after
      // blockConcurrencyWhile) or 'compacting' (a sync window with no awaits).
      return this.refuse(server, client, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    }

    const doc = this.ydoc as Y.Doc;
    // Hibernating accept: the object may go idle with these sockets still open,
    // and is woken by the next frame or connection.
    this.ctx.acceptWebSocket(server);
    this.pending.set(server, []);

    // SyncStep2 first: a joiner converges against the stored state immediately.
    // SyncStep1 second: the joiner answers with its own state, which is how a
    // client that edited while the room was asleep gets its changes back in
    // (they are appended by persistBatch like any other update, so nothing is
    // lost if that client then disconnects).
    this.sendTo(server, syncStep2(doc));
    this.sendTo(server, syncStep1(doc));

    return new Response(null, { status: 101, statusText: 'Switching Protocols', webSocket: client });
  }

  // Hand the client back a socket that is closed with the given code. The
  // client still sees a successful upgrade and then its documented close, which
  // is what lets y-websocket map the code and keep retrying.
  private refuse(server: WebSocket, client: WebSocket, code: number, reason: string): Response {
    try {
      this.ctx.acceptWebSocket(server);
    } catch {
      /* already accepted */
    }
    this.pending.delete(server);
    this.closeSocket(server, code, reason);
    return new Response(null, { status: 101, statusText: 'Switching Protocols', webSocket: client });
  }

  // ==========================================================================
  // WebSocket handlers
  //
  // These are the Durable Object's webSocket handlers, and they exist because
  // connections are accepted through ctx.acceptWebSocket(). A connection that
  // hibernated is delivered here by waking the object - the constructor (and the
  // load it blocks on) runs first - so the handlers always find a loaded
  // document and never assume that anything survived in memory.
  // ==========================================================================

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    this.handleMessage(ws, message);
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.socketGone(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.socketGone(ws);
  }

  private socketGone(ws: WebSocket): void {
    this.pending.delete(ws);
  }

  // One received frame. Sync is applied + persisted + broadcast; awareness is
  // relayed verbatim to every socket including the sender (keepalive).
  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      // Text frame, truncated bytes, or unknown type: this socket only (TC-15).
      this.closeUnsupported(ws);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return; // presence is story 6; there is no stored awareness to answer
    }

    if (decoded.kind === 'awareness') {
      this.relayBytes(data);
      return;
    }

    if (!this.serving) {
      // A board the room cannot serve must not be written to, and there is
      // nothing meaningful to answer. Dropping the frame is what keeps the
      // "no writes while load_failed" invariant true even mid-handshake.
      this.pending.delete(ws);
      return;
    }

    let step: number;
    let body: Uint8Array;
    try {
      const decoder = decoding.createDecoder(decoded.payload);
      step = decoding.readVarUint(decoder);
      body = decoding.readVarUint8Array(decoder);
    } catch {
      this.closeUnsupported(ws);
      return;
    }

    if (step === YjsSync.messageYjsSyncStep1) {
      // Answer with our state; this path reads, it never writes.
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      try {
        YjsSync.writeSyncStep2(reply, this.ydoc as Y.Doc, body);
      } catch {
        // An unparseable state vector is a malformed frame (TC-15).
        this.closeUnsupported(ws);
        return;
      }
      this.sendTo(ws, encoding.toUint8Array(reply));
      return;
    }

    if (step === YjsSync.messageYjsSyncStep2 || step === YjsSync.messageYjsUpdate) {
      let chunks = this.pending.get(ws);
      if (!chunks) {
        chunks = [];
        this.pending.set(ws, chunks);
      }
      chunks.push(body);
      this.persistBatch(ws);
      return;
    }

    this.closeUnsupported(ws);
  }

  // The one write path: apply this socket's buffered updates, append them all
  // in a single Durable Object transaction, and only then broadcast.
  //
  // An update Yjs rejects is a protocol error and closes that socket only (no
  // storage was touched); a storage error rolls the transaction back, is written
  // nowhere, is broadcast to nobody, and closes every socket with 1011.
  private persistBatch(ws: WebSocket): void {
    const chunks = this.pending.get(ws);
    if (!chunks || chunks.length === 0) return;
    const doc = this.ydoc;
    if (!doc) {
      this.pending.delete(ws);
      return;
    }
    const batch = chunks.slice();
    this.pending.set(ws, []);

    const applied: Uint8Array[] = [];
    for (const update of batch) {
      try {
        Y.applyUpdate(doc, update, ws);
        applied.push(update);
      } catch {
        // Malformed update: nothing was appended, so the log still matches what
        // everyone else was told.
        this.pending.delete(ws);
        this.closeUnsupported(ws);
        return;
      }
    }

    try {
      this.ctx.storage.transactionSync(() => {
        for (const update of applied) this.store.append(update);
      });
    } catch (err) {
      this.storageFailed(err);
      return;
    }

    // Durable from here on; everyone else may now see it.
    for (const update of applied) this.broadcastUpdate(update, ws);
    this.maybeCompact();
  }

  // A storage write failed: the room cannot keep relaying changes it cannot
  // keep. Rollback already happened (transactionSync rethrows), so the log is
  // exactly what clients were last told; the in-memory document is the part that
  // may be ahead of it, and is therefore thrown away.
  private storageFailed(err: unknown): void {
    console.error(`[board] storage write failed: ${errorMessage(err)}`);
    this.fire({ type: 'storage-error' });
    this.discardDoc();
    this.closeAll(CLOSE_STORAGE_FAILURE, 'storage write failed');
  }

  // Compact off the hot path. `waitUntil` keeps the object alive for the write
  // without making any client wait for it.
  private maybeCompact(): void {
    if (this.compacting || !this.store.shouldCompact()) return;
    this.compacting = true;
    this.ctx.waitUntil(this.compactSoon());
  }

  private async compactSoon(): Promise<void> {
    try {
      await this.compactNow();
    } finally {
      this.compacting = false;
    }
  }

  /** Fold the log into a snapshot. Returns whether a snapshot was written. */
  async compactNow(): Promise<boolean> {
    const doc = this.ydoc;
    if (!doc || this.lifecycle !== 'ready') return false;
    this.fire({ type: 'compact-start' });
    let written = false;
    try {
      written = this.store.compact(doc);
    } catch (err) {
      // compact() rolls its own transaction back; a throw here is unexpected
      // and is treated the same way: the log is kept, the board keeps serving.
      console.error(`[board] compaction failed: ${errorMessage(err)}`);
      written = false;
    }
    this.fire({ type: written ? 'compact-ok' : 'compact-failed' });
    return written;
  }

  // ==========================================================================
  // Outbound (always through ctx.getWebSockets(): never a cached Set)
  // ==========================================================================

  // Broadcast a Yjs update to every open socket except the one that produced it.
  private broadcastUpdate(update: Uint8Array, except: WebSocket): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    YjsSync.writeUpdate(enc, update);
    const bytes = encoding.toUint8Array(enc);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.sendTo(ws, bytes);
    }
  }

  // Relay a raw received frame to every open socket, verbatim, including the
  // sender (awareness keepalive).
  private relayBytes(data: ArrayBuffer | string): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendRaw(ws, data);
    }
  }

  private sendTo(ws: WebSocket, bytes: Uint8Array): void {
    // No readyState pre-check: a hibernating connection reports CLOSED but still
    // takes a send, while a genuinely dead one throws. Both are decided by the
    // send itself, which is the only reliable answer.
    try {
      ws.send(bytes);
    } catch {
      // Peer gone: its buffered chunks go with it. ctx.getWebSockets() drops a
      // closed connection by itself, so there is nothing else to clean up.
      this.pending.delete(ws);
    }
  }

  private sendRaw(ws: WebSocket, data: ArrayBuffer | string): void {
    try {
      ws.send(data);
    } catch {
      this.pending.delete(ws);
    }
  }

  private closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.closeSocket(ws, code, reason);
    }
    this.pending.clear();
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    this.pending.delete(ws);
    this.closeSocket(ws, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
  }

  // ==========================================================================
  // Test-only entry points
  //
  // These are ordinary public methods because a Durable Object exposes its
  // methods to its own isolate, and the integration suite needs to call them
  // directly. They are NOT reachable from the network: the only thing that maps
  // a URL onto them is the /__test/ router below, which answers unless
  // env TEST_HOOKS === '1' - a variable that nothing sets except the test worker
  // and `wrangler dev --var TEST_HOOKS:1` for the e2e run.
  // ==========================================================================

  private async testHook(url: URL, request: Request): Promise<Response> {
    if (this.env.TEST_HOOKS !== '1') {
      return new Response('Not found', { status: 404 });
    }
    const action = url.pathname.replace(/^\/__test\//, '');
    try {
      switch (action) {
        case 'state': {
          return Response.json(await this.testStats());
        }
        case 'compact': {
          return Response.json({ written: await this.testCompact() });
        }
        case 'reload': {
          return Response.json(await this.testReload());
        }
        case 'corrupt-snapshot': {
          await this.testCorruptSnapshot();
          return Response.json(await this.testStats());
        }
        case 'repair-snapshot': {
          await this.testRepairSnapshot();
          return Response.json(await this.testStats());
        }
        case 'seed': {
          const body = new Uint8Array(await request.arrayBuffer());
          await this.testSeed(body);
          return Response.json(await this.testStats());
        }
        case 'ensure': {
          return Response.json(await this.testEnsure());
        }
        case 'sql': {
          // Body is {sql, bindings?}: an existence assertion that interpolated its
          // key into the statement would not be an assertion about that key.
          const body = (await request.json()) as { sql?: unknown; bindings?: unknown };
          if (typeof body.sql !== 'string') return new Response('body.sql must be a string', { status: 400 });
          const bindings: SqlBinding[] = [];
          for (const value of Array.isArray(body.bindings) ? body.bindings : []) {
            if (value === null || typeof value === 'number' || typeof value === 'string') bindings.push(value);
            else return new Response('test SQL bindings must be null, numbers or strings', { status: 400 });
          }
          return Response.json({ rows: this.store.testQuery(body.sql, bindings) });
        }
        default:
          return new Response('Unknown test hook', { status: 404 });
      }
    } catch (err) {
      return new Response(`test hook failed: ${errorMessage(err)}`, { status: 500 });
    }
  }

  /** How this room actually is, for assertions. */
  async testStats(): Promise<RoomStats> {
    let logRows = 0;
    let logBytes = 0;
    let chunks = 0;
    let quarantined = 0;
    try {
      logRows = this.store.countRows('updates');
      logBytes = this.store.logBytes();
      chunks = this.store.chunkCount();
      quarantined = this.store.countRows('quarantined_updates');
    } catch (err) {
      console.error(`[board] testStats could not read counts: ${errorMessage(err)}`);
    }
    return {
      lifecycle: this.lifecycle,
      state: roomState(this.lifecycle),
      loadError: this.loadError,
      serving: this.serving,
      updateCount: this.store.updateCount,
      updateBytes: this.store.updateBytes,
      logRows,
      logBytes,
      chunks,
      chunkSizes: this.store.chunkSizes(),
      throughSeq: this.store.snapshotThroughSeq,
      quarantined,
      sockets: this.ctx.getWebSockets().length,
      compacting: this.compacting,
    };
  }

  /** The storage layout version this room wrote. */
  async testSchemaVersion(): Promise<string | null> {
    return this.store.schemaVersion();
  }

  /** Force a compaction, ignoring the thresholds. */
  async testCompact(): Promise<boolean> {
    return this.compactNow();
  }

  /**
   * Bring a board into existence for a test, by id, without going through the
   * create endpoint. This is the same `initialize()` the real create path calls -
   * the same stamp, the same schema - so a board made this way is indistinguish-
   * able from one a visitor created. The e2e suite uses it for the boards that
   * are scenery for another story's assertion: without it every story 1-4 test
   * would spend one of the ONE VISITOR creation quota and fail at random.
   */
  async testEnsure(): Promise<RoomStats> {
    await this.initialize();
    return this.testStats();
  }

  /**
   * Put a row in the log that was never applied to any document - what a torn
   * or half-written update looks like from the inside - without touching the
   * live document, so the next load has to quarantine it.
   */
  async testPoisonLog(): Promise<void> {
    this.store.append(unreadableChunk());
  }

  /** Make the next client update fail *after* its row was written. */
  async testFailNextAppend(): Promise<void> {
    this.store.testFailAfterNextAppend(1);
  }

  /**
   * Overwrite snapshot chunk 0 with bytes that decode as a Yjs update and then
   * fail to apply, which is what a truncated or foreign chunk looks like from
   * the inside. The original bytes are kept in this instance so
   * `testRepairSnapshot()` can put them back the way an operator would.
   */
  async testCorruptSnapshot(): Promise<RoomStats> {
    // Fold the log first: a room that has nothing to read back would not be
    // affected by a broken chunk, and the test would pass for the wrong reason.
    await this.compactNow();
    const good = this.store.readChunk(0);
    if (good) this.chunkBackup = good.slice();
    this.store.writeChunk(0, unreadableChunk());
    return this.testReload();
  }

  /** Restore the chunk that `testCorruptSnapshot()` replaced. Loads nothing. */
  async testRepairSnapshot(): Promise<void> {
    const saved = this.chunkBackup;
    if (!saved) throw new Error('no chunk was corrupted by this instance');
    this.store.writeChunk(0, saved);
    this.chunkBackup = null;
  }

  /**
   * Throw away the in-memory document and read the board again - what a wake-up
   * does, without waiting for a runtime that cannot be asked to evict itself.
   * A board that only became unreachable is therefore re-read from scratch.
   */
  async testReload(): Promise<RoomStats> {
    this.discardDoc();
    // The machine has no ready -> loading edge on purpose (in production an
    // instance always starts in 'loading' from its constructor), so a forced
    // wake-up is the one place that moves it by hand.
    this.lifecycle = 'loading';
    this.loadNow();
    return this.testStats();
  }

  /**
   * Take `update` as if it had arrived from a client and fold it in, so a test
   * can build a board of any size in one call instead of one round trip per
   * note. It goes through the same apply -> append -> compact path.
   */
  async testSeed(update: Uint8Array): Promise<RoomStats> {
    const doc = this.ydoc;
    if (!doc || this.lifecycle !== 'ready') {
      throw new Error(`room is ${this.lifecycle}, cannot seed`);
    }
    // Origin is the document itself: this is a room-internal apply, so the
    // update handler knows there is nothing extra to persist.
    Y.applyUpdate(doc, update, doc);
    this.ctx.storage.transactionSync(() => {
      this.store.append(update);
    });
    await this.compactNow();
    return this.testStats();
  }
}

// ---------------------------------------------------------------------------
// framing helpers
// ---------------------------------------------------------------------------

function syncStep1(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  YjsSync.writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

function syncStep2(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  YjsSync.writeSyncStep2(enc, doc);
  return encoding.toUint8Array(enc);
}
