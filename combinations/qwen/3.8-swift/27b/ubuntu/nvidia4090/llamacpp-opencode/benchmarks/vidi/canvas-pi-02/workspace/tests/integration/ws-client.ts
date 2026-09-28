// Test client for the BoardRoom integration tests: a real Y.Doc speaking the
// y-websocket protocol over a real WebSocket obtained from a SELF.fetch
// upgrade response — the same framing the browser provider uses. No mocks.

import { createDecoder, readTailAsUint8Array, readVarUint, readVarUint8Array } from 'lib0/decoding';
import {
  createEncoder,
  toUint8Array,
  writeUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';

export interface ReceivedMessage {
  /** Outer frame type (0 = sync, 1 = awareness). */
  type: number;
  /** Body after the frame type byte: the raw inner sync message for sync,
   *  the awareness update for awareness. */
  payload: Uint8Array;
  /** Inner sync message type when type === MESSAGE_SYNC. */
  syncType?: number;
}

export class RoomClient {
  readonly doc: Y.Doc;
  readonly ws: WebSocket;
  /** Every frame received, in order. */
  readonly messages: ReceivedMessage[] = [];
  private closedInfo: { code: number; reason: string } | null = null;
  private closedWaiters: Array<(info: { code: number; reason: string }) => void> = [];
  private serverSyncStep1Received = false;
  private serverSyncStep2Received = false;
  private syncWaiters: Array<() => void> = [];
  private syncResolved = false;

  constructor(ws: WebSocket, doc?: Y.Doc) {
    this.ws = ws;
    this.doc = doc ?? new Y.Doc();
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data as ArrayBuffer);
    ws.onclose = (ev: CloseEvent) => {
      this.closedInfo = { code: ev.code, reason: ev.reason };
      this.closedWaiters.splice(0).forEach((w) => w(this.closedInfo!));
    };
    ws.onerror = () => {};
    // Client-initiated sync: send our own SyncStep1, exactly like the
    // y-websocket provider does on socket open.
    const step1 = createEncoder();
    sync.writeSyncStep1(step1, this.doc);
    ws.send(syncFrame(toUint8Array(step1)));
    // Forward local doc updates to the room (the provider does this too);
    // updates we applied ourselves (origin === this) are not resent.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const enc = createEncoder();
      sync.writeUpdate(enc, update);
      this.sendSync(toUint8Array(enc));
    });
  }

  static async connect(boardId: string, doc?: Y.Doc): Promise<RoomClient> {
    const resp = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${boardId}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    );
    const ws = resp.webSocket;
    if (resp.status !== 101 || ws === null || ws === undefined) {
      throw new Error(`expected 101 upgrade, got ${resp.status}`);
    }
    // The client end of a workerd WebSocketPair must be accepted before use.
    await ws.accept();
    return new RoomClient(ws, doc);
  }

  private onMessage(data: ArrayBuffer): void {
    try {
      const decoder = createDecoder(new Uint8Array(data));
      const type = readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        // Raw inner sync message (no varBytes wrapper) — the y-websocket format.
        const payload = readTailAsUint8Array(decoder);
        const syncType = readVarUint(createDecoder(payload));
        this.messages.push({ type, payload, syncType });
        if (syncType === sync.messageYjsSyncStep1) {
          this.serverSyncStep1Received = true;
        } else if (syncType === sync.messageYjsSyncStep2) {
          this.serverSyncStep2Received = true;
        }
        // Answer with whatever the sync protocol wants (SyncStep2 replies,
        // empty otherwise) and apply any updates to our doc.
        const enc = createEncoder();
        sync.readSyncMessage(createDecoder(payload), enc, this.doc, this);
        const reply = toUint8Array(enc);
        if (reply.length > 0) this.sendSync(reply);
        this.maybeResolveSync();
      } else {
        const payload =
          type === MESSAGE_AWARENESS
            ? (readVarUint8ArraySafe(decoder) ?? new Uint8Array(0))
            : new Uint8Array(0);
        this.messages.push({ type, payload });
      }
    } catch {
      // Malformed frame: record nothing (the room closes such sockets).
    }
    this.maybeResolveSync();
  }

  private maybeResolveSync(): void {
    // Synced once the server's SyncStep1 AND the server's (possibly empty)
    // SyncStep2 reply to our SyncStep1 have both been received.
    if (!this.syncResolved && this.serverSyncStep1Received && this.serverSyncStep2Received) {
      this.syncResolved = true;
      this.syncWaiters.splice(0).forEach((w) => w());
    }
  }

  /** Resolves when the initial sync exchange is complete. */
  async waitForSync(timeoutMs = 10_000): Promise<void> {
    if (this.syncResolved) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('waitForSync timed out')),
        timeoutMs,
      );
      this.syncWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Resolves with the close code/reason when the server closes us. */
  waitForClose(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    if (this.closedInfo !== null) return Promise.resolve(this.closedInfo);
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('waitForClose timed out')),
        timeoutMs,
      );
      this.closedWaiters.push((info) => {
        clearTimeout(t);
        resolve(info);
      });
    });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING;
  }

  get closed(): { code: number; reason: string } | null {
    return this.closedInfo;
  }

  get notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  sendSync(message: Uint8Array): void {
    this.ws.send(syncFrame(message));
  }

  sendRaw(data: ArrayBuffer | string | Uint8Array): void {
    this.ws.send(data);
  }

  /** Frames a raw (unframed) payload with outer type `type`. */
  sendFramed(type: number, payload: Uint8Array): void {
    const enc = createEncoder();
    writeVarUint(enc, type);
    writeVarUint8Array(enc, payload);
    this.ws.send(toUint8Array(enc));
  }

  sendAwareness(payload: Uint8Array): void {
    this.sendFramed(MESSAGE_AWARENESS, payload);
  }

  /** Updates received (inner type Update) after `index`. */
  updateMessages(fromIndex = 0): ReceivedMessage[] {
    return this.messages
      .slice(fromIndex)
      .filter((m) => m.type === MESSAGE_SYNC && m.syncType === sync.messageYjsUpdate);
  }

  close(): void {
    this.ws.close();
  }
}

function readVarUint8ArraySafe(decoder: ReturnType<typeof createDecoder>): Uint8Array | null {
  try {
    return readVarUint8Array(decoder);
  } catch {
    return null;
  }
}

/** Frames a complete y-protocols sync message as a type-0 frame: the inner
 *  sync message follows the type byte RAW (no varBytes wrapper), exactly as
 *  the y-websocket provider frames it. */
export function syncFrame(message: Uint8Array): Uint8Array {
  const enc = createEncoder();
  writeVarUint(enc, MESSAGE_SYNC);
  writeUint8Array(enc, message);
  return toUint8Array(enc);
}

/**
 * Exact replica of `doc` (same client ids/clocks, so inserts in one replica
 * and the other target the SAME base items — required for deterministic
 * concurrent-merge tests).
 */
export function replicate(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

/**
 * Builds a local Y.Doc containing one sticky note (fixed id, given text and
 * position) — used to stage concurrent edits before two clients connect.
 */
export function makeStickyDoc(
  id: string,
  text: string,
  x = 0,
  y = 0,
): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'sticky');
    entry.set('x', x);
    entry.set('y', y);
    entry.set('color', 'yellow');
    entry.set('text', new Y.Text());
    entry.set('z', 1);
    entry.set('createdAt', 0);
    doc.getMap('objects').set(id, entry);
  });
  if (text !== '') getStickyText(doc, id)?.insert(0, text);
  return doc;
}

/** Convenience: create a sticky in a client's doc and return its id. */
export function createNote(client: RoomClient, x: number, y: number, color?: string): string {
  const id = createSticky(client.doc, { x, y }, color as never);
  if (id === '') throw new Error('createSticky failed');
  return id;
}
