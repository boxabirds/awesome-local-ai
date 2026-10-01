import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../../src/shared/protocol';

export const ORIGIN = 'http://example.com';

export function roomUrl(boardId: string): string {
  return `${ORIGIN}/api/rooms/${boardId}`;
}

export async function eventually(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A real Y.Doc speaking y-protocols over a real WebSocket, same framing as y-websocket. */
export class WsClient {
  readonly doc: Y.Doc;
  readonly log: { type: number; syncType?: number; bytes: Uint8Array }[] = [];
  closeCode: number | null = null;
  synced = false;
  private constructor(readonly ws: WebSocket, doc: Y.Doc) {
    this.doc = doc;
    ws.addEventListener('message', (e) => this.onMessage(e.data as ArrayBuffer));
    ws.addEventListener('close', (e) => { this.closeCode = e.code; });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this || this.ws.readyState !== WebSocket.OPEN) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      ws.send(encoding.toUint8Array(enc));
    });
  }

  static async connect(boardId: string, doc = new Y.Doc()): Promise<WsClient> {
    const res = await SELF.fetch(roomUrl(boardId), { headers: { Upgrade: 'websocket' } });
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade refused: ${res.status}`);
    res.webSocket.accept();
    res.webSocket.binaryType = 'arraybuffer';
    const client = new WsClient(res.webSocket, doc);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    res.webSocket.send(encoding.toUint8Array(enc));
    return client;
  }

  private onMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);
    if (type === MESSAGE_AWARENESS) {
      this.log.push({ type, bytes });
      return;
    }
    const syncType = decoding.peekVarUint(dec);
    this.log.push({ type, syncType, bytes });
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(dec, reply, this.doc, this);
    if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply));
    if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true;
  }

  async waitForSync(): Promise<void> {
    await eventually(() => this.synced);
  }

  /** Update messages (not handshake) received so far. */
  get updatesReceived(): number {
    return this.log.filter((m) => m.type === MESSAGE_SYNC && m.syncType === syncProtocol.messageYjsUpdate).length;
  }

  get awarenessReceived() {
    return this.log.filter((m) => m.type === MESSAGE_AWARENESS).map((m) => m.bytes);
  }

  snapshot() {
    return snapshot(this.doc);
  }

  sendRaw(data: string | Uint8Array): void {
    this.ws.send(data);
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
  }
}

export async function connectAll(boardId: string, n: number): Promise<WsClient[]> {
  const clients: WsClient[] = [];
  for (let i = 0; i < n; i++) {
    const c = await WsClient.connect(boardId);
    await c.waitForSync();
    clients.push(c);
  }
  return clients;
}

export async function converged(clients: WsClient[]): Promise<void> {
  await eventually(() => {
    const first = JSON.stringify(clients[0].snapshot());
    return clients.every((c) => JSON.stringify(c.snapshot()) === first);
  }, 10_000);
}
