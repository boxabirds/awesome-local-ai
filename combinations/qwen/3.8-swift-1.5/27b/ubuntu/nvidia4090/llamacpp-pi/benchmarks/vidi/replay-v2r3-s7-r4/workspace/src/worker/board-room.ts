import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, MESSAGE_SYNC } from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { initDoc, createSticky, getStickyText } from '../shared/board-model';

function wrapSyncMessage(inner: Uint8Array): Uint8Array {
  // y-websocket 3.x framing: `[0, <sync message>]` — the sync message is
  // self-delimiting, so there is no inner length prefix.
  const out = new Uint8Array(1 + inner.length);
  out[0] = MESSAGE_SYNC;
  out.set(inner, 1);
  return out;
}

type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject {
  private state: RoomState = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private lastLoadAttempt = 0;
  // Sockets we have upgraded. The hibernation API in this workerd build
  // does not deliver messages to sockets registered via acceptWebSocket()
  // (onmessage never fires), so we track accepted sockets ourselves for
  // broadcast and cleanup.
  private sockets = new Set<WebSocket>();
  private loadInFlight: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, _env: unknown) {
    super(ctx, _env as any);
    const storage = (ctx as unknown as { storage?: { sql?: unknown; transactionSync?: (fn: () => void) => void } }).storage;
    this.store = new BoardStore({
      sql: storage?.sql as never,
      transactionSync: storage?.transactionSync ? storage.transactionSync.bind(storage) : undefined,
    });
    // No load here (story 5): boards are explicit. `fetch` rejects
    // non-existent boards before accepting, and loads lazily on first
    // connection of an existing board.
  }

  /**
   * RPC: initialise a freshly created board (share.board_api).
   * Migrates the schema and sets `created_at` exactly once; a second call
   * on the same object returns 'exists' and never re-initialises (TC-15).
   */
  async initialize(): Promise<'created' | 'exists'> {
    this.store.migrate();
    const createdAt = this.store.getCreatedAt();
    if (createdAt === null) {
      this.store.setCreatedAt(Date.now());
      return 'created';
    }
    return 'exists';
  }

  /**
   * RPC: read-only existence check (share.board_api). True if
   * `created_at` is set, or (legacy) there is any board data.
   */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  private load(): void {
    try {
      const doc = new Y.Doc();
      const result = this.store.load(doc);
      if (result.ok) {
        this.doc = doc;
        this.state = 'ready';
        this.setupUpdateHandler();
      } else {
        this.doc = null;
        this.state = 'load-failed';
        this.lastLoadAttempt = Date.now();
      }
    } catch (err) {
      this.doc = null;
      this.state = 'load-failed';
      this.lastLoadAttempt = Date.now();
    }
  }

  private loadIfNeeded(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'load-failed') {
      const now = Date.now();
      if (now - this.lastLoadAttempt < LOAD_RETRY_MIN_INTERVAL_MS) return Promise.resolve();
      this.lastLoadAttempt = now;
    }
    if (!this.loadInFlight) {
      const p = this.ctx.blockConcurrencyWhile(async () => {
        this.state = 'loading';
        this.load();
      });
      this.loadInFlight = p;
      // Reset after settlement: a stale promise must not pin loadInFlight,
      // or later connections would reuse it and never load again.
      void p.finally(() => {
        this.loadInFlight = null;
      });
    }
    return this.loadInFlight;
  }

  private setupUpdateHandler(): void {
    if (!this.doc) return;
    const doc = this.doc;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Skip updates from loading
      if (origin === LOAD_ORIGIN) return;

      // Store before broadcast
      try {
        this.store.append(update);
      } catch (err) {
        // Storage failure: close all sockets, discard doc
        this.state = 'storage-failed';
        this.doc = null;
        for (const other of this.sockets) {
          try { other.close(CLOSE_STORAGE_FAILURE); } catch {}
        }
        return;
      }

      // Broadcast to all except origin
      const innerEncoder = encoding.createEncoder();
      syncProtocol.writeUpdate(innerEncoder, update);
      const inner = encoding.toUint8Array(innerEncoder);
      const message = wrapSyncMessage(inner);

      // Broadcast to all connected sockets. The origin client receives its
      // own update back; Yjs applies it as a no-op, which is fine.
      for (const other of this.sockets) {
        try {
          other.send(message);
        } catch {}
      }

      // Compact if needed
      this.store.compactIfNeeded(doc);
    });
  }

  async fetch(req: Request): Promise<Response> {
    // Internal test hooks
    if (req.url.includes('__corrupt_snapshot')) {
      return this.corruptSnapshot();
    }
    if (req.url.includes('__repair_snapshot')) {
      return this.repairSnapshot();
    }
    if (req.url.includes('__seed_legacy')) {
      return this.seedLegacy();
    }

    // Unknown boards: 404 before accepting anything (share.not_found).
    // The check only reads; for an unknown id no tables exist and nothing
    // is written, so probing links leaves no storage behind.
    if (!this.store.existsReadOnly()) {
      return new Response('Not Found', { status: 404 });
    }

    // Current platform WebSocket API: pair index 0 is the server socket
    // (accept() returns void), index 1 is handed to the client via the
    // Response's `webSocket` init field (a 101 response carries no body).
    // Test environments without a working non-hibernating WebSocket API
    // (vitest-pool-workers): report 200 to distinguish "exists" from 404;
    // the real platform always upgrades.
    let ws: WebSocket;
    let client: WebSocket;
    try {
      const pair = new WebSocketPair();
      const [server, clientSocket] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      this.sockets.add(server);
      ws = server;
      client = clientSocket;
    } catch {
      return new Response(null, { status: 200 });
    }

    await this.loadIfNeeded();

    if (this.state !== 'ready' || !this.doc) {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return this.upgradeResponse(client);
    }

    const doc = this.doc;

    // Send SyncStep1 to the new client
    const step1Encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1Encoder, doc);
    const step1Inner = encoding.toUint8Array(step1Encoder);
    ws.send(wrapSyncMessage(step1Inner));

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;

      // Check state: if load-failed or storage-failed, close
      if (this.state === 'load-failed') {
        ws.close(CLOSE_BOARD_LOAD_FAILED);
        return;
      }
      if (this.state === 'storage-failed') {
        ws.close(CLOSE_STORAGE_FAILURE);
        return;
      }

      const decoded = decodeMessage(data);

      if (decoded.kind === 'invalid') {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
      }

      if (decoded.kind === 'sync') {
        try {
          const decoder = decoding.createDecoder(decoded.payload);
          const replyEncoder = encoding.createEncoder();
          // y-protocols readSyncMessage writes any reply (e.g. SyncStep2)
          // into the encoder; the return value is the message type, not a
          // "send this" flag. Send whenever a reply was produced.
          syncProtocol.readSyncMessage(decoder, replyEncoder, doc, 'ws-origin');
          const replyInner = encoding.toUint8Array(replyEncoder);
          if (replyInner.length > 0) {
            ws.send(wrapSyncMessage(replyInner));
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        return;
      }

      if (decoded.kind === 'awareness') {
        const fullFrame = event.data as ArrayBuffer;
        for (const otherWs of this.sockets) {
          if (otherWs === ws) continue;
          try {
            otherWs.send(fullFrame);
          } catch {}
        }
        return;
      }
    };

    ws.onclose = () => {
      this.sockets.delete(ws);
    };

    ws.onerror = () => {
      // Hibernation API handles cleanup
    };

    return this.upgradeResponse(client);
  }

  /**
   * 101 upgrade response carrying the client socket. Falls back to a plain
   * 200 in environments where the WebSocket response form is unavailable
   * (vitest-pool-workers).
   */
  private upgradeResponse(client: WebSocket): Response {
    try {
      return new Response(null, { status: 101, webSocket: client });
    } catch {
      return new Response(null, { status: 200 });
    }
  }

  /**
   * Test hook (story 5, TC-31): seed a legacy board — real Yjs updates in
   * the `updates` table but no `created_at`, as boards written before this
   * feature shipped look (share.legacy_boards).
   */
  private async seedLegacy(): Promise<Response> {
    try {
      this.store.migrate();
      if (this.store.getCreatedAt() !== null) {
        return new Response('already initialized', { status: 409 });
      }
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 100, y: 100 }, 'yellow') as string;
      const text = getStickyText(doc, id);
      if (text) text.insert(0, 'Legacy note');
      this.store.append(Y.encodeStateAsUpdate(doc));
      return new Response('seeded', { status: 200 });
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  }

  private async corruptSnapshot(): Promise<Response> {
    try {
      // Ensure the board is loaded (the instance may have hibernated) and
      // force a snapshot to exist so there is something to corrupt.
      if (!this.doc) {
        await this.loadIfNeeded();
      }
      if (!this.doc) {
        return new Response('no board data', { status: 500 });
      }
      this.store.compact(this.doc);
      const chunk0 = this.store.readSnapshotChunk(0);
      if (!chunk0) {
        return new Response('no snapshot', { status: 404 });
      }
      // Save original for repair (dedicated backup chunk index)
      this.store.writeSnapshotChunk(-1, chunk0);
      // Corrupt it
      const corrupted = new Uint8Array(chunk0.length);
      corrupted.fill(0xFF);
      this.store.writeSnapshotChunk(0, corrupted);
      // Force reload to enter load-failed state
      this.state = 'load-failed';
      this.lastLoadAttempt = Date.now();
      this.doc = null;
      return new Response('corrupted', { status: 200 });
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  }

  private async repairSnapshot(): Promise<Response> {
    try {
      const original = this.store.readSnapshotChunk(-1);
      if (!original) {
        return new Response('no saved original', { status: 404 });
      }
      this.store.writeSnapshotChunk(0, original);
      this.store.deleteSnapshotChunk(-1);
      // Reset state to allow reload
      this.state = 'load-failed';
      this.lastLoadAttempt = 0; // Allow immediate retry
      this.doc = null;
      return new Response('repaired', { status: 200 });
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  }
}
