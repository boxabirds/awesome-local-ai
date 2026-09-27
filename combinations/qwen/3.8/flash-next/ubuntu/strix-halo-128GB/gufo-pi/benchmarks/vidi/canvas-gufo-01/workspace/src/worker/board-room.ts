// One Durable Object instance per board. Owns the authoritative Y.Doc, the
// SQLite-backed store, and every live WebSocket for that board (story 3), plus
// the story-5 link lifecycle: `initialize()` (create with a created_at marker,
// idempotent) and `exists()` (read-only existence check).

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { DurableObject } from 'cloudflare:workers';
import { BoardStore, LOAD_ORIGIN } from './board-store';
import {
  MESSAGE_SYNC,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  syncStep1Message,
  updateMessage,
} from '../shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';
import type { Env } from './env';

type RoomState = 'ready' | 'load_failed' | 'storage_failed';

interface LiveDoc {
  doc: Y.Doc;
  updateHandler: (update: Uint8Array, origin: unknown) => void;
}

export class BoardRoom extends DurableObject<Env> {
  private store: BoardStore;
  private state: RoomState = 'ready';
  private loadFailedAt = 0;
  private live: LiveDoc | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BoardStore(ctx.storage);
    this.state = 'storage_failed'; // transient until the first load completes
    ctx.blockConcurrencyWhile(async () => {
      await this.loadNow();
    });
  }

  private docOrLoad(): Y.Doc {
    if (!this.live) {
      const doc = new Y.Doc();
      const updateHandler = (update: Uint8Array, origin: unknown): void => {
        this.onLocalDocUpdate(update, origin);
      };
      doc.on('update', updateHandler);
      this.live = { doc, updateHandler };
    }
    return this.live.doc;
  }

  private discardDoc(): void {
    if (this.live) {
      this.live.doc.off('update', this.live.updateHandler);
      this.live = null;
    }
  }

  private async loadNow(): Promise<boolean> {
    this.discardDoc();
    const doc = this.docOrLoad();
    const result = this.store.load(doc);
    if (result.ok) {
      this.state = 'ready';
      return true;
    }
    this.state = 'load_failed';
    this.loadFailedAt = Date.now();
    console.error(JSON.stringify({ event: 'board-load-failed', reason: result.reason, error: result.error }));
    return false;
  }

  private onLocalDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return; // server-applied load never re-appends
    if (this.state !== 'ready') return;
    try {
      this.store.append(update);
    } catch (e) {
      // Story 3 storage-failure path: close every socket, discard the doc; the
      // next connection reloads from storage.
      this.state = 'storage_failed';
      console.error(JSON.stringify({ event: 'storage-failure', error: e instanceof Error ? e.message : String(e) }));
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE_STORAGE_FAILURE);
        } catch {
          /* already closing */
        }
      }
      this.discardDoc();
      return;
    }
    const frame = updateMessage(update);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === origin) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(frame);
      } catch {
        // Socket-level failure: story 3 drops the socket, not the board.
        try {
          ws.close(CLOSE_STORAGE_FAILURE);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      this.store.compactIfNeeded(this.docOrLoad());
    } catch (e) {
      // Compaction failures already rolled back inside the store; never a reason to close sockets.
      console.error(JSON.stringify({ event: 'compaction-error', error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /**
   * Create-once semantics. Returns 'exists' (without touching anything) when
   * the board already has a created_at marker OR any content (legacy boards are
   * never re-initialised). Otherwise writes created_at and returns 'created'.
   */
  async initialize(): Promise<'created' | 'exists'> {
    if (this.state !== 'ready') await this.loadNow();
    if (this.store.existsReadOnly()) return 'exists';
    this.store.markCreatedAtIfAbsent(Date.now());
    return 'created';
  }

  /** Read-only existence check; never creates tables or touches storage. */
  async exists(): Promise<boolean> {
    return this.store.existsReadOnly();
  }

  /** Test-only fixture: seed updates without a created_at marker. */
  async seedLegacy(updatesB64: string[]): Promise<void> {
    this.store.seedLegacyUpdates(updatesB64.map((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));
    this.state = 'storage_failed'; // force reload on next connection
    this.discardDoc();
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade')?.toLowerCase();
    if (upgrade === 'websocket') {
      if (!this.store.existsReadOnly()) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (this.state !== 'ready') {
        const retried = Date.now() - this.loadFailedAt >= LOAD_RETRY_MIN_INTERVAL_MS || this.state === 'storage_failed';
        if (!retried) {
          const pair = new WebSocketPair();
          const client = pair[0];
          const server = pair[1];
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED);
          return new Response(null, { status: 101, webSocket: client });
        }
        const ok = await this.loadNow();
        if (!ok) {
          const pair = new WebSocketPair();
          const client = pair[0];
          const server = pair[1];
          this.ctx.acceptWebSocket(server);
          server.close(CLOSE_BOARD_LOAD_FAILED);
          return new Response(null, { status: 101, webSocket: client });
        }
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      try {
        server.send(syncStep1Message(this.docOrLoad()));
      } catch (e) {
        console.error(JSON.stringify({ event: 'socket-initial-send-failed', error: e instanceof Error ? e.message : String(e) }));
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    // Non-WebSocket requests to a room are not part of the protocol.
    return new Response('upgrade required', { status: 426 });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === 'string') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (this.state === 'load_failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this.state === 'storage_failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }
    const decoded = decodeMessage(message);
    switch (decoded.kind) {
      case 'sync': {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        try {
          syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, this.docOrLoad(), ws);
        } catch (e) {
          // Corrupt sync payload: story 3 closes the offending connection only.
          console.error(JSON.stringify({ event: 'bad-sync-message', error: e instanceof Error ? e.message : String(e) }));
          ws.close(CLOSE_UNSUPPORTED_DATA);
          return;
        }
        const bytes = encoding.toUint8Array(reply);
        if (bytes.length > 1) {
          try {
            ws.send(bytes);
          } catch {
            /* socket already gone */
          }
        }
        return;
      }
      case 'awareness': {
        // Relay the same bytes verbatim to every other open socket. Story 3
        // never persists awareness; story 5 must not change that.
        for (const peer of this.ctx.getWebSockets()) {
          if (peer === ws) continue;
          if (peer.readyState !== WebSocket.OPEN) continue;
          try {
            peer.send(message);
          } catch {
            /* ignore per-socket failures */
          }
        }
        return;
      }
      case 'query-awareness':
        return; // stored awareness: none (story 3)
      case 'invalid':
        ws.close(CLOSE_UNSUPPORTED_DATA);
        return;
    }
  }

  override webSocketClose(): void {
    // Nothing to clean up per-socket beyond the runtime's own bookkeeping.
  }

  override webSocketError(): void {
    // Socket errors are isolated: no storage write, no other socket affected.
  }
}
