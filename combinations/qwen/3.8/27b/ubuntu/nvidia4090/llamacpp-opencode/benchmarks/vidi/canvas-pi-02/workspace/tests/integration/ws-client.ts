import { SELF, env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import { initDoc, snapshot } from '../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  MESSAGE_SYNC_ACK,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
} from '../../src/shared/protocol';

/**
 * A minimal y-websocket client for integration tests.
 *
 * It speaks the same binary frame protocol as the y-websocket provider
 * (sync + awareness framing identical to y-websocket), so the room cannot
 * tell it apart. It is deliberately not the real provider: the pool's
 * runtime has no browser WebSocket, and the provider adds reconnect
 * machinery the room tests do not need.
 */
export interface ClosedInfo {
  code: number;
  reason: string;
}

/** One received frame, kept in order in `received`. */
export interface ReceivedFrame {
  kind: 'sync-step1' | 'sync-step2' | 'sync-update' | 'awareness';
  /** The payload after the frame type byte: sync message or awareness update. */
  payload: Uint8Array;
}

export class WsClient {
  readonly doc: Y.Doc;
  /** Resolves once the initial SyncStep2 from the room has been applied. */
  readonly synced: Promise<void>;
  /** Resolves when the connection is closed, by either side. */
  readonly closed: Promise<ClosedInfo>;
  /** Every frame received, in order. */
  readonly received: ReceivedFrame[] = [];
  /** Story 13: number of sync acks received. */
  private ackCount = 0;

  private readonly ws: WebSocket;
  private readonly closeWaiters: Array<(info: ClosedInfo) => void> = [];
  private readonly noteWaiters: Array<{ id: string; resolve: (note: Y.Map) => void }> = [];
  private closedInfo: ClosedInfo | null = null;
  private syncResolve: ((value: void) => void) | null = null;
  private paused = false;
  private localBuffer: Uint8Array[] = [];
  private remoteBuffer: Uint8Array[] = [];

  constructor(
    ws: WebSocket,
    { autoSync = true, doc = new Y.Doc() }: { autoSync?: boolean; doc?: Y.Doc } = {},
  ) {
    this.doc = doc;
    initDoc(this.doc);
    this.ws = ws;
    this.synced = new Promise((resolve) => {
      this.syncResolve = resolve;
    });
    this.closed = new Promise((resolve) => {
      this.closeWaiters.push(resolve);
    });
    ws.accept();
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      this.onMessage(new Uint8Array(event.data as ArrayBuffer));
    };
    const onGone = (info: ClosedInfo): void => {
      this.closedInfo = info;
      for (const wait of this.closeWaiters.splice(0)) {
        wait(info);
      }
    };
    ws.onclose = (event) => {
      onGone({ code: event.code, reason: event.reason });
    };
    ws.oncancel = () => {
      onGone({ code: 1005, reason: 'cancelled' });
    };
    // Push our own updates to the room, like the provider does.
    this.doc.on('update', (update, origin) => {
      if (origin === 'room') return;
      if (this.paused) {
        this.localBuffer.push(update);
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(updateFrame(update));
      }
    });
    if (autoSync) {
      // The client initiates the handshake with SyncStep1.
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      ws.send(toUint8Array(encoder));
    }
  }

  /** Alias matching the helper contract in the task sheet. */
  waitForSync(): Promise<void> {
    return this.synced;
  }

  /** Immutable view of the board content, like the client renders it. */
  snapshot() {
    return snapshot(this.doc);
  }

  /** How many sync Update frames (kind 'sync-update') have been received. */
  get updateCount(): number {
    return this.received.filter((f) => f.kind === 'sync-update').length;
  }

  /** Awareness frames received, in order (raw payload after the type byte). */
  get awarenessFrames(): Uint8Array[] {
    return this.received.filter((f) => f.kind === 'awareness').map((f) => f.payload);
  }

  /** Story 13: number of sync ack frames received. */
  get syncAckCount(): number {
    return this.ackCount;
  }

  private onMessage(bytes: Uint8Array): void {
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);
    if (type === MESSAGE_SYNC_ACK) {
      this.ackCount++;
      return;
    }
    if (type === MESSAGE_AWARENESS) {
      // Record only: the room tests assert the relayed bytes (TC-16), not
      // the applied presence state (that is story 6).
      const update = readVarUint8Array(decoder);
      this.received.push({ kind: 'awareness', payload: update });
      return;
    }
    if (type !== MESSAGE_SYNC) {
      return;
    }
    // Faithful to the y-websocket client, which processes at most one top-
    // level message per WebSocket frame (its `readMessage` has no loop). A
    // room that concatenates [Step2, Step1] into a single frame would have
    // its Step1 dropped by every real browser — so this client must not be
    // more lenient than the one in production.
    const response = createEncoder();
    let responseStarted = false;
    const syncType = readVarUint(decoder);
    if (syncType === SYNC_STEP1) {
      this.received.push({ kind: 'sync-step1', payload: readVarUint8Array(decoder) });
      // The room asks for what it is missing.
      const serverStateVector = this.received[this.received.length - 1].payload;
      if (!responseStarted) {
        writeVarUint(response, MESSAGE_SYNC);
        responseStarted = true;
      }
      // An empty binary state vector would make yjs throw; stand one in.
      const sv =
        serverStateVector.length > 0 ? serverStateVector : Y.encodeStateVector(new Y.Doc());
      syncProtocol.writeSyncStep2(response, this.doc, sv);
    } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
      const update = readVarUint8Array(decoder);
      this.received.push({
        kind: syncType === SYNC_STEP2 ? 'sync-step2' : 'sync-update',
        payload: update,
      });
      if (this.paused) {
        this.remoteBuffer.push(update);
      } else {
        if (update.length > 0) {
          Y.applyUpdate(this.doc, update, 'room');
        }
        if (syncType === SYNC_STEP2 && this.syncResolve !== null) {
          this.syncResolve();
          this.syncResolve = null;
        }
        this.settleNoteWaiters();
      }
    }
    if (responseStarted && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(toUint8Array(response));
    }
  }

  /** Send one raw frame (binary or string) — for the malformed-frame tests. */
  sendRaw(frame: Uint8Array | string): void {
    this.ws.send(frame);
  }

  /**
   * While paused, local updates are not sent and incoming updates are not
   * applied. Resuming applies the pending remote updates, then sends the
   * pending local ones — how the concurrency tests (TC-09, TC-10, TC-11)
   * build real "before exchange" edits.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) return;
    for (const u of this.remoteBuffer) {
      if (u.length > 0) Y.applyUpdate(this.doc, u, 'room');
    }
    this.remoteBuffer = [];
    this.settleNoteWaiters();
    for (const u of this.localBuffer) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(updateFrame(u));
      }
    }
    this.localBuffer = [];
  }

  /** Send an awareness update frame for this client's doc client. */
  sendAwareness(update: Uint8Array): void {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_AWARENESS);
    writeVarUint8Array(encoder, update);
    this.ws.send(toUint8Array(encoder));
  }

  /** Encode an awareness update announcing this client with the given state. */
  encodeAwareness(state: unknown): Uint8Array {
    const awareness = new Awareness(this.doc);
    awareness.setLocalState(state);
    return awarenessProtocol.encodeAwarenessUpdate(awareness, [this.doc.clientID]);
  }

  /** Resolves with the note once it has arrived in this client's doc. */
  waitForNote(id: string, timeoutMs = 10_000): Promise<Y.Map> {
    const existing = this.doc.getMap('objects').get(id);
    if (existing instanceof Y.Map) {
      return Promise.resolve(existing);
    }
    return new Promise<Y.Map>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`note ${id} did not arrive within ${timeoutMs}ms`)),
        timeoutMs,
      );
      this.noteWaiters.push({
        id,
        resolve: (note) => {
          clearTimeout(timer);
          resolve(note);
        },
      });
    });
  }

  private settleNoteWaiters(): void {
    const objects = this.doc.getMap('objects');
    for (let i = this.noteWaiters.length - 1; i >= 0; i--) {
      const waiter = this.noteWaiters[i];
      const note = objects.get(waiter.id);
      if (note instanceof Y.Map) {
        this.noteWaiters.splice(i, 1);
        waiter.resolve(note);
      }
    }
  }

  /** Local close (fire-and-forget): the pool runtime does not complete the
   * close handshake on the initiating side, so tests must not await `closed`
   * after this. The room (passive side) does receive its close event. */
  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  /** The close code/reason once the connection has closed. */
  get closeCode(): number | null {
    return this.closedInfo?.code ?? null;
  }
}

/** Open an (optionally auto-syncing) WebSocket client on the given board. */
async function openClient(
  boardId: string,
  options: { autoSync?: boolean; doc?: Y.Doc; skipInit?: boolean } = {},
): Promise<WsClient> {
  // Story 5: the BoardRoom.fetch() handler auto-initializes boards that
  // have no tables (lazy migration, backward-compatible with stories 1-4).
  // No explicit initialization needed here.
  const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
  });
  if (res.status !== 101) {
    throw new Error(`expected 101 Switching Protocols, got ${res.status}`);
  }
  const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
  return new WsClient(ws, options);
}

/** Connect a client that completes the y-websocket sync handshake. */
export const connectClient = (
  boardId: string,
  options: { skipInit?: boolean } = {},
): Promise<WsClient> => openClient(boardId, options);

/**
 * Reconnect with an EXISTING doc — a tab that was offline keeps its Y.Doc,
 * so the room must merge both directions: push what it missed and pull what
 * the others made meanwhile.
 */
export const connectClientWithDoc = (boardId: string, doc: Y.Doc): Promise<WsClient> =>
  openClient(boardId, { doc });

/** Connect a client that sends nothing until told to (malformed-frame tests). */
export const connectRawClient = (boardId: string): Promise<WsClient> =>
  openClient(boardId, { autoSync: false });

/** A well-formed frame carrying exactly one y-protocols sync message. */
export function syncFrame(inner: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + inner.length);
  out[0] = MESSAGE_SYNC;
  out.set(inner, 1);
  return out;
}

/** Number of sticky notes in a doc. */
export function noteCount(doc: Y.Doc): number {
  return doc.getMap('objects').size;
}

/** A well-formed sync Update frame for the given binary update. */
export function updateFrame(update: Uint8Array): Uint8Array {
  const inner = createEncoder();
  writeVarUint(inner, SYNC_UPDATE);
  writeVarUint8Array(inner, update);
  return syncFrame(toUint8Array(inner));
}

/** A well-formed awareness frame for the given awareness update. */
export function awarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_AWARENESS);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

/** Byte-equality for the awareness relay test. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
