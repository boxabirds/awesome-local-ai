import { exports as workerExports } from 'cloudflare:workers';

const entry = (workerExports as unknown as { default: Fetcher }).default;
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { snapshot } from '../../src/shared/board-model';

export const fetchWorker = (input: string, init?: RequestInit) => entry.fetch(input, init);
export const ORIGIN_REMOTE = Symbol('remote');

export async function openSocket(boardId: string, host = 'https://example.com'): Promise<WebSocket> {
  const res = await fetchWorker(`${host}/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  res.webSocket.accept();
  return res.webSocket;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** A real Y.Doc speaking y-protocols over a socket, like the browser provider. */
export class WsClient {
  readonly doc: Y.Doc;
  readonly received: Uint8Array[] = [];
  closeCode: number | null = null;
  synced = false;
  private paused = false;
  private queued: Uint8Array[] = [];

  constructor(readonly ws: WebSocket, doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    ws.addEventListener('message', (ev) => this.onMessage(new Uint8Array(ev.data as ArrayBuffer)));
    ws.addEventListener('close', (ev) => { this.closeCode = ev.code; });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.sendRaw(encoding.toUint8Array(enc));
    });
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.sendRaw(encoding.toUint8Array(enc));
  }

  /** Holds local updates back so two clients can edit "at the same time". */
  pause(): void { this.paused = true; }

  resume(): void {
    this.paused = false;
    for (const m of this.queued.splice(0)) this.ws.send(m);
  }

  sendRaw(msg: Uint8Array | string): void {
    if (this.paused && typeof msg !== 'string') this.queued.push(msg);
    else this.ws.send(msg);
  }

  private onMessage(data: Uint8Array): void {
    this.received.push(data);
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type !== MESSAGE_SYNC) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    const kind = syncProtocol.readSyncMessage(decoder, enc, this.doc, ORIGIN_REMOTE);
    if (kind === syncProtocol.messageYjsSyncStep2) this.synced = true;
    if (encoding.length(enc) > 1) this.ws.send(encoding.toUint8Array(enc));
  }

  /** Sync messages carrying a document update (excluding the handshake). */
  get updateMessages(): number {
    return this.received.filter((m) => m[0] === MESSAGE_SYNC && m[1] === syncProtocol.messageYjsUpdate).length;
  }

  get awarenessMessages(): Uint8Array[] {
    return this.received.filter((m) => m[0] === MESSAGE_AWARENESS);
  }

  snapshot() { return snapshot(this.doc); }

  waitForSync(): Promise<void> { return until(() => this.synced, 5000, 'initial sync'); }

  close(): void { try { this.ws.close(1000); } catch { /* closed */ } }
}

export async function connect(boardId: string, doc?: Y.Doc): Promise<WsClient> {
  const c = new WsClient(await openSocket(boardId), doc);
  await c.waitForSync();
  return c;
}

/** Waits until every client has the same snapshot as the first. */
export async function converged(clients: WsClient[], timeoutMs = 8000): Promise<void> {
  const same = () => clients.every((c) => JSON.stringify(c.snapshot()) === JSON.stringify(clients[0].snapshot())
    && Y.encodeStateVector(c.doc).toString() === Y.encodeStateVector(clients[0].doc).toString());
  await until(same, timeoutMs, 'convergence');
}
