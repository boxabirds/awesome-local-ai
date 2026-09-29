// Integration-test client: a real Y.Doc speaking the y-protocols framing of
// y-websocket, over a real WebSocket obtained from a SELF.fetch upgrade to the
// Worker. This exercises the exact wire path the browser provider uses.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SELF, env } from 'cloudflare:test';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../../src/shared/protocol.ts';
import { initDoc, snapshot, LOCAL_ORIGIN, type StickySnapshot } from '../../../src/shared/board-model.ts';
// Type-only: the room class the namespace is declared against, so `initialize()`
// is checked against the real RPC signature.
import type { BoardRoom } from '../../../src/worker/index.ts';

// A non-client origin used when applying remote updates so the local
// doc.on('update') handler does not echo them back.
const REMOTE: unique symbol = Symbol('remote');

/**
 * Bring a board into existence before a client dials it.
 *
 * Story 5 closed the door a test used to walk through: from now on a board that
 * was never created is a 404, not an empty board, so a suite that wants a board
 * has to say so. This is that saying-so - the very `initialize()` the create
 * endpoint calls, with the same stamp and the same schema - so the connection
 * under test is the real one. A test that wants the *absence* of a board (the
 * 404 cases) calls SELF.fetch itself and never comes through here.
 */
export async function ensureBoard(boardId: string): Promise<void> {
  const namespace = (env as unknown as { BOARD_ROOM: DurableObjectNamespace<BoardRoom> }).BOARD_ROOM;
  await namespace.get(namespace.idFromName(boardId)).initialize();
}

export type ReceivedKind = 'sync-step1' | 'sync-step2' | 'update' | 'awareness' | 'query-awareness' | 'unknown';

export interface Received {
  kind: ReceivedKind;
  bytes: Uint8Array;
}

export class TestClient {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private ws: WebSocket | null = null;
  private _synced = false;
  private _closeCode: number | null = null;
  private docHandlerRegistered = false;
  readonly received: Received[] = [];
  private syncWaiters: Array<() => void> = [];

  private constructor() {
    this.doc = new Y.Doc();
    initDoc(this.doc);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  get synced(): boolean {
    return this._synced;
  }
  get closeCode(): number | null {
    return this._closeCode;
  }
  get readyState(): number {
    return this.ws ? this.ws.readyState : -1;
  }
  get open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.READY_STATE_OPEN;
  }
  // Number of incremental Yjs update messages this client has received.
  get updateCount(): number {
    return this.received.filter((r) => r.kind === 'update').length;
  }
  // Snapshot the update count so a test can assert the DELTA caused by its own
  // operation (initial-sync awareness/meta chatter must not count as an echo).
  mark(): number {
    return this.updateCount;
  }

  // Simulate a client reconnecting the SAME Y.Doc to a (possibly brand-new) room
  // id — used to model a server restart with a fresh, empty Durable Object while
  // the client keeps its document. The existing doc.on('update') handler now
  // sends over the new socket; we re-run the SyncStep1 handshake.
  async reconnect(boardId: string): Promise<void> {
    this._synced = false;
    this._closeCode = null;
    this.received.length = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already gone */
      }
    }
    this.ws = null;
    await ensureBoard(boardId);
    await this.openSocket(`/api/rooms/${boardId}`);
    this.startSync();
  }

  /**
   * Connect to a board. By default the board is created first, because that is
   * what a test means when it says "a client opens this board". `create: false`
   * dials the link as it stands, which is how a test asserts what a board that
   * was never created does: it is refused.
   */
  static async connect(boardId: string, options: { create?: boolean } = {}): Promise<TestClient> {
    const c = new TestClient();
    if (options.create !== false) await ensureBoard(boardId);
    await c.openSocket(`/api/rooms/${boardId}`);
    return c;
  }

  private async openSocket(path: string): Promise<void> {
    const res = await SELF.fetch(`http://placeholder${path}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no webSocket on response (status ${res.status})`);
    ws.accept();
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('message', (event: MessageEvent) => {
      this.onMessage(event.data as ArrayBuffer);
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      this._closeCode = event.code;
    });
    ws.addEventListener('error', () => {
      /* swallow; close event carries the code */
    });

    // Mirror y-websocket: apply local doc updates as incremental messages. The
    // handler is registered once so a reconnect reuses it (sending over the new
    // socket) instead of double-sending.
    if (!this.docHandlerRegistered) {
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.rawSend(encoding.toUint8Array(enc));
      });
      this.docHandlerRegistered = true;
    }
  }

  // Send our SyncStep1 (as the browser provider does on socket open).
  startSync(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.rawSend(encoding.toUint8Array(enc));
  }

  private onMessage(data: ArrayBuffer): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.received.push({ kind: 'unknown', bytes: new Uint8Array() });
      return;
    }
    if (decoded.kind === 'query-awareness') {
      this.received.push({ kind: 'query-awareness', bytes: new Uint8Array() });
      return;
    }
    if (decoded.kind === 'awareness') {
      // Tolerate opaque/invalid awareness bytes (a relay test may send synthetic
      // payloads); never let them break the socket.
      try {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.payload, REMOTE);
      } catch {
        /* ignore undecodable awareness for the purposes of these tests */
      }
      this.received.push({ kind: 'awareness', bytes: decoded.payload });
      return;
    }
    // sync
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    const kindMap: Record<number, ReceivedKind> = {
      [syncProtocol.messageYjsSyncStep1]: 'sync-step1',
      [syncProtocol.messageYjsSyncStep2]: 'sync-step2',
      [syncProtocol.messageYjsUpdate]: 'update',
    };
    try {
      const dec = decoding.createDecoder(decoded.payload);
      const t = syncProtocol.readSyncMessage(dec, reply, this.doc, REMOTE);
      this.received.push({ kind: kindMap[t] ?? 'unknown', bytes: decoded.payload });
      // A reply body beyond the type prefix is a SyncStep2 (our full state) in
      // response to a SyncStep1 — send it, exactly like y-websocket does.
      if (encoding.length(reply) > 1) {
        this.rawSend(encoding.toUint8Array(reply));
      }
      if (t === syncProtocol.messageYjsSyncStep2 && !this._synced) {
        this._synced = true;
        for (const w of this.syncWaiters.splice(0)) w();
      }
    } catch {
      this.received.push({ kind: 'unknown', bytes: decoded.payload });
    }
  }

  private rawSend(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.READY_STATE_OPEN) {
      this.ws.send(bytes);
    }
  }

  // Send raw, malformed bytes (not a valid y-websocket message).
  sendRaw(bytes: Uint8Array): void {
    this.rawSend(bytes);
  }
  sendText(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.READY_STATE_OPEN) this.ws.send(text);
  }
  sendQueryAwareness(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    this.rawSend(encoding.toUint8Array(enc));
  }
  sendAwareness(update: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, update);
    this.rawSend(encoding.toUint8Array(enc));
  }

  // Wait until the room has answered our SyncStep1 with a SyncStep2.
  waitForSync(timeoutMs = 5000): Promise<void> {
    if (this._synced) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('waitForSync timed out')), timeoutMs);
      this.syncWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
      this.startSync();
    });
  }

  close(code?: number): void {
    if (this.ws) this.ws.close(code);
  }

  // Wait until the socket has closed (closeCode becomes non-null).
  async waitForClose(timeoutMs = 5000): Promise<number> {
    await this.waitFor(() => this.closeCode !== null, timeoutMs, 'socket close');
    return this.closeCode as number;
  }

  async waitFor(predicate: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  // Wait until this client's doc converges with `other`'s (same snapshot).
  async waitForEqualSnapshot(other: TestClient, timeoutMs = 5000): Promise<void> {
    await this.waitFor(() => snapEq(this.snapshot(), other.snapshot()), timeoutMs, 'equal snapshot');
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  localOrigin(): unknown {
    return LOCAL_ORIGIN;
  }
}

export function snapEq(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.color !== y.color ||
      x.text !== y.text ||
      x.z !== y.z
    ) {
      return false;
    }
  }
  return true;
}

// Let the workerd event loop deliver any in-flight socket messages.
export function tick(ms = 25): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
