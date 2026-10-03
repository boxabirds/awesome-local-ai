/**
 * Minimal raw y-protocols sync/awareness client over a workerd WebSocket,
 * for driving the BoardRoom from integration tests (no y-websocket).
 *
 * Runs in the Cloudflare workers pool: the upgrade is performed with
 * `SELF.fetch`, and the returned client WebSocket is `accept()`ed (this
 * workerd build requires both sides of the pair to be accepted).
 *
 * Speaks the same wire format as the worker:
 *   [type varuint][payload]  where type 0 = sync, 1 = awareness.
 * Sync payloads carry the raw submessage bytes; awareness payloads carry a
 * length-prefixed varuint8Array blob.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SELF } from 'cloudflare:test';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../../src/shared/protocol';

/**
 * Create a real board through the worker API (story 5: rooms are only
 * accepted for boards that exist), and return its id.
 */
export async function createBoardViaWorker(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}
// Remote updates are applied with this origin; the 'update' handler skips
// them so they are not echoed back to the room. Every other origin (local
// board-model edits, direct Y.Text mutations, ...) is forwarded.
const REMOTE_ORIGIN = 'integration-test-client';

export interface CloseInfo {
  code: number;
  reason: string;
}

export class RoomClient {
  readonly doc: Y.Doc;
  private ws: WebSocket | null = null;
  private closed: Promise<CloseInfo> | null = null;
  private boardId: string;

  // Sync state tracking
  private serverWasEmpty = false;
  private receivedServerStep2 = false;
  private sentOwnStep2 = false;
  private clientWasEmpty = false;
  private updateCount = 0;
  private syncStep1Seen = false;

  // Awareness tracking
  private awarenessReceived: Uint8Array[] = [];

  constructor(boardId: string) {
    this.boardId = boardId;
    this.doc = new Y.Doc();
    this.doc.on('update', (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.sendBytes(enc);
    });
  }

  get socket(): WebSocket {
    if (!this.ws) throw new Error('not connected');
    return this.ws;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === 1; // WebSocket.OPEN
  }

  async connect(): Promise<void> {
    const res = await SELF.fetch(`http://localhost/api/rooms/${this.boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    if (res.status !== 101) {
      throw new Error(`expected 101 upgrade, got ${res.status}`);
    }
    const ws = res.webSocket as (WebSocket & { accept(): void }) | null;
    if (!ws) throw new Error('no webSocket on upgrade response');
    // workerd 2026: both sides of a WebSocketPair must be accept()ed before use.
    ws.accept();
    this.ws = ws;
    ws.onmessage = (event) => this.onMessage(event.data as ArrayBuffer);
    ws.onclose = (event) => {
      this.closed ??= Promise.resolve({ code: event.code, reason: event.reason });
    };
    ws.onerror = () => {
      this.closed ??= Promise.resolve({ code: 1006, reason: 'error' });
    };

    // Initiate the reverse sync: send our state vector so the server replies
    // with the state we lack (mirrors y-websocket's WebsocketProvider).
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.sendBytes(enc);
  }

  private sendBytes(encoder: encoding.Encoder): void {
    const bytes = encoding.toUint8Array(encoder);
    this.ws?.send(bytes);
  }

  private onMessage(data: ArrayBuffer): void {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const tail = decoding.readTailAsUint8Array(decoder);
      const sub = decoding.peekVarUint(decoding.createDecoder(tail));
      if (sub === 0) {
        this.syncStep1Seen = true;
        const svDecoder = decoding.createDecoder(tail);
        decoding.readVarUint(svDecoder); // submessage type
        this.serverWasEmpty = decoding.readVarUint8Array(svDecoder).byteLength === 0;
      } else if (sub === 1) {
        this.receivedServerStep2 = true;
      }
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      try {
        syncProtocol.readSyncMessage(
          decoding.createDecoder(tail),
          reply,
          this.doc,
          REMOTE_ORIGIN,
          (e) => {
            throw e;
          },
        );
      } catch {
        return;
      }
      if (sub === 2) this.updateCount += 1;
      if (sub === 0) {
        this.clientWasEmpty = Y.encodeStateVector(this.doc).byteLength === 0;
        this.sentOwnStep2 = !this.clientWasEmpty && encoding.length(reply) > 2 + 1;
      }
      if (encoding.length(reply) > 1) this.sendBytes(reply);
    } else if (type === MESSAGE_AWARENESS) {
      const blob = decoding.createDecoder(decoding.readTailAsUint8Array(decoder));
      this.awarenessReceived.push(decoding.readVarUint8Array(blob));
    }
  }

  /**
   * Synced once the state exchange is complete in both directions:
   *  - we have everything the server had (it sent a SyncStep2, or it was empty), and
   *  - the server has everything we had (we sent a SyncStep2, or we were empty).
   */
  get isSynced(): boolean {
    if (!this.syncStep1Seen) return false;
    const hasServerState = this.receivedServerStep2 || this.serverWasEmpty;
    const serverHasOurState = this.sentOwnStep2 || this.clientWasEmpty;
    return hasServerState && serverHasOurState;
  }

  async waitForSync(timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isSynced) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for sync');
  }

  async waitForClose(timeoutMs = 8000): Promise<CloseInfo> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.closed) return this.closed;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for close');
  }

  /** Number of Update (submessage type 2) frames received. */
  get updatesReceived(): number {
    return this.updateCount;
  }

  get awarenessCount(): number {
    return this.awarenessReceived.length;
  }

  lastAwareness(): Uint8Array | undefined {
    return this.awarenessReceived[this.awarenessReceived.length - 1];
  }

  /** Send a raw (possibly malformed) frame. */
  sendRaw(data: ArrayBuffer | string): void {
    this.ws?.send(data);
  }

  /** Send an awareness frame with the given payload bytes. */
  sendAwareness(bytes: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, bytes);
    this.sendBytes(enc);
  }

  /** Send a sync frame wrapping the given raw submessage bytes. */
  sendSyncSubmessage(subBytes: Uint8Array): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeUint8Array(enc, subBytes);
    this.sendBytes(enc);
  }

  close(code = 1000, reason = ''): void {
    this.ws?.close(code, reason);
  }
}
