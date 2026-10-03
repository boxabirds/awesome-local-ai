// BoardRoom Durable Object (persist.room): one Y.Doc per board that is
// persisted to Durable Object storage (SQLite + KV), merged, and relayed
// between all sockets on the board.
//
// Design notes (see spec design.md):
// - Hibernation API: `ctx.acceptWebSocket(server)` allows the object to
//   hibernate when idle. On wake, the constructor reloads the doc from storage.
// - Write before broadcast: every applied update is appended to storage
//   before any broadcast. Durable Object output gates hold sends until the
//   write is durable (platform guarantee).
// - Load failure: if the snapshot is unreadable, the room enters LoadFailed
//   state and closes new connections with CLOSE_BOARD_LOAD_FAILED (4500).
// - Storage failure: if an insert throws, the room resets (closes all sockets
//   with 1011, discards doc). Reconnecting clients re-send their state.
// - Awareness is relayed verbatim to ALL sockets including the sender.
// - Malformed traffic closes only the offending socket with 1003.

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { createEncoder, length, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import type { Env } from './index';

export class BoardRoom extends DurableObject<Env> {
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private state: 'ready' | 'load-failed' | 'storage-failed' = 'ready';
  private lastLoadFailedAt: number = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    // Load the document on construct/wake.
    ctx.blockConcurrencyWhile(async () => {
      await this.loadDoc();
    });
  }

  private async loadDoc(): Promise<void> {
    this.store.migrate();
    const doc = new Y.Doc();
    const result = await this.store.load(doc);
    if (result.ok) {
      this.doc = doc;
      this.state = 'ready';
      // Set up the update handler for store-before-broadcast.
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.handleDocUpdate(update, origin);
      });
    } else {
      this.doc = null;
      this.state = 'load-failed';
      this.lastLoadFailedAt = Date.now();
      console.error(
        JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }),
      );
    }
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: the object can hibernate with open sockets.
    this.ctx.acceptWebSocket(server);

    // If load failed, check if we should retry.
    if (this.state === 'load-failed') {
      const now = Date.now();
      if (now - this.lastLoadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Retry load.
        this.lastLoadFailedAt = now;
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.loadDoc();
        });
        if (this.state === 'ready' && this.doc) {
          // Load succeeded — proceed normally.
          return this.handleReadyConnection(server, client);
        }
      }
      // Still failing: close with 4500.
      server.close(CLOSE_BOARD_LOAD_FAILED, 'Board load failed');
      return new Response(null, { status: 101, webSocket: client });
    }

    // If storage failed, try to reload.
    if (this.state === 'storage-failed') {
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.loadDoc();
      });
      if (this.state === 'ready' && this.doc) {
        return this.handleReadyConnection(server, client);
      }
      if (this.state === 'load-failed') {
        server.close(CLOSE_BOARD_LOAD_FAILED, 'Board load failed');
        return new Response(null, { status: 101, webSocket: client });
      }
      server.close(CLOSE_STORAGE_FAILURE, 'Storage failure');
      return new Response(null, { status: 101, webSocket: client });
    }

    return this.handleReadyConnection(server, client);
  }

  private handleReadyConnection(server: WebSocket, client: WebSocket): Promise<Response> {
    const doc = this.doc!;

    // Initial SyncStep1.
    const step1 = createEncoder();
    writeVarUint(step1, MESSAGE_SYNC);
    writeSyncStep1(step1, doc);
    this.safeSend(server, toUint8Array(step1));

    return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    // Check state first.
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    if (!this.doc) return;

    const decoded = decodeMessage(msg);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'awareness') {
      // Relay verbatim to every open socket, including the sender.
      for (const s of this.ctx.getWebSockets()) {
        this.safeSend(s, decoded.payload);
      }
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return;
    }

    // kind === 'sync'
    const doc = this.doc;
    const decoder = createDecoder(decoded.payload);
    readVarUint(decoder); // Skip MESSAGE_SYNC byte.
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    let invalid = false;
    try {
      readSyncMessage(decoder, encoder, doc, ws, () => {
        invalid = true;
      });
    } catch {
      invalid = true;
    }
    if (invalid) {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (length(encoder) > 1) {
      this.safeSend(ws, toUint8Array(encoder));
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Sockets are managed by the platform via ctx.getWebSockets().
    // Nothing to clean up here.
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // Nothing to do.
  }

  /**
   * Handle a document update: store before broadcast.
   * - Skip updates from LOAD_ORIGIN (applied during load).
   - On store failure: reset room (close all sockets with 1011, discard doc).
   - On success: broadcast to all sockets except origin, then compact if needed.
   */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;

    // Store before broadcast.
    try {
      // append is async but we fire-and-forget here because the Durable Object
      // output gate holds sends until pending storage writes are confirmed.
      // We use a synchronous wrapper: the KV put + SQL insert happen in sequence.
      // Since we can't await in a sync handler, we use the synchronous SQL path
      // and accept that the KV write is microtask-async (the output gate still
      // holds the broadcast until the DO's event loop completes the write).
      this.appendAndBroadcast(update, origin);
    } catch (e) {
      // Storage failed: reset the room.
      this.state = 'storage-failed';
      this.doc = null;
      for (const ws of this.ctx.getWebSockets()) {
        ws.close(CLOSE_STORAGE_FAILURE);
      }
      console.error(
        JSON.stringify({ event: 'storage-failed', error: String(e) }),
      );
    }
  }

  private appendAndBroadcast(update: Uint8Array, origin: unknown): void {
    // We need to store the update. Since append is async (KV write), we use
    // a synchronous approach: write to KV synchronously is not possible, so
    // we use a different strategy.
    //
    // In the Durable Object model, the output gate holds outgoing messages
    // until all pending storage operations complete. So we can:
    // 1. Initiate the async append (KV write + SQL insert)
    // 2. Broadcast immediately (the output gate will hold it until the write completes)
    //
    // This is safe because the platform guarantees that no message is delivered
    // to other clients until all pending storage writes in this DO are confirmed.

    // Fire the async append. If it throws, the catch in handleDocUpdate handles it.
    // We use .catch to handle async errors since we can't try/catch an async call
    // in a sync context.
    this.store.append(update).catch((e) => {
      this.state = 'storage-failed';
      this.doc = null;
      for (const ws of this.ctx.getWebSockets()) {
        ws.close(CLOSE_STORAGE_FAILURE);
      }
      console.error(
        JSON.stringify({ event: 'storage-failed', error: String(e) }),
      );
      return;
    });

    // Broadcast to all sockets except origin.
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_SYNC);
    writeUpdate(frame, update);
    const bytes = toUint8Array(frame);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      this.safeSend(socket, bytes);
    }

    // Compact if needed (async, fire-and-forget).
    if (this.doc) {
      this.store.compactIfNeeded(this.doc).catch(() => {
        // Compaction failure is non-fatal; logged inside compactIfNeeded.
      });
    }
  }

  /** Send, ignoring errors (socket may already be closed). */
  private safeSend(socket: WebSocket, data: Uint8Array): void {
    try {
      socket.send(data);
    } catch {
      // Socket already closed; nothing to do.
    }
  }
}
