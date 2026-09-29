import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, writeVarUint, writeUint8Array, toUint8Array } from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import { snapshot, LOCAL_ORIGIN, type StickySnapshot } from '@/shared/board-model';
import { BASE_URL, wsUrl } from './server';

// y-websocket outer frame types (see src/shared/protocol.ts).
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/**
 * A raw y-protocol client for integration tests. Speaks the same framing as
 * the y-websocket provider (outer [type varUint][payload]; sync frames carry
 * a y-protocols sync message; awareness frames carry a length-prefixed
 * varUint8Array) but keeps no local awareness of its own.
 *
 * `synced` mirrors the y-websocket provider: it becomes true the first time
 * the peer's SyncStep2 is received (i.e. we now hold the room's state).
 *
 * A `doc` may be supplied to reuse an existing Y.Doc (e.g. to simulate a
 * client reconnecting to a restarted room with its prior content, TC-18).
 */
export class RoomClient {
  readonly doc: Y.Doc;
  readonly boardId: string;
  private ws: WebSocket | null = null;
  private _synced = false;
  private _closed = false;
  private _closeCode: number | null = null;
  private _receivedUpdates = 0;
  private syncResolvers: Array<() => void> = [];

  /** Every frame received, decoded to {type, payload}. */
  readonly receivedFrames: Array<{ type: number; payload: Uint8Array }> = [];
  /** Awareness payloads (inner bytes) received from the room. */
  readonly awarenessReceived: Uint8Array[] = [];
  private _autoPush = true;
  private pending: Uint8Array[] = [];
  /**
   * Story 5: boards must exist before a room accepts a connection, so by
   * default connect() first creates this board through the initialize test
   * hook (idempotent). Pass { autoInit: false } for 404 tests.
   */
  private readonly autoInit: boolean;

  constructor(boardId: string, doc?: Y.Doc, opts: { autoInit?: boolean } = {}) {
    this.boardId = boardId;
    this.autoInit = opts.autoInit ?? true;
    this.doc = doc ?? new Y.Doc();
    this.doc.on('update', (update, origin) => {
      if (origin === LOCAL_ORIGIN) {
        const bytes = new Uint8Array(update);
        if (this._autoPush) this.push(bytes);
        else this.pending.push(bytes);
      } else {
        this._receivedUpdates++;
      }
    });
  }

  private push(update: Uint8Array): void {
    if (this.ws && this.ws.readyState === 1) {
      const enc = createEncoder();
      sync.writeUpdate(enc, update);
      this.ws.send(this.frame(MESSAGE_SYNC, toUint8Array(enc)));
    }
  }

  /** When false, LOCAL_ORIGIN updates are queued (not sent) until flush(). */
  setAutoPush(b: boolean): void {
    this._autoPush = b;
  }

  /** Sends all queued LOCAL_ORIGIN updates (simulates releasing concurrent edits). */
  flush(): void {
    for (const u of this.pending) this.push(u);
    this.pending = [];
  }

  /** Sends a TEXT (string) frame — used for malformed-traffic tests. */
  sendText(s: string): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
  }

  private frame(type: number, payload?: Uint8Array): Uint8Array {
    const enc = createEncoder();
    writeVarUint(enc, type);
    if (payload) writeUint8Array(enc, new Uint8Array(payload));
    return new Uint8Array(toUint8Array(enc));
  }

  /** Sends arbitrary raw bytes to the room (malformed-traffic tests). */
  sendRaw(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
  }

  /** Sends a framed message of the given outer type. */
  sendFrame(type: number, payload?: Uint8Array): void {
    this.sendRaw(this.frame(type, payload));
  }

  /** Opens the socket and sends our SyncStep1. Resolves on open. */
  connect(): Promise<void> {
    if (this.autoInit) {
      return fetch(`${BASE_URL}/__test/boards/${this.boardId}/initialize`)
        .then(() => undefined)
        .then(() => this.open());
    }
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl(this.boardId));
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const enc = createEncoder();
        sync.writeSyncStep1(enc, this.doc);
        ws.send(this.frame(MESSAGE_SYNC, toUint8Array(enc)));
        resolve();
      };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onclose = (e: CloseEvent) => {
        this._closed = true;
        this._closeCode = e.code;
      };
      ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    });
  }

  private onMessage(data: ArrayBuffer | string): void {
    if (typeof data === 'string') return; // the room closes on strings; nothing to parse
    const bytes = new Uint8Array(data);
    const dec = createDecoder(bytes);
    let type: number;
    try {
      type = readVarUint(dec);
    } catch {
      return;
    }
    const payload = bytes.slice(dec.pos);
    this.receivedFrames.push({ type, payload });
    if (type === MESSAGE_SYNC && payload.length > 0) {
      const enc = createEncoder();
      const innerType = sync.readSyncMessage(createDecoder(payload), enc, this.doc, 'remote', () => {});
      const reply = toUint8Array(enc);
      if (reply.length > 0 && this.ws && this.ws.readyState === 1) {
        this.ws.send(this.frame(MESSAGE_SYNC, reply));
      }
      if (innerType === sync.messageYjsSyncStep2) this.markSynced();
    } else if (type === MESSAGE_AWARENESS && payload.length > 0) {
      // The awareness frame is [varUint8Array]; read the inner bytes.
      const inner = createDecoder(payload);
      try {
        this.awarenessReceived.push(new Uint8Array(readVarUint8Array(inner)));
      } catch {
        /* ignore */
      }
    }
  }

  private markSynced(): void {
    if (this._synced) return;
    this._synced = true;
    const rs = this.syncResolvers;
    this.syncResolvers = [];
    for (const r of rs) r();
  }

  get synced(): boolean {
    return this._synced;
  }

  /** Resolves once the room's state has been received (initial sync done). */
  waitSync(timeoutMs = 5000): Promise<void> {
    if (this._synced) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sync timeout')), timeoutMs);
      this.syncResolvers.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  get closed(): boolean {
    return this._closed;
  }
  get closeCode(): number | null {
    return this._closeCode;
  }
  /** Resolves once the socket is closed (with an optional expected code). */
  waitClose(timeoutMs = 5000): Promise<number> {
    if (this._closed) return Promise.resolve(this._closeCode ?? 0);
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws) return reject(new Error('not connected'));
      const t = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      const prev = ws.onclose;
      ws.onclose = (e: CloseEvent) => {
        clearTimeout(t);
        if (prev) prev.call(ws, e);
        resolve(e.code);
      };
    });
  }

  get receivedUpdates(): number {
    return this._receivedUpdates;
  }
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }
  close(code = 1000): void {
    try {
      this.ws?.close(code);
    } catch {
      /* ignore */
    }
  }
}

/** Waits `ms` (a short settle delay for relayed updates). */
export function settle(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
