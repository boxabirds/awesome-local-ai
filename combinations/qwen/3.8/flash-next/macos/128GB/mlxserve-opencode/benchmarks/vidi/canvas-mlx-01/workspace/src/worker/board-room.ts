/**
 * `BoardRoom`: one Durable Object per board. It owns that board's `Y.Doc`, durably
 * stores every change to SQLite (`BoardStore`) before broadcasting it, compacts the
 * update log into a chunked snapshot, and reloads the saved state when the object is
 * constructed or woken — so a board survives the process forgetting it (story 4).
 *
 * Sockets are accepted with the hibernating `ctx.acceptWebSocket()` API and iterated
 * through `ctx.getWebSockets()`, so an idle board with open sockets costs no compute:
 * the object can be evicted between messages and is reconstructed (which reloads the
 * doc from storage) when a message or connection arrives. Because the document is now
 * durable, eviction no longer loses it.
 *
 * Write-before-broadcast: the `doc` update handler appends the update to storage and
 * only then relays it; Cloudflare output gating holds any `ws.send` until the durable
 * write for that turn has completed. A storage write failure (`persist.save_failure`)
 * closes every socket with `CLOSE_STORAGE_FAILURE` and discards the doc so the next
 * connection reloads; a board whose saved state cannot be read (`persist.load_failure`)
 * is never presented as an empty editable board — new connections are closed with
 * `CLOSE_BOARD_LOAD_FAILED` and retried at most every `LOAD_RETRY_MIN_INTERVAL_MS`.
 *
 * Awareness still lives only in memory (the room keeps a mirror so it can answer a
 * newcomer's `queryAwareness` and announce departures). It is best-effort across
 * eviction: presence is ephemeral, the board content is not.
 */
import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol.js';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config.js';
import { BoardStore, LOAD_ORIGIN } from './board-store.js';
import type { Env } from './index.js';

const { messageYjsSyncStep1 } = syncProtocol;

/**
 * The coarse runtime states the room routes on. `load-failed` and `storage-failed`
 * mirror two edges of the design's lifecycle diagram; the full lifecycle (hibernation,
 * compaction, quarantine) is modelled purely in `room-state.ts`. `loading` is a
 * transient held only during the constructor's `blockConcurrencyWhile(load)`; no message
 * or connection is dispatched until that resolves.
 */
type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed';

/**
 * Wrap a Yjs update as a y-websocket sync frame: `[ MESSAGE_SYNC, writeUpdate ]`.
 * It is never sent back to the peer that produced it, so a sender sees no echo.
 */
const frameUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

/** A room's own SyncStep1 frame: `[ MESSAGE_SYNC, SyncStep1, stateVector ]`. */
const frameSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

/** Wrap an awareness update as `[ MESSAGE_AWARENESS, varuint8array ]`. */
const frameAwareness = (bytes: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
};

export class BoardRoom extends DurableObject<Env> {
  /** The SQLite persistence layer for this board (one database per object). */
  private readonly store: BoardStore;
  /** The room document; null while loading and discarded on a storage failure. */
  private doc: Y.Doc | null = null;
  private state: RoomState;
  /** When the last load failed, to rate-limit retries to `LOAD_RETRY_MIN_INTERVAL_MS`. */
  private loadFailedAt = 0;

  // --- in-memory awareness bookkeeping (ephemeral across eviction, by design) ---
  /** Which awareness client ids each socket introduced, so a departure can be announced. */
  private readonly socketAwareness = new Map<WebSocket, Set<number>>();
  /** The socket that most recently asserted each awareness id (for reconnect re-ownership). */
  private readonly awarenessOwner = new Map<number, WebSocket>();
  /** The room's awareness mirror, kept only to answer queries and announce departures. */
  private readonly awarenessDoc = new Y.Doc();
  private readonly awareness = new Awareness(this.awarenessDoc);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.state = 'loading';
    // Reload the saved board before the object handles any message or connection.
    this.ctx.blockConcurrencyWhile(async () => {
      this.load();
    });
  }

  /**
   * Read the board from storage into a fresh doc. On success the doc's `update` handler
   * (installed here, before any load applies) stores+broadcasts live changes and skips
   * `LOAD_ORIGIN` updates. A snapshot or SQL read failure leaves the room `load-failed`.
   */
  private load(): void {
    try {
      this.store.migrate();
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.onDocUpdate(update, origin);
      });
      const result = this.store.load(doc);
      if (result.ok) {
        this.doc = doc;
        this.state = 'ready';
      } else {
        this.doc = null; // never surface a half-loaded board
        this.state = 'load-failed';
        this.loadFailedAt = Date.now();
        console.error('board-room.load-failed', {
          reason: result.reason,
          error: result.error,
        });
      }
    } catch (error) {
      // migrate or the doc setup itself hit an SQL error: same honest failure as a load miss.
      this.doc = null;
      this.state = 'load-failed';
      this.loadFailedAt = Date.now();
      console.error('board-room.load-failed', {
        reason: 'sql-error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The `doc.on('update')` handler. Loaded updates (`LOAD_ORIGIN`) are neither stored nor
   * rebroadcast. Every other update is durably appended FIRST — a storage failure resets
   * the room and is swallowed so it is never conflated with a Yjs apply error that would
   * close the socket 1003 — then broadcast to everyone but its origin, then compaction is
   * attempted. Cloudflare output gating holds the broadcasts until the write is durable.
   */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    const sender = (origin as WebSocket | null | undefined) ?? null;
    try {
      this.store.append(update);
    } catch (error) {
      // persist.save_failure: the board is still readable but unsavable. Close everyone,
      // discard the doc, and let the next connection reload (clients re-send their
      // unsaved change via SyncStep2). Return without rethrowing so the update event (fired
      // inside `Y.applyUpdate`) is not mistaken for a rejected-update close.
      console.error('board-room.storage-failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.resetRoom();
      return;
    }
    this.broadcast(frameUpdate(update), sender);
    if (this.doc !== null) this.store.compactIfNeeded(this.doc);
  }

  /**
   * Handle a WebSocket upgrade: accept with the hibernating API, then serve. A `load-failed`
   * room retries loading only after `LOAD_RETRY_MIN_INTERVAL_MS`; a still-failing room
   * accepts then immediately closes the socket with `CLOSE_BOARD_LOAD_FAILED` so the client
   * keeps its honest "couldn't be loaded" state rather than seeing an empty board.
   */
  async fetch(request: Request): Promise<Response> {
    // A test-only storage operation (a black-box e2e harness corrupting/repairing a board).
    // Present in the code but inert unless `env.TEST_HOOKS === '1'`, which the production
    // config never sets.
    const testPath = new URL(request.url).pathname;
    if (testPath.startsWith('/__test/')) return this.handleTest(request, testPath);

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Retry a failed load only on a fresh connection and only after the retry interval;
    // a storage failure reloads immediately (its doc was discarded on failure).
    if (
      (this.state === 'load-failed' &&
        Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) ||
      this.state === 'storage-failed'
    ) {
      this.load();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.binaryType = 'arraybuffer';
    // Hibernating accept: the object may be evicted while these sockets stay open.
    this.ctx.acceptWebSocket(server);

    if (this.state === 'load-failed') {
      // The board still can't be read; close honestly rather than present it empty.
      server.close(CLOSE_BOARD_LOAD_FAILED);
      return new Response(null, { status: 101, webSocket: client });
    }

    const doc = this.doc as Y.Doc;
    // Ask the newcomer for its state: a reconnected client's SyncStep2 repopulates anything
    // this (reconstructed) room lacks, and its own changes get stored.
    this.send(server, frameSyncStep1(doc));
    // Push who is already here: a newcomer learns existing editors solely from this push.
    this.answerAwarenessQuery(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** A message from an accepted socket. Routes on room state first, then the frame kind. */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed' || this.doc === null) {
      // Transient until the next connection reloads; the board is readable elsewhere.
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    this.handleMessage(ws, message);
  }

  /** A socket closed (cleanly or not): announce its awareness departure. */
  webSocketClose(ws: WebSocket): void {
    this.forgetSocket(ws);
  }

  /** A socket errored: same cleanup as a close. */
  webSocketError(ws: WebSocket): void {
    this.forgetSocket(ws);
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        this.handleSync(ws, decoded.payload);
        break;
      }
      case 'awareness': {
        // Relay verbatim to every socket (including the sender) so idle clients keep
        // receiving traffic and their no-message timeout never fires.
        if (typeof data !== 'string') this.relay(data, null);
        this.trackAwareness(ws, decoded.payload);
        break;
      }
      case 'query-awareness': {
        this.answerAwarenessQuery(ws);
        break;
      }
      case 'invalid': {
        // A malformed frame only closes the offending socket; every other editor stays
        // connected and the doc (and log) is unchanged.
        this.closeUnsupported(ws);
        break;
      }
    }
  }

  /**
   * Handle a sync frame body (bytes after the outer `MESSAGE_SYNC`). A reply is written only
   * for a SyncStep1 (SyncStep2 back to the requester); a SyncStep2 or update is applied to
   * the doc, which fires `update` (store + broadcast to the others). Any undecodable message
   * or rejected Yjs update closes just this socket — and, because a rejected update fires no
   * `update` event, is never stored.
   */
  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const doc = this.doc;
    if (doc === null) return;
    const decoder = decoding.createDecoder(payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    let failed = false;
    try {
      const messageType = syncProtocol.readSyncMessage(decoder, reply, doc, ws, () => {
        failed = true;
      });
      if (messageType === messageYjsSyncStep1 && encoding.length(reply) > 1) {
        this.send(ws, encoding.toUint8Array(reply));
      }
    } catch {
      failed = true;
    }
    if (failed) this.closeUnsupported(ws);
  }

  /**
   * Merge an awareness update into the room's mirror and remember which client ids came from
   * this socket, so its departure can be announced. The verbatim relay already happened;
   * this is only bookkeeping. Re-owns a client id on reconnect so exactly one socket can
   * announce its loss.
   */
  private trackAwareness(ws: WebSocket, payload: Uint8Array): void {
    try {
      applyAwarenessUpdate(this.awareness, payload, ws);
    } catch {
      return; // a bad awareness update is ignored; the doc is untouched
    }
    for (const id of this.presentClients()) {
      const prev = this.awarenessOwner.get(id);
      if (prev === ws) continue;
      if (prev !== undefined) this.socketAwareness.get(prev)?.delete(id);
      this.awarenessOwner.set(id, ws);
      let ids = this.socketAwareness.get(ws);
      if (ids === undefined) {
        ids = new Set<number>();
        this.socketAwareness.set(ws, ids);
      }
      ids.add(id);
    }
  }

  /**
   * The awareness client ids that represent an actual remote editor: every state the mirror
   * holds EXCEPT the room's own awareness-doc id and any null (departed) state — without
   * this filter the room would broadcast its own placeholder id as phantom presence.
   */
  private presentClients(): number[] {
    const self = this.awarenessDoc.clientID;
    const present: number[] = [];
    for (const [id, state] of this.awareness.getStates()) {
      if (id === self || state == null) continue;
      present.push(id);
    }
    return present;
  }

  /** Answer a newcomer's `queryAwareness` with every state the room currently holds. */
  private answerAwarenessQuery(ws: WebSocket): void {
    const ids = this.presentClients();
    if (ids.length === 0) return;
    this.send(ws, frameAwareness(encodeAwarenessUpdate(this.awareness, ids)));
  }

  /** Announce a departed socket's awareness so remaining editors drop it from their count. */
  private forgetSocket(ws: WebSocket): void {
    const ids = this.socketAwareness.get(ws);
    this.socketAwareness.delete(ws);
    if (ids === undefined || ids.size === 0) return;
    const changed = Array.from(ids);
    for (const id of changed) this.awarenessOwner.delete(id);
    removeAwarenessStates(this.awareness, changed, null);
    this.broadcast(frameAwareness(encodeAwarenessUpdate(this.awareness, changed)), ws);
  }

  /**
   * Drop into `storage-failed`: close every socket with `CLOSE_STORAGE_FAILURE` (the board
   * is readable, so clients map this to `reconnecting` and re-send their unsaved change) and
   * discard the doc so the next connection reloads cleanly.
   */
  private resetRoom(): void {
    this.state = 'storage-failed';
    this.doc = null;
    this.socketAwareness.clear();
    this.awarenessOwner.clear();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE);
      } catch {
        // already closing
      }
    }
  }

  /**
   * TEST-ONLY storage operations, gated on `env.TEST_HOOKS === '1'` (otherwise 404, so the
   * route is inert in production). `corrupt` writes an unreadable snapshot, reloads the room
   * (which now fails), and closes every socket with the honest load-failure code; `repair`
   * clears the injected snapshot and reloads to `ready`, so a still-open client recovers on
   * its next reconnect WITHOUT a page reload.
   */
  private handleTest(request: Request, pathname: string): Response {
    if (String(this.env.TEST_HOOKS) !== '1') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (pathname === '/__test/corrupt') {
      this.store.corruptSnapshotForTest();
      this.load(); // now `load-failed` from the unreadable snapshot
      this.closeAll(CLOSE_BOARD_LOAD_FAILED);
      return new Response('corrupt', { status: 200 });
    }
    if (pathname === '/__test/repair') {
      this.store.repairSnapshotForTest();
      this.load(); // back to `ready` from the intact log
      return new Response('repair', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }

  /** Close every open socket (best effort; already-closing sockets are skipped). */
  private closeAll(code: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code);
      } catch {
        // already closing
      }
    }
  }

  private send(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      // A dead socket is dropped rather than throwing into the room.
    }
  }

  /** Send `bytes` to every open socket, skipping `except` (the update's origin). */
  private broadcast(bytes: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.send(ws, bytes);
    }
  }

  /**
   * Relay raw frame bytes to every open socket. `except === null` includes the sender
   * (the awareness relay). Unlike `broadcast`, a send failure never interrupts the rest.
   */
  private relay(data: ArrayBuffer, except: WebSocket | null): void {
    for (const ws of [...this.ctx.getWebSockets()]) {
      if (ws === except) continue;
      this.send(ws, new Uint8Array(data));
    }
  }

  private closeUnsupported(ws: WebSocket): void {
    try {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    } catch {
      // already closing
    }
  }
}
