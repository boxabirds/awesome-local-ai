// Integration-test client: a real Y.Doc speaking the exact y-websocket
// framing (y-protocols over binary WebSocket frames) against a real Worker /
// BoardRoom WebSocket obtained from an upgrade response. Same framing as the
// browser provider, so what passes here passes in the browser.

import * as Y from 'yjs';
import { SELF } from 'cloudflare:test';
import { createDecoder, readVarUint } from 'lib0/decoding';
import {
  createEncoder,
  length,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

export class RoomClient {
  readonly doc: Y.Doc;
  /** Every frame received from the room, in order. */
  readonly received: Uint8Array[] = [];
  /** Only sync "update" frames (sync type 2) received from the room. */
  readonly updates: Uint8Array[] = [];
  /** Close code once the socket has closed (null while open). */
  closeCode: number | null = null;

  private ws: WebSocket;
  private updateHandler: (update: Uint8Array, origin: unknown) => void;
  private frameWaiters: Array<() => void> = [];
  /** Bumped on every message; lets waiters detect notifications they missed. */
  private notifyCount = 0;

  private constructor(ws: WebSocket, doc: Y.Doc) {
    this.ws = ws;
    this.doc = doc;
    initDoc(this.doc);
    ws.addEventListener('message', (event) =>
      this.handleMessage(event.data as ArrayBuffer),
    );
    ws.addEventListener('close', (event) => {
      this.closeCode = (event as CloseEvent).code;
      this.notifyWaiters();
    });

    // Open the sync handshake (y-websocket sends SyncStep1 on open).
    this.sendSyncStep1();

    // Forward local doc updates to the room (never echo remote ones back).
    this.updateHandler = (update, origin) => {
      if (origin === this) return;
      const frame = createEncoder();
      writeVarUint(frame, MESSAGE_SYNC);
      writeUpdate(frame, update);
      this.safeSend(toUint8Array(frame));
    };
    this.doc.on('update', this.updateHandler);
  }

  /** Connect through the Worker entry (`SELF.fetch` upgrade). */
  static async connect(boardId: string, doc?: Y.Doc): Promise<RoomClient> {
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    if (res.status !== 101 || !res.webSocket) {
      throw new Error(`WebSocket upgrade failed: HTTP ${res.status}`);
    }
    res.webSocket.accept();
    const client = new RoomClient(res.webSocket, doc ?? new Y.Doc());
    await client.waitForFrames(1);
    return client;
  }

  /** Connect directly to a Durable Object stub (restart simulation). */
  static async connectToStub(
    stub: DurableObjectStub,
    boardId: string,
    doc?: Y.Doc,
  ): Promise<RoomClient> {
    const res = await stub.fetch(
      new Request(`http://localhost/api/rooms/${boardId}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    );
    if (res.status !== 101 || !res.webSocket) {
      throw new Error(`WebSocket upgrade failed: HTTP ${res.status}`);
    }
    res.webSocket.accept();
    const client = new RoomClient(res.webSocket, doc ?? new Y.Doc());
    await client.waitForFrames(1);
    return client;
  }

  /** Current board snapshot (same function the client renders from). */
  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Resolves once at least `count` frames have been received. */
  waitForFrames(count: number, timeoutMs = 5000): Promise<void> {
    return this.waitUntil(
      () => this.received.length >= count,
      () => `timed out waiting for ${count} frames (got ${this.received.length})`,
      timeoutMs,
    );
  }

  /** Resolves once at least `count` update frames have been received. */
  waitForUpdates(count: number, timeoutMs = 5000): Promise<void> {
    return this.waitUntil(
      () => this.updates.length >= count,
      () => `timed out waiting for ${count} update frames (got ${this.updates.length})`,
      timeoutMs,
    );
  }

  /** Resolves once the socket has closed; resolves with the close code. */
  waitForClose(timeoutMs = 5000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return this.waitUntil(
      () => this.closeCode !== null,
      () => 'timed out waiting for socket close',
      timeoutMs,
    ).then(() => this.closeCode as number);
  }

  /**
   * Wait for a predicate, woken by incoming frames. The waiter stays
   * registered until it settles: an earlier frame (e.g. a sync step2) may
   * notify it before the frame it actually cares about (an update) arrives.
   * A generation counter catches notifications that fired between the
   * initial check and registering the waiter.
   */
  private waitUntil(
    pred: () => boolean,
    errMsg: () => string,
    timeoutMs: number,
  ): Promise<void> {
    if (pred()) return Promise.resolve();
    const at = this.notifyCount;
    return new Promise((resolve, reject) => {
      let settled = false;
      const remove = () => {
        const i = this.frameWaiters.indexOf(done);
        if (i >= 0) this.frameWaiters.splice(i, 1);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        remove();
        reject(new Error(errMsg()));
      }, timeoutMs);
      const done = () => {
        if (settled) return;
        if (pred()) {
          settled = true;
          clearTimeout(timer);
          remove();
          resolve();
        }
      };
      this.frameWaiters.push(done);
      if (this.notifyCount !== at) done();
    });
  }

  /** Resolves once a frame matching `pred` has been received. */
  waitForFrame(pred: (frame: Uint8Array) => boolean, timeoutMs = 5000): Promise<void> {
    return this.waitUntil(
      () => this.received.some(pred),
      () => 'timed out waiting for a matching frame',
      timeoutMs,
    );
  }

  /** Send an arbitrary (possibly malformed) frame. */
  sendRaw(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  /** Send an awareness frame wrapping `payload`. */
  sendAwareness(payload: Uint8Array): void {
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_AWARENESS);
    writeVarUint8Array(frame, payload);
    this.safeSend(toUint8Array(frame));
  }

  close(): void {
    this.ws.close();
  }

  destroy(): void {
    this.doc.off('update', this.updateHandler);
  }

  private sendSyncStep1(): void {
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_SYNC);
    writeSyncStep1(frame, this.doc);
    this.safeSend(toUint8Array(frame));
  }

  private handleMessage(data: ArrayBuffer): void {
    const frame = new Uint8Array(data);
    this.received.push(frame);
    const decoder = createDecoder(frame);
    let type: number;
    try {
      type = readVarUint(decoder);
    } catch {
      this.notifyWaiters();
      return;
    }
    if (type === MESSAGE_SYNC) {
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      let syncType = 0;
      try {
        syncType = readSyncMessage(decoder, encoder, this.doc, this);
      } catch {
        // A malformed sync frame from the room is a server bug; drop it.
      }
      if (syncType === 2) {
        this.updates.push(frame);
      }
      if (length(encoder) > 1) {
        // Reply to the room's SyncStep1 with our SyncStep2.
        this.safeSend(toUint8Array(encoder));
      }
    }
    this.notifyWaiters();
  }

  private safeSend(data: Uint8Array): void {
    try {
      this.ws.send(data);
    } catch {
      // Socket already closed; nothing to do in a test client.
    }
  }

  private notifyWaiters(): void {
    this.notifyCount++;
    // Copy: a waiter removes itself from the array when it settles.
    for (const w of [...this.frameWaiters]) w();
  }
}

/**
 * Close every client and give the room a moment to observe the closes.
 * (workerd's proxied WebSocket does not fire a close event on a
 * client-initiated close, so we settle with a short delay instead of
 * awaiting the event.)
 */
export async function closeAll(clients: RoomClient[]): Promise<void> {
  for (const c of clients) c.close();
  await new Promise((r) => setTimeout(r, 200));
}

/**
 * Poll until every client's snapshot is identical (full convergence), or
 * throw on timeout.
 */
export async function waitForConvergence(
  clients: RoomClient[],
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snaps = clients.map((c) => JSON.stringify(c.snapshot()));
    if (snaps.every((s) => s === snaps[0])) return;
    if (Date.now() > deadline) {
      throw new Error(
        `convergence timeout; snapshots differ:\n${clients
          .map((c, i) => `client ${i}: ${JSON.stringify(c.snapshot())}`)
          .join('\n')}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
