/**
 * WebSocket test client for integration tests (design: mock vs real
 * boundaries).
 *
 * Real Y.Doc, real protocol frames, real workerd WebSocket against the
 * deployed Worker — no mocks. Mirrors what the browser y-websocket provider
 * does: send SyncStep1 on connect, answer SyncStep1 with SyncStep2, send
 * every local document update, and apply incoming updates/step2.
 */

import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { writeSyncStep1, writeSyncStep2 } from 'y-protocols/sync.js';
import {
  createSticky,
  deleteObject,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../../../src/shared/protocol';

// y-protocols sync message types (y-protocols/sync.js syncMessageType).
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

/** Replaces a note's full text (transactional, local origin). */
function replaceText(doc: Y.Doc, id: string, text: string): void {
  const entry = doc.getMap('objects').get(id);
  if (!(entry instanceof Y.Map)) {
    return;
  }
  const noteText = entry.get('text');
  if (!(noteText instanceof Y.Text)) {
    return;
  }
  doc.transact(() => {
    if (noteText.length > 0) {
      noteText.delete(0, noteText.length);
    }
    noteText.insert(0, text);
  });
}

export class WsClient {
  readonly doc: Y.Doc;
  readonly ws: WebSocket;
  /** Every frame received, decoded (malformed frames decode to invalid). */
  readonly received: Decoded[] = [];
  /** Number of applied document Update frames. */
  updateCount = 0;
  closed = false;
  closeCode: number | null = null;

  private suspended = false;
  private pending: Uint8Array[] = [];
  private syncWaiters: (() => void)[] = [];
  private synced = false;

  private constructor(ws: WebSocket, initialState: Uint8Array | null) {
    this.doc = new Y.Doc();
    if (initialState !== null) {
      Y.applyUpdate(this.doc, initialState, this.doc);
    }
    // Story 4: the room owns meta.schemaVersion (applied under LOAD_ORIGIN
    // after load); clients never write it.
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    this.doc.on('update', (update, origin) => {
      // Local changes (origin undefined) are sent to the room; updates the
      // room sent back (origin === this.ws) are not re-sent.
      if (origin !== this.ws) {
        this.sendSyncUpdate(update);
      }
    });

    ws.addEventListener('message', (event: MessageEvent): void => {
      this.onMessage(event.data as ArrayBuffer | ArrayBufferView | string);
    });
    ws.addEventListener('close', (event: CloseEvent): void => {
      this.closed = true;
      this.closeCode = event.code;
    });

    // Kick off the sync dance: tell the room what we have (empty for a
    // fresh client).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  static async connect(
    boardId: string,
    options: { baseUrl?: string; initialState?: Uint8Array | null } = {},
  ): Promise<WsClient> {
    const baseUrl = options.baseUrl ?? 'http://localhost';
    const response = await SELF.fetch(`${baseUrl}/api/rooms/${encodeURIComponent(boardId)}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    if (response.status !== 101 || response.webSocket === null) {
      throw new Error(`expected 101 upgrade for ${boardId}, got ${response.status}`);
    }
    // Across the Durable Object stub boundary the socket handed back to
    // SELF.fetch is the un-accepted (server) half of the tunnel; accept it
    // so frames flow both ways.
    response.webSocket.accept();
    return new WsClient(response.webSocket, options.initialState ?? null);
  }

  private onMessage(data: ArrayBuffer | ArrayBufferView | string): void {
    const decoded = decodeMessage(data);
    this.received.push(decoded);
    if (decoded.kind !== 'sync') {
      return;
    }
    const decoder = decoding.createDecoder(decoded.payload);
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
      this.send(encoding.toUint8Array(encoder));
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
      return;
    }
    if (inner === SYNC_UPDATE) {
      const update = decoding.readVarUint8Array(decoder);
      this.updateCount += 1;
      this.doc.transact(() => Y.applyUpdate(this.doc, update, this.ws), this.ws);
    }
  }

  private send(data: Uint8Array): void {
    try {
      this.ws.send(data);
    } catch {
      this.closed = true;
    }
  }

  private sendSyncUpdate(update: Uint8Array): void {
    // y-websocket sync framing: MESSAGE_SYNC type byte followed by the RAW
    // y-protocols update sub-message (no length prefix).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    if (this.suspended) {
      this.pending.push(frame);
      return;
    }
    this.send(frame);
  }

  /** TC-09 to TC-11: hold local updates back so both sides change first. */
  suspendSend(): void {
    this.suspended = true;
  }

  resumeSend(): void {
    this.suspended = false;
    for (const frame of this.pending.splice(0)) {
      this.send(frame);
    }
  }

  /** Resolves once the room has sent us its SyncStep2. */
  waitForSync(timeoutMs = 5000): Promise<void> {
    if (this.synced) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for SyncStep2')),
        timeoutMs,
      );
      this.syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Resolves once the predicate over our objects holds. */
  async waitForObjects(
    predicate: (objects: readonly StickySnapshot[]) => boolean,
    timeoutMs = 5000,
  ): Promise<readonly StickySnapshot[]> {
    const started = Date.now();
    for (;;) {
      const objects = this.objects();
      if (predicate(objects)) {
        return objects;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `timed out waiting for objects; got ${JSON.stringify(
            objects.map((o) => o.text),
          )}`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Resolves once both clients show the same set of notes. */
  async waitForConvergence(other: WsClient, timeoutMs = 5000): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (sameNotes(this.objects(), other.objects())) {
        return;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          'timed out waiting for convergence: ' +
            JSON.stringify(this.objects().map((o) => o.text)) +
            ' vs ' +
            JSON.stringify(other.objects().map((o) => o.text)),
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  objects(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  // --- board-model conveniences -------------------------------------

  addNote(text: string, color: string = 'yellow'): string {
    const id = createSticky(this.doc, { x: 0, y: 0 }, color as import('../../../src/shared/config').StickyColor);
    if (id !== '') {
      replaceText(this.doc, id, text);
    }
    return id;
  }

  setText(id: string, text: string): void {
    replaceText(this.doc, id, text);
  }

  setPosition(id: string, x: number, y: number): void {
    moveObject(this.doc, id, x, y);
  }

  setColor(id: string, color: string): void {
    setStickyColor(this.doc, id, color);
  }

  deleteNote(id: string): void {
    deleteObject(this.doc, id);
  }

  noteIdByText(text: string): string | undefined {
    return this.objects().find((o) => o.text === text)?.id;
  }

  /** Send a raw frame (malformed-frame tests). */
  sendRaw(data: Uint8Array): void {
    this.send(data);
  }

  /**
   * Send one raw y-protocols sync update frame (failure-path tests, e.g.
   * TC-15: an update in flight while the room is LoadFailed must store
   * nothing).
   */
  sendUpdateFrame(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  /** True when the room closed us with the unsupported-data code. */
  get closedWithUnsupported(): boolean {
    return this.closeCode === CLOSE_UNSUPPORTED_DATA;
  }

  async waitForClose(timeoutMs = 5000): Promise<void> {
    const started = Date.now();
    while (!this.closed) {
      if (Date.now() - started > timeoutMs) {
        throw new Error('timed out waiting for close');
      }
      await new Promise((r) => setTimeout(r, 10));
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

/** Two snapshots agree on the full (id, text, x, y, z, color) set. */
export function sameNotes(
  a: readonly StickySnapshot[],
  b: readonly StickySnapshot[],
): boolean {
  const key = (o: StickySnapshot): string =>
    `${o.id}|${o.text}|${o.x}|${o.y}|${o.z}|${o.color}`;
  if (a.length !== b.length) {
    return false;
  }
  const aKeys = a.map(key).sort();
  const bKeys = b.map(key).sort();
  return aKeys.every((k, i) => k === bKeys[i]);
}
