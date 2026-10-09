import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { createSticky } from '../shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { nextRoomState, type RoomEvent, type RoomState } from './room-state';
import type { Env } from './index';

/** How often the room asks its sockets to report their awareness, to keep them alive. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/** Test-only routes, handled by the room itself when `env.TEST_HOOKS === '1'`. */
export const TEST_HOOK_PREFIX = '/__test/';

/**
 * One board's room: the board's `Y.Doc` in memory, its update log in SQLite in this
 * same object's storage, and the sockets of the people on it, accepted through the
 * hibernation API so an idle board costs no compute.
 *
 * The rules the room keeps (design "Persistent, hibernating board room"):
 * - an update is *stored before it is broadcast*, in the same turn it is applied, so
 *   nobody ever sees a change the storage does not have (`persist.seen_is_saved`);
 * - the doc is loaded on wake before anything is served, and a board that cannot be
 *   loaded is never presented as an empty one — the room closes 4500 and retries
 *   (`persist.load_failure`, `LOAD_RETRY_MIN_INTERVAL_MS`);
 * - a storage write that throws costs the room its doc, not the board: every socket
 *   closes 1011 and the clients' reconnection handshakes refill what was not saved
 *   (`persist.save_failure`);
 * - garbage updates are refused exactly as in story 3: sender closed 1003, nothing
 *   stored (`live.reject_bad_update`).
 *
 * Merging is `y-protocols`/Yjs semantics, unchanged from story 3.
 */
export class BoardRoom extends DurableObject<Env> {
  /** Public so integration tests can wrap individual methods the way real disk
   *  failures arrive at individual statements. */
  readonly store: BoardStore;
  private doc: Y.Doc | null = null;
  private state: RoomState = 'loading';
  /** Timestamp of the last failed load: the retry clock (`LOAD_RETRY_MIN_INTERVAL_MS`). */
  private lastLoadFailureAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Nothing may be served before the board has been read back: `blockConcurrencyWhile`
    // holds all events (including the first `webSocketMessage`) until the load resolves
    // (design: "on wake the constructor reloads the doc").
    this.ctx.blockConcurrencyWhile(async () => {
      this.loadNow();
    });
  }

  /**
   * Create this board (`POST /api/boards`, story 5): migrate, then write `created_at`
   * unless it is already there. One call per board — an id that turns out to be taken
   * answers `exists` and the Worker turns that into a 500 rather than adopting someone
   * else's board (share.unguessable).
   *
   * This is the only place a board's tables come from for a linked board; a room that
   * is merely probed by `exists()` or a refused socket writes nothing.
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    if (!this.store.markCreatedAtIfAbsent(Date.now())) return 'exists';
    return 'created';
  }

  /**
   * Does this board exist (`GET /api/boards/:id`, story 5)? Read-only by contract:
   * no tables, no rows, no `created_at` (`share.not_found`).
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /**
   * A WebSocket upgrade takes a seat; when `TEST_HOOKS` is on, the room also answers
   * the test-only storage routes (`/__test/...`), which production never sees.
   */
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(TEST_HOOK_PREFIX)) {
      if (this.env.TEST_HOOKS !== '1') {
        return new Response('not found', { status: 404 });
      }
      return this.testHook(request);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    // Story 5 (`share.not_found`): a board is created by `POST /api/boards`, not by
    // connecting to its address. The check reads, so a mistyped link leaves no storage
    // and no board behind (TC-09).
    if (!this.store.existsReadOnly()) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // A connection is the only way back for a room that failed before: storage resets
    // reload on the next socket, load failures retry at most once per interval.
    this.allowRetry();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (this.state === 'load-failed') {
      // Accept, then close 4500 immediately: the client learns the truth about this
      // board and nothing else can be done over this socket.
      this.ctx.acceptWebSocket(server);
      this.sendLoadFailed(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Binary frames as ArrayBuffer, which is what `decodeMessage` reads; the runtime
    // default hands over a Blob instead. Set before accepting: a hibernated socket
    // keeps this configuration across wakeups.
    server.binaryType = 'arraybuffer';
    // The hibernating accept: `ctx.getWebSockets()` is now the source of truth, so
    // sockets outlive the object's memory and idle boards cost no compute.
    this.ctx.acceptWebSocket(server);
    // SyncStep1 out, SyncStep2 back: a late joiner receives the board as it is
    // (`live.join_state`), and the first person to reconnect after a storage reset
    // refills what the room lost with what they still have (`persist.save_failure`).
    this.send(server, frame((encoder) => syncProtocol.writeSyncStep1(encoder, this.document())));
    this.armKeepalive();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string | Blob): Promise<void> {
    // `blockConcurrencyWhile` in the constructor guarantees a load has been attempted
    // before any message is handled; the room's state says what happened.
    if (this.state === 'load-failed') {
      this.sendLoadFailed(socket);
      return;
    }
    if (this.state === 'storage-failed') {
      // The doc is gone until the next connection reloads it; the sender reconnects
      // and its handshake brings the change back (`persist.save_failure`).
      this.closeWith(socket, CLOSE_STORAGE_FAILURE, 'storage failed, reload pending');
      return;
    }
    if (this.doc === null) {
      // Should not happen (a Ready room has a doc), but never serve from nothing.
      this.loadNow();
      if (this.state !== 'ready') {
        this.sendLoadFailed(socket);
        return;
      }
    }
    // `binaryType = 'arraybuffer'` is per-socket configuration a *new object after
    // hibernation* never set, so a woken socket hands over a `Blob`; the room's
    // decoder reads bytes, so the frame is normalised here, once (TC-18).
    const frame = message instanceof Blob ? await message.arrayBuffer() : message;
    this.receive(socket, frame);
  }

  /** Record the connection attempt and, where the room may recover, recover on it. */
  private allowRetry(): void {
    const afterRetryInterval =
      Date.now() - this.lastLoadFailureAt >= LOAD_RETRY_MIN_INTERVAL_MS;
    const event: RoomEvent = { type: 'connection', afterRetryInterval };
    const next = this.dispatch(event);
    if (this.state === 'storage-failed' || (next === 'loading')) {
      this.loadNow();
    }
  }

  /** Read the board into a fresh doc. Synchronous SQL throughout: no await needed. */
  private loadNow(): void {
    const doc = new Y.Doc();
    // Story 5: loading does not migrate. A board that has no tables has never been
    // created, and reading it must leave it that way (`share.not_found`); boards that
    // do have tables are read as they are, damaged tables and all (`persist.load_failure`).
    const result = this.store.load(doc);
    if (result.ok) {
      if (result.quarantined > 0) {
        console.error(
          JSON.stringify({ event: 'board_loaded_with_damage', quarantined: result.quarantined }),
        );
      }
      this.doc = doc;
      this.wire(doc);
      this.dispatch({ type: 'load-ok' });
      return;
    }
    const failure = `${result.reason}: ${result.error}`;
    // A failed load: the doc is discarded (never served half-read), and the retry
    // clock starts. `load-failed` rooms answer every socket with 4500.
    this.doc = null;
    this.dispatch({ type: 'load-error' });
    this.lastLoadFailureAt = Date.now();
    console.error(JSON.stringify({ event: 'board_load_failed', error: failure }));
  }

  /**
   * The room's document. Created by the load on wake; `document()` only ever runs
   * while the state is Ready, where the load guarantees a doc.
   */
  private document(): Y.Doc {
    if (this.doc === null) {
      // Defensive: Ready with no doc is the one inconsistency the room must not have.
      this.loadNow();
      if (this.doc === null) {
        throw new Error('board document unavailable');
      }
    }
    return this.doc;
  }

  /**
   * Every update the doc produces (only other clients' updates ever reach it, applied
   * with a socket origin) is stored first, then broadcast, then maybe compacted.
   * Load-time applies carry `LOAD_ORIGIN` and are already in storage.
   */
  private wire(doc: Y.Doc): void {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN || this.doc !== doc) return;
      try {
        this.store.append(update);
      } catch (error) {
        // `persist.save_failure`: the change is *not* broadcast — nobody sees it as
        // saved — the doc is discarded so it cannot drift from storage, and every
        // socket closes 1011 while the clients' handshakes retry the change.
        console.error(JSON.stringify({ event: 'storage_write_failed', error: reasonOf(error) }));
        this.dispatch({ type: 'storage-error' });
        this.dropRoom();
        return;
      }
      this.dispatch({ type: 'update-applied' });
      this.broadcast(update, origin);
      // Compaction is a performance feature and never throws; if it fails the log is
      // intact and the next append tries again.
      this.store.compactIfNeeded(doc);
    });
  }

  /** Close everything: the sockets learn the truth, the next connection reloads. */
  private dropRoom(): void {
    this.doc = null;
    for (const socket of this.ctx.getWebSockets()) {
      this.closeWith(socket, CLOSE_STORAGE_FAILURE, 'storage failure, reloading');
    }
  }

  /** Handle one frame from one socket. */
  private receive(socket: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      // Only the sender is closed: everyone else keeps working (TC-15 story 3), and
      // nothing was stored (`live.reject_bad_update`, TC-17).
      this.closeWith(socket, CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'awareness') {
      this.relay(data);
      return;
    }
    if (decoded.kind === 'query-awareness') {
      // There is no stored awareness in this story, so nobody can answer the query.
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    try {
      // `readSyncMessage` applies the update (origin = this socket, so the broadcast
      // skips it) and writes the reply the client still needs. Its own default error
      // handling logs a bad update and carries on; the room rethrows instead, so the
      // sender is closed and the room's document is never left half-updated (TC-15).
      syncProtocol.readSyncMessage(
        decoding.createDecoder(decoded.payload),
        encoder,
        this.document(),
        socket,
        (error: Error) => {
          throw error;
        },
      );
    } catch (error) {
      this.closeWith(socket, CLOSE_UNSUPPORTED_DATA, `rejected sync message (${reasonOf(error)})`);
      return;
    }
    if (encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
  }

  /**
   * `y-websocket` hangs up on a connection it has heard nothing from for 30 seconds,
   * and an idle board produces nothing by itself. So every `KEEPALIVE_INTERVAL_MS`
   * the room asks each socket to report its awareness; every client answers, and the
   * answer is relayed like any other awareness frame — traffic both ways, a few bytes
   * a second, and a board that has been left open all afternoon stays connected
   * (TC-29).
   *
   * The clock is a Durable Object alarm, not a `setInterval`: an interval keeps the
   * object awake forever, which is exactly the compute an idle board must not have
   * (and blocks hibernation while sockets are open). An alarm lets the object sleep
   * between pings — it wakes, sends, re-arms, and sleeps again. When nobody is
   * connected the chain ends by itself.
   */
  private armKeepalive(): void {
    this.ctx.storage
      .setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS)
      .catch((error: unknown) =>
        console.error(JSON.stringify({ event: 'keepalive_alarm_failed', error: reasonOf(error) })),
      );
  }

  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return; // the chain ends when nobody is left
    this.sendTo(new Uint8Array([MESSAGE_QUERY_AWARENESS]), sockets);
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);
  }

  /**
   * Awareness goes out verbatim, to every socket including the sender: the room does
   * not know what awareness means (story 6 gives it meaning), so it does not get to
   * decide who should see it. Relaying the sender's own frame back is also what keeps
   * an idle client's watchdog fed (TC-29).
   */
  private relay(frameBytes: ArrayBuffer | string): void {
    if (typeof frameBytes === 'string') return;
    this.sendTo(new Uint8Array(frameBytes), this.ctx.getWebSockets());
  }

  /** The update one socket caused, to every other open socket (and never back). */
  private broadcast(update: Uint8Array, origin: unknown): void {
    const bytes = frame((encoder) => syncProtocol.writeUpdate(encoder, update));
    this.sendTo(bytes, [...this.ctx.getWebSockets()].filter((socket) => socket !== origin));
  }

  /**
   * One send per recipient. A recipient that cannot be written to is simply gone
   * (TC-31); the room never throws because of it, and never stops serving the others.
   */
  private sendTo(bytes: Uint8Array, recipients: Iterable<WebSocket>): void {
    for (const socket of recipients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        // A copy per recipient: the runtime takes the buffer over when it sends it, so
        // the second recipient of the same array would be sent nothing at all.
        socket.send(new Uint8Array(bytes));
      } catch {
        // The socket was closed between `getWebSockets()` and this send; the runtime
        // has moved on, and so has the room.
      }
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    this.sendTo(bytes, [socket]);
  }

  /** Close one socket with a story 3 close code, hibernated ones included. */
  private closeWith(socket: WebSocket, code: number, reason: string): void {
    try {
      // Direct close: with this hibernation API level, the socket object itself is
      // the handle, and it works across hibernation too.
      socket.close(code, reason.slice(0, 120));
    } catch {
      // Already closed: nothing else to do.
    }
  }

  /** The honest answer to anybody reaching a board that could not be loaded. */
  private sendLoadFailed(socket: WebSocket): void {
    this.closeWith(socket, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
  }

  /** The room's one state machine, in one place (unit-tested in `room-state.ts`). */
  private dispatch(event: RoomEvent): RoomState {
    this.state = nextRoomState(this.state, event);
    return this.state;
  }

  /**
   * Test-only storage routes, compiled behind `env.TEST_HOOKS === '1'` (never set in
   * production config). They exist because damaged bytes cannot be produced on
   * demand: one writes a real snapshot chunk and remembers its bytes, the other puts
   * them back, and only real loads with real bytes decide whether the board is broken.
   */
  private testHook(request: Request): Response {
    const { pathname, searchParams } = new URL(request.url);
    const hook = pathname.split('/').pop() ?? '';
    const storage = this.ctx.storage.sql;
    if (hook === 'seed-notes' || hook === 'pump-notes') {
      // Both change the board, and only through the room's own production path:
      // `createSticky` and colour sets run on the room's doc, so every one of them
      // goes through `store.append` exactly as a person's change would.
      if (request.method !== 'POST') {
        return new Response('test hooks that change the board want POST', { status: 405 });
      }
      if (this.doc === null) this.loadNow();
      if (this.doc === null || this.state !== 'ready') {
        return new Response(JSON.stringify({ error: `room is ${this.state}` }), { status: 503 });
      }
      if (hook === 'seed-notes') {
        const count = Number(searchParams.get('count') ?? '0');
        if (!Number.isInteger(count) || count < 1 || count > 5000) {
          return new Response(JSON.stringify({ error: 'count must be 1..5000' }), { status: 400 });
        }
        const doc = this.doc;
        for (let i = 0; i < count; i++) {
          createSticky(doc, { x: (i % 50) * 260, y: Math.floor(i / 50) * 260 });
        }
        return new Response(JSON.stringify({ seeded: count }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const times = Number(searchParams.get('times') ?? '0');
      if (!Number.isInteger(times) || times < 1 || times > 5000) {
        return new Response(JSON.stringify({ error: 'times must be 1..5000' }), { status: 400 });
      }
      const ids = [...this.doc.getMap('objects').keys()];
      if (ids.length === 0) {
        return new Response(JSON.stringify({ error: 'no notes to pump' }), { status: 409 });
      }
      const doc = this.doc;
      for (let t = 0; t < times; t++) {
        const id = ids[t % ids.length];
        const item = doc.getMap('objects').get(id);
        if (!(item instanceof Y.Map)) continue;
        doc.transact(() => {
          item.set('color', t % 2 === 0 ? 'pink' : 'yellow'); // a change that is really a change
        });
      }
      return new Response(JSON.stringify({ pumped: times }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.method !== 'POST') {
      return new Response('test hooks want POST', { status: 405 });
    }
    if (hook === 'corrupt-snapshot') {
      const chunks = storage
        .exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
        )
        .toArray();
      if (chunks.length === 0) {
        return new Response(JSON.stringify({ error: 'no snapshot present' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Remember the real bytes, then damage the first chunk with real junk of the
      // same length: a load will refuse it, and nothing else about the board changes.
      const original = Array.from(new Uint8Array(chunks[0].data));
      storage.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        'test_backup_chunk_0',
        JSON.stringify(original),
      );
      storage.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        differFrom(new Uint8Array(chunks[0].data)),
      );
      // The in-memory copy must not keep serving a broken board's ghost: the room
      // drops it and tells every socket, exactly as a storage failure would.
      this.dispatch({ type: 'storage-error' });
      this.dropRoom();
      return new Response(JSON.stringify({ corrupted: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (hook === 'repair-snapshot') {
      const row = storage
        .exec<{ value: string }>(
          "SELECT value FROM storage_meta WHERE key = 'test_backup_chunk_0'",
        )
        .next();
      if (row.done === true) {
        return new Response(JSON.stringify({ error: 'nothing to repair' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      const original = Uint8Array.from(JSON.parse(row.value.value) as number[]);
      storage.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
      storage.exec("DELETE FROM storage_meta WHERE key = 'test_backup_chunk_0'");
      return new Response(JSON.stringify({ repaired: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('unknown test hook', { status: 404 });
  }
}

/** Junk of the same length as `bytes`, differing from it at every position. */
function differFrom(bytes: Uint8Array): Uint8Array {
  const junk = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) junk[i] = (bytes[i] + 1) % 256;
  return junk;
}

/** Wrap a y-protocols message in its y-websocket frame (`varUint(type) + payload`). */
function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
