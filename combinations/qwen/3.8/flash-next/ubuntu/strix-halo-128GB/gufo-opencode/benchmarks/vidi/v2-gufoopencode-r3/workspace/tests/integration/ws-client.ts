import * as Y from 'yjs';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../src/shared/protocol';

export interface ReceivedFrame {
  type: number;
  bytes: Uint8Array;
}

export type RoomFetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Minimum time SyncStep1 must have been in flight before a quiet socket
// counts as synced; comfortably above local websocket RTT.
const ROUND_TRIP_GATE_MS = 150;

// A real Y.Doc speaking the y-protocols wire format over a WebSocket
// obtained from a Worker/Durable Object upgrade response — the same framing
// the browser provider uses.
export class RoomClient {
  readonly doc = new Y.Doc();
  readonly frames: ReceivedFrame[] = [];
  private ws!: WebSocket;
  private closedResolve!: (code: number) => void;
  private closedPromise = new Promise<number>((resolve) => {
    this.closedResolve = resolve;
  });
  private paused = false;
  private lastFrameAt = Date.now();
  closeCode: number | null = null;

  static async connect(fetcher: RoomFetcher, url: string): Promise<RoomClient> {
    const client = new RoomClient();
    initDoc(client.doc);
    const ws = await RoomClient.openSocket(fetcher, url);
    client.bindSocket(ws);
    client.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || client.paused) return;
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      client.ws.send(toUint8Array(encoder));
    });
    client.sendSyncStep1();
    return client;
  }

  private static async openSocket(fetcher: RoomFetcher, url: string): Promise<WebSocket> {
    const response = await fetcher(url, { headers: { Upgrade: 'websocket' } });
    const ws = response.webSocket;
    if (ws == null) {
      throw new Error(`no WebSocket in upgrade response (status ${response.status})`);
    }
    return ws;
  }

  private bindSocket(ws: WebSocket): void {
    ws.accept();
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      this.handleFrame(event.data as ArrayBuffer);
    });
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return; // stale socket after reconnect
      this.closeCode = event.code;
      this.closedResolve(event.code);
    });
    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this.closedResolve(1006);
    });
  }

  private handleFrame(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);
    this.frames.push({ type, bytes });
    this.lastFrameAt = Date.now();
    if (type === MESSAGE_SYNC) {
      const replyEncoder = createEncoder();
      syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, 'remote');
      const reply = toUint8Array(replyEncoder);
      if (reply.length > 0) {
        const out = new Uint8Array(reply.length + 1);
        out[0] = MESSAGE_SYNC;
        out.set(reply, 1);
        this.ws.send(out);
      }
    }
  }

  // Re-open a socket to another url with the same doc (used to simulate a
  // reconnect after a room restart). The old socket is closed first and close
  // tracking is reset so waitForClosed reflects the new socket only.
  async reconnect(fetcher: RoomFetcher, url: string): Promise<void> {
    // Detach first so the old socket's close listener short-circuits, then
    // start a fresh close promise for the replacement socket.
    this.ws = undefined as unknown as WebSocket;
    this.closeNow();
    this.closeCode = null;
    this.closedPromise = new Promise<number>((resolve) => {
      this.closedResolve = resolve;
    });
    const ws = await RoomClient.openSocket(fetcher, url);
    this.bindSocket(ws);
    this.sendSyncStep1();
  }

  sendSyncStep1(): void {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.ws.send(toUint8Array(encoder));
  }

  // Suppress outgoing updates so two clients can make concurrent local
  // changes before exchanging (TC-09/10/11).
  pauseSync(): void {
    this.paused = true;
  }

  resumeSync(): void {
    this.paused = false;
    // Deliver everything accumulated while paused, then re-handshake.
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc));
    this.ws.send(toUint8Array(encoder));
    this.sendSyncStep1();
  }

  // Resolve once a full round-trip window has passed since SyncStep1 and
  // no frames arrived for `quietMs` — a practical sync-complete signal on a
  // local machine. The round-trip gate matters: without it a call on an idle
  // socket resolves immediately (stale quiet time) before in-flight data lands.
  waitForSync(quietMs = 80, timeoutMs = 5_000): Promise<void> {
    this.sendSyncStep1();
    const started = Date.now();
    const deadline = started + timeoutMs;
    return new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.closeCode !== null) {
          reject(new Error(`socket closed with code ${this.closeCode}`));
          return;
        }
        if (
          Date.now() - started >= ROUND_TRIP_GATE_MS &&
          Date.now() - this.lastFrameAt >= quietMs
        ) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('timed out waiting for sync'));
          return;
        }
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  async waitForClosed(timeoutMs = 5_000): Promise<number> {
    const timeout = new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error('socket did not close')), timeoutMs)
    );
    return Promise.race([this.closedPromise, timeout]);
  }

  closeNow(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  // Raw frames for malformed-traffic tests (sent verbatim).
  sendRaw(bytes: Uint8Array): void {
    this.ws.send(bytes);
  }

  sendText(text: string): void {
    this.ws.send(text);
  }

  newFramesSince(index: number): ReceivedFrame[] {
    return this.frames.slice(index);
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function connectBoard(
  fetcher: RoomFetcher,
  boardId: string
): Promise<RoomClient> {
  const client = await RoomClient.connect(fetcher, `https://example.com/api/rooms/${boardId}`);
  await client.waitForSync();
  return client;
}
