// Integration client: a real Y.Doc speaking y-protocols over a real WebSocket
// obtained from an upgrade through the Worker (same framing as y-websocket).
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  encodeAwarenessFrame,
  encodeSyncFrame,
} from '../../src/shared/protocol';

const REMOTE = Symbol('remote');
const POLL_MS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface Received {
  type: number;
  /** y-protocols sync subtype for MESSAGE_SYNC frames. */
  subtype?: number;
  bytes: Uint8Array;
}

export async function openSocket(boardId: string): Promise<{ status: number; ws: WebSocket | null }> {
  const res = await SELF.fetch(`http://vidi6.test/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (ws) {
    ws.accept();
    ws.binaryType = 'arraybuffer';
  }
  return { status: res.status, ws };
}

export async function waitFor(check: () => boolean, what: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export class TestClient {
  readonly doc: Y.Doc;
  readonly received: Received[] = [];
  closeCode: number | null = null;
  /** Server answered our SyncStep1 with its SyncStep2. */
  synced = false;
  private paused = false;
  private readonly outbox: Uint8Array[] = [];

  private constructor(
    readonly ws: WebSocket,
    doc: Y.Doc,
  ) {
    this.doc = doc;
    ws.addEventListener('message', (e) => this.onMessage(e.data as ArrayBuffer));
    ws.addEventListener('close', (e) => {
      this.closeCode = e.code;
    });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.send(encodeSyncFrame((enc) => syncProtocol.writeUpdate(enc, update)));
    });
    // Like y-websocket: announce our state vector on open.
    this.sendNow(encodeSyncFrame((enc) => syncProtocol.writeSyncStep1(enc, doc)));
  }

  /** Connects and waits for the initial sync. Pass `doc` to reconnect with existing state. */
  static async connect(boardId: string, doc = new Y.Doc()): Promise<TestClient> {
    const { status, ws } = await openSocket(boardId);
    if (status !== 101 || !ws) throw new Error(`upgrade failed: ${status}`);
    const client = new TestClient(ws, doc);
    await client.waitForSync();
    return client;
  }

  waitForSync(): Promise<void> {
    return waitFor(() => this.synced, 'initial sync');
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Document updates received after the initial sync (subtype Update). */
  updateCount(): number {
    return this.received.filter((m) => m.type === MESSAGE_SYNC && m.subtype === syncProtocol.messageYjsUpdate).length;
  }

  /** Holds outgoing updates (simulating edits made "at the same moment" before exchange). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const frame of this.outbox.splice(0)) this.sendNow(frame);
  }

  sendRaw(data: ArrayBuffer | Uint8Array | string): void {
    this.ws.send(data);
  }

  /**
   * Round-trip barrier: sends an awareness frame and waits for the room to relay
   * it back. Anything the room sent us before that (e.g. an echo) has arrived.
   */
  async barrier(): Promise<void> {
    const marker = crypto.getRandomValues(new Uint8Array(8));
    const frame = encodeAwarenessFrame(marker);
    this.sendNow(frame);
    await waitFor(
      () => this.received.some((m) => m.type === MESSAGE_AWARENESS && equalBytes(m.bytes, frame)),
      'awareness barrier',
    );
  }

  close(): void {
    try {
      this.ws.close(1000, 'done');
    } catch {
      // Already closed.
    }
  }

  private send(frame: Uint8Array): void {
    if (this.paused) this.outbox.push(frame);
    else this.sendNow(frame);
  }

  private sendNow(frame: Uint8Array): void {
    if (this.closeCode === null) this.ws.send(frame);
  }

  private onMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    const entry: Received = { type, bytes };
    this.received.push(entry);
    if (type !== MESSAGE_SYNC) return;
    entry.subtype = bytes[decoder.pos];
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const subtype = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE);
    if (subtype === syncProtocol.messageYjsSyncStep2) this.synced = true;
    if (encoding.length(encoder) > 1) this.sendNow(encoding.toUint8Array(encoder));
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Waits until every client's board snapshot equals the first one's. */
export async function waitForConvergence(clients: TestClient[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const same = () => {
    const first = JSON.stringify(clients[0].snapshot());
    return clients.every((c) => JSON.stringify(c.snapshot()) === first);
  };
  await waitFor(same, 'convergence', timeoutMs);
}
