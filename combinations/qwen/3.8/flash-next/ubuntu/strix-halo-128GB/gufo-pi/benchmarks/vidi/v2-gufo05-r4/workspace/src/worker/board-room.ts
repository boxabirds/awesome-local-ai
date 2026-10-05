/**
 * `BoardRoom` — one Durable Object per board.
 *
 * It is the only place that talks to a board's storage, and it is deliberately
 * boring about what a board *is*: the CRDT lives in `shared/board-model`, the wire
 * format in `shared/protocol`, and every byte of storage in `BoardStore`. What is
 * here is ordering and consequence: a change is written before it is repeated, a
 * board is read before anyone is let in, and when either of those fails the room
 * says so with a close code instead of pretending.
 *
 * The sockets hibernate (design.md 3.1): `ctx.acceptWebSocket` plus the
 * `webSocketMessage` / `webSocketClose` / `webSocketError` handlers mean an idle
 * editor costs nothing, and the live set of sockets belongs to the platform
 * (`ctx.getWebSockets()`) rather than to this instance — which is what lets a
 * reconstructed room deliver to sockets it never accepted itself.
 */

import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { BOARD_LOAD_BUDGET_MS, LOAD_RETRY_MIN_INTERVAL_MS, BOARD_IDLE_RELEASE_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameBytes
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState, shouldRetryLoad, type RoomLifecycleState } from './room-state';
import { TEST_HOOK_PREFIX } from './test-hooks';
import type { Env } from './index';

/** A WebSocket close reason is capped at 123 bytes by RFC 6455. */
const MAX_CLOSE_REASON_BYTES = 123;

/** The liveness exchange the platform answers for a hibernated socket. */
const LIVENESS_REQUEST = 'vidi6:ping';
const LIVENESS_RESPONSE = 'vidi6:pong';

/** What the room remembers about one socket across a restart. */
interface BoardAttachment {
  kind: 'board';
}

const BOARD_ATTACHMENT: BoardAttachment = { kind: 'board' };

/** One y-websocket frame: the message type, then the sync bytes. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** One y-websocket frame carrying an opaque awareness update. */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** One log line, structured so `wrangler tail` can group it. */
function log(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ room: 'BoardRoom', ...fields }));
}

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BoardRoom extends DurableObject<Env> {
  /** The board's storage, opened once per instance. */
  private store: BoardStore | null = null;

  /** The board's document, or `null` when it is not safe to serve one. */
  private board: Y.Doc | null = null;

  /** Where this room is in the design's lifecycle. */
  private state: RoomLifecycleState = 'loading';

  /** Log rows this board's last load had to set aside. */
  private quarantined = 0;

  /** When the last load attempt failed, so a retry waits `LOAD_RETRY_MIN_INTERVAL_MS`. */
  private lastFailureAt = 0;

  /** The load in flight, so a message never overtakes it. */
  private loading: Promise<void> | null = null;

  /** The compaction in flight, so two updates do not fold the log at once. */
  private compacting: Promise<void> | null = null;

  /** How many times this instance has read the board out of storage. */
  private loadCount = 0;

  /**
   * Which storage failure the room last hit, because the two deserve different words.
   * A board that could not be *read* cannot be opened; a board that could not be
   * *written* is one worth coming back to, and the person holding unsaved work should
   * be told that rather than shown a broken board.
   */
  private storageFailure: 'read' | 'write' | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // While a socket hibernates the platform answers its liveness pings, so idle
    // editors are not dropped for want of a wake-up.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVENESS_REQUEST, LIVENESS_RESPONSE));
    // Nothing is handled until the board has been read: an event delivered against
    // an unloaded document is how a board gets overwritten with nothing.
    this.loading = this.ctx.blockConcurrencyWhile(async () => {
      await this.loadBoard();
    });
  }

  /**
   * The join request, or a status question.
   *
   * A request without the upgrade header is not a join attempt (the Worker answers
   * those with 426); it is something asking how the room is.
   *
   * A join waits for the load. If the board cannot be read the handshake still
   * completes and the socket closes with `CLOSE_BOARD_LOAD_FAILED`: the browser has
   * to see a close, not a failed request, to say "this board could not be opened"
   * rather than "the board is empty".
   */
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith(TEST_HOOK_PREFIX)) return this.testHook(pathname);
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return Response.json(this.status(BoardRoom.boardIdOf(request)));
    }

    await this.readyToServe();

    const pair = new WebSocketPair();
    // A join that cannot be served still completes its handshake, so the browser
    // sees a close code and not a failed request.
    if (this.state === 'storage-failed') {
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].close(this.refusalCode(), this.refusalReason());
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (this.state === 'load-failed' || this.board === null) {
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be opened');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const server = pair[1];
    server.serializeAttachment(BOARD_ATTACHMENT);
    this.ctx.acceptWebSocket(server);

    // Ask the newcomer what it has. A room that just woke up answers from the
    // document it read out of storage, and the newcomer's SyncStep2 is the update
    // that puts back whatever its own edits held before the restart.
    this.sendTo(
      server,
      syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.board as Y.Doc))
    );
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * One frame from one socket. A message that arrives before the board has been
   * read waits for the read; a message for a board that could not be read, or that
   * could not be written, closes only that socket with the code that says which.
   */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.loading !== null) await this.loading;
    if (this.state === 'load-failed') {
      socket.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be opened');
      return;
    }
    if (this.state === 'storage-failed') {
      socket.close(this.refusalCode(), this.refusalReason());
      return;
    }
    // The listener itself must not reject: an unhandled rejection drops a socket
    // with no explanation, and the client would read that as a network problem.
    await this.handleMessage(socket, message).catch(() =>
      socket.close(CLOSE_UNSUPPORTED_DATA, 'frame error')
    );
  }

  /**
   * Test-only board surgery (story 4's TC-24).
   *
   * The gate is at the door rather than here: a Durable Object has no address of its
   * own, so the only way this path is reached is through the Worker's `/__test/` route,
   * which exists only when `TEST_HOOKS=1`. Checking the variable again here would not
   * add a thing — the object's environment is the Worker's, and that is the environment
   * the check was about.
   *
   * `corrupt-snapshot` folds the log so that there *is* a snapshot, replaces chunk 0
   * with random bytes, and then puts the room through the path a failed read puts it
   * through: the document dropped and every socket closed with 4500. A room cannot
   * evict itself, and one that still held the board in memory would simply go on
   * serving it — which is not the failure being tested. The damage itself is real, so
   * the load that follows reads damaged bytes out of SQLite and fails for the reason
   * the story gives.
   *
   * `repair` puts the bytes back and changes nothing else. The room stays
   * `load-failed`, and the next person to ask — once the retry window has passed —
   * reads the board for real and gets it.
   */
  private async testHook(pathname: string): Promise<Response> {
    const action = pathname.slice(TEST_HOOK_PREFIX.length);
    if (action !== 'repair' && action !== 'corrupt-snapshot') {
      return new Response('No such test hook', { status: 404 });
    }
    // Storage is not touched while the board is on its way into memory: two readers of
    // the same rows, one of them rewriting them, is a story nobody wants to debug.
    if (this.loading !== null) await this.loading;
    const store = this.store ?? this.openStore();

    if (action === 'repair') {
      const restored = await store.restoreSnapshotChunkZero();
      return Response.json(restored, { status: restored.ok ? 200 : 409 });
    }

    await this.readyToServe();
    const doc = this.board;
    if (doc === null) return Response.json({ ok: false, reason: 'board-not-loaded' }, { status: 409 });
    if (!store.compactNow(doc)) {
      return Response.json({ ok: false, reason: 'compaction-failed' }, { status: 500 });
    }
    const damaged = await store.damageSnapshotChunkZero();
    if (!damaged.ok) return Response.json(damaged, { status: 409 });

    // The room cannot evict itself, and one holding the board would simply go on
    // serving it. So it takes the path it already has for a document it has thrown
    // away: send the clients off with the code that says the board could not be opened,
    // forget the document, and read it again in front of the caller — which is where the
    // damaged bytes are discovered, by the same code that finds them for real.
    this.closeAllSockets(CLOSE_BOARD_LOAD_FAILED, 'this board could not be opened');
    this.board = null;
    log({ event: 'test_hook_corrupt_snapshot', bytes: damaged.bytes });
    this.state = nextRoomState(this.state, { type: 'hibernate' });
    await this.readyToServe();
    return Response.json({ ok: true, bytes: damaged.bytes });
  }

  /**
   * A socket went away. The room keeps no per-socket state, so the only work here is
   * to finish the handshake — a hibernated socket does not echo the close on its own,
   * and a client that never hears back sits in "connecting" forever — and to notice
   * that the board is now empty.
   */
  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(echoCode(code), closeReason(reason));
    } catch {
      // A socket that cannot be closed is already gone, which is what we wanted.
    }
    if (this.ctx.getWebSockets().length === 0) this.ctx.waitUntil(this.idleSoon());
  }

  /**
   * A socket failed without a close handshake. The platform has already given up on
   * it, and the client sees an abnormal closure and reconnects; the board is
   * unaffected, because nothing was ever held only here.
   */
  webSocketError(_socket: WebSocket, error: unknown): void {
    log({ event: 'socket_error', error: textOf(error) });
  }

  /**
   * The idle alarm: with nobody watching, fold the log and give the document back.
   * SQLite holds the board either way, so the memory is not needed between visits,
   * and no further alarm is set — which is what lets the instance be evicted.
   */
  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.idleSoon();
      return;
    }
    if (this.state === 'ready' || this.state === 'compacting') {
      await this.compact();
      this.state = nextRoomState(this.state, { type: 'hibernate' });
    }
    this.board = null;
  }

  /**
   * The board's storage, migrated on first use.
   *
   * Opening is not a write: a board nobody has edited stays exactly as empty as it
   * was, because `migrate` creates tables and no update rows.
   */
  private openStore(): BoardStore {
    const store = new BoardStore(this.ctx.storage);
    store.migrate();
    return store;
  }

  /** The code for a connection that cannot be served: see `storageFailure`. */
  private refusalCode(): number {
    return this.storageFailure === 'write' ? CLOSE_STORAGE_FAILURE : CLOSE_BOARD_LOAD_FAILED;
  }

  private refusalReason(): string {
    return this.storageFailure === 'write' ? 'this board could not be saved' : 'this board could not be opened';
  }

  /**
   * Read the board out of storage into a document of our own, and only then hand it
   * out. Sets `ready`, or `load-failed` with the reason in the log — an empty document
   * is never a substitute for a board that could not be read.
   */
  private async loadBoard(): Promise<void> {
    const startedAt = Date.now();
    this.loadCount += 1;
    try {
      const store = this.store ?? this.openStore();
      const doc = this.createDocument();
      const result = store.load(doc);
      this.store = store;
      if (!result.ok) {
        // An empty document is never handed out in place of an unreadable board.
        this.board = null;
        this.storageFailure = result.reason === 'sql-error' ? 'read' : null;
        this.failed('load', { reason: result.reason, error: result.error });
        return;
      }
      this.board = doc;
      this.quarantined = result.quarantined;
      this.storageFailure = null;
      this.state = nextRoomState(this.state, { type: 'loaded' });
      const tookMs = Date.now() - startedAt;
      if (tookMs > BOARD_LOAD_BUDGET_MS) {
        log({ event: 'load_slow', tookMs, budgetMs: BOARD_LOAD_BUDGET_MS, quarantined: result.quarantined });
      }
    } catch (error) {
      // Opening storage, or something the platform refused: the same honest answer.
      this.board = null;
      this.storageFailure = 'read';
      this.failed('load', { reason: 'sql-error', error: textOf(error) });
    }
  }

  /**
   * Called before a join is accepted: the first load, or the retry of a failed one.
   *
   * A failed load is retried only after `LOAD_RETRY_MIN_INTERVAL_MS`. Someone
   * reconnecting into a storage system that is down would otherwise have the room
   * hit it again per attempt, per client, forever.
   */
  private async readyToServe(): Promise<void> {
    if (this.loading !== null) await this.loading;

    if (this.state === 'hibernated') {
      this.state = nextRoomState(this.state, { type: 'wake' });
      this.loading = this.loadBoard();
      await this.loading;
      return;
    }
    // Both kinds of failure wait `LOAD_RETRY_MIN_INTERVAL_MS` before trying again:
    // a client on a reconnecting socket retries every couple of seconds, and a room
    // that re-hit broken storage on each of those makes an outage worse, not shorter.
    if (this.state === 'storage-failed') {
      if (Date.now() - this.lastFailureAt < LOAD_RETRY_MIN_INTERVAL_MS) return;
      this.state = nextRoomState(this.state, { type: 'reconnect' });
      this.loading = this.loadBoard();
      await this.loading;
      return;
    }
    if (this.state === 'load-failed') {
      const sinceFailureMs = Date.now() - this.lastFailureAt;
      if (!shouldRetryLoad(sinceFailureMs)) return;
      this.state = nextRoomState(this.state, { type: 'reopen', sinceFailureMs });
      this.loading = this.loadBoard();
      await this.loading;
    }
  }

  /** Mark a failure, log it once, and remember when, so the retry can wait. */
  private failed(kind: 'load' | 'storage', fields: Record<string, unknown>): void {
    this.lastFailureAt = Date.now();
    // A failure to write is the one a person should come back to; a failure to read is
    // recorded by the caller, because only it knows which read broke.
    if (kind === 'storage') this.storageFailure = 'write';
    this.state = nextRoomState(
      this.state,
      kind === 'load' ? { type: 'load-failed' } : { type: 'storage-error' }
    );
    log({ event: kind === 'load' ? 'board_load_failed' : 'storage_failure', ...fields });
  }

  /** A document whose changes go to storage before they go to anybody. */
  private createDocument(): Y.Doc {
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.recordThenBroadcast(update, origin);
    });
    return doc;
  }

  /**
   * The room's own read is not a change to store, and a change that could not be
   * stored is not broadcast: the output gates hold until the write is durable, which
   * is the difference between "saved" and "the other tabs said so".
   */
  private recordThenBroadcast(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    if (this.state === 'storage-failed') return;
    const store = this.store;
    if (store === null) {
      this.failed('storage', { error: 'no storage attached' });
      this.dropEverything();
      return;
    }
    try {
      store.append(update);
    } catch (error) {
      // Nothing went out, and the room cannot promise to save what comes next either.
      this.failed('storage', { error: textOf(error) });
      this.dropEverything();
      return;
    }
    this.broadcastSync(update, origin);
    this.ctx.waitUntil(this.compact());
  }

  /**
   * After a failure the room has to be rebuilt before it is used again: the document
   * holds changes nobody has, and the next join reads the truth from storage. Clients
   * that still hold the change re-send it on reconnect, and it is stored then.
   */
  private dropEverything(): void {
    this.board = null;
    this.closeAllSockets(CLOSE_STORAGE_FAILURE, 'this board could not be saved');
  }

  /**
   * Tell everybody the board is going away. A socket that cannot be closed is already
   * not a problem of ours, and one that is gone is one less thing to notify.
   */
  private closeAllSockets(code: number, reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(code, reason);
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Fold the update log into a chunked snapshot if it has grown long enough.
   * One fold at a time, and it keeps folding while the log is over the threshold — a
   * burst of edits must not leave the backlog to grow forever.
   */
  private async compact(): Promise<void> {
    if (this.compacting !== null) return this.compacting;
    const store = this.store;
    const doc = this.board;
    if (store === null || doc === null || this.state === 'storage-failed' || this.state === 'load-failed') {
      return;
    }
    this.state = nextRoomState(this.state, { type: 'compact' });
    const run = (async () => {
      try {
        while (store.compactIfNeeded(doc)) {
          // Keep going: `compactIfNeeded` answers false once the log is short again.
        }
      } finally {
        this.state = nextRoomState(this.state, { type: 'compacted' });
        this.compacting = null;
      }
    })();
    this.compacting = run;
    return run;
  }

  /** With the last socket gone, give the instance a chance to fold and let go. */
  private async idleSoon(): Promise<void> {
    try {
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + BOARD_IDLE_RELEASE_MS);
      }
    } catch (error) {
      // The alarm is an optimisation; a board whose log is long is still correct.
      log({ event: 'alarm_scheduling_failed', error: textOf(error) });
    }
  }

  /**
   * Type one frame and act on it. `invalid` closes only this socket.
   *
   * Reading the frame is awaited because some runtimes deliver a binary message as
   * a `Blob`, whose bytes are only available asynchronously.
   */
  private async handleMessage(socket: WebSocket, data: unknown): Promise<void> {
    const bytes = await frameBytes(data);
    const decoded = decodeMessage(bytes ?? 'not a binary frame');
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(socket, decoded.payload);
        break;
      case 'awareness':
        // Verbatim to everybody, sender included: idle clients stay alive on it.
        // The room keeps no awareness state of its own — see NOTES.md for why that
        // waits for the story that puts cursors on the board.
        this.broadcastToAll(awarenessFrame(decoded.payload), null);
        break;
      case 'query-awareness':
        break;
      case 'invalid':
        socket.close(CLOSE_UNSUPPORTED_DATA, closeReason(decoded.reason));
        break;
    }
  }

  /**
   * Hand a sync message to Yjs. The reply (SyncStep2 or an update acknowledgement)
   * goes back to the sender; anything the room learned is stored and then broadcast
   * by the doc's `update` listener with this socket as origin, so the sender gets no
   * echo. A change Yjs rejects never reaches storage: an update that could not be
   * applied is not part of the board.
   */
  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const doc = this.board;
    if (doc === null) {
      // Between the failure and the reload there is nothing to write into.
      socket.close(CLOSE_BOARD_LOAD_FAILED, 'this board could not be opened');
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // Yjs swallows apply errors by default (they are only logged). Here an
      // undecodable update is the sender's protocol error, so hand it an
      // errorHandler that puts the exception back where it can be acted on.
      syncProtocol.readSyncMessage(
        decoding.createDecoder(payload),
        encoder,
        doc,
        socket,
        (error: unknown) => {
          throw error;
        }
      );
    } catch (error) {
      // Not a Yjs message at all: this connection is speaking nonsense.
      socket.close(CLOSE_UNSUPPORTED_DATA, closeReason(textOf(error)));
      return;
    }
    // `length > 1` means Yjs actually wrote a reply (just the type byte otherwise).
    if (encoding.length(encoder) > 1) this.sendTo(socket, encoding.toUint8Array(encoder));
  }

  /** Forward one document update to every socket except the one it came from. */
  private broadcastSync(update: Uint8Array, except: unknown): void {
    // `writeUpdate` is what makes this a sync message a peer can apply: the sync
    // type plus the length-prefixed update, not the update bytes on their own.
    this.broadcastToAll(
      syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)),
      except
    );
  }

  /**
   * Write one frame to every open socket but the origin. Sockets belong to the
   * platform, so this reaches hibernated ones too — which is the whole point of
   * accepting them with `ctx.acceptWebSocket`.
   */
  private broadcastToAll(frame: Uint8Array, except: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.sendTo(socket, frame);
    }
  }

  /** Send, dropping a socket the platform says is gone rather than throwing. */
  private sendTo(socket: WebSocket, frame: Uint8Array): void {
    try {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    } catch {
      // A socket that cannot be written to is on its way out; the board is fine.
    }
  }

  /**
   * How the room is. `clients` is story 3's count; the rest is what persistence
   * made worth knowing — including `persistedBytes`, the thing that used to be a
   * `console.log` in a nightly test.
   */
  private status(boardId: string): Record<string, unknown> {
    const totals = this.store?.totals() ?? { logRows: 0, logBytes: 0, snapshotBytes: 0 };
    return {
      ok: true,
      boardId,
      clients: this.ctx.getWebSockets().length,
      state: this.state,
      loaded: this.board !== null,
      loads: this.loadCount,
      quarantined: this.quarantined,
      persistedRows: totals.logRows,
      persistedBytes: totals.logBytes + totals.snapshotBytes
    };
  }

  /**
   * The board id in the URL the Worker forwarded. The room is addressed by an
   * object id derived from it, so this is the only way for it to say which board
   * it is; the Worker has already checked the id before passing it along.
   */
  private static boardIdOf(request: Request): string {
    const raw = new URL(request.url).pathname.slice('/api/rooms/'.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return '';
    }
  }
}

/**
 * The code to answer a close with. 1005 ("no status received") and 1006 ("abnormal
 * closure") describe what happened and must not be sent on the wire, so the echo of
 * them is a normal closure; everything else — including the room's own 4500 and 1011
 * — goes back unchanged.
 */
function echoCode(code: number): number {
  return code === 1005 || code === 1006 ? 1000 : code;
}

/** Keep a close reason inside the RFC's limit. */
function closeReason(text: string): string {
  return text.length > MAX_CLOSE_REASON_BYTES ? `${text.slice(0, MAX_CLOSE_REASON_BYTES - 1)}…` : text;
}
