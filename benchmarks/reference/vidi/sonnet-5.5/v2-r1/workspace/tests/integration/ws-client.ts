import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { initDoc, snapshot } from '../../src/shared/board-model';

export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

export async function waitFor(cond: () => boolean, what = 'condition', timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export interface Received {
  type: number;
  syncType?: number;
  bytes: Uint8Array;
}

/** A real Y.Doc speaking y-websocket framing over a WebSocket obtained from the real Worker. */
export class WsClient {
  readonly doc = new Y.Doc();
  readonly received: Received[] = [];
  closeCode: number | undefined;
  /** When true, local edits are kept in the doc but not sent (used to create true concurrency). */
  offline = false;
  private synced = false;

  private constructor(readonly ws: WebSocket) {
    initDoc(this.doc);
    ws.addEventListener('message', (ev) => this.onMessage(ev.data as ArrayBuffer));
    ws.addEventListener('close', (ev) => {
      this.closeCode = ev.code;
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this || this.offline || ws.readyState !== WebSocket.OPEN) return;
      this.send(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update));
    });
  }

  static async connect(boardId: string, doc?: (d: Y.Doc) => void): Promise<WsClient> {
    const res = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
    const ws = res.webSocket;
    ws.accept();
    const client = new WsClient(ws);
    doc?.(client.doc);
    client.send(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, client.doc));
    return client;
  }

  private send(type: number, write: (e: encoding.Encoder) => void): void {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, type);
    write(e);
    this.ws.send(encoding.toUint8Array(e));
  }

  private onMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    const entry: Received = { type, bytes };
    this.received.push(entry);
    if (type !== MESSAGE_SYNC) return;
    const peek = decoding.createDecoder(bytes);
    decoding.readVarUint(peek);
    entry.syncType = decoding.readVarUint(peek);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
    if (encoding.length(reply) > 1 && this.ws.readyState === WebSocket.OPEN) this.ws.send(encoding.toUint8Array(reply));
    if (entry.syncType === SYNC_STEP_2) this.synced = true;
  }

  waitForSync(): Promise<void> {
    return waitFor(() => this.synced, 'initial sync');
  }

  /** Sends everything this client has (idempotent) and stops withholding edits. */
  resume(): void {
    this.offline = false;
    this.send(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(this.doc)));
  }

  sendRaw(data: ArrayBuffer | Uint8Array | string): void {
    this.ws.send(data);
  }

  sendAwareness(payload: number[]): void {
    this.send(MESSAGE_AWARENESS, (e) => payload.forEach((b) => encoding.writeUint8(e, b)));
  }

  /** Update messages (sync type 2) the server has pushed to this client. */
  get updateMessages(): Received[] {
    return this.received.filter((m) => m.type === MESSAGE_SYNC && m.syncType === SYNC_UPDATE);
  }

  get snapshotJson(): string {
    return JSON.stringify(snapshot(this.doc));
  }

  close(): void {
    this.ws.close();
  }
}

export async function converged(clients: WsClient[], what = 'convergence'): Promise<void> {
  await waitFor(() => new Set(clients.map((c) => c.snapshotJson)).size === 1, what, 15_000);
}
