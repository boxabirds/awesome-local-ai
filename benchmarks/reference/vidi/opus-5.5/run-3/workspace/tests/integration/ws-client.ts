// A test participant: a real Y.Doc speaking y-protocols over a real WebSocket to the Worker, framed exactly
// like the browser's y-websocket provider (sync + awareness messages).
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_SYNC, decodeMessage, encodeSync } from '../../src/shared/protocol';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';

/** Transaction origin for updates that came from the room (never sent back). */
const REMOTE = Symbol('remote');

export interface Received {
  kind: 'sync-step1' | 'sync-step2' | 'update' | 'awareness' | 'other';
  bytes: Uint8Array;
}

export async function openSocket(boardId: string): Promise<{ status: number; ws: WebSocket | null }> {
  const res = await SELF.fetch(`http://vidi6.test/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (ws) {
    ws.binaryType = 'arraybuffer';
    ws.accept();
  }
  return { status: res.status, ws };
}

export class TestClient {
  readonly doc: Y.Doc;
  readonly received: Received[] = [];
  ws!: WebSocket;
  closeCode: number | null = null;
  synced = false;
  private held: Uint8Array[] | null = null;
  private readonly closed: Promise<number>;
  private resolveClosed!: (code: number) => void;

  private constructor(doc: Y.Doc) {
    this.doc = doc;
    this.closed = new Promise((r) => (this.resolveClosed = r));
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      const msg = encodeSync((e) => syncProtocol.writeUpdate(e, update));
      if (this.held) this.held.push(msg);
      else this.send(msg);
    });
  }

  /** Connects `doc` (default: a new one) to `boardId` and waits for the initial sync. */
  static async connect(boardId: string, doc: Y.Doc = new Y.Doc()): Promise<TestClient> {
    const client = new TestClient(doc);
    await client.attach(boardId);
    await client.waitForSync();
    return client;
  }

  private async attach(boardId: string): Promise<void> {
    const { status, ws } = await openSocket(boardId);
    if (status !== 101 || !ws) throw new Error(`upgrade failed: ${status}`);
    this.ws = ws;
    ws.addEventListener('message', (e) => this.onMessage(e.data as ArrayBuffer | string));
    ws.addEventListener('close', (e) => {
      this.closeCode = e.code;
      this.resolveClosed(e.code);
    });
    // Like y-websocket: always start with our state vector.
    this.send(encodeSync((e) => syncProtocol.writeSyncStep1(e, this.doc)));
  }

  private onMessage(data: ArrayBuffer | string): void {
    if (typeof data === 'string') return;
    const bytes = new Uint8Array(data);
    const msg = decodeMessage(bytes);
    if (msg.kind === 'awareness') {
      this.received.push({ kind: 'awareness', bytes });
      return;
    }
    if (msg.kind !== 'sync') {
      this.received.push({ kind: 'other', bytes });
      return;
    }
    const type = decoding.readVarUint(decoding.createDecoder(msg.payload));
    const kind = type === 0 ? 'sync-step1' : type === 1 ? 'sync-step2' : 'update';
    this.received.push({ kind, bytes });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoding.createDecoder(msg.payload), encoder, this.doc, REMOTE);
    if (kind === 'sync-step2') this.synced = true;
    if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
  }

  send(data: Uint8Array | ArrayBuffer | string): void {
    this.ws.send(data as ArrayBuffer | string);
  }

  /** Queue outgoing updates (to make edits concurrent with other clients' edits) until `release()`. */
  hold(): void {
    this.held ??= [];
  }

  release(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const m of held) this.send(m);
  }

  count(kind: Received['kind']): number {
    return this.received.filter((r) => r.kind === kind).length;
  }

  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  waitForSync(): Promise<void> {
    return waitFor(() => this.synced, 'initial sync');
  }

  waitForClose(): Promise<number> {
    return withTimeout(this.closed, 'socket close');
  }

  close(): void {
    try {
      this.ws.close(1000, 'done');
    } catch {
      // already closed
    }
  }
}

export const WAIT_MS = 5000;

export async function waitFor(cond: () => boolean, what: string, timeoutMs = WAIT_MS): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    sleep(WAIT_MS).then(() => {
      throw new Error(`timed out waiting for ${what}`);
    }),
  ]);
}

/** Waits until every client's notes are identical; returns them. */
export async function converged(clients: TestClient[]): Promise<readonly StickySnapshot[]> {
  const same = () => {
    const first = JSON.stringify(clients[0].notes());
    return clients.every((c) => JSON.stringify(c.notes()) === first);
  };
  await waitFor(same, 'convergence');
  return clients[0].notes();
}

/** Lets in-flight messages settle (used before asserting that something did NOT arrive). */
export function quiet(): Promise<void> {
  return sleep(150);
}
