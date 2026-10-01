import { exports } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../src/shared/protocol';

const REMOTE = Symbol('remote');

export function upgrade(boardId: string): Promise<Response> {
  return exports.default.fetch(`http://example.com/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitFor(cond: () => boolean, what = 'condition', timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** A real Y.Doc speaking y-websocket framing to the room over a real WebSocket. */
export class WsClient {
  readonly doc = new Y.Doc();
  readonly received: Uint8Array[] = [];
  closeCode: number | null = null;
  synced = false;
  private ws!: WebSocket;

  static async connect(boardId: string, opts: { waitForSync?: boolean; doc?: Y.Doc } = {}): Promise<WsClient> {
    const res = await upgrade(boardId);
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade refused: ${res.status}`);
    const c = new WsClient(opts.doc);
    c.attach(res.webSocket);
    if (opts.waitForSync !== false) await c.waitForSync();
    return c;
  }

  private constructor(doc?: Y.Doc) {
    if (doc) (this as { doc: Y.Doc }).doc = doc;
  }

  private attach(ws: WebSocket): void {
    this.ws = ws;
    ws.accept();
    ws.addEventListener('message', (ev: MessageEvent) => {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      this.received.push(bytes);
      const decoder = decoding.createDecoder(bytes);
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const type = syncProtocol.readSyncMessage(decoder, enc, this.doc, REMOTE);
      if (encoding.length(enc) > 1) this.sendBytes(encoding.toUint8Array(enc));
      if (type === syncProtocol.messageYjsSyncStep2) this.synced = true;
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      this.closeCode = ev.code;
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.sendBytes(encoding.toUint8Array(enc));
    });
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.sendBytes(encoding.toUint8Array(enc));
  }

  get isOpen(): boolean {
    return this.closeCode === null && this.ws.readyState === 1;
  }

  sendBytes(bytes: Uint8Array): void {
    if (this.ws.readyState === 1) this.ws.send(bytes);
  }
  sendRaw(data: string | ArrayBuffer | Uint8Array): void {
    this.ws.send(data as string | ArrayBuffer);
  }
  close(code = 1000): void {
    this.ws.close(code);
  }
  waitForSync(): Promise<void> {
    return waitFor(() => this.synced, 'initial sync');
  }
  snapshot() {
    return snapshot(this.doc);
  }
  /** Canonical (key-sorted) JSON of the board, independent of integration order. */
  json(): string {
    const sort = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sort(x)]))
          : v;
    return JSON.stringify(sort(this.doc.getMap('objects').toJSON()));
  }
}

/** Resolves once every client holds the same document state as the first. */
export async function converge(clients: WsClient[], timeoutMs = 8000): Promise<void> {
  const same = () => {
    const first = clients[0].json();
    return clients.every((c) => c.json() === first);
  };
  await waitFor(same, 'convergence', timeoutMs);
  await sleep(50); // quiescence check: still equal after in-flight traffic lands
  if (!same()) await waitFor(same, 'convergence', timeoutMs);
}
