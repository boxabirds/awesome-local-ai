import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc, createSticky, getStickyText, snapshot } from '@shared/board-model';
import { STICKY_COLORS, type StickyColor } from '@shared/config';
import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '@shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@shared/config';
import { BoardStore, LOAD_ORIGIN, type LoadResult } from './board-store';
import { nextRoomState, type LifecycleState } from './room-state';
import type { Env } from './index';

/** Runtime state used for message gating (a subset of the lifecycle states). */
export type RoomState = 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject<Env> {
  private readonly store: BoardStore;
  private doc: Y.Doc = new Y.Doc();
  private state: LifecycleState = 'loading';
  private lastLoadFailure = 0;
  private loadCount = 0;
  private lastLoadReason = '';
  private lastLoadMs = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Load (migrate + replay) before any request is handled. On a real wake this
    // runs on construction; the SQL API is synchronous so nothing else can interleave.
    ctx.blockConcurrencyWhile(async () => {
      this.attemptLoad();
    });
  }

  // ---- load / reload ------------------------------------------------------

  private resetDoc(): void {
    this.doc.destroy();
    this.doc = new Y.Doc();
    initDoc(this.doc);
  }

  /** (Re)load the doc from storage. Transitions loading -> ready | load-failed. */
  private attemptLoad(): void {
    this.state = 'loading';
    this.loadCount += 1;
    this.resetDoc();
    const t0 = Date.now();
    try {
      this.store.migrate();
    } catch (e: unknown) {
      this.lastLoadMs = Date.now() - t0;
      this.failLoad('sql-error', e instanceof Error ? e.message : String(e));
      return;
    }
    let result: LoadResult;
    try {
      result = this.store.load(this.doc);
    } catch (e: unknown) {
      result = { ok: false, reason: 'sql-error', error: e instanceof Error ? e.message : String(e) };
    }
    this.lastLoadMs = Date.now() - t0;
    if (result.ok) {
      this.lastLoadReason = '';
      this.state = nextRoomState(
        this.state,
        result.quarantined > 0 ? { type: 'load-quarantined' } : { type: 'load-ok' },
      );
      // Register the update handler only after load completes so nothing read from
      // storage is re-stored or broadcast back out.
      this.wireDoc();
    } else {
      this.failLoad(result.reason, result.error);
    }
  }

  private failLoad(reason: string, message: string): void {
    this.lastLoadReason = reason;
    this.state = nextRoomState(this.state, { type: 'load-failed' });
    this.lastLoadFailure = Date.now();
    console.error(JSON.stringify({ event: 'board-load-failed', reason, error: message }));
  }

  private wireDoc(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.handleDocUpdate(update, origin);
    });
  }

  // ---- Yjs update handling ------------------------------------------------

  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    // Updates applied while loading from storage are never stored or broadcast.
    if (origin === LOAD_ORIGIN) return;
    // Only store/broadcast when the room is healthy. (webSocketMessage gates the
    // entry points, so this is a safety net for anything else touching the doc.)
    if (this.state !== 'ready') return;

    // Write before broadcast. The SQL API is synchronous and Durable Objects hold
    // outgoing messages until storage writes are durable, so no other client can
    // observe a change that is not already saved.
    try {
      this.store.append(update);
    } catch (e: unknown) {
      this.enterStorageFailure(e);
      return;
    }

    // Broadcast to everyone except the origin.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const encoded = encoding.toUint8Array(encoder);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === origin) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(encoded);
      } catch {
        /* socket closing; getWebSockets will drop it */
      }
    }

    // Keep the replay bounded. compactIfNeeded never throws.
    try {
      this.store.compactIfNeeded(this.doc);
    } catch {
      /* defensive; compactIfNeeded swallows internally */
    }
  }

  private enterStorageFailure(e: unknown): void {
    this.state = nextRoomState(this.state, { type: 'storage-error' });
    console.error(
      JSON.stringify({ event: 'storage-failure', error: e instanceof Error ? e.message : String(e) }),
    );
    // Close every socket with 1011; the change was never broadcast. Reconnecting
    // clients re-send what the server lacks via the SyncStep1/2 exchange so the
    // unsaved change is retried from each open page once saving works again.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        /* ignore */
      }
    }
    // Discard the in-memory doc; the next connection reloads it from storage.
    this.resetDoc();
  }

  // ---- connection lifecycle ----------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // Decide whether to (re)load before admitting the new socket.
    if (this.state === 'storage-failed') {
      this.attemptLoad();
    } else if (this.state === 'load-failed') {
      const elapsedEnough = Date.now() - this.lastLoadFailure >= LOAD_RETRY_MIN_INTERVAL_MS;
      this.state = nextRoomState(this.state, { type: 'retry', elapsed: elapsedEnough });
      if (this.state === 'loading') this.attemptLoad();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    if (this.state === 'load-failed') {
      // Honest failure: accept then immediately refuse the connection. The client
      // provider keeps retrying (4500 is in the retryable range).
      server.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.state === 'storage-failed') {
      server.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ready: kick off the sync handshake (client also sends its own SyncStep1).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    server.send(encoding.toUint8Array(encoder));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    const decoded = decodeMessage(message);
    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }
    if (decoded.kind === 'awareness') {
      const relayEncoder = encoding.createEncoder();
      encoding.writeVarUint(relayEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(relayEncoder, decoded.payload);
      const bytes = encoding.toUint8Array(relayEncoder);
      for (const s of this.ctx.getWebSockets()) {
        if (s.readyState !== WebSocket.OPEN) continue;
        try {
          s.send(bytes);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return;
    }

    // sync message. Apply-before-store: a sync message that Yjs rejects throws
    // here, so nothing is stored and the sender is closed with 1003.
    try {
      const syncDecoder = decoding.createDecoder(decoded.payload);
      const replyEncoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(syncDecoder, replyEncoder, this.doc, ws);
      const reply = encoding.toUint8Array(replyEncoder);
      if (reply.length > 0) {
        const outerEncoder = encoding.createEncoder();
        encoding.writeVarUint(outerEncoder, MESSAGE_SYNC);
        encoding.writeUint8Array(outerEncoder, reply);
        ws.send(encoding.toUint8Array(outerEncoder));
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'invalid sync message');
    }
  }

  webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // Sockets are tracked by ctx.getWebSockets(); nothing to clean up here.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Same: the socket is dropped from getWebSockets by the runtime.
  }

  // ---- test support -------------------------------------------------------
  // These methods exist only so integration tests can simulate a wake-from-
  // hibernation load, reach the storage wrapper to inject failures, and read the
  // room state. They are harmless no-ops in production (never called there).

  __testReload(): void {
    this.attemptLoad();
  }

  __testGetState(): LifecycleState {
    return this.state;
  }

  __testLoadCount(): number {
    return this.loadCount;
  }

  __testLastLoadReason(): string {
    return this.lastLoadReason;
  }

  __testGetStore(): BoardStore {
    return this.store;
  }

  __testSetLastLoadFailure(t: number): void {
    this.lastLoadFailure = t;
  }

  __testLoadMs(): number {
    return this.lastLoadMs;
  }

  __testNoteCount(): number {
    return snapshot(this.doc).length;
  }

  /**
   * TEST ONLY (gated behind an HTTP test route): build a deterministic board of
   * `count` notes and persist them as a single self-contained Yjs update, exactly
   * as a fresh collaborator syncing its full state would. Building the notes in a
   * throwaway doc (rather than the room's own doc) is essential: the room doc's
   * first transaction is `initDoc`, which is intentionally never persisted, so a
   * delta taken from the room doc would start at a client clock > 0 and fail to
   * replay onto a fresh load (a missing-clock gap leaves items unintegrated).
   * Text is `Note ${i}`.
   */
  __testSeed(count: number, seed: number): number {
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    const col0 = seed % 7;
    const tmp = new Y.Doc();
    initDoc(tmp);
    for (let i = 0; i < count; i++) {
      const col = i % 50;
      const row = Math.floor(i / 50);
      const x = 60 + ((col + col0) % 50) * 240;
      const y = 60 + row * 240;
      const id = createSticky(tmp, { x, y }, colors[i % colors.length]);
      if (!id) continue;
      const txt = getStickyText(tmp, id);
      if (txt) txt.insert(0, `Note ${i}`);
    }
    const full = Y.encodeStateAsUpdate(tmp);
    tmp.destroy();
    // Integrate into the live room doc without re-persisting (LOAD_ORIGIN), then
    // store the one self-contained update.
    Y.applyUpdate(this.doc, full, LOAD_ORIGIN);
    this.store.append(full);
    return snapshot(this.doc).length;
  }

  /** TEST ONLY: fabricate an unreadable snapshot in storage (does not reload). */
  __testCorruptSnapshot(): void {
    this.store.__testCorruptSnapshot();
  }

  /** TEST ONLY: remove a fabricated snapshot so the log replays on next load. */
  __testRepairSnapshot(): void {
    this.store.__testRepairSnapshot();
  }
}
