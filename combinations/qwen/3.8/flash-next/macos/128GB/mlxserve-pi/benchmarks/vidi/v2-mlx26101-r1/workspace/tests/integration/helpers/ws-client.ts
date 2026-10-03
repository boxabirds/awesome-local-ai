// A board client for integration tests: a real `Y.Doc` speaking the exact
// y-websocket framing over a WebSocket obtained from a `SELF.fetch` upgrade
// response. Message handling mirrors y-websocket's provider (sync step exchange,
// update broadcast, awareness relay) but stays under test control, so tests can
// also inject malformed traffic and observe closes.

import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import { MESSAGE_AWARENESS, MESSAGE_SYNC, decodeMessage } from '../../../src/shared/protocol';

/**
 * What a received frame was, in board terms rather than wire numbers: the two
 * sync steps and a document update share the sync envelope, so tests ask for
 * `'update'` (a document change) without juggling message-type constants.
 */
export type FrameKind =
  | 'syncStep1'
  | 'syncStep2'
  | 'update'
  | 'awareness'
  | 'queryAwareness'
  | 'invalid';

/** One frame the client received. */
export interface ReceivedFrame {
  kind: FrameKind;
  /** Message body for the frame's type. */
  body: Uint8Array;
  /** Raw bytes, exactly as they arrived. */
  raw: Uint8Array;
  /** Why an `invalid` frame could not be decoded. */
  invalid?: string;
}

/** How long a wait helper waits before giving up (functional, not latency). */
const WAIT_TIMEOUT_MS = 5_000;
const POLL_MS = 5;

export class RoomClient {
  readonly boardId: string;
  readonly doc: Y.Doc;
  /** The current socket. `reconnect()` replaces it and keeps `doc`. */
  ws: WebSocket;
  /** Presence state; relayed once `enableAwareness()` was called. */
  readonly awareness: awarenessProtocol.Awareness;
  /** Every frame received, in arrival order. */
  readonly received: ReceivedFrame[] = [];
  /** True from the room's SyncStep2 answer until the next close. */
  synced = false;
  /** Close code observed on the socket, null while open. */
  closeCode: number | null = null;

  private closeHandlers: Array<() => void> = [];
  private awarenessRelay = false;
  private readonly onMessageEvent = (event: MessageEvent): void => {
    this.onFrame(event.data as ArrayBuffer | string);
  };
  private readonly onCloseEvent = (event: CloseEvent): void => {
    this.closeCode = event.code;
    this.synced = false;
    const handlers = this.closeHandlers;
    this.closeHandlers = [];
    for (const handler of handlers) handler();
  };

  private constructor(boardId: string, ws: WebSocket) {
    this.boardId = boardId;
    this.ws = ws;
    this.doc = new Y.Doc();
    initDoc(this.doc);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.attach();

    // Ship this doc's updates to the room, exactly like the browser provider:
    // anything that did not arrive from the room goes out as a sync update.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      try {
        this.ws.send(encoding.toUint8Array(encoder));
      } catch {
        // the socket is already gone; tests assert on the close instead
      }
    });
  }

  private attach(): void {
    this.ws.addEventListener('message', this.onMessageEvent);
    this.ws.addEventListener('close', this.onCloseEvent);
  }

  private detach(): void {
    this.ws.removeEventListener('message', this.onMessageEvent);
    this.ws.removeEventListener('close', this.onCloseEvent);
  }

  /** Ask the room for its current state over the socket we have. */
  private async startSync(): Promise<void> {
    await this.waitForOpen();
    this.syncStep1();
  }

  /** Open a WebSocket to `boardId`'s room through the real Worker route. */
  static async connect(boardId = newBoardId()): Promise<RoomClient> {
    const client = new RoomClient(boardId, await RoomClient.openSocket(boardId));
    // Like the browser provider: as soon as the socket is open, ask the room what
    // it has (the room's own SyncStep1 is answered by the frame handler below).
    await client.startSync();
    return client;
  }

  /**
   * Drop the socket and open a new one with the same document — what the browser
   * provider does when it reconnects. The room sees a brand new participant.
   */
  async reconnect(): Promise<void> {
    this.detach();
    try {
      this.ws.close();
    } catch {
      // already gone
    }
    this.closeCode = null;
    this.synced = false;
    this.ws = await RoomClient.openSocket(this.boardId);
    this.attach();
    await this.startSync();
  }

  /** Perform the upgrade and hand back the client end of the room's socket pair. */
  private static async openSocket(boardId: string): Promise<WebSocket> {
    const response = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
    if (!ws) {
      throw new Error(`no WebSocket in upgrade response (status ${response.status})`);
    }
    // The socket handed back through the service binding belongs to the caller,
    // so workerd requires accept() before use (it is the client end of the room's
    // WebSocketPair).
    ws.accept();
    return ws;
  }

  /** Wait until the socket is usable (or fail if it died while opening). */
  private async waitForOpen(): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (this.ws.readyState === WebSocket.CONNECTING) {
      if (Date.now() > deadline) {
        throw new Error(`client ${this.boardId} socket stayed CONNECTING`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`client ${this.boardId} socket closed while opening`);
    }
  }

  private push(frame: ReceivedFrame): void {
    this.received.push(frame);
  }

  private onFrame(data: ArrayBuffer | string): void {
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      this.push({ kind: 'invalid', body: new Uint8Array(0), raw, invalid: decoded.reason });
      return;
    }
    if (decoded.kind === 'awareness') {
      this.push({ kind: 'awareness', body: decoded.payload, raw });
      if (this.awarenessRelay) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.payload, this);
      }
      return;
    }
    if (decoded.kind === 'query-awareness') {
      this.push({ kind: 'queryAwareness', body: new Uint8Array(0), raw });
      return;
    }

    // A sync frame: the same handling as y-websocket's message handler, which
    // prefixes the reply envelope with the outer sync message type.
    const decoder = decoding.createDecoder(decoded.payload);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    let messageType: number;
    try {
      messageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    } catch (error) {
      this.push({
        kind: 'invalid',
        body: decoded.payload,
        raw,
        invalid: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const kind: FrameKind =
      messageType === syncProtocol.messageYjsSyncStep1
        ? 'syncStep1'
        : messageType === syncProtocol.messageYjsSyncStep2
          ? 'syncStep2'
          : 'update';
    this.push({ kind, body: decoded.payload, raw });
    if (encoding.length(encoder) > 1) {
      try {
        this.ws.send(encoding.toUint8Array(encoder));
      } catch {
        // socket already gone
      }
    }
    if (messageType === syncProtocol.messageYjsSyncStep2) this.synced = true;
  }

  /** Send raw bytes (used for malformed traffic). */
  sendBytes(bytes: Uint8Array | ArrayBuffer | string): void {
    this.ws.send(bytes);
  }

  /** Send a SyncStep1 asking the room what it has. */
  syncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /** Send an awareness frame carrying `update` (framed like the provider). */
  sendAwareness(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  /**
   * Start relaying this client's presence, exactly like the provider does: any
   * local awareness change goes out as an awareness frame.
   */
  enableAwareness(field: string, value: unknown): void {
    this.awarenessRelay = true;
    this.awareness.on(
      'update',
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin === this) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            this.awareness,
            changes.added.concat(changes.updated, changes.removed),
          ),
        );
        try {
          this.ws.send(encoding.toUint8Array(encoder));
        } catch {
          // socket already gone
        }
      },
    );
    this.awareness.setLocalStateField(field, value);
  }

  /** Presence states this client currently knows about. */
  awarenessStates(): Map<number, unknown> {
    return this.awareness.getStates();
  }

  framesOf(kind: FrameKind): ReceivedFrame[] {
    return this.received.filter((frame) => frame.kind === kind);
  }

  /** How many frames of `kind` have arrived so far (a marker for waits). */
  frameCount(kind: FrameKind): number {
    return this.framesOf(kind).length;
  }

  /** Frames of `kind` received strictly after the marker `since`. */
  framesAfter(kind: FrameKind, since: number): ReceivedFrame[] {
    return this.framesOf(kind).slice(since);
  }

  /** Wait until the room has answered our SyncStep1 (initial sync complete). */
  waitForSync(): Promise<void> {
    return this.waitFor(
      () => this.synced,
      `client ${this.boardId} never synced (close=${this.closeCode})`,
    );
  }

  /**
   * Wait until more frames of `kind` have arrived than the marker `since` and
   * return the new ones.
   */
  async waitForNewFrames(kind: FrameKind, since: number): Promise<ReceivedFrame[]> {
    await this.waitFor(
      () => this.frameCount(kind) > since,
      `client ${this.boardId} received no new ${kind} frame (close=${this.closeCode})`,
    );
    return this.framesAfter(kind, since);
  }

  /** Wait for at least `count` frames of `kind` in total. */
  async waitForFrames(kind: FrameKind, count: number): Promise<ReceivedFrame[]> {
    await this.waitFor(
      () => this.frameCount(kind) >= count,
      `client ${this.boardId} never received ${count} ${kind} frame(s) (close=${this.closeCode})`,
    );
    return this.framesOf(kind);
  }

  /** Wait for the socket to close and resolve with its close code. */
  waitForClose(): Promise<number | null> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`client ${this.boardId} socket never closed`)),
        WAIT_TIMEOUT_MS,
      );
      this.closeHandlers.push(() => {
        clearTimeout(timer);
        resolve(this.closeCode);
      });
    });
  }

  /** Wait until this client's document satisfies `predicate`. */
  async waitForDoc(
    predicate: (notes: readonly StickySnapshot[]) => boolean,
    message: string,
  ): Promise<readonly StickySnapshot[]> {
    await this.waitFor(() => predicate(this.snapshot()), message);
    return this.snapshot();
  }

  /** Poll `condition` until true, or reject with `message` after the timeout. */
  private async waitFor(condition: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /** The board as this client currently renders it. */
  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Close the socket (abruptly, like a dropped connection, when given no code). */
  close(code?: number): void {
    this.synced = false;
    try {
      if (code === undefined) this.ws.close();
      else this.ws.close(code);
    } catch {
      // already gone
    }
  }
}
