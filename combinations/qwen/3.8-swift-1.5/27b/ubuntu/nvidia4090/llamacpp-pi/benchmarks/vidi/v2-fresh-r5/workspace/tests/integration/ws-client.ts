/**
 * Integration-test WebSocket client: a real `Y.Doc` speaking the y-websocket
 * framing (sync + awareness) over a real socket obtained from a Worker
 * `fetch` upgrade response — the same wire protocol as the browser provider.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';
import { initDoc, snapshot } from '../../src/shared/board-model';

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

/**
 * Open a WebSocket to `/api/rooms/<boardId>` on the given fetch handler
 * (the Worker via SELF.fetch, or a room stub). Returns the raw socket.
 */
export async function openSocket(
  fetcher: (req: Request) => Promise<Response>,
  boardId: string,
): Promise<WebSocket> {
  const req = new Request(`http://localhost/api/rooms/${boardId}`, {
    headers: UPGRADE_HEADERS,
  });
  const res = await fetcher(req);
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected 101 upgrade, got ${res.status}`);
  }
  const ws = res.webSocket;
  // In the workerd test runtime the stub-side socket must be accepted
  // before it can send (a no-op for already-open sockets).
  ws.accept();
  // Do NOT touch res.body: for a 101 response the body IS the socket stream,
  // and cancelling it closes the WebSocket.
  return ws;
}

/** A synced client: real Y.Doc + y-protocols framing + observation hooks. */
export class WsClient {
  readonly doc: Y.Doc;
  readonly ws: WebSocket;

  /** Count of remote Update frames applied to the doc (not sync steps). */
  receivedUpdates = 0;
  /** Raw awareness payloads received (verbatim bytes), for relay assertions. */
  receivedAwareness: Uint8Array[] = [];

  private synced = false;
  private syncWaiters: Array<() => void> = [];
  private closeInfo: { code: number; reason: string } | null = null;
  private closeWaiters: Array<(info: { code: number; reason: string }) => void> = [];

  constructor(ws: WebSocket, existingDoc?: Y.Doc) {
    this.ws = ws;
    this.doc = existingDoc ?? new Y.Doc();
    initDoc(this.doc);

    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleFrame(event.data as ArrayBuffer);
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closeInfo = { code: event.code, reason: event.reason };
      for (const w of this.closeWaiters.splice(0)) w(this.closeInfo);
    });

    // Mirror the y-websocket provider: send every doc update to the room.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.sendFrame(encoding.toUint8Array(encoder));
    });

    // Kick off the sync: send our SyncStep1.
    this.sendFrame(this.encodeSyncStep1());
  }

  /** True once a SyncStep2 from the room has been applied. */
  get isSynced(): boolean {
    return this.synced;
  }

  /** Wait until the initial sync completes (SyncStep2 received). */
  async waitForSync(timeoutMs = 5000): Promise<void> {
    if (this.synced) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for sync')),
        timeoutMs,
      );
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Wait for the socket to close; resolves with the close info. */
  async waitForClose(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    if (this.closeInfo) return this.closeInfo;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for close')),
        timeoutMs,
      );
      this.closeWaiters.push((info) => {
        clearTimeout(timer);
        resolve(info);
      });
    });
  }

  /** Immutable board snapshot, same shape as the client renders. */
  boardSnapshot() {
    return snapshot(this.doc);
  }

  /** Send raw bytes or a string frame (for malformed-traffic tests). */
  sendRaw(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  /**
   * Send an awareness frame [type][clientID: varuint][state: varuint8array]
   * (relayed verbatim by the room to all sockets, including the sender).
   */
  sendAwareness(clientId: number, state: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint8Array(encoder, state);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  close(): void {
    this.ws.close();
  }

  // --- internals ---------------------------------------------------------

  private handleFrame(data: ArrayBuffer): void {
    const decoded = decodeMessage(data);
    if (decoded.kind !== 'sync') {
      if (decoded.kind === 'awareness') {
        this.receivedAwareness.push(decoded.payload.slice());
      }
      return;
    }
    const decoder = decoding.createDecoder(decoded.payload);
    const encoder = encoding.createEncoder();
    const kind = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (kind === 2) {
      this.receivedUpdates += 1;
    }
    if (kind === 1 && !this.synced) {
      this.synced = true;
      for (const w of this.syncWaiters.splice(0)) w();
    }
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 0) {
      // The encoder holds the raw sync message; wrap it in a sync frame
      // (MESSAGE_SYNC is 0 → one byte) before sending.
      const frame = new Uint8Array(1 + reply.length);
      frame[0] = MESSAGE_SYNC;
      frame.set(reply, 1);
      this.ws.send(frame);
    }
  }

  private encodeSyncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return encoding.toUint8Array(encoder);
  }

  private sendFrame(bytes: Uint8Array): void {
    this.ws.send(bytes);
  }
}
