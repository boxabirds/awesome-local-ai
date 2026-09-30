import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc } from '@shared/board-model';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '@shared/protocol';

/**
 * A test WebSocket client that speaks y-websocket protocol over a real WebSocket,
 * obtained from a SELF.fetch upgrade response.
 *
 * Wire format matches y-websocket:
 * - Sync: [varUint(0)][syncType varUint][sync content]
 * - Awareness: [varUint(1)][varUint8Array(data)]
 */
export class TestSyncClient {
  doc: Y.Doc;
  ws: WebSocket | null = null;
  private receivedMessages: ArrayBuffer[] = [];
  private syncComplete = false;
  private resolveSync: (() => void) | null = null;

  constructor() {
    this.doc = new Y.Doc();
    initDoc(this.doc);
  }

  get synced(): boolean {
    return this.syncComplete;
  }

  get received(): readonly ArrayBuffer[] {
    return this.receivedMessages;
  }

  getReceivedCount(): number {
    return this.receivedMessages.length;
  }

  waitForSync(): Promise<void> {
    if (this.syncComplete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolveSync = resolve;
    });
  }

  connect(ws: WebSocket): void {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') return;
      const buf = data instanceof ArrayBuffer ? data : (data as Uint8Array).buffer as ArrayBuffer;
      this.receivedMessages.push(buf);
      this.handleMessage(new Uint8Array(buf));
    });
    ws.addEventListener('close', () => {
      this.ws = null;
    });

    // Send initial SyncStep1 so server replies with SyncStep2 (full state)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  private handleMessage(bytes: Uint8Array): void {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);

    if (type === MESSAGE_SYNC) {
      const replyEncoder = encoding.createEncoder();
      const msgType = syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, 'remote');

      // If we got SyncStep1, reply with our SyncStep2
      if (msgType === syncProtocol.messageYjsSyncStep1) {
        const outerEncoder = encoding.createEncoder();
        encoding.writeVarUint(outerEncoder, MESSAGE_SYNC);
        // replyEncoder now contains varUint(SyncStep2) + varUint8Array(our update)
        const reply = encoding.toUint8Array(replyEncoder);
        encoding.writeUint8Array(outerEncoder, reply);
        this.ws?.send(encoding.toUint8Array(outerEncoder));
      }

      // Mark synced when we receive SyncStep2
      if (msgType === syncProtocol.messageYjsSyncStep2 && !this.syncComplete) {
        this.syncComplete = true;
        this.resolveSync?.();
      }
    }
  }

  startListening(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.ws?.send(encoding.toUint8Array(encoder));
    });
  }

  sendAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    this.ws?.send(encoding.toUint8Array(encoder));
  }

  sendRaw(data: Uint8Array | string): void {
    this.ws?.send(data);
  }

  async close(): Promise<void> {
    if (this.ws) {
      await new Promise<void>((resolve) => {
        this.ws!.addEventListener('close', () => resolve());
        this.ws!.close();
        setTimeout(resolve, 300);
      });
    }
    this.ws = null;
  }

  getNotes(): Map<string, unknown> {
    const objects = this.doc.getMap<Y.Map<unknown>>('objects');
    const result = new Map<string, unknown>();
    objects.forEach((obj, id) => {
      result.set(id, {
        x: obj.get('x'),
        y: obj.get('y'),
        color: obj.get('color'),
        text: (obj.get('text') as Y.Text)?.toString() ?? '',
        z: obj.get('z'),
      });
    });
    return result;
  }
}

/**
 * Open a WebSocket to the Worker at /api/rooms/:boardId using SELF.fetch
 */
export async function openWebSocket(
  SELF: Fetcher,
  boardId: string,
): Promise<WebSocket> {
  const url = `http://localhost/api/rooms/${boardId}`;
  const req = new Request(url, {
    headers: { Upgrade: 'websocket' },
  });
  const resp = await SELF.fetch(req);
  if (resp.status !== 101) {
    throw new Error(`Expected 101, got ${resp.status}`);
  }
  const ws = resp.webSocket;
  if (!ws) throw new Error('No WebSocket in response');
  ws.accept();
  return ws;
}

/**
 * Create a connected TestSyncClient
 */
export async function createSyncClient(
  SELF: Fetcher,
  boardId: string,
): Promise<TestSyncClient> {
  const client = new TestSyncClient();
  client.startListening();
  const ws = await openWebSocket(SELF, boardId);
  client.connect(ws);
  await client.waitForSync();
  return client;
}
