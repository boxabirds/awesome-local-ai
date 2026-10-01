// One board, one instance of this Durable Object: it keeps the board's Y.Doc in
// memory, relays y-websocket frames between every socket on the address, and —
// the whole of story 4 — writes every change to its own SQLite storage before it
// shows that change to anyone else, so a board is still there tomorrow, after
// everyone has left, and after the service restarts with nobody connected.
//
// How each requirement of story 4 lives here:
//   * persist.automatic   — `onDocUpdate` appends the update the moment it is
//                           applied; there is no save action to forget.
//   * persist.seen_is_saved — the row is written in the same turn as the update
//                           and the broadcast goes out after it; the platform
//                           holds outgoing frames until the write is durable, so
//                           nobody can see a change that is not stored.
//   * persist.reopen / persist.restart — `loadFromStorage` runs on construct
//                           (inside `blockConcurrencyWhile`) and on wake, so the
//                           document comes from storage, not from memory.
//   * persist.large_board — every append asks `compactIfNeeded`, which keeps the
//                           replay on the next load to one snapshot plus fewer
//                           than COMPACTION_UPDATE_COUNT rows.
//   * persist.load_failure — a board whose storage cannot be read goes to
//                           `load-failed`, accepts and immediately closes with
//                           CLOSE_BOARD_LOAD_FAILED, and retries at most once per
//                           LOAD_RETRY_MIN_INTERVAL_MS, rather than serving an
//                           empty board.
//   * persist.partial_damage — a damaged log row is quarantined by the store and
//                           the rest of the board loads.
//   * persist.save_failure — an append that throws never broadcasts; every socket
//                           is closed with CLOSE_STORAGE_FAILURE and the document
//                           is discarded, so a reconnecting client re-sends the
//                           change it still holds and only then is it saved.
//
// The socket is accepted through `ctx.acceptWebSocket` (the hibernation API)
// rather than the plain `server.accept()`: the document now survives eviction
// because it lives in storage, so the object may hibernate while its sockets stay
// open, and an idle board costs storage only. `ctx.getWebSockets()` is the source
// of truth for who is connected; story 3's in-memory `Set` is gone.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc } from '../shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { RoomState } from './room-state';
import type { Env } from './index';

const WEBSOCKET_OPEN = 1;

/** A frame for the room's own SyncStep1 (its current state vector). */
function syncStep1Message(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A frame carrying one document update, sent to the other sockets. */
function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export class BoardRoom extends DurableObject<Env> {
  /** This board's storage; created once, because the tables outlive the memory. */
  private readonly store: BoardStore;

  /** The document, or null while loading or after a failure discarded it. */
  private ydoc: Y.Doc | null = null;

  /** Where the room is in its life. It starts loading; only `loadFromStorage`
   *  settles that, and only `loadFromStorage` leaves `loading`. */
  private state: RoomState = 'loading';

  /** When a load last failed, so a retry happens at most once per interval. */
  private loadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Nothing else runs until the first load has settled: the constructor is
    // where a woken or freshly-created room reads its board back.
    ctx.blockConcurrencyWhile(async () => {
      await this.loadFromStorage();
    });
  }

  /** WebSocket upgrade only; the Worker has already validated the board id. */
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').trim().toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade\n', { status: 426 });
    }

    // A room that lost its document (a storage failure reset it, or a load
    // failure whose interval has passed) reads it back before it says anything.
    await this.ensureLoaded();

    const [client, server] = Object.values(new WebSocketPair());
    if (client === undefined || server === undefined) {
      return new Response('WebSocket pair unavailable\n', { status: 500 });
    }
    this.ctx.acceptWebSocket(server);

    if (this.state !== 'ready' || this.ydoc === null) {
      // Still cannot read storage: the connection is a retry attempt that the
      // platform gate let through, and the board is not served empty.
      this.closeSocket(server, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Ask the newcomer what it has. Whoever joins first gives the room its
    // board; whoever joins second is given the board, whole, in one message.
    this.sendTo(server, syncStep1Message(this.ydoc));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** One frame from one socket: read the state first, then the message. */
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      this.closeSocket(ws, CLOSE_BOARD_LOAD_FAILED, 'board could not be loaded');
      return;
    }
    if (this.state === 'storage-failed' || this.ydoc === null) {
      this.closeSocket(ws, CLOSE_STORAGE_FAILURE, 'storage write failed');
      return;
    }

    const decoded: Decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync':
        this.handleSync(ws, decoded.payload);
        return;
      case 'awareness':
        // Relayed verbatim to every socket *including* the sender: awareness
        // traffic is what keeps an idle link from looking dead. Interpreting it
        // (who is here, who left) is story 6.
        this.broadcast(message as ArrayBuffer, null);
        return;
      case 'query-awareness':
        // Ignored: the room keeps no awareness state of its own.
        return;
      case 'invalid':
        this.reject(ws);
        return;
    }
  }

  /** Nothing to do when a socket goes away: `ctx.getWebSockets()` drops it. */
  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}

  /** Nothing to do when a socket errors: `ctx.getWebSockets()` drops it. */
  webSocketError(_ws: WebSocket, _error: unknown): void {}

  // --- loading ---------------------------------------------------------------

  /** Bring the document up to date with storage, if it is not.
   *
   * A storage-failed room reloads on the next connection; a load-failed room is
   * allowed to try again only once LOAD_RETRY_MIN_INTERVAL_MS has passed, so a
   * client that keeps reconnecting does not hammer a storage that is down. */
  private async ensureLoaded(): Promise<void> {
    if (this.state === 'storage-failed') {
      await this.loadFromStorage();
      return;
    }
    // The object woke without a document in memory (it was evicted, or its
    // document was discarded); the board is still in SQLite, so read it back.
    if (this.ydoc === null && this.state !== 'load-failed') {
      await this.loadFromStorage();
      return;
    }
    if (this.state === 'load-failed' && Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
      await this.loadFromStorage();
    }
  }

  /** Read this board's storage into a fresh document, and settle the state. */
  private async loadFromStorage(): Promise<void> {
    const doc = new Y.Doc();
    // The schema marker's own update is written before the broadcast-and-store
    // handler exists, so an empty board never gains a log row just for existing.
    initDoc(doc);
    this.store.migrate();
    doc.on('update', this.onDocUpdate);

    const result = this.store.load(doc);
    if (result.ok) {
      this.ydoc = doc;
      this.state = 'ready';
      if (result.quarantined > 0) {
        console.error(`vidi6: board opened with ${result.quarantined} damaged update(s) set aside`);
      }
      return;
    }
    doc.destroy();
    this.ydoc = null;
    this.state = 'load-failed';
    this.loadFailedAt = Date.now();
    console.error(`vidi6: board could not be loaded (${result.reason}): ${result.error}`);
  }

  // --- the update path ---------------------------------------------------------

  /** What the document does with an update: store it, then show it.
   *
   * The order is the whole of the durability promise. An update that the store
   * refuses is never broadcast — nobody is ever shown a change that is not saved
   * (persist.seen_is_saved, persist.save_failure) — and the room resets so the
   * change is retried from the page that still holds it. */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // An update the load applied is not the board changing, and an update whose
    // origin is this very store round-trip must not be written back to it.
    if (origin === LOAD_ORIGIN) return;
    if (this.state !== 'ready' || this.ydoc === null) return;

    try {
      this.store.append(update);
    } catch (error) {
      this.resetStorageFailed(error);
      return;
    }

    this.broadcast(updateMessage(update), origin);
    try {
      this.store.compactIfNeeded(this.ydoc);
    } catch (error) {
      // `compactIfNeeded` never throws by contract; a surprise here must not be
      // the thing that stops the board working.
      console.error('vidi6: compaction reported an unexpected error', error);
    }
  };

  /** A write failed: the change is gone, so the document is discarded and every
   *  socket is closed. The next connection reloads from storage, and each client
   *  re-sends through the sync handshake whatever the room is missing. */
  private resetStorageFailed(error: unknown): void {
    const doc = this.ydoc;
    this.ydoc = null;
    this.state = 'storage-failed';
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_STORAGE_FAILURE, 'storage write failed');
    }
    if (doc !== null) doc.destroy();
    console.error('vidi6: storage write failed, board reset for its clients to resend', error);
  }

  // --- sync and relaying -------------------------------------------------------

  /** Answer a sync message; a Yjs update the document rejects closes one socket. */
  private handleSync(socket: WebSocket, payload: Uint8Array): void {
    const doc = this.ydoc;
    if (doc === null) {
      this.reject(socket);
      return;
    }
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let rejected: Error | null = null;
    // Yjs reports a broken update through a callback rather than throwing, so the
    // room cannot use `readSyncMessage`, which swallows it and carries on: a
    // client that sends nonsense would keep sending it.
    const noteRejection = (error: unknown): void => {
      rejected = error instanceof Error ? error : new Error(String(error));
    };
    try {
      const syncType = decoding.readVarUint(decoder);
      switch (syncType) {
        case syncProtocol.messageYjsSyncStep1:
          syncProtocol.readSyncStep1(decoder, encoder, doc);
          break;
        case syncProtocol.messageYjsSyncStep2:
          syncProtocol.readSyncStep2(decoder, doc, socket, noteRejection);
          break;
        case syncProtocol.messageYjsUpdate:
          syncProtocol.readUpdate(decoder, doc, socket, noteRejection);
          break;
        default:
          throw new Error(`unknown sync message type ${syncType}`);
      }
    } catch {
      rejected ??= new Error('undecodable sync message');
    }
    if (rejected !== null) {
      // Undecodable or rejected update: only this socket is closed; the document
      // is untouched (never stored) and everyone else keeps working.
      this.reject(socket);
      return;
    }
    if (encoding.length(encoder) > 1) {
      this.sendTo(socket, encoding.toUint8Array(encoder));
    }
  }

  /** Send to every open socket except the one the change came from. */
  private broadcast(data: Uint8Array | ArrayBuffer, except: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      if (socket.readyState !== WEBSOCKET_OPEN) continue;
      this.sendTo(socket, data);
    }
  }

  /** A socket that will not take the bytes is left for the runtime to drop. */
  private sendTo(socket: WebSocket, data: Uint8Array | ArrayBuffer): void {
    try {
      socket.send(data);
    } catch {
      /* the runtime has already taken it out of getWebSockets() */
    }
  }

  /** Close exactly the socket that sent something unusable. */
  private reject(socket: WebSocket): void {
    this.closeSocket(socket, CLOSE_UNSUPPORTED_DATA, 'unsupported message');
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      /* already gone */
    }
  }

  // --- test-only hooks (compiled out of the Worker when TEST_HOOKS is unset) ---
  // They let an end-to-end test break and mend a saved board on demand, which no
  // real disk failure can be timed to do. See src/worker/test-hooks.ts.

  /** Fold the log into a snapshot regardless of thresholds, so a short board can
   *  still be put into the snapshotted state a load-failure test needs. */
  testForceCompaction(): boolean {
    return this.ydoc !== null && this.store.compactNow(this.ydoc);
  }

  /** Overwrite snapshot chunk 0 with bytes that cannot be read, discarding the
   *  in-memory document so the next connection reads the damaged storage. The
   *  original chunk is kept for `testRepairSnapshot`. */
  testCorruptSnapshot(): boolean {
    try {
      if (this.ydoc !== null) this.store.compactNow(this.ydoc);
      const original = this.store.testReadChunk(0);
      if (original === null) return false;
      this.store.testSaveChunk(0, original);
      this.store.testWriteChunk(0, unreadableBytes());
    } catch (error) {
      console.error('vidi6: the corruption hook could not run', error);
      return false;
    }
    // The board a client now opens is the board on disk, not the one in memory.
    // Dropping the document and going to load-failed is what makes the next
    // connection read the damaged storage, close with 4500 and say so — rather
    // than quietly serve the board this room still happens to hold in memory.
    const doc = this.ydoc;
    this.ydoc = null;
    this.state = 'load-failed';
    this.loadFailedAt = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      this.closeSocket(socket, CLOSE_BOARD_LOAD_FAILED, 'board storage was corrupted for a test');
    }
    if (doc !== null) doc.destroy();
    return true;
  }

  /** Put chunk 0 back, so a load-failed room can load again on its next retry. */
  testRepairSnapshot(): boolean {
    const saved = this.store.testRestoreChunk(0);
    if (!saved) return false;
    // The room is sitting in load-failed; let the next connection reload at once
    // rather than waiting out a retry interval the test would otherwise pay.
    if (this.state === 'load-failed') this.loadFailedAt = 0;
    return true;
  }
}

/** A payload no Yjs update is: a varuint that runs past every safe integer,
 *  so applying the snapshot it stands in for throws rather than reading as a
 *  valid (if empty) document. A fixed payload, because "random bytes" only
 *  *usually* fail to decode, and a test that sometimes corrupts is worse than
 *  no test. */
function unreadableBytes(): Uint8Array {
  return new Uint8Array(16).fill(0xff);
}
