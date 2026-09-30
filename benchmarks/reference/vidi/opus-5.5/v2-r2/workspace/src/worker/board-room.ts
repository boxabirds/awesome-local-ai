import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { Env } from './index';
import { type RoomEvent, type RoomLifecycleState, nextRoomState } from './room-state';
import { handleRoomTestHook, isTestHookPath } from './test-hooks';

/** Close code for a room unloaded on purpose (test hook): clients reconnect. */
const CLOSE_SERVICE_RESTART = 1012;

function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

interface SocketAttachment {
  id: string;
}

function socketId(ws: WebSocket): string | undefined {
  return (ws.deserializeAttachment() as SocketAttachment | null)?.id;
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

/**
 * One board's room: the board's Y.Doc, loaded from the board's SQLite storage,
 * relaying Yjs sync and awareness messages between every connected WebSocket.
 *
 * Every applied update is stored before it is broadcast; the platform's output
 * gate holds the broadcast until the write is durable, so nobody ever sees a
 * change that is not saved. Sockets use the hibernation API, so an idle board
 * costs no compute; on wake the constructor reloads the doc from storage.
 */
export class BoardRoom extends DurableObject<Env> {
  /** Replaceable by integration tests to inject storage failures. */
  store: BoardStore;
  state: RoomLifecycleState = 'loading';
  /** When the last load attempt failed (ms since epoch). */
  loadFailedAt = 0;
  private doc: Y.Doc | null = null;
  /** Set when an append failed while applying the current message. */
  private appendFailed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => this.load());
  }

  private transition(event: RoomEvent): void {
    this.state = nextRoomState(this.state, event);
  }

  /** Loads the doc from storage; on failure the room refuses to serve an empty board. */
  private load(): void {
    this.state = 'loading';
    this.doc?.destroy();
    this.doc = null;
    const doc = new Y.Doc();
    let result;
    try {
      // Unknown boards load as empty without creating tables (tables come with initialize or the first append).
      result = this.store.load(doc);
    } catch (error) {
      result = { ok: false as const, reason: 'sql-error' as const, error: String(error) };
    }
    if (!result.ok) {
      doc.destroy();
      this.loadFailedAt = Date.now();
      console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
      this.transition({ type: 'load-failed' });
      return;
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(update, origin));
    this.doc = doc;
    this.transition({ type: 'load-succeeded', quarantined: result.quarantined });
  }

  /** Store, then broadcast to every socket except the one the update came from (no echo). */
  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN || this.state !== 'ready') return;
    try {
      this.store.append(update);
    } catch (error) {
      console.error(JSON.stringify({ event: 'board-append-failed', error: String(error) }));
      this.appendFailed = true;
      this.transition({ type: 'append-failed' });
      return;
    }
    this.transition({ type: 'update-stored' });
    const originId = origin instanceof WebSocket ? socketId(origin) : undefined;
    const message = frame(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update));
    for (const ws of this.ctx.getWebSockets()) {
      if (originId === undefined || socketId(ws) !== originId) this.send(ws, message);
    }
  }

  /** After a failed append: nobody keeps an unsaved view; clients reconnect and re-send. */
  private resetAfterStorageFailure(): void {
    this.appendFailed = false;
    this.doc?.destroy();
    this.doc = null;
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
  }

  /** Drops the in-memory doc and every socket, as a restart would (test hook). */
  unload(): void {
    this.doc?.destroy();
    this.doc = null;
    this.state = 'hibernated';
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_SERVICE_RESTART, 'Room unloaded');
  }

  /** The loaded doc, loading it first when the room was unloaded (test hook). */
  loadedDoc(): Y.Doc | null {
    if (!this.doc && this.state !== 'load-failed') this.load();
    return this.doc;
  }

  /** RPC (share.board_api): creates the board once; 'exists' if it was already created. */
  async initialize(): Promise<'created' | 'exists'> {
    return this.store.initialize();
  }

  /** RPC (share.board_api): read-only existence check; writes nothing for unknown boards. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /**
   * Whether a connection may be accepted. A storage error while checking is not
   * "not found": the load path then reports the board as unloadable (4500).
   */
  private existsForConnection(): boolean {
    try {
      return this.store.existsReadOnly();
    } catch {
      return true;
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.env.TEST_HOOKS === '1' && isTestHookPath(url.pathname)) {
      const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
      return handleRoomTestHook(url.pathname, {
        storage: this.ctx.storage,
        store: this.store,
        loadedDoc: () => this.loadedDoc(),
        unload: () => this.unload(),
      }, body);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // Rooms are never created implicitly by connecting (share.not_found).
    if (!this.existsForConnection()) return new Response('Board not found', { status: 404 });
    if (this.state !== 'ready') {
      const before = this.state;
      this.transition({ type: 'connection', msSinceLoadFailure: Date.now() - this.loadFailedAt });
      if (before !== 'loading' && this.state === 'loading') this.load();
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID() } satisfies SocketAttachment);
    const doc = this.doc;
    if (this.state !== 'ready' || !doc) {
      closeQuietly(server, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return new Response(null, { status: 101, webSocket: client });
    }
    // SyncStep1 on every (re)connection: the client answers with everything the room lacks,
    // which also re-sends changes whose saving failed earlier.
    this.send(server, frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, doc)));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (this.state === 'load-failed') {
      closeQuietly(ws, CLOSE_BOARD_LOAD_FAILED, "Board couldn't be loaded");
      return;
    }
    const doc = this.doc;
    if (this.state !== 'ready' || !doc) {
      closeQuietly(ws, CLOSE_STORAGE_FAILURE, 'Storage failure');
      return;
    }
    const decoded = decodeMessage(data);
    switch (decoded.kind) {
      case 'sync': {
        let reply: Uint8Array;
        try {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const before = encoding.length(encoder);
          syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, doc, ws, (error) => {
            throw error;
          });
          reply = encoding.length(encoder) > before ? encoding.toUint8Array(encoder) : new Uint8Array();
        } catch {
          if (this.appendFailed) this.resetAfterStorageFailure();
          else closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
          return;
        }
        if (this.appendFailed) {
          this.resetAfterStorageFailure();
          return;
        }
        if (reply.length > 0) this.send(ws, reply);
        this.compactIfNeeded(doc);
        return;
      }
      case 'awareness': {
        // Relayed verbatim to everyone, sender included: idle y-websocket clients need traffic.
        const message = frame(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, decoded.payload));
        for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
        return;
      }
      case 'query-awareness':
        // No awareness state is kept (presence is story 6).
        return;
      case 'invalid':
        closeQuietly(ws, CLOSE_UNSUPPORTED_DATA, 'Unsupported data');
        return;
    }
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    // Complete the closing handshake (1005/1006 cannot be sent back).
    closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  override webSocketError(_ws: WebSocket, _error: unknown): void {
    // The runtime drops the socket; ctx.getWebSockets() no longer returns it.
  }

  private compactIfNeeded(doc: Y.Doc): void {
    this.transition({ type: 'compaction-started' });
    const compacted = this.store.compactIfNeeded(doc);
    this.transition({ type: compacted ? 'compaction-finished' : 'compaction-rolled-back' });
  }

  /** A socket whose send throws is closing; the runtime removes it. */
  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      // closing or closed
    }
  }
}
