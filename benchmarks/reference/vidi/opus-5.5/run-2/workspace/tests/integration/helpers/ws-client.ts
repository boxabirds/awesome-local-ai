/**
 * Integration test client (design Fixtures): a real Y.Doc speaking y-protocols over a
 * real WebSocket obtained from a `SELF.fetch` upgrade — the same framing as the browser's
 * y-websocket provider.
 */
import { SELF, env } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../../src/shared/board-id';
import { initDoc, snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../../src/shared/protocol';

/** Transaction origin for updates received from the room (never sent back). */
const REMOTE = Symbol('remote');
const DEFAULT_WAIT_MS = 2000;
const POLL_MS = 5;

export interface Received {
  type: number;
  /** For sync frames: y-protocols sync message type (0 step1, 1 step2, 2 update). */
  syncType?: number;
  bytes: Uint8Array;
}

export function roomUrl(boardId: string): string {
  return `http://vidi6.test/api/rooms/${boardId}`;
}

/**
 * A fresh id whose board has been created (story 5: rooms of unknown boards answer 404).
 * Initialised over the same RPC that POST /api/boards uses, so no rate limit is spent.
 */
export async function createdBoardId(): Promise<string> {
  const id = newBoardId();
  const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
  if (result !== 'created') throw new Error(`fresh board ${id} already existed`);
  return id;
}

export async function waitUntil(predicate: () => boolean, what: string, timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TestClient {
  readonly received: Received[] = [];
  closeCode: number | null = null;
  synced = false;
  private held: Uint8Array[] | null = null;

  private constructor(
    readonly ws: WebSocket,
    readonly doc: Y.Doc,
  ) {}

  /** Opens a socket to `boardId`. Pass `doc` to reconnect an existing replica. */
  static async connect(boardId: string, doc = new Y.Doc()): Promise<TestClient> {
    const res = await SELF.fetch(roomUrl(boardId), { headers: { Upgrade: 'websocket' } });
    const ws = res.webSocket;
    if (res.status !== 101 || ws === null) throw new Error(`upgrade failed: ${res.status}`);
    ws.binaryType = 'arraybuffer';
    ws.accept();
    const client = new TestClient(ws, doc);
    client.attach();
    return client;
  }

  private attach(): void {
    this.ws.addEventListener('message', (event) => this.onMessage(event.data));
    this.ws.addEventListener('close', (event) => {
      this.closeCode = event.code;
    });
    this.doc.on('update', this.onLocalUpdate);
    // Like y-websocket: always announce our state vector on open.
    this.sendSync((e) => syncProtocol.writeSyncStep1(e, this.doc));
  }

  private readonly onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    this.sendSync((e) => syncProtocol.writeUpdate(e, update));
  };

  private onMessage(data: ArrayBuffer | string): void {
    if (typeof data === 'string') throw new Error('room sent a text frame');
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type !== MESSAGE_SYNC) {
      this.received.push({ type, bytes });
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE);
    this.received.push({ type, syncType, bytes });
    if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true;
    if (encoding.length(encoder) > 1) this.sendRaw(encoding.toUint8Array(encoder));
  }

  private sendSync(write: (e: encoding.Encoder) => void): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    const frame = encoding.toUint8Array(encoder);
    if (this.held !== null) this.held.push(frame);
    else this.sendRaw(frame);
  }

  sendRaw(frame: Uint8Array | string): void {
    if (this.closeCode === null) this.ws.send(frame);
  }

  sendAwareness(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    this.sendRaw(frame);
    return frame;
  }

  /** Queue outgoing updates (simulates edits made before the replicas exchange). */
  hold(): void {
    this.held = [];
  }

  release(): void {
    const frames = this.held ?? [];
    this.held = null;
    frames.forEach((f) => this.sendRaw(f));
  }

  async waitForSync(): Promise<void> {
    await waitUntil(() => this.synced, 'initial sync');
    initDoc(this.doc);
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Document updates (sync type 2) received so far. */
  updatesReceived(): number {
    return this.received.filter((m) => m.type === MESSAGE_SYNC && m.syncType === syncProtocol.messageYjsUpdate).length;
  }

  close(): void {
    this.doc.off('update', this.onLocalUpdate);
    try {
      this.ws.close(1000, 'done');
    } catch {
      // already closed
    }
  }
}

/** True when both replicas contain exactly the same Yjs state. */
export function sameState(a: Y.Doc, b: Y.Doc): boolean {
  const sa = Y.encodeStateVector(a);
  const sb = Y.encodeStateVector(b);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]) && JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));
}

export async function waitConverged(clients: TestClient[], timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
  const [first, ...rest] = clients;
  if (first === undefined) return;
  await waitUntil(() => rest.every((c) => sameState(first.doc, c.doc)), 'replicas to converge', timeoutMs);
}
