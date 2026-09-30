// A real Yjs client that speaks the exact y-websocket wire format, driven from
// the workerd integration tests over the WebSocket returned by a `SELF.fetch`
// upgrade. It is deliberately *not* the browser `WebsocketProvider` (that needs
// a public network URL): this is the byte-for-byte protocol the provider uses —
// sync step 1 on open, updates on local edits (skipping our own echoes),
// awareness frames — so what the room sees is what a browser would send.

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SELF } from 'cloudflare:test';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../src/shared/protocol';
import {
  initDoc,
  snapshot as snapshotDoc,
  type StickySnapshot,
} from '../../../src/shared/board-model';

export type ReceivedFrame =
  | { frameType: 'sync'; syncType: number; bytes: Uint8Array }
  | { frameType: 'awareness'; bytes: Uint8Array }
  | { frameType: 'query-awareness'; bytes: Uint8Array }
  | { frameType: 'unknown'; bytes: Uint8Array };

export class TestClient {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly received: ReceivedFrame[] = [];
  readonly awarenessReceived: Uint8Array[] = [];
  synced = false;
  closeCode: number | null = null;

  private ws: WebSocket;
  private syncWaiters: (() => void)[] = [];

  private constructor(
    private readonly boardId: string,
    ws: WebSocket,
  ) {
    this.ws = ws;
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.ws.binaryType = 'arraybuffer';
    this.ws.accept();
    this.ws.addEventListener('message', (event: MessageEvent) =>
      this.onFrame(event.data as ArrayBuffer),
    );
    this.ws.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
    });
    // Forward local edits exactly like the provider's `_updateHandler`; updates
    // we *applied* from the room carry us as origin and are not echoed back.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.send(encoding.toUint8Array(encoder));
    });
  }

  /** Open a room WebSocket through the Worker route and start the sync handshake. */
  static async connect(boardId: string): Promise<TestClient> {
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    if (res.status !== 101) {
      throw new Error(`expected 101, got ${res.status}`);
    }
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    const client = new TestClient(boardId, ws);
    client.startSync();
    return client;
  }

  /** Open a room WebSocket straight on the Durable Object stub, bypassing the route. */
  static async connectStub(stub: DurableObjectStub): Promise<TestClient> {
    const res = await stub.fetch(new Request('http://internal/', {
      headers: { Upgrade: 'websocket' },
    }));
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    const client = new TestClient('__stub__', ws);
    client.startSync();
    return client;
  }

  private startSync(): void {
    initDoc(this.doc);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private onFrame(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const frameType = decoding.readVarUint(decoder);

    if (frameType === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const syncType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      this.received.push({ frameType: 'sync', syncType, bytes });
      // The provider flips to `synced` on the first SyncStep2 it receives.
      if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        for (const waiter of this.syncWaiters.splice(0)) waiter();
      }
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
    } else if (frameType === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      this.received.push({ frameType: 'awareness', bytes });
      this.awarenessReceived.push(update);
    } else if (frameType === MESSAGE_QUERY_AWARENESS) {
      this.received.push({ frameType: 'query-awareness', bytes });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(this.awareness.getStates().keys()),
        ),
      );
      this.send(encoding.toUint8Array(encoder));
    } else {
      this.received.push({ frameType: 'unknown', bytes });
    }
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  /** Send a non-binary WebSocket frame (a text frame is `invalid` to the room). */
  sendTextFrame(text: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
  }

  /**
   * Apply `fn` to the doc as a purely LOCAL edit that is NOT sent to the room,
   * and return the exact update bytes it produced. This is how the tests create
   * genuinely concurrent edits: both clients edit against the same base state
   * with neither seeing the other first, and the captured updates are then fed
   * to the room through `injectUpdate`.
   */
  makeLocalEdit(fn: (doc: Y.Doc) => void): Uint8Array {
    let captured: Uint8Array | undefined;
    const capture = (update: Uint8Array, origin: unknown) => {
      if (origin === this) captured = update;
    };
    this.doc.on('update', capture);
    try {
      // Origin `this` makes our own relay handler skip sending it.
      this.doc.transact(() => fn(this.doc), this);
    } finally {
      this.doc.off('update', capture);
    }
    if (captured === undefined) throw new Error('local edit produced no update');
    return captured;
  }

  /** Push a captured update to the room as a normal `[sync][update]` frame. */
  injectUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  /**
   * Reconnect on the *same* Y.Doc and awareness (as the browser provider does):
   * drop the socket, open a fresh upgrade to the same board, and send SyncStep1.
   * Used to prove a restarted (empty) room repopulates from the first client.
   */
  async reconnect(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      // already gone
    }
    const res = await SELF.fetch(`http://localhost/api/rooms/${this.boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    if (res.status !== 101) throw new Error(`reconnect expected 101, got ${res.status}`);
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    this.ws = ws;
    this.closeCode = null;
    this.synced = false;
    this.ws.binaryType = 'arraybuffer';
    this.ws.accept();
    this.ws.addEventListener('message', (event: MessageEvent) =>
      this.onFrame(event.data as ArrayBuffer),
    );
    this.ws.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
    });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Broadcast a local awareness state change the way the provider does. */
  setAwareness(field: string, value: unknown): void {
    this.awareness.setLocalStateField(field, value);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  /** How many inbound `update` (not step1/step2) sync frames we have logged. */
  get updateCount(): number {
    return this.received.filter(
      (frame) => frame.frameType === 'sync' && frame.syncType === syncProtocol.messageYjsUpdate,
    ).length;
  }

  clearLog(): void {
    this.received.length = 0;
    this.awarenessReceived.length = 0;
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshotDoc(this.doc);
  }

  waitForSync(timeoutMs = 10_000): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForSync timed out')), timeoutMs);
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(code?: number): void {
    try {
      this.ws.close(code);
    } catch {
      // already closed
    }
    this.awareness.destroy();
  }
}

