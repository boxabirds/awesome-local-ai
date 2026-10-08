import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { writeSyncStep1, writeSyncStep2 } from 'y-protocols/sync.js';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';
import type { NoteSpec } from '../../fixtures/boards';
import { applySpec } from '../../fixtures/boards';

/**
 * A Node-side WebSocket client for the e2e persistence tests (story 4, TC-21).
 *
 * Mirrors the browser y-websocket provider and the integration WsClient: it
 * speaks the real sync protocol against the real `wrangler dev` Worker, so a
 * board can be SEEDED from Node without driving the UI 2000 times.
 *
 * Crucially, `seed(specs)` applies each note as its own transaction, so each
 * note's create + text updates are sent as SEPARATE frames. The room therefore
 * appends one log row per update — a PERSIST_TESTED_NOTES board pushes the log
 * past COMPACTION_UPDATE_COUNT, the room compacts, and the board is stored as
 * a chunked snapshot (the design's D1 = "Snapshotted") rather than one huge
 * log row.
 */

// y-protocols sync sub-message types (y-protocols/sync.js syncMessageType).
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

export class NodeWsClient {
  readonly doc = new Y.Doc();

  private ws: WebSocket;
  private synced = false;
  private syncWaiters: (() => void)[] = [];
  private failed: Error | null = null;
  private failWaiters: ((err: Error) => void)[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    this.doc.on('update', (update, origin) => {
      // Local changes (origin undefined) go to the room; updates the room
      // sent back (origin === this.ws) are not re-sent.
      if (origin !== this.ws) {
        this.sendUpdateFrame(update);
      }
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      this.onMessage(event.data as ArrayBuffer | ArrayBufferView | string);
    });
    ws.addEventListener('error', (): void => {
      this.fail(new Error('websocket error'));
    });
    ws.addEventListener('close', (): void => {
      // A close is not an error by itself; waitForSync/waitForOpen surface it.
    });
    // Kick off the sync dance once the socket is actually open. (Sending in
    // the constructor would be dropped: the socket is still CONNECTING, and
    // rawSend only sends when OPEN.) The room's own SyncStep1 may arrive
    // before 'open' fires; the 'message' listener above is already registered
    // and will answer it with our SyncStep2.
    ws.addEventListener('open', (): void => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeSyncStep1(encoder, this.doc);
      this.rawSend(encoding.toUint8Array(encoder));
    }, { once: true });
  }

  /** Connects to `ws://127.0.0.1:<port>/api/rooms/<boardId>` and opens the socket. */
  static async connect(
    port: number,
    boardId: string,
    timeoutMs = 60_000,
  ): Promise<NodeWsClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${encodeURIComponent(boardId)}`);
    const client = new NodeWsClient(ws);
    await client.waitForOpen(timeoutMs);
    return client;
  }

  private waitForOpen(timeoutMs: number): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      return Promise.reject(this.failed ?? new Error('socket closed before open'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for socket to open')),
        timeoutMs,
      );
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(this.failed ?? new Error('socket error before open'));
      }, { once: true });
    });
  }

  private onMessage(data: ArrayBuffer | ArrayBufferView | string): void {
    const buf = toUint8(data);
    const [messageType, payload] = readHeader(buf);
    if (messageType !== MESSAGE_SYNC) {
      return;
    }
    const decoder = decoding.createDecoder(payload);
    let inner: number;
    try {
      inner = decoding.readVarUint(decoder);
    } catch {
      return;
    }
    if (inner === SYNC_STEP1) {
      const stateVector = decoding.readVarUint8Array(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeSyncStep2(encoder, this.doc, stateVector);
      this.rawSend(encoding.toUint8Array(encoder));
      return;
    }
    if (inner === SYNC_STEP2) {
      const update = decoding.readVarUint8Array(decoder);
      if (update.byteLength > 0) {
        this.doc.transact(() => Y.applyUpdate(this.doc, update, this.ws), this.ws);
      }
      this.synced = true;
      for (const resolve of this.syncWaiters.splice(0)) {
        resolve();
      }
    }
    // SYNC_UPDATE frames (the room echoing others' edits) need no action here:
    // we are the only client, so there are none.
  }

  private rawSend(data: Uint8Array): void {
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private sendUpdateFrame(update: Uint8Array): void {
    // y-websocket sync framing: MESSAGE_SYNC byte, then the raw sync
    // sub-message (SYNC_UPDATE + update bytes, no length prefix).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    this.rawSend(encoding.toUint8Array(encoder));
  }

  private fail(err: Error): void {
    if (this.failed !== null) {
      return;
    }
    this.failed = err;
    for (const reject of this.failWaiters.splice(0)) {
      reject(err);
    }
  }

  /** Resolves once the room has sent us its SyncStep2 (we hold an empty board). */
  waitForSync(timeoutMs = 15_000): Promise<void> {
    if (this.synced) {
      return this.failed === null ? Promise.resolve() : Promise.reject(this.failed);
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for SyncStep2')),
        timeoutMs,
      );
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.failWaiters.push((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Applies `specs` to the local doc. Each note is its own transaction, so
   * each update is handed to the socket as a separate frame (see the class
   * doc). Runs synchronously: by the time it returns, every update has been
   * queued on the socket (in order, ahead of any subsequent close).
   */
  seed(specs: readonly NoteSpec[]): void {
    for (const spec of specs) {
      applySpec(this.doc, spec);
    }
  }

  /** The number of notes currently in the local doc. */
  get noteCount(): number {
    return this.doc.getMap('objects').size;
  }

  /**
   * Polls until the local doc holds at least `count` notes. Used by a second
   * (probe) client to confirm the room has applied + stored the seeded board
   * before the browser loads it.
   */
  async waitForNotes(count: number, timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (this.noteCount >= count) {
        return;
      }
      if (this.failed !== null) {
        throw this.failed;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for ${count} notes; have ${this.noteCount}`);
      }
      await sleep(50);
    }
  }

  close(code = 1000): void {
    try {
      this.ws.close(code);
    } catch {
      // already closed
    }
  }
}

/** Copies an ArrayBuffer/View to a fresh Uint8Array. */
function toUint8(data: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Splits a vidi6 frame into (messageType, payload). */
function readHeader(buf: Uint8Array): [number, Uint8Array] {
  const decoder = decoding.createDecoder(buf);
  const messageType = decoding.readVarUint(decoder);
  return [messageType, decoding.readTailAsUint8Array(decoder)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
