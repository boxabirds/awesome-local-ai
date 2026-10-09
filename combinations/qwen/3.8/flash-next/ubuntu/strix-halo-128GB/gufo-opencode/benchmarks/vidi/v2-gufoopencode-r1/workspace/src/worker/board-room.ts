import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import { createEncoder, length as encodedLength, toUint8Array, writeVarUint } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import {
  SYNC_STEP2,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN, type BoardStorage } from './board-store';
import { nextRoomState, type RoomEvent, type RoomPhase } from './room-state';
import { isTestHookPath, runRoomTestHook, type RoomTestHookAccess } from './test-hooks';
import { createSticky } from '../shared/board-model';
import type { Env } from './index';

function safeSend(socket: WebSocket, data: Uint8Array | ArrayBuffer): boolean {
  try {
    socket.send(data);
    return true;
  } catch {
    return false;
  }
}

function frameUpdate(update: Uint8Array): Uint8Array {
  // Updates travel framed, exactly like the provider sends them:
  // [MESSAGE_SYNC][SYNC_UPDATE][length-prefixed update].
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeUpdate(encoder, update);
  return toUint8Array(encoder);
}

function sameStateVector(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// One board, one Y.Doc, durable in SQLite-backed Durable Object storage.
// Every update is appended before it is broadcast (the platform's output
// gates hold sends until the write is confirmed), so anything a client can
// see is already saved. Sockets use the hibernation API: the object can be
// evicted while idle and a woken instance reloads the document inside
// `blockConcurrencyWhile` before touching storage or sockets again.
export class BoardRoom extends DurableObject<Env> implements RoomTestHookAccess {
  private readonly store: BoardStore;
  private doc: Y.Doc | null = null;
  private phase: RoomPhase = 'loading';
  private lastLoadFailedAt = 0;
  private loadAttempts = 0;
  private failAppendOnce = false;
  private pending: Uint8Array[] | null = null;
  private pendingSv: Uint8Array | null = null;
  private pendingOrigin: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.ctx.blockConcurrencyWhile(async () => {
      this.runLoad();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hook = isTestHookPath(url.pathname);
    if (hook !== null) {
      if (this.env.TEST_HOOKS !== '1') return new Response('not found', { status: 404 });
      return runRoomTestHook(hook.action, this, url.searchParams);
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    if (this.phase === 'load-failed' || this.phase === 'storage-failed') {
      const event: RoomEvent =
        this.phase === 'load-failed'
          ? { type: 'retry-load', elapsedMs: Date.now() - this.lastLoadFailedAt }
          : { type: 'reload' };
      this.transition(event);
      if (this.phaseIs('loading')) this.runLoad();
      if (!this.phaseIs('ready')) return this.rejectUpgrade(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
    }

    const doc = this.doc;
    if (doc === null) return this.rejectUpgrade(CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // Ask the newcomer for everything we lack; its SyncStep2 repopulates a
    // doc that storage could not fully restore.
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, doc);
    safeSend(server, toUint8Array(encoder));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer | Uint8Array): void {
    try {
      this.handleMessage(ws, message);
    } catch {
      this.reject(ws, 'unhandled message error');
    }
  }

  webSocketClose(_ws: WebSocket): void {
    // Nothing to release: membership lives in ctx.getWebSockets().
  }

  webSocketError(_ws: WebSocket): void {
    // Broken sockets are dropped by the platform; the next message or close
    // event will not arrive.
  }

  // --- RoomTestHookAccess (used only when TEST_HOOKS === '1') -------------

  get testStore(): BoardStore {
    return this.store;
  }

  get testStorage(): BoardStorage {
    return this.ctx.storage;
  }

  get testPhase(): RoomPhase {
    return this.phase;
  }

  get testLoadAttempts(): number {
    return this.loadAttempts;
  }

  armFailAppendOnce(): void {
    this.failAppendOnce = true;
  }

  // Test-only: append `count` sticky notes through the normal update path so
  // persistence and compaction see them exactly like real client edits.
  seedNotes(count: number): void {
    const doc = this.doc;
    if (doc === null) throw new Error('room has no doc to seed');
    doc.transact(() => {
      for (let i = 0; i < count; i += 1) {
        createSticky(doc, { x: (i % 50) * 60, y: Math.floor(i / 50) * 60 });
      }
    });
  }

  // --- internals -----------------------------------------------------------

  private transition(event: RoomEvent): void {
    this.phase = nextRoomState(this.phase, event);
  }

  // Opaque phase read so control flow after transition()/runLoad() is not
  // narrowed by TypeScript to the pre-call value.
  private phaseIs(phase: RoomPhase): boolean {
    return this.phase === phase;
  }

  // Rebuild the in-memory doc from storage. Called on construction (inside
  // blockConcurrencyWhile, so no handler can run against a half-loaded room)
  // and on explicit retry/reload from fetch().
  private runLoad(): void {
    this.loadAttempts += 1;
    this.phase = 'loading';
    try {
      this.store.migrate();
      const doc = new Y.Doc();
      const result = this.store.load(doc);
      if (result.ok) {
        this.attach(doc);
        this.doc = doc;
        this.transition({ type: 'load-succeeded', quarantined: result.quarantined });
        return;
      }
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'load-error', error: String(error) }));
    }
    this.doc = null;
    this.transition({ type: 'load-failed' });
    this.lastLoadFailedAt = Date.now();
  }

  private attach(doc: Y.Doc): void {
    // Write before broadcast: the row is inserted in the same turn as the
    // apply, and broadcasts go out only after the insert succeeded. Updates
    // applied from storage (LOAD_ORIGIN) are neither stored nor echoed.
    // While a peer message is being processed, updates are queued so the
    // state-vector check in flushPending can drop offers that add nothing.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      if (this.pending !== null) {
        this.pending.push(update);
        return;
      }
      this.persistAndBroadcast(doc, update, origin);
    });
  }

  private persistAndBroadcast(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
    if (update.byteLength === 0) return;
    try {
      if (this.failAppendOnce) {
        this.failAppendOnce = false;
        throw new Error('injected append failure');
      }
      this.store.append(update);
    } catch (error) {
      this.failStorage(error);
      return;
    }
    const message = frameUpdate(update);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== origin) safeSend(socket, message);
    }
    this.transition({ type: 'begin-compact' });
    const done = this.store.compactIfNeeded(doc);
    this.transition(done ? { type: 'compact-succeeded' } : { type: 'compact-failed' });
  }

  // An offer from a fully caught-up peer (a SyncStep2 carrying state we
  // already hold) fires update events with non-empty but redundant payloads;
  // if the state vector did not advance, nothing was added and nothing is
  // stored or broadcast.
  private beginDedup(doc: Y.Doc, origin: WebSocket): void {
    this.pending = [];
    this.pendingSv = Y.encodeStateVector(doc);
    this.pendingOrigin = origin;
  }

  private flushPending(doc: Y.Doc): void {
    const pending = this.pending ?? [];
    const before = this.pendingSv;
    const origin = this.pendingOrigin;
    this.pending = null;
    this.pendingSv = null;
    this.pendingOrigin = null;
    if (before !== null && sameStateVector(before, Y.encodeStateVector(doc))) return;
    for (const update of pending) this.persistAndBroadcast(doc, update, origin);
  }

  // A storage insert failed: the change is not broadcast, every socket is
  // closed with 1011, and the doc is discarded. Reconnecting clients re-send
  // what we lack through SyncStep1/SyncStep2 once storage works again.
  private failStorage(error: unknown): void {
    this.phase = nextRoomState(this.phase, { type: 'storage-error' });
    this.doc = null;
    console.error(JSON.stringify({ event: 'storage-failure', error: String(error) }));
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      } catch {
        // Already gone.
      }
    }
  }

  private handleMessage(ws: WebSocket, message: string | ArrayBuffer | Uint8Array): void {
    if (this.phase === 'load-failed') {
      this.closeWith(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.phase === 'storage-failed') {
      this.closeWith(ws, CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }
    const doc = this.doc;
    if (doc === null) {
      this.closeWith(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (typeof message === 'string') {
      this.reject(ws, 'text frames are not accepted');
      return;
    }
    const bytes = message instanceof Uint8Array ? message.slice() : new Uint8Array(message);
    const decoded = decodeMessage(bytes.buffer as ArrayBuffer);
    switch (decoded.kind) {
      case 'invalid':
        this.reject(ws, decoded.reason);
        return;
      case 'sync': {
        const decoder = createDecoder(decoded.payload);
        const reply = createEncoder();
        writeVarUint(reply, MESSAGE_SYNC);
        let failed = false;
        // Only SyncStep2 offers are deduplicated: an offer that leaves the
        // state vector where it was adds nothing to the log. SyncStep1 draws
        // a reply from us, and a plain update is trusted as the sender's own
        // work (its deletes must relay even when clocks do not advance).
        const isStep2 = decoded.payload[0] === SYNC_STEP2;
        if (isStep2) this.beginDedup(doc, ws);
        try {
          readSyncMessage(decoder, reply, doc, ws, () => {
            failed = true;
          });
        } finally {
          if (isStep2) this.flushPending(doc);
        }
        if (failed) {
          this.reject(ws, 'invalid yjs update');
          return;
        }
        if (encodedLength(reply) > 1) safeSend(ws, toUint8Array(reply));
        return;
      }
      case 'awareness': {
        // Relayed verbatim to every open socket including the sender; hearing
        // traffic back keeps idle hibernating connections alive.
        for (const other of this.ctx.getWebSockets()) {
          safeSend(other, bytes);
        }
        return;
      }
      case 'query-awareness':
        // Ignored in this story: no awareness state is stored (story 6).
        return;
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    this.closeWith(ws, CLOSE_UNSUPPORTED_DATA, reason);
  }

  private closeWith(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason.slice(0, 120));
    } catch {
      // The socket was already gone.
    }
  }

  private rejectUpgrade(code: number, reason: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.closeWith(server, code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }
}
