import { SELF, env, runInDurableObject } from 'cloudflare:test';
import type { BoardRoom } from '../../../src/worker/board-room';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../../src/shared/board-model.ts';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../../src/shared/protocol.ts';

/**
 * A WebSocket client that talks to the BoardRoom Durable Object through the `SELF`
 * fetcher of the workers pool. The upgrade is performed with a fetch that carries the
 * `Upgrade: websocket` header; the response's `webSocket` is already open.
 */
export class WsClient {
  doc: Y.Doc;
  ws: WebSocket;
  receivedMessages: Uint8Array[] = [];
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private synced: boolean = false;
  private syncWaiters: (() => void)[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.doc = new Y.Doc();
    initDoc(this.doc);

    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data as ArrayBuffer);
      this.receivedMessages.push(bytes);
      this.processMessage(bytes);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.closeCode = event.code;
      this.closeReason = event.reason;
      // Resolve any pending sync waiters if the socket closes before sync completes
      if (!this.synced) {
        this.syncWaiters.forEach((w) => w());
        this.syncWaiters = [];
      }
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
        // Determine the inner sync message type (0=SyncStep1, 1=SyncStep2, 2=Update)
        const innerDecoder = decoding.createDecoder(bytes);
        innerDecoder.pos = decoder.pos;
        const innerType = decoding.readVarInt(innerDecoder);

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
        // Consider the board synced only once the server's SyncStep2 (full doc state)
        // has been received and applied.
        if (innerType === 1 && !this.synced) {
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

  /** Send a raw framed frame (used to deliver garbage in negative tests). */
  sendRawFrame(bytes: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
    }
  }

  async waitForSync(timeoutMs = 10000): Promise<void> {
    if (this.synced) return;
    if (this.closeCode !== null) return; // socket already closed
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForSync timeout')), timeoutMs);
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Wait until the socket is closed (resolves with the close code). */
  async waitForClose(timeoutMs = 10000): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForClose timeout')), timeoutMs);
      const check = () => {
        if (this.closeCode !== null) {
          clearTimeout(timer);
          resolve(this.closeCode as number);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
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
  // Ensure the board exists (initialize it if not already created)
  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId);
  await runInDurableObject(stub, (room: BoardRoom) => room.initialize());

  const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  });

  const resWithWs = res as Response & { webSocket?: WebSocket };
  if (res.status !== 101 || !resWithWs.webSocket) {
    throw new Error(`WebSocket upgrade failed: status ${res.status}`);
  }

  // In the hibernation API the DO accepts the server socket via ctx.acceptWebSocket;
  // the client socket returned in the Response must be accepted by the caller before use.
  const ws = resWithWs.webSocket as WebSocket & { accept?: () => void };
  if (typeof ws.accept === 'function') {
    ws.accept();
  }

  const client = new WsClient(ws as WebSocket);

  // The socket from the upgrade response is already open.
  client.sendSyncStep1();

  await client.waitForSync();
  return client;
}
