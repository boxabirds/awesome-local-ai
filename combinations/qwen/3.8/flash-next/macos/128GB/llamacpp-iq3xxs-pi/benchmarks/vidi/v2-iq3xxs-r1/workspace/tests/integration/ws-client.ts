import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

/**
 * A board client that speaks exactly the same framing as the browser provider:
 * a real `Y.Doc`, real `y-protocols` sync/awareness messages, and a real
 * WebSocket obtained from a `SELF.fetch` upgrade response (design "Fixtures").
 * Nothing about the room is mocked: the only difference from a browser tab is
 * that the socket was produced by workerd instead of a `new WebSocket(url)`.
 */
export class RoomClient {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;

  /** Every frame the room sent, in arrival order. */
  readonly frames: { type: number; bytes: Uint8Array }[] = [];
  /** Every frame this client sent, for byte-for-byte relay assertions (TC-16). */
  readonly sent: Uint8Array[] = [];
  /** `messageYjsUpdate` frames only: what a real change costs on the wire. */
  readonly updates: Uint8Array[] = [];
  /** `messageAwareness` frames, verbatim. */
  readonly awarenessFrames: Uint8Array[] = [];

  private ws: WebSocket | null = null;
  private closedWith: { code: number; reason: string } | null = null;
  private closeWaiters: ((value: { code: number; reason: string }) => void)[] = [];
  synced = false;

  /** Mutable: a room restart gives the same client a fresh room to dial. */
  constructor(public boardId: string, readonly label: string) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    initDoc(this.doc);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this || !this.ws) return; // no echo, and nothing before connect()
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.sendRaw(encoding.toUint8Array(encoder));
    });
    this.awareness.on('update', (change: { added: number[]; updated: number[]; removed: number[] }) => {
      if (!this.ws) return;
      const { added, updated, removed } = change;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, added.concat(updated).concat(removed)),
      );
      this.sendRaw(encoding.toUint8Array(encoder));
    });
  }

  /** Drop this socket and reopen one, optionally on another room (TC-18). */
  async reconnect(boardId = this.boardId): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
    this.closedWith = null;
    this.synced = false;
    this.boardId = boardId;
    await this.open();
  }

  /** Forget everything received so far, so counts are per-assertion. */
  clearLog(): void {
    this.frames.length = 0;
    this.updates.length = 0;
    this.awarenessFrames.length = 0;
    this.sent.length = 0;
  }

  /** Await the first SyncStep2, i.e. the point a real tab has the board. */
  async waitForSync(timeoutMs = 5000): Promise<void> {
    await this.waitFor(() => this.synced, 'initial sync (SyncStep2)', timeoutMs);
  }

  /** A fresh board id, never a hand-written string (design "Fixtures"). */
  static newBoardId(): string {
    return newBoardId();
  }

  /** Open the websocket through the real Worker route. */
  static async connect(boardId: string, label = 'client'): Promise<RoomClient> {
    const client = new RoomClient(boardId, label);
    await client.open();
    return client;
  }

  /** Raw upgrade: exposes the status code so routing tests can assert 400/426. */
  static async rawUpgrade(
    boardId: string,
    upgradeHeader: string | null,
  ): Promise<Response> {
    const headers = new Headers();
    if (upgradeHeader !== null) headers.set('Upgrade', upgradeHeader);
    return SELF.fetch(`http://worker/api/rooms/${boardId}`, { headers });
  }

  private async open(): Promise<void> {
    const response = await RoomClient.rawUpgrade(this.boardId, 'websocket');
    // The room accepted the *server* half of its WebSocketPair and handed the
    // client half back on the 101 response (`Response.webSocket` in workerd).
    const ws = response.webSocket;
    if (response.status !== 101 || !ws) {
      throw new Error(`upgrade to ${this.boardId} failed: ${response.status}`);
    }
    // The room accepted its half; whoever receives the other half accepts it here
    // before sending or reading, exactly like `new WebSocket(url)` does implicitly.
    ws.accept();
    this.ws = ws;
    ws.addEventListener('message', (event: MessageEvent) => this.onFrame(event.data as ArrayBuffer));
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closedWith = { code: event.code, reason: event.reason };
      for (const waiter of this.closeWaiters.splice(0)) waiter(this.closedWith!);
    });
    ws.addEventListener('error', () => {
      /* observed through `close` */
    });
    // Same first message the browser provider sends (design sequence "connect and
    // initial sync"): the room answers with its whole document.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.sendRaw(encoding.toUint8Array(encoder));
  }

  private onFrame(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    this.frames.push({ type, bytes });

    if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const syncType = syncProtocol.readSyncMessage(
        decoding.createDecoder(bytes.subarray(decoder.pos)),
        reply,
        this.doc,
        this,
      );
      if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (syncType === syncProtocol.messageYjsUpdate) {
        this.updates.push(bytes.subarray(decoder.pos));
      }
      if (encoding.length(reply) > 1) this.sendRaw(encoding.toUint8Array(reply));
      return;
    }
    if (type === MESSAGE_AWARENESS) {
      const awarenessUpdate = decoding.readVarUint8Array(decoder);
      this.awarenessFrames.push(awarenessUpdate);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, awarenessUpdate, this);
      return;
    }
    if (type === MESSAGE_QUERY_AWARENESS) return;
  }

  /** Send bytes verbatim, exactly as a browser provider would. */
  sendRaw(bytes: Uint8Array | ArrayBuffer): void {
    if (!this.ws) throw new Error(`${this.label}: socket is not open`);
    const payload = bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : bytes;
    this.sent.push(payload);
    this.ws.send(payload);
  }

  /** A text frame, which this protocol never uses (TC-15). */
  sendText(text: string): void {
    if (!this.ws) throw new Error(`${this.label}: socket is not open`);
    this.sent.push(Uint8Array.from([text.length]));
    this.ws.send(text);
  }

  /** Close the socket but keep the document, i.e. a tab whose network dropped. */
  disconnect(): void {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
    this.synced = false;
  }

  get disconnected(): boolean {
    return this.ws === null;
  }

  sendAwarenessOf(clients: number[]): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
    this.sendRaw(encoding.toUint8Array(encoder));
  }

  /** Wait until `predicate` holds for this client's frames, or fail. */
  async waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(
          `${this.label}: ${label} not reached after ${timeoutMs}ms ` +
            `(frames=${this.frames.length}, updates=${this.updates.length})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Resolve with the close code the room used for this socket. */
  async closed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    if (this.closedWith) return this.closedWith;
    const pending = new Promise<{ code: number; reason: string }>((resolve) => {
      this.closeWaiters.push(resolve);
    });
    return Promise.race([
      pending,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`${this.label}: socket did not close`)), timeoutMs),
      ),
    ]);
  }

  /** Board snapshot, exactly what a client would paint. */
  get notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Canonical comparison value: every note, in paint order, with its text. */
  get state(): string {
    return JSON.stringify(this.notes);
  }

  get socket(): WebSocket | null {
    return this.ws;
  }

  /** Close the socket and stop the awareness heartbeat. */
  destroy(): void {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.awareness.destroy();
  }
}

/** Wait until every client reports the same board state. */
export async function waitForConvergence(clients: RoomClient[], timeoutMs = 10_000): Promise<string> {
  const first = clients[0];
  if (!first) throw new Error('no clients');
  await first.waitFor(
    () => clients.every((client) => client.state === first.state),
    'all clients converged',
    timeoutMs,
  );
  return first.state;
}
