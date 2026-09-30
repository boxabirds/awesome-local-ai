// A test participant: a real Y.Doc speaking y-protocols over a real WebSocket
// obtained from the Worker's upgrade response — the same framing as y-websocket.
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { vi } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

export const ORIGIN = 'http://vidi6.test';

export interface Received {
  type: number;
  /** Sync sub-type (step1 / step2 / update) for sync messages. */
  syncType?: number;
  bytes: Uint8Array;
}

export function syncFrame(write: (e: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function awarenessFrame(body: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
}

export class TestClient {
  readonly received: Received[] = [];
  readonly errors: unknown[] = [];
  closeEvent: { code: number; reason: string } | null = null;
  synced = false;
  /** While holding, local updates are queued instead of sent (simulates "before exchanging"). */
  private held: Uint8Array[] | null = null;

  private constructor(
    readonly ws: WebSocket,
    readonly doc: Y.Doc,
  ) {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const message = syncFrame((e) => syncProtocol.writeUpdate(e, update));
      if (this.held) this.held.push(message);
      else this.send(message);
    });
    ws.addEventListener('message', (event) => this.onMessage(event.data));
    ws.addEventListener('close', (event) => {
      this.closeEvent = { code: event.code, reason: event.reason };
    });
    ws.binaryType = 'arraybuffer';
    ws.accept();
    this.send(syncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
  }

  static async connect(boardId: string, doc: Y.Doc = new Y.Doc()): Promise<TestClient> {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
    if (response.status !== 101 || !response.webSocket) {
      throw new Error(`upgrade failed with ${response.status}`);
    }
    return new TestClient(response.webSocket, doc);
  }

  /** Connects and waits for the room's SyncStep2 (initial state). */
  static async join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
    const client = await TestClient.connect(boardId, doc);
    await client.waitForSync();
    return client;
  }

  send(message: Uint8Array | string): void {
    // Like y-websocket, a closed participant keeps editing its doc locally only.
    if (this.closed) return;
    this.ws.send(message);
  }

  hold(): void {
    this.held ??= [];
  }

  release(): void {
    const queued = this.held ?? [];
    this.held = null;
    for (const message of queued) this.send(message);
  }

  get closed(): boolean {
    return this.closeEvent !== null || this.ws.readyState !== WebSocket.OPEN;
  }

  close(): void {
    if (this.closed) return;
    this.ws.close(1000, 'done');
  }

  snapshot() {
    return snapshot(this.doc);
  }

  /** Sync `update` messages received (not step1/step2). */
  updatesReceived(): Received[] {
    return this.received.filter((m) => m.type === MESSAGE_SYNC && m.syncType === syncProtocol.messageYjsUpdate);
  }

  async waitForSync(): Promise<void> {
    await vi.waitFor(() => {
      if (!this.synced) throw new Error('not synced yet');
    });
  }

  private onMessage(data: unknown): void {
    if (typeof data === 'string') {
      this.received.push({ type: -1, bytes: new TextEncoder().encode(data) });
      return;
    }
    const bytes = new Uint8Array(data as ArrayBuffer);
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type !== MESSAGE_SYNC) {
        this.received.push({ type, bytes });
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      this.received.push({ type, syncType, bytes });
      if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
    } catch (error) {
      this.errors.push(error);
    }
  }
}

/** Waits until every client's board snapshot equals the first one's. */
export async function waitForConvergence(clients: readonly TestClient[], timeout = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      const [first, ...rest] = clients.map((c) => JSON.stringify(c.snapshot()));
      for (const other of rest) if (other !== first) throw new Error('not converged');
    },
    { timeout, interval: 10 },
  );
}

/** Lets in-flight messages settle (for asserting that something did NOT arrive). */
export function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
