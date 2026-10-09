import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { decodeMessage, encodeFrame, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

/** Base URL of the wrangler dev server started by the global setup. */
export const BASE: string = process.env.INTEGRATION_BASE ?? 'http://127.0.0.1:29042';

export function boardUrl(boardId: string): string {
  return BASE.replace(/^http/, 'ws') + `/api/rooms/${boardId}`;
}

/**
 * A raw WebSocket client that speaks the y-websocket sync protocol manually
 * (the same framing the room implements): step1/step2 handshake, update
 * relay, plus raw send for malformed-data tests.
 *
 * `hold` suppresses all outgoing sync traffic (for concurrent-edit tests);
 * `release()` flushes the client's full state.
 */
export class RoomClient {
  readonly doc: Y.Doc;
  hold = false;
  /** update (type 2) sync messages received after sync completed */
  receivedUpdates = 0;
  /** awareness payloads received (full frame payloads) */
  receivedAwareness: Uint8Array[] = [];
  closed: { code: number; reason: string } | null = null;

  private ws: WebSocket;
  private synced = false;
  private syncWaiters: Array<() => void> = [];
  private closeWaiters: Array<(c: { code: number; reason: string }) => void> = [];
  private updateWaiters: Array<(n: number) => void> = [];

  private constructor(doc: Y.Doc, ws: WebSocket) {
    this.doc = doc;
    this.ws = ws;
    ws.addEventListener('message', (ev: MessageEvent) => {
      void this.handleMessage(ev.data);
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      this.closed = { code: ev.code, reason: ev.reason };
      for (const w of this.closeWaiters.splice(0)) w(this.closed);
    });
    doc.on('update', (update, origin) => {
      if (this.hold) return;
      if (origin === this) return; // remote-applied: do not echo back
      const enc = encoding.createEncoder();
      writeUpdate(enc, update);
      this.sendFrame(MESSAGE_SYNC, encoding.toUint8Array(enc));
    });
  }

  static async connect(url: string): Promise<RoomClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout opening ${url}`)), 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error(`websocket error opening ${url}`));
      }, { once: true });
    });
    const doc = new Y.Doc();
    initDoc(doc);
    const client = new RoomClient(doc, ws);
    client.sendInitialStep1();
    return client;
  }

  private sendFrame(type: number, payload: Uint8Array): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeFrame(type, payload));
  }

  /** Mirror y-websocket: announce our state vector as soon as we're open. */
  private sendInitialStep1(): void {
    const enc = encoding.createEncoder();
    writeSyncStep1(enc, this.doc);
    this.sendFrame(MESSAGE_SYNC, encoding.toUint8Array(enc));
  }

  /** Node's WebSocket delivers binary frames as Blob; normalize to ArrayBuffer. */
  private async handleMessage(data: unknown): Promise<void> {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data = await (data as Blob).arrayBuffer();
    }
    this.onMessage(data);
  }

  private onMessage(data: unknown): void {
    const decoded = decodeMessage(data as ArrayBuffer | string);
    if (decoded.kind === 'awareness') {
      this.receivedAwareness.push(decoded.payload);
      return;
    }
    if (decoded.kind !== 'sync') return;
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(decoded.payload);
    // A sync frame can carry several messages (e.g. step2+step1): process all.
    while (decoding.hasContent(decoder)) {
      const msgType = readSyncMessage(decoder, encoder, this.doc, this);
      if (msgType === messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        for (const w of this.syncWaiters.splice(0)) w();
      }
      if (msgType === messageYjsUpdate && this.synced) {
        this.receivedUpdates++;
        for (const w of [...this.updateWaiters]) w(this.receivedUpdates);
      }
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 0 && !this.hold) {
      this.sendFrame(MESSAGE_SYNC, reply);
    }
  }

  /** Sends a full-state update (used to flush after `hold`). */
  release(): void {
    this.hold = false;
    const enc = encoding.createEncoder();
    writeUpdate(enc, Y.encodeStateAsUpdate(this.doc));
    this.sendFrame(MESSAGE_SYNC, encoding.toUint8Array(enc));
  }

  sendRaw(data: string | Uint8Array): void {
    this.ws.send(data);
  }

  sendSyncPayload(payload: Uint8Array): void {
    this.sendFrame(MESSAGE_SYNC, payload);
  }

  sendAwareness(payload: Uint8Array): void {
    this.sendFrame(MESSAGE_AWARENESS, payload);
  }

  async waitForSync(timeoutMs = 10_000): Promise<void> {
    if (this.synced) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('timeout waiting for sync')),
        timeoutMs,
      );
      this.syncWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async waitForUpdates(n: number, timeoutMs = 10_000): Promise<void> {
    if (this.receivedUpdates >= n) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`timeout: ${this.receivedUpdates}/${n} updates`)),
        timeoutMs,
      );
      this.updateWaiters.push((count) => {
        if (count >= n) {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }

  async waitForClose(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    if (this.closed) return this.closed;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.closeWaiters.push((c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
  }

  close(code = 1000, reason = 'bye'): void {
    try {
      this.ws.close(code, reason);
    } catch {
      // already closing
    }
  }

  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }
}

export function sameNotes(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (n: StickySnapshot) => `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}`;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Polls until fn() is true (or times out). */
export async function waitUntil(
  fn: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout in waitUntil');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
