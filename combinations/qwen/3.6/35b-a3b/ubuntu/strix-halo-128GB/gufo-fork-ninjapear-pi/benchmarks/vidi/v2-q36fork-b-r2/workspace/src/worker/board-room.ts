import * as Y from 'yjs';
import { writeSyncStep1, readSyncMessage } from 'y-protocols/sync';
import type { Encoder } from 'lib0/encoding';
import {
  createEncoder,
  writeVarUint,
  writeVarUint8Array,
  toUint8Array,
} from 'lib0/encoding';
import { createDecoder, readVarUint } from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../shared/protocol';
import { BoardStore, LoadResult } from './board-store';
import { LOAD_ORIGIN, RoomStateInternal, nextRoomState } from '../shared/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

// Key used to identify each socket so broadcasts skip back to sender
const ORIGIN_KEY = '_vidi6_origin_';

/** Create a y-websocket framed message: [type: varint][payload] */
function makeFrame(type: number, payload: Uint8Array): ArrayBuffer {
  const enc = createEncoder();
  writeVarUint(enc, type);
  writeVarUint8Array(enc, payload);
  return toUint8Array(enc).buffer as ArrayBuffer;
}

// In production this is `extends DurableObject` — the CF Workers runtime provides
// the abstract class at runtime. We suppress the TS conflict because @cloudflare/workers-types
// exports both an interface and an abstract class named 'DurableObject';
// our config resolves the abstract class at runtime regardless.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: works at runtime via CF runtime despite dual TS declaration
export class BoardRoom extends DurableObject {
  private _doc: Y.Doc | null = null;
  private _state: RoomStateInternal = 'loading';
  private _loadFailedAt: number = 0;
  private _store: BoardStore | null = null;
  private _stateObj!: DurableObjectState;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(ctx: DurableObjectState, _env: unknown) {
    // Workers runtime calls us with (DurableObjectState, Env)
    super(ctx as any, _env as any);
    this._stateObj = ctx;

    // Start loading inside blockConcurrencyWhile so no incoming messages arrive before load
    this._stateObj.blockConcurrencyWhile(async () => {
      this._store = new BoardStore(this._stateObj.storage);
      this._store.migrate();

      try {
        this._doc = new Y.Doc();
        Y.applyUpdate(this._doc, new Uint8Array(0), LOAD_ORIGIN);

        const result = this._store.load(this._doc);

        if (result.ok) {
          this._setState('load-ok');
          if (result.quarantined > 0) {
            console.error({ msg: 'board-room.quarantined-on-load', quarantined: result.quarantined });
          }
        } else {
          this._setState('load-error');
        }
      } catch (_e: unknown) {
        console.error({ msg: 'board-room.sql-error-during-init', error: _e });
        this._setState('sql-error');
      }

      // Observe doc updates for auto-persist + broadcast
      if (this._doc && this._state === 'ready') {
        this._doc.on('update', (update: Uint8Array, origin: unknown) => {
          this._onDocUpdate(update, origin);
        });
      }
    });
  }

  private _setState(event: string, extra?: unknown): void {
    this._state = nextRoomState(this._state, event, extra as { now: number; failedAt?: number } | undefined);
  }

  private get doc(): Y.Doc {
    if (!this._doc) throw new Error('BoardRoom.doc accessed before load completed');
    return this._doc;
  }

  /** Persist then broadcast an update from the document */
  private _onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    if (this._state !== 'ready') return;

    try {
      this._store!.append(update);
    } catch {
      // Storage failure: close all sockets, discard doc, reset to loading
      console.error({ msg: 'board-room.storage-failed' });
      this._setState('append-failed');

      // Close all connected sockets with 1011
      const socks = this._stateObj.getWebSockets() as WebSocket[];
      for (const ws of socks) {
        try { ws.close(CLOSE_STORAGE_FAILURE); } catch { /* ignore */ }
      }

      // Discard doc — next connection will reload
      this._doc = null;
      this._setState('reset-done');
      return;
    }

    // Broadcast to all other sockets
    const frame = makeFrame(MESSAGE_SYNC, update);
    const originKey = (origin as symbol) || '';
    const socks = this._stateObj.getWebSockets() as WebSocket[];
    for (const ws of socks) {
      const w = ws as unknown as Record<string, unknown>;
      if (w[ORIGIN_KEY] === originKey) continue;
      try { ws.send(frame); } catch { /* dead socket */ }
    }

    // Compaction after successful append
    this._store!.compactIfNeeded(this.doc);
  }

  private sendSyncStep1(ws: WebSocket): void {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeSyncStep1(enc, this.doc);
    ws.send(toUint8Array(enc).buffer as ArrayBuffer);
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const serverWs: WebSocket = pair[0];
    const clientWs: WebSocket = pair[1];
    this._stateObj.acceptWebSocket(serverWs);

    (serverWs as unknown as Record<string, unknown>)[ORIGIN_KEY] = Symbol();

    this.sendSyncStep1(serverWs);

    // Message handler (called both directly and by hibernation API)
    serverWs.addEventListener('message', (event: MessageEvent) => {
      this.handleServerMessage(serverWs, event.data);
    });

    serverWs.addEventListener('close', () => {
      // No cleanup needed — ctx manages the sockets
    });

    serverWs.addEventListener('error', () => {
      // No cleanup needed
    });

    return new Response(null, { status: 101, webSocket: clientWs });
  }

  private handleServerMessage(ws: WebSocket, data: unknown): void {
    // Check room state first — reject if load-failed or storage-failed
    if (this._state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED);
      return;
    }
    if (this._state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE);
      return;
    }

    // Only accept binary frames
    if (!(data instanceof ArrayBuffer)) {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    const decoded = decodeMessage(data);

    switch (decoded.kind) {
      case 'invalid': {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        break;
      }

      case 'sync': {
        try {
          const origin = (ws as unknown as Record<string, unknown>)[ORIGIN_KEY];
          const decoder = createDecoder(decoded.payload);

          while (decoder.pos < decoder.arr.length) {
            const msgType = readVarUint(decoder);
            const replyEnc = createEncoder();

            if (msgType === 0 || msgType === 1) {
              readSyncMessage(decoder, replyEnc, this.doc, origin);
              const replyBuf = toUint8Array(replyEnc);
              if (replyBuf.length > 0) {
                const replyFrame = makeFrame(MESSAGE_SYNC, replyBuf);
                ws.send(replyFrame);
              }
            } else {
              ws.close(CLOSE_UNSUPPORTED_DATA);
              return;
            }
          }
        } catch (e) {
          console.error('Sync error:', e);
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        break;
      }

      case 'awareness': {
        const relayFrame = makeFrame(MESSAGE_AWARENESS, decoded.payload);
        const socks = this._stateObj.getWebSockets() as WebSocket[];
        const originKey = (ws as unknown as Record<string, unknown>)[ORIGIN_KEY];
        for (const s of socks) {
          try { s.send(relayFrame); } catch { /* ignore */ }
        }
        break;
      }

      case 'query-awareness':
        break;
    }
  }

  // Hibernation API handlers (invoked when messages arrive to hibernating sockets)
  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string): void {
    this.handleServerMessage(ws, msg);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    // ctx-managed sockets — no cleanup needed
  }

  webSocketError(ws: WebSocket, err: unknown): void {
    try { ws.close(CLOSE_UNSUPPORTED_DATA); } catch { /* ignore */ }
  }
}
