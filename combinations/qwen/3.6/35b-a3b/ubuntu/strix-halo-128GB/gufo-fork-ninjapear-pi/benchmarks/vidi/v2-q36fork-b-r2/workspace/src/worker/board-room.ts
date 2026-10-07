import * as Y from 'yjs';
import { writeSyncStep1, readSyncMessage, writeSyncStep2 } from 'y-protocols/sync';
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
} from '../shared/protocol';

// Unique symbol used to identify each socket so broadcasts skip back to sender
const ORIGIN_KEY = Symbol('socketOrigin');

interface SocketEntry {
  ws: WebSocket;
}

/** Create a y-websocket framed message: [type: varint][payload] */
function makeFrame(type: number, payload: Uint8Array): ArrayBuffer {
  const enc = createEncoder();
  writeVarUint(enc, type);
  writeVarUint8Array(enc, payload);
  return toUint8Array(enc).buffer as ArrayBuffer;
}

export class BoardRoom {
  private _doc: Y.Doc | null = null;
  private _sockets: Set<SocketEntry> = new Set();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_state: DurableObjectState, _ctx: { storage: unknown }) {}

  /** Lazily-create or reuse the Y.Doc for this room */
  get doc(): Y.Doc {
    if (!this._doc) {
      this._doc = new Y.Doc();
      // Observe updates and broadcast to all other sockets
      this._doc.on('update', (update: Uint8Array, origin: unknown) => {
        const originKey = typeof origin === 'symbol' ? origin : '';
        this.broadcastExcept(originKey, update);
      });
    }
    return this._doc;
  }

  /** Broadcast an update to all sockets except the one identified by `origin` */
  private broadcastExcept(origin: unknown, update: Uint8Array): void {
    const frame = makeFrame(MESSAGE_SYNC, update);
    for (const entry of this._sockets) {
      if ((entry.ws as Record<string, unknown>)[ORIGIN_KEY] === origin) continue;
      try {
        entry.ws.send(frame);
      } catch {
        // Dead socket — will be cleaned up by close/error handler
      }
    }
  }

  private sendSyncStep1(ws: WebSocket): void {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_SYNC);
    writeSyncStep1(enc, this.doc);
    ws.send(toUint8Array(enc).buffer as ArrayBuffer);
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [serverWs, clientWs] = pair;
    serverWs.accept();

    const entry: SocketEntry = { ws: serverWs };
    (serverWs as Record<string, unknown>)[ORIGIN_KEY] = Symbol();
    this._sockets.add(entry);

    // Send SyncStep1 so client starts syncing immediately
    this.sendSyncStep1(serverWs);

    // Handle incoming messages
    serverWs.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;

      // Only accept binary frames
      if (!(data instanceof ArrayBuffer)) {
        serverWs.close(CLOSE_UNSUPPORTED_DATA);
        return;
      }

      const decoded = decodeMessage(data);

      switch (decoded.kind) {
        case 'invalid': {
          serverWs.close(CLOSE_UNSUPPORTED_DATA);
          break;
        }

        case 'sync': {
          try {
            const doc = this.doc;
            const origin = (serverWs as Record<string, unknown>)[ORIGIN_KEY];
            const decoder = createDecoder(decoded.payload);

            // Read all sync messages in the stream
            while (!decoder.finished) {
              const msgType = readVarUint(decoder);
              const replyEnc = createEncoder();

              if (msgType === 0 || msgType === 1) {
                // SYNC_STEP_1 or SYNC_STEP_2
                readSyncMessage(decoder, replyEnc, doc, origin);
                const replyBuf = toUint8Array(replyEnc);
                if (replyBuf.length > 0) {
                  const replyFrame = makeFrame(MESSAGE_SYNC, replyBuf);
                  serverWs.send(replyFrame);
                }
              } else {
                serverWs.close(CLOSE_UNSUPPORTED_DATA);
                return;
              }
            }
          } catch (e) {
            console.error('Sync error:', e);
            serverWs.close(CLOSE_UNSUPPORTED_DATA);
          }
          break;
        }

        case 'awareness': {
          // Relay awareness bytes to ALL connected sockets including sender
          const relayFrame = makeFrame(MESSAGE_AWARENESS, decoded.payload);
          for (const s of this._sockets) {
            try {
              s.ws.send(relayFrame);
            } catch {
              /* ignore */
            }
          }
          break;
        }

        case 'query-awareness':
          // No stored awareness state in this story — ignore
          break;
      }
    });

    // Remove socket on close/error
    const removeSocket = () => {
      this._sockets.delete(entry);
    };
    serverWs.addEventListener('close', removeSocket);
    serverWs.addEventListener('error', removeSocket);

    return new Response(null, { status: 101, webSocket: clientWs });
  }
}
