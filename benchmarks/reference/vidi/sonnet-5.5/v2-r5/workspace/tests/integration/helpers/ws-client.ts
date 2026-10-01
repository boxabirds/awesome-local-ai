import { SELF, env } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

const REMOTE = Symbol('remote');
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

export async function openSocket(boardId: string, init = true): Promise<WebSocket> {
  if (init) await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).initialize(); // boards must exist since story 5
  const res = await SELF.fetch(`http://example.com/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  res.webSocket.accept();
  return res.webSocket;
}

export async function waitUntil(cond: () => boolean, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A real Y.Doc speaking the y-websocket sync/awareness framing over a real socket. */
export class WsClient {
  readonly doc: Y.Doc;
  readonly ws: WebSocket;
  boardId = '';
  /** Received frames: type prefix and, for sync, the sync sub-type. */
  readonly log: Array<{ type: number; sync?: number; bytes: Uint8Array }> = [];
  closeCode: number | null = null;
  synced = false;

  private constructor(ws: WebSocket, doc: Y.Doc) {
    this.ws = ws;
    this.doc = doc;
  }

  static async connect(boardId: string, doc: Y.Doc = new Y.Doc(), init = true): Promise<WsClient> {
    const client = new WsClient(await openSocket(boardId, init), doc);
    client.boardId = boardId;
    client.start();
    return client;
  }

  private start(): void {
    const { ws, doc } = this;
    ws.addEventListener('message', (ev: MessageEvent) => {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type !== MESSAGE_SYNC) {
        this.log.push({ type, bytes });
        return;
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const sync = syncProtocol.readSyncMessage(decoder, enc, doc, REMOTE);
      this.log.push({ type, sync, bytes });
      if (sync === SYNC_STEP2) this.synced = true;
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    });
    ws.addEventListener('close', (ev: CloseEvent) => { this.closeCode = ev.code; });
    doc.on('update', this.onLocalUpdate);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  }

  private paused = false;

  /** Stop forwarding local edits (simulates two people editing before exchanging). */
  pause(): void { this.paused = true; }

  /** Forward everything made while paused. */
  resume(): void {
    this.paused = false;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(this.doc));
    this.ws.send(encoding.toUint8Array(enc));
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE || this.paused || this.ws.readyState !== 1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.ws.send(encoding.toUint8Array(enc));
  };

  waitForSync(): Promise<void> {
    return waitUntil(() => this.synced, 10_000, 'initial sync');
  }

  /** Number of sync update frames received (excludes the handshake). */
  get updatesReceived(): number {
    return this.log.filter((m) => m.type === MESSAGE_SYNC && m.sync === SYNC_UPDATE).length;
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  close(): void {
    this.doc.off('update', this.onLocalUpdate);
    try { this.ws.close(1000); } catch { /* already closed */ }
  }
}

export function sameSnapshot(...clients: WsClient[]): boolean {
  const first = JSON.stringify(clients[0].snapshot());
  return clients.every((c) => JSON.stringify(c.snapshot()) === first);
}

export async function converge(clients: WsClient[], timeoutMs = 10_000): Promise<void> {
  await waitUntil(() => sameSnapshot(...clients), timeoutMs, 'convergence');
}

/** Lets in-flight frames settle so negative assertions ("nothing arrives") are meaningful. */
export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
