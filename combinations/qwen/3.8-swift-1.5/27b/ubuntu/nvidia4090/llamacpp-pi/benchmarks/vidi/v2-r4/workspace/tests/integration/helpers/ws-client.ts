import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../../src/shared/board-model.ts';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../../src/shared/protocol.ts';

const SERVER_PORT = 8891;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

export class WsClient {
  doc: Y.Doc;
  ws: WebSocket;
  receivedMessages: Uint8Array[] = [];
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private synced: boolean = false;
  private syncWaiters: (() => void)[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.doc = new Y.Doc();
    initDoc(this.doc);

    this.ws.binaryType = 'arraybuffer';

    // Set up message handler immediately
    this.ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(new Uint8Array(data as ArrayBuffer));
      this.receivedMessages.push(bytes);
      this.processMessage(bytes);
    };

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        this.sendUpdate(update);
      }
    };
    this.doc.on('update', this.updateHandler);
  }

  private processMessage(bytes: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarInt(decoder);

      if (type === MESSAGE_SYNC) {
        const responseEncoder = encoding.createEncoder();
        sync.readSyncMessage(decoder, responseEncoder, this.doc, this);
        const response = encoding.toUint8Array(responseEncoder);
        if (response.length > 0) {
          const framedEncoder = encoding.createEncoder();
          encoding.writeVarInt(framedEncoder, MESSAGE_SYNC);
          encoding.writeUint8Array(framedEncoder, response);
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(encoding.toUint8Array(framedEncoder));
          }
        }
        if (!this.synced) {
          this.synced = true;
          this.syncWaiters.forEach((w) => w());
          this.syncWaiters = [];
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    sync.writeSyncStep1(encoder, this.doc);
    const framedEncoder = encoding.createEncoder();
    encoding.writeVarInt(framedEncoder, MESSAGE_SYNC);
    encoding.writeUint8Array(framedEncoder, encoding.toUint8Array(encoder));
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encoding.toUint8Array(framedEncoder));
    }
  }

  private sendUpdate(update: Uint8Array): void {
    const syncEncoder = encoding.createEncoder();
    sync.writeUpdate(syncEncoder, update);
    const framedEncoder = encoding.createEncoder();
    encoding.writeVarInt(framedEncoder, MESSAGE_SYNC);
    encoding.writeUint8Array(framedEncoder, encoding.toUint8Array(syncEncoder));
    const msg = encoding.toUint8Array(framedEncoder);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  sendAwareness(bytes: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarInt(encoder, MESSAGE_AWARENESS);
    encoding.writeUint8Array(encoder, bytes);
    const msg = encoding.toUint8Array(encoder);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  async waitForSync(timeoutMs = 10000): Promise<void> {
    if (this.synced) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForSync timeout')), timeoutMs);
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  getSnapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  getNoteCount(): number {
    return this.doc.getMap('objects').size;
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  destroy(): void {
    if (this.updateHandler) {
      this.doc.off('update', this.updateHandler);
    }
    this.close();
  }
}

export async function connectToBoard(boardId: string): Promise<WsClient> {
  const ws = new WebSocket(`${WS_URL}/api/rooms/${boardId}`);

  // Create the client BEFORE waiting for open, so onmessage is set up in time
  const client = new WsClient(ws);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connection error'));
    };
  });

  // Send our state vector to the server so it can send us its state
  client.sendSyncStep1();

  await client.waitForSync();
  return client;
}
