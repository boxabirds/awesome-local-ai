import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createDecoder } from 'lib0/decoding';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { ensureMeta } from '@/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  type Decoded,
} from '@/shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { type RoomState } from './room-state';
import { handleTestRequest } from './test-hooks';
import type { Env } from './index';

/**
 * One BoardRoom per board (stories 3+4).
 *
 * A Durable Object with hibernatable WebSockets and a SQLite-backed Yjs
 * document:
 *
 *  - construct/wake: migrate the schema, load the chunked snapshot and the
 *    update log into a fresh doc (blockConcurrencyWhile until done). A
 *    log row that Yjs rejects is quarantined (the board stays usable); an
 *    unreadable snapshot or SQL error puts the room in LoadFailed.
 *  - fetch: a WebSocket upgrade is accepted only from Ready (after a fresh
 *    load if the room was StorageFailed). From LoadFailed a connection is
 *    refused with CLOSE_BOARD_LOAD_FAILED (4500) until
 *    LOAD_RETRY_MIN_INTERVAL_MS has elapsed since the last attempt, at which
 *    point the load is retried in-line.
 *  - sync messages: `readSyncMessage` decodes and applies; whatever was
 *    applied is STORED BEFORE it is broadcast (write-before-broadcast: a
 *    change is durable before any other client can see it). A storage
 *    failure discards the in-memory doc and closes every socket with
 *    CLOSE_STORAGE_FAILURE (1011) — the board stays readable from storage
 *    and open pages re-send their unsaved changes on reconnect.
 *  - awareness: relayed verbatim to ALL open sockets including the sender,
 *    which keeps idle y-websocket clients alive (their watchdog closes
 *    silent connections).
 *
 * Sockets are accepted with `ctx.acceptWebSocket` (hibernation API): they
 * stay open across hibernation, the runtime tracks them, and the doc is
 * reloaded from storage on every (re)construct.
 */
export class BoardRoom implements DurableObject {

  private doc: Y.Doc;
  private readonly store: BoardStore;
  private state: RoomState;
  /** Epoch ms of the last load attempt (LoadFailed retry throttling). */
  private lastLoadAttempt = 0;

  constructor(private readonly ctx: DurableObjectState, _env: Env) {
    this.store = new BoardStore(ctx.storage);
    this.doc = this.freshDoc();
    this.state = 'loading';
    // The constructor must complete before the runtime starts delivering
    // events (fetch, webSocketMessage, timers); block those until load done.
    void ctx.blockConcurrencyWhile(async () => {
      this.loadFromStorage();
    });
  }

  // --- lifecycle ----------------------------------------------------------

  /**
   * A pristine doc with NO meta. The load target must be empty: persisted
   * rows (the first of which is a full state) already carry the top-level
   * types, so pre-seeding meta here would create a second, client-id-
   * distinct meta item on every reload. Meta is seeded lazily by the first
   * real change (see handleSync) — a never-edited board stores nothing.
   */
  private freshDoc(): Y.Doc {
    return new Y.Doc();
  }

  /** Migrates (idempotent) and loads the persisted state into a fresh doc. */
  private loadFromStorage(): void {
    this.state = 'loading';
    this.doc = this.freshDoc();
    this.store.migrate();
    this.lastLoadAttempt = Date.now();
    const result = this.store.load(this.doc);
    if (result.ok) {
      this.state = 'ready';
      if (result.quarantined > 0) {
        console.warn({ event: 'board-load-quarantined', quarantined: result.quarantined });
      }
    } else {
      this.state = 'load-failed';
      console.error({ event: 'board-load-failed', reason: result.reason, error: result.error });
    }
  }

  /**
   * Test-only: drop the in-memory doc and reload from storage, simulating a
   * wake from hibernation (local workerd cannot force hibernation). Open
   * sockets are runtime-tracked and survive: they can still send, and
   * broadcasts reach them via ctx.getWebSockets().
   */
  reconstruct(): { before: RoomState; after: RoomState } {
    const before = this.state;
    this.loadFromStorage();
    return { before, after: this.state };
  }

  /** Test-only: peek at the state machine. */
  inspectState(): { state: RoomState; lastLoadAttempt: number } {
    return { state: this.state, lastLoadAttempt: this.lastLoadAttempt };
  }

  /** Test-only: the durable storage (used by the /__test ops). */
  get storage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  // --- fetch: upgrades, test hooks, load retries ---------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__test/')) {
      return handleTestRequest(request, this);
    }
    // Only WebSocket upgrades reach the room (the worker entry returns 426
    // for anything else).
    if (
      this.state === 'load-failed' &&
      Date.now() - this.lastLoadAttempt >= LOAD_RETRY_MIN_INTERVAL_MS
    ) {
      // A load attempt is overdue: retry it before serving the connection.
      await this.ctx.blockConcurrencyWhile(async () => {
        this.loadFromStorage();
      });
    } else if (this.state === 'storage-failed') {
      // Next connection after a storage failure: reload from storage.
      await this.ctx.blockConcurrencyWhile(async () => {
        this.loadFromStorage();
      });
    }
    // A LoadFailed room still ACCEPTS the upgrade: the close frame must be
    // issued from a socket event (onMessage) to be delivered — a close issued
    // from here, or from a timer, is dropped by the runtime before the 101
    // handshake completes and never reaches the client. onMessage closes the
    // socket with CLOSE_BOARD_LOAD_FAILED (4500) as soon as the client's
    // first frame (its SyncStep1) arrives; the provider treats 4500-range
    // codes as "try again later" and keeps reconnecting.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.onClientOpen(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- socket handling ------------------------------------------------------

  private onClientOpen(ws: WebSocket): void {
    // Handshake: the room's current state vector.
    this.sendFrame(ws, this.syncStep1Frame());
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.onMessage(ws, message);
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // No per-socket state to clean up (awareness is not stored).
  }

  private onMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    // A state change can only put the room into LoadFailed while sockets are
    // open after a wake whose reload failed: tell the client to reconnect.
    if (this.state === 'load-failed') {
      this.dropSocket(ws, CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state !== 'ready') {
      // 'loading' cannot deliver messages (blocked); be defensive anyway.
      return;
    }

    let decoded: Decoded;
    try {
      decoded = decodeMessage(data);
    } catch {
      decoded = { kind: 'invalid', reason: 'decode threw' };
    }
    switch (decoded.kind) {
      case 'invalid':
        // String frames, unknown types, truncated bytes: reject the sender.
        this.rejectSocket(ws);
        return;
      case 'query-awareness':
        // No stored awareness (story 3 behaviour).
        return;
      case 'awareness':
        this.relayAwareness(decoded.payload);
        return;
      case 'sync':
        this.handleSync(ws, decoded.payload);
        return;
    }
  }

  private handleSync(ws: WebSocket, payload: Uint8Array): void {
    const decoder = createDecoder(payload);
    const encoder = createEncoder();
    let rejected = false;
    // Capture the RAW updates readSyncMessage applies. They must be stored
    // and broadcast as-is (not recomputed as an encodeStateAsUpdate delta
    // against persistedSv): a delete is a tombstone that does NOT advance
    // the state vector, so a delta computed against the durable sv would be
    // empty and the delete would never be persisted or relayed (TC-08).
    const applied: Uint8Array[] = [];
    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === LOAD_ORIGIN) applied.push(update);
    };
    this.doc.on('update', onUpdate);
    try {
      // readSyncMessage:
      //  - SyncStep1 -> writes a SyncStep2 reply into `encoder` (no doc change)
      //  - SyncStep2 / Update -> applies to the doc (fires `update` events)
      // The errorHandler catches invalid Yjs updates that readSyncStep2 would
      // otherwise swallow (it logs and continues).
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, LOAD_ORIGIN, () => {
        rejected = true;
      });
      if (rejected) {
        this.rejectSocket(ws);
        return;
      }
      // Reply (SyncStep2) to a SyncStep1.
      const reply = toUint8Array(encoder);
      if (reply.length > 0) {
        this.sendFrame(ws, encodeMessage(MESSAGE_SYNC, reply));
      }
      // A real change landed only if at least one update was applied (a mere
      // connection / known SyncStep2 applies nothing). A never-edited board
      // must stay row-free (persist.first_write).
      if (applied.length > 0) {
        // eslint-disable-next-line no-console
        console.log({ event: 'DEBUG-handleSync', applied: applied.length, bytes: applied.reduce((s, u) => s + u.length, 0), state: this.state });
        // Make sure meta exists (idempotent; in practice the first client's
        // createSticky already carries it), then make each applied update
        // durable BEFORE relaying it (write-before-broadcast).
        ensureMeta(this.doc);
        for (const update of applied) {
          this.storeAndBroadcast(ws, update);
          if (this.state === 'storage-failed') return;
        }
      }
    } catch {
      rejected = true;
    }
    if (rejected) {
      console.error({ event: 'board-sync-rejected' });
      this.rejectSocket(ws);
    }
  }

  /**
   * Write-before-broadcast: store the update first, then send it to every
   * socket except the one that produced the change (no echo — story 3).
   */
  private storeAndBroadcast(origin: WebSocket, update: Uint8Array): void {
    try {
      this.store.append(update);
    } catch (err) {
      this.onAppendFailed(err);
      return;
    }
    // The sync broadcast is a y-protocols Update message (not raw update
    // bytes): [MESSAGE_SYNC][sync Update][varUint8Array(update)].
    const inner = createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const frame = encodeMessage(MESSAGE_SYNC, toUint8Array(inner));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      this.sendFrame(socket, frame);
    }
    if (this.store.compactIfNeeded(this.doc)) {
      console.info({ event: 'board-compaction' });
    }
  }

  /**
   * append-failed -> storage-failed: discard the in-memory doc and close all
   * open sockets with CLOSE_STORAGE_FAILURE. The board remains readable from
   * storage; the next connection reloads it.
   */
  private onAppendFailed(err: unknown): void {
    this.state = 'storage-failed';
    console.error({
      event: 'board-storage-failed',
      error: err instanceof Error ? err.message : String(err),
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // Already closed.
      }
    }
    this.doc = this.freshDoc();
  }

  /** Relays an awareness frame verbatim to every open socket (incl. sender). */
  private relayAwareness(payload: Uint8Array): void {
    const frame = encodeMessage(MESSAGE_AWARENESS, payload);
    for (const socket of this.ctx.getWebSockets()) {
      this.sendFrame(socket, frame);
    }
  }

  // --- plumbing -------------------------------------------------------------

  private syncStep1Frame(): Uint8Array {
    const encoder = createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return encodeMessage(MESSAGE_SYNC, toUint8Array(encoder));
  }

  private sendFrame(socket: WebSocket, frame: Uint8Array): void {
    try {
      socket.send(frame);
    } catch {
      // A send that throws means the socket is gone; the runtime drops it.
    }
  }

  /** Closes `socket` with CLOSE_UNSUPPORTED_DATA (1003, story 3). */
  private rejectSocket(socket: WebSocket): void {
    this.dropSocket(socket, CLOSE_UNSUPPORTED_DATA);
  }

  private dropSocket(socket: WebSocket, code: number): void {
    try {
      socket.close(code);
    } catch {
      // Already closed; nothing to do.
    }
  }
}
