/**
 * BoardRoom Durable Object: persistent, hibernating board room.
 *
 * - Loads the Y.Doc from SQLite storage on construct (inside blockConcurrencyWhile).
 * - Uses the hibernation WebSocket API (ctx.acceptWebSocket, ctx.getWebSockets).
 * - Stores every update before broadcasting (write-before-broadcast).
 * - LoadFailed rooms close new connections with CLOSE_BOARD_LOAD_FAILED (4500).
 * - Storage failures close all sockets with CLOSE_STORAGE_FAILURE (1011) and discard the doc.
 * - Invalid updates close only the offending socket with CLOSE_UNSUPPORTED_DATA (1003).
 * - Compacts the update log when thresholds are reached.
 */

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import { initDoc } from '../shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

export class BoardRoom extends DurableObject {
  private doc: Y.Doc | null = null;
  private store: BoardStore;
  private state: 'loading' | 'ready' | 'load-failed' | 'storage-failed' = 'loading';
  private lastLoadFailedAt = 0;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);

    ctx.blockConcurrencyWhile(async () => {
      this.loadDoc();
    });
  }

  /**
   * Load the document from storage. Sets state to 'ready' or 'load-failed'.
   */
  private loadDoc(): void {
    try {
      this.store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      const result = this.store.load(doc);
      if (result.ok) {
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          this.broadcastUpdate(update, origin);
        });
        this.doc = doc;
        this.state = 'ready';
      } else {
        this.doc = null;
        this.state = 'load-failed';
        this.lastLoadFailedAt = Date.now();
        console.error(
          JSON.stringify({
            event: 'load-failed',
            reason: result.reason,
            error: result.error,
          }),
        );
      }
    } catch (e) {
      this.doc = null;
      this.state = 'load-failed';
      this.lastLoadFailedAt = Date.now();
      console.error(
        JSON.stringify({
          event: 'load-failed',
          reason: 'sql-error',
          error: String(e),
        }),
      );
    }
  }

  fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // If the room is in load-failed state, check if we should retry
    if (this.state === 'load-failed') {
      const elapsed = Date.now() - this.lastLoadFailedAt;
      if (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS) {
        // Retry loading
        this.loadDoc();
        if (this.state === 'load-failed') {
          // Still failing: accept then close
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
          return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
        }
      } else {
        // Too soon to retry: accept then close
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
      }
    }

    // If the room is in storage-failed state, try to reload
    if (this.state === 'storage-failed') {
      this.state = 'loading';
      this.loadDoc();
      if (this.state !== 'ready') {
        this.ctx.acceptWebSocket(server);
        server.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
        return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
      }
    }

    // Accept the WebSocket (hibernation API)
    this.ctx.acceptWebSocket(server);

    const doc = this.doc;
    if (!doc) {
      server.close(CLOSE_BOARD_LOAD_FAILED, 'no doc');
      return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
    }

    // Send SyncStep1 to the newcomer
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    server.send(encoding.toUint8Array(encoder));

    return Promise.resolve(new Response(null, { status: 101, webSocket: client }));
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    // Check state first
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }
    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    const doc = this.doc;
    if (!doc) {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'no doc');
      return;
    }

    const decoded = decodeMessage(msg);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (decoded.kind === 'query-awareness') {
      return;
    }
    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
      return;
    }

    // Sync message
    const decoder = decoding.createDecoder(decoded.payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      syncProtocol.readSyncMessage(decoder, reply, doc, ws, (error) => {
        throw error;
      });
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'unsupported data');
      return;
    }
    if (encoding.length(reply) > 1) {
      ws.send(encoding.toUint8Array(reply));
    }
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // The hibernation API handles socket cleanup automatically.
  }

  webSocketError(ws: WebSocket, _err: unknown): void {
    // No action needed; the socket will be closed.
  }

  /**
   * Broadcast a document update to every socket except its origin.
   * Called from the doc's 'update' event handler.
   */
  private broadcastUpdate(update: Uint8Array, origin: unknown): void {
    // Skip updates from load
    if (origin === LOAD_ORIGIN) return;

    // Store before broadcast
    try {
      this.store.append(update);
    } catch (e) {
      // Storage failure: close all sockets, discard doc
      this.state = 'storage-failed';
      this.doc = null;
      console.error(
        JSON.stringify({
          event: 'storage-failed',
          error: String(e),
        }),
      );
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.close(CLOSE_STORAGE_FAILURE, 'storage failure');
        } catch {
          // Already closed
        }
      }
      return;
    }

    // Broadcast to all sockets except origin
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(frame);
      } catch {
        // Socket is broken
      }
    }

    // Compact if needed
    if (this.doc) {
      this.store.compactIfNeeded(this.doc);
    }
  }

  /** Relay awareness bytes verbatim to all open sockets, including the sender. */
  private relayAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(frame);
      } catch {
        // Socket is broken
      }
    }
  }
}
