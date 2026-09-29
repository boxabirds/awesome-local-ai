/**
 * A test client for the `BoardRoom`: a real `Y.Doc` speaking the exact y-protocols
 * framing the browser's `WebsocketProvider` uses, over a real WebSocket obtained from
 * a `SELF.fetch` upgrade response. Nothing here is mocked — merge, broadcast, echo
 * suppression and close-code behaviour are the behaviour under test.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { SELF } from 'cloudflare:test';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../../src/shared/protocol.js';
import {
  LOCAL_ORIGIN,
  createSticky as modelCreateSticky,
  deleteObject as modelDeleteObject,
  getStickyText,
  initDoc,
  moveObject as modelMoveObject,
  setStickyColor as modelSetStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model.js';

const { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } = syncProtocol;

/** Wrap a body written by `write` in the outer `[ MESSAGE_SYNC, ... ]` y-websocket frame. */
const frameSync = (write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

/** Wrap raw awareness bytes in an awareness frame. */
const frameAwareness = (bytes: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
};

/** True when two board snapshots are identical (ignoring wall-clock `createdAt`). */
export function sameSnapshot(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.x !== y.x || x.y !== y.y || x.color !== y.color || x.text !== y.text || x.z !== y.z) {
      return false;
    }
  }
  return true;
}

/** Let queued WebSocket / timer events settle. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RoomClient {
  readonly doc: Y.Doc;
  /** Received sync bodies that carried data (SyncStep2 or Update payloads). */
  readonly receivedUpdates: Uint8Array[] = [];
  /** Every raw `message` payload received, in arrival order (for verbatim-relay checks). */
  readonly rawFrames: (ArrayBuffer | string)[] = [];
  /** Sync sub-protocol message types received, in arrival order. */
  readonly syncTypesSeen: number[] = [];
  closeCode: number | null = null;
  closed = false;

  private readonly ws: WebSocket;
  private readonly remoteOrigin = Symbol('remote');

  private constructor(ws: WebSocket, doc?: Y.Doc) {
    this.ws = ws;
    this.doc = doc ?? new Y.Doc();
    ws.binaryType = 'arraybuffer';
    // Local edits (board-model transacts with LOCAL_ORIGIN) go to the room as an update;
    // anything the room applied (origin = remoteOrigin) is never re-sent.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL_ORIGIN) return;
      this.send(frameSync((enc) => syncProtocol.writeUpdate(enc, update)));
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;
      this.rawFrames.push(data);
      this.handleFrame(data);
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
      this.closed = true;
    });
    ws.addEventListener('error', () => {
      /* swallow: a send on a dead socket must not crash the test worker */
    });
    initDoc(this.doc);
  }

  private handleFrame(data: ArrayBuffer | string): void {
    if (typeof data === 'string') return; // malformed: the room closes us
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const outerType = decoding.readVarUint(decoder);
    if (outerType !== MESSAGE_SYNC) return; // awareness / query: no reply owed
    const syncType = decoding.readVarUint(decoder);
    this.syncTypesSeen.push(syncType);
    if (syncType === messageYjsSyncStep1) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      encoding.writeVarUint(reply, messageYjsSyncStep2);
      const sv = decoding.readVarUint8Array(decoder);
      encoding.writeVarUint8Array(reply, Y.encodeStateAsUpdate(this.doc, sv));
      this.send(encoding.toUint8Array(reply));
      return;
    }
    if (syncType === messageYjsSyncStep2 || syncType === messageYjsUpdate) {
      const payload = decoding.readVarUint8Array(decoder);
      this.receivedUpdates.push(payload);
      Y.applyUpdate(this.doc, payload, this.remoteOrigin);
      return;
    }
    // Unknown sync type: the room would close us; treat as no reply.
  }

  private send(bytes: Uint8Array | string): void {
    if (this.closed) return;
    try {
      this.ws.send(bytes);
    } catch {
      // A dead socket must not throw into the test; the close listener marks us closed.
    }
  }

  /** Connect to a board and start the sync handshake exactly as the browser provider does. */
  static async connect(boardId: string): Promise<RoomClient> {
    const request = new Request(`http://self/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    const response = await SELF.fetch(request);
    if (response.status !== 101 || response.webSocket === null) {
      throw new Error(`upgrade failed: ${response.status}`);
    }
    const ws = response.webSocket;
    ws.accept();
    const client = new RoomClient(ws);
    client.send(frameSync((enc) => syncProtocol.writeSyncStep1(enc, client.doc)));
    return client;
  }

  /**
   * Open a SECOND connection over an EXISTING document, reusing its local state (and its
   * `update` → send wiring). Used to model a client whose socket dropped after an
   * unsavable change: the document still holds that change across the reconnect, and the
   * sync handshake re-sends it so the room can now store it.
   */
  static async connectWithDoc(boardId: string, doc: Y.Doc): Promise<RoomClient> {
    const response = await SELF.fetch(
      new Request(`http://self/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } }),
    );
    if (response.status !== 101 || response.webSocket === null) {
      throw new Error(`upgrade failed: ${response.status}`);
    }
    const ws = response.webSocket;
    ws.accept();
    const client = new RoomClient(ws, doc);
    client.send(frameSync((enc) => syncProtocol.writeSyncStep1(enc, doc)));
    return client;
  }

  /** Open a raw upgrade connection and return the socket (for routing/edge tests). */  static async raw(boardId: string): Promise<{ status: number; client: WebSocket | null }> {
    const response = await SELF.fetch(
      new Request(`http://self/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } }),
    );
    const socket = response.webSocket;
    if (socket) socket.accept();
    return { status: response.status, client: socket };
  }

  close(code?: number): void {
    this.closed = true;
    try {
      this.ws.close(code);
    } catch {
      // already closing
    }
  }

  /** Abruptly drop the socket without a clean close handshake (dead-socket test). */
  abort(): void {
    this.closed = true;
    try {
      this.ws.close(1006);
    } catch {
      // ignore
    }
  }

  // --- board-model mutations (each fires `update` and reaches the room) ---

  createSticky(x: number, y: number, color?: string): string {
    return modelCreateSticky(this.doc, { x, y }, color as never);
  }
  move(id: string, x: number, y: number): boolean {
    return modelMoveObject(this.doc, id, x, y);
  }
  setColor(id: string, color: string): boolean {
    return modelSetStickyColor(this.doc, id, color);
  }
  delete(id: string): boolean {
    return modelDeleteObject(this.doc, id);
  }
  /** Insert text at an index inside this document, as a local mutation. */
  insertText(id: string, index: number, text: string): void {
    const note = getStickyText(this.doc, id);
    if (!note) throw new Error(`note ${id} has no text`);
    this.doc.transact(() => note.insert(index, text), LOCAL_ORIGIN);
  }

  sendRaw(data: Uint8Array | string): void {
    this.send(data);
  }

  sendAwarenessBytes(bytes: Uint8Array): void {
    this.send(frameAwareness(bytes));
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /**
   * Resolve as soon as `predicate()` holds, polling every 5ms; reject after `timeoutMs`
   * so a broken sync is a failing test rather than a hang.
   */
  until(predicate: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (predicate()) {
        resolve();
        return;
      }
      const started = Date.now();
      const interval = setInterval(() => {
        if (predicate()) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`timeout waiting for ${label}`));
        }
      }, 5);
      const timer = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`timeout waiting for ${label}`));
      }, timeoutMs + 50);
    });
  }

  /** Wait until this client's snapshot equals `other`'s. */
  waitForSync(other: RoomClient, timeoutMs = 3000): Promise<void> {
    return this.until(() => sameSnapshot(this.snapshot(), other.snapshot()), timeoutMs, 'sync');
  }

  /** Wait until at least one frame has arrived (the initial handshake completed). */
  waitForHandshake(timeoutMs = 3000): Promise<void> {
    return this.until(() => this.rawFrames.length > 0, timeoutMs, 'handshake');
  }

  /** Count of data-carrying frames received so far (SyncStep2 + Update bodies). */
  get updatesReceived(): number {
    return this.receivedUpdates.length;
  }

  /** Wait until the socket is closed, resolving with the close code (or null on timeout). */
  waitForClose(timeoutMs = 3000): Promise<number | null> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(this.closeCode);
        return;
      }
      const timer = setTimeout(() => resolve(this.closeCode), timeoutMs);
      this.ws.addEventListener('close', () => {
        clearTimeout(timer);
        resolve(this.closeCode);
      });
    });
  }
}
