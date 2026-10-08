/** BoardRoom Durable Object — in-memory Y.Doc relay for story 3 */

import * as Y from 'yjs';
import { readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  decodeMessage,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '@shared/protocol';

export interface Env {}

export class BoardRoom implements DurableObject {
  private state: DurableObjectState;
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /** Lazy-initialise the Y.Doc on first connection. */
  private getDocument(): Y.Doc {
    if (!this.doc) {
      this.doc = new Y.Doc();
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint8Array(encoder, update);
        const msgBytes = encoding.toUint8Array(encoder);

        for (const ws of this.sockets) {
          if (ws !== origin && ws.readyState === WebSocket.OPEN) {
            try { ws.send(msgBytes); } catch { /* dead socket */ }
          }
        }
        for (const ws of this.sockets) {
          if (ws.readyState !== WebSocket.OPEN) {
            this.sockets.delete(ws);
          }
        }
      });
    }
    return this.doc;
  }

  /** Handle incoming HTTP request — accepts WebSocket via DurableObject API. */
  async fetch(request: Request): Promise<Response | undefined> {
    // Create a WebSocketPair; wrangler/dev will use the server-side pair
    // to complete the upgrade internally
    const pair = new WebSocketPair();
    const [clientWs] = Object.values(pair);

    // Accept into the DO event loop
    await this.state.acceptWebSocket(clientWs);

    // Immediately send SyncStep1 so the client can sync
    const syncEncoder = encoding.createEncoder();
    writeSyncStep1(syncEncoder, this.getDocument());
    clientWs.send(encoding.toUint8Array(syncEncoder));

    // Return undefined — wrangler/dev handles the upgrade internally
    // when no Response body is written
    return undefined;
  }

  // --- WebSocket event handlers ---

  async websocketMessage(
    ws: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN || typeof data === 'string') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    let decoded: ReturnType<typeof decodeMessage>;
    try {
      decoded = decodeMessage(data as ArrayBuffer);
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    switch (decoded.kind) {
      case 'sync': {
        try {
          const encoder = encoding.createEncoder();
          const decoder = decoding.createDecoder(decoded.payload);
          readSyncMessage(decoder, encoder, this.getDocument(), ws);
          const reply = encoding.toUint8Array(encoder);
          if (reply.length > 0) ws.send(reply);
        } catch {
          ws.close(CLOSE_UNSUPPORTED_DATA);
        }
        break;
      }
      case 'awareness': {
        for (const sock of this.sockets) {
          if (sock.readyState === WebSocket.OPEN) {
            try { sock.send(data as ArrayBuffer); } catch { /* dead */ }
          }
        }
        break;
      }
      case 'query-awareness': {
        break;
      }
      case 'invalid': {
        ws.close(CLOSE_UNSUPPORTED_DATA);
        break;
      }
    }
  }

  async websocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.sockets.delete(ws);
  }

  async websocketError(_ws: WebSocket, _error: Error): Promise<void> {
    // Sockets auto-remove via close handler
  }
}
