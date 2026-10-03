import { DurableObject, DurableObjectState } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, MESSAGE_AWARENESS } from '../shared/protocol';

/**
 * BoardRoom Durable Object: holds a Y.Doc in memory and relays Yjs sync and
 * awareness messages over WebSockets to all connected clients on a board.
 *
 * Non-hibernating: uses `server.accept()` (not `ctx.acceptWebSocket`) because
 * the doc is memory-only in this story. An open, accepted socket keeps the
 * object alive.
 */
export class BoardRoom extends DurableObject {
  state: DurableObjectState;
  private doc: Y.Doc | null = null;
  private sockets = new Set<WorkersWebSocket>();

  constructor(state: DurableObjectState, env: unknown) {
    super(state, env);
    this.state = state;
  }

  private getDoc(): Y.Doc {
    if (this.doc === null) {
      this.doc = new Y.Doc();
      // Listen for document updates and broadcast to all sockets except the origin
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
    }
    return this.doc;
  }

  /** Broadcast an update to all open sockets except the origin socket. */
  private broadcast(update: Uint8Array, except: unknown): void {
    // Frame as y-websocket sync message: [MESSAGE_SYNC=0, ...y-protocols update]
    // y-protocols update = [messageYjsUpdate=2, ...update bytes]
    const encoder = createEncoder();
    sync.writeUpdate(encoder, update);
    const payload = toUint8Array(encoder);

    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_SYNC;
    frame.set(payload, 1);

    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          this.sockets.delete(ws);
        }
      }
    }
  }

  /** Relay awareness bytes verbatim to all open sockets including the sender. */
  private relayAwareness(payload: Uint8Array): void {
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_AWARENESS;
    frame.set(payload, 1);

    for (const ws of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          this.sockets.delete(ws);
        }
      }
    }
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const ws = pair[1];
    ws.accept();
    this.sockets.add(ws);

    const doc = this.getDoc();

    // On accept, send SyncStep1 (server state vector) to the new socket
    // Frame: [MESSAGE_SYNC=0, messageYjsSyncStep1=0, state vector]
    const step1Encoder = createEncoder();
    sync.writeSyncStep1(step1Encoder, doc);
    const step1Payload = toUint8Array(step1Encoder);
    const step1Frame = new Uint8Array(1 + step1Payload.length);
    step1Frame[0] = MESSAGE_SYNC;
    step1Frame.set(step1Payload, 1);
    ws.send(step1Frame);

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event: { data: unknown }) => {
      this.handleMessage(ws, event.data);
    };

    ws.onclose = () => {
      this.sockets.delete(ws);
    };

    ws.onerror = () => {
      this.sockets.delete(ws);
    };

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(ws: WorkersWebSocket, data: unknown): void {
    const doc = this.getDoc();

    let decoded;
    try {
      decoded = decodeMessage(data as ArrayBuffer | string);
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA, 'decode error');
      return;
    }

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA, decoded.reason);
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        const decoder = createDecoder(decoded.payload);
        const replyEncoder = createEncoder();
        sync.readSyncMessage(decoder, replyEncoder, doc, ws, (_error: Error) => {
          ws.close(CLOSE_UNSUPPORTED_DATA, 'sync decode/apply error');
        });
        const reply = toUint8Array(replyEncoder);
        if (reply.length > 0) {
          const frame = new Uint8Array(1 + reply.length);
          frame[0] = MESSAGE_SYNC;
          frame.set(reply, 1);
          ws.send(frame);
        }
      } catch {
        ws.close(CLOSE_UNSUPPORTED_DATA, 'sync decode/apply error');
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
      return;
    }

    // query-awareness: ignored in this story (no stored awareness)
  }
}
