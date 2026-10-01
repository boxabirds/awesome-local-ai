import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../../src/shared/protocol';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';

export const REMOTE = Symbol('remote');

export async function openSocket(boardId: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const ws = res.webSocket;
  ws.accept();
  return ws;
}

/** A real Y.Doc speaking the y-websocket sync/awareness framing over a workerd WebSocket. */
export class WsClient {
  readonly doc = new Y.Doc();
  readonly received: Uint8Array[] = [];
  readonly awarenessReceived: Uint8Array[] = [];
  closeCode: number | null = null;
  private synced = false;
  private syncWaiters: (() => void)[] = [];

  private constructor(
    readonly ws: WebSocket,
    readonly boardId: string,
  ) {}

  static async connect(boardId: string, opts: { autoSync?: boolean } = {}): Promise<WsClient> {
    const client = new WsClient(await openSocket(boardId), boardId);
    client.attach();
    if (opts.autoSync !== false) await client.waitForSync();
    return client;
  }

  private attach(): void {
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (e) => this.onMessage(e.data as ArrayBuffer));
    this.ws.addEventListener('close', (e) => {
      this.closeCode = e.code;
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || this.ws.readyState !== 1) return;
      if (this.paused) {
        this.pending.push(update);
        return;
      }
      this.sendSync((e) => syncProtocol.writeUpdate(e, update));
    });
    // Same handshake as y-websocket: announce our state vector on open.
    this.sendSync((e) => syncProtocol.writeSyncStep1(e, this.doc));
  }

  /** Holds back local updates until `resume()`; used to create genuinely concurrent edits. */
  private paused = false;
  private pending: Uint8Array[] = [];

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    for (const u of this.pending) this.sendSync((e) => syncProtocol.writeUpdate(e, u));
    this.pending = [];
  }

  private sendSync(write: (e: encoding.Encoder) => void): void {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    write(e);
    this.ws.send(encoding.toUint8Array(e));
  }

  private onMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      this.received.push(bytes);
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const step = syncProtocol.readSyncMessage(decoder, reply, this.doc, REMOTE);
      if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply));
      if (step === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.syncWaiters.splice(0).forEach((w) => w());
      }
    } else if (type === MESSAGE_AWARENESS) {
      this.awarenessReceived.push(bytes);
    }
  }

  waitForSync(): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise((resolve) => this.syncWaiters.push(resolve));
  }

  sendAwareness(): Uint8Array {
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    aw.setLocalState({ hello: 'world' });
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(aw, [aw.clientID]));
    const bytes = encoding.toUint8Array(e);
    this.ws.send(bytes);
    aw.destroy();
    return bytes;
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  close(): void {
    this.ws.close(1000);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls until `fn` is truthy (or throws on timeout). */
export async function waitFor(fn: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

export const json = (c: WsClient) => JSON.stringify(c.snapshot());

export async function settle(clients: WsClient[], timeoutMs = 5000): Promise<void> {
  await waitFor(() => new Set(clients.map(json)).size === 1, 'clients to converge', timeoutMs);
}
