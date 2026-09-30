import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, MESSAGE_SYNC } from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

function wrapSyncMessage(inner: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_SYNC);
  encoding.writeVarUint8Array(encoder, inner);
  return encoding.toUint8Array(encoder);
}

type RoomState = 'loading' | 'ready' | 'load-failed' | 'storage-failed';

export class BoardRoom extends DurableObject {
  private state: RoomState = 'loading';
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private lastLoadAttempt = 0;

  constructor(ctx: DurableObjectState, _env: unknown) {
    super(ctx, _env as any);
    this.store = new BoardStore(ctx as any);

    ctx.blockConcurrencyWhile(async () => {
      await this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.store.migrate();
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
        const webSockets = this.ctx.getWebSockets();
        for (const ws of webSockets) {
          try { ws.close(CLOSE_STORAGE_FAILURE); } catch {}
        }
        return;
      }

      // Broadcast to all except origin
      const innerEncoder = encoding.createEncoder();
      syncProtocol.writeUpdate(innerEncoder, update);
      const inner = encoding.toUint8Array(innerEncoder);
      const message = wrapSyncMessage(inner);

      const webSockets = this.ctx.getWebSockets();
      for (const ws of webSockets) {
        if (ws === origin) continue;
        try {
          ws.send(message);
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

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const ws = server.accept() as unknown as WebSocket;

    // If load-failed, check if we should retry
    if (this.state === 'load-failed') {
      const now = Date.now();
      if (now - this.lastLoadAttempt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Retry loading
        this.lastLoadAttempt = now;
        this.state = 'loading';
        await this.load();
        const stateAfterLoad = this.state as RoomState;
        if (stateAfterLoad === 'load-failed') {
          ws.close(CLOSE_BOARD_LOAD_FAILED);
          return new Response(null, { status: 101, body: client } as any);
        }
      } else {
        // Too soon to retry
        ws.close(CLOSE_BOARD_LOAD_FAILED);
        return new Response(null, { status: 101, body: client } as any);
      }
    }

    // If storage-failed, reload
    if (this.state === 'storage-failed') {
      this.state = 'loading';
      await this.load();
      const stateAfterReload = this.state as RoomState;
      if (stateAfterReload !== 'ready') {
        ws.close(stateAfterReload === 'load-failed' ? CLOSE_BOARD_LOAD_FAILED : CLOSE_STORAGE_FAILURE);
        return new Response(null, { status: 101, body: client } as any);
      }
    }

    if (this.state !== 'ready' || !this.doc) {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return new Response(null, { status: 101, body: client } as any);
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
          const result = syncProtocol.readSyncMessage(
            decoder,
            replyEncoder,
            doc,
            ws,
          ) as unknown as boolean;
          if (result) {
            const replyInner = encoding.toUint8Array(replyEncoder);
            ws.send(wrapSyncMessage(replyInner));
          }
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        return;
      }

      if (decoded.kind === 'awareness') {
        const fullFrame = event.data as ArrayBuffer;
        const webSockets = this.ctx.getWebSockets();
        for (const otherWs of webSockets) {
          if (otherWs === ws) continue;
          try {
            otherWs.send(fullFrame);
          } catch {}
        }
        return;
      }
    };

    ws.onclose = () => {
      // Hibernation API handles cleanup
    };

    ws.onerror = () => {
      // Hibernation API handles cleanup
    };

    return new Response(null, {
      status: 101,
      // @ts-expect-error Cloudflare Workers extends Response to support WebSocket bodies
      body: client,
    });
  }

  private async corruptSnapshot(): Promise<Response> {
    try {
      const row = (this.ctx as any).sql`SELECT data FROM snapshot_chunks WHERE idx = 0`.one();
      if (!row) {
        return new Response('no snapshot', { status: 404 });
      }
      // Save original for repair
      (this.ctx as any).sql`INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('__original_chunk_0', ${row.data})`;
      // Corrupt it
      const corrupted = new Uint8Array((row.data as Uint8Array).length);
      corrupted.fill(0xFF);
      (this.ctx as any).sql`UPDATE snapshot_chunks SET data = ${corrupted} WHERE idx = 0`;
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
      const original = (this.ctx as any).sql`SELECT value FROM storage_meta WHERE key = '__original_chunk_0'`.one();
      if (!original) {
        return new Response('no saved original', { status: 404 });
      }
      (this.ctx as any).sql`UPDATE snapshot_chunks SET data = ${original.value} WHERE idx = 0`;
      (this.ctx as any).sql`DELETE FROM storage_meta WHERE key = '__original_chunk_0'`;
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
