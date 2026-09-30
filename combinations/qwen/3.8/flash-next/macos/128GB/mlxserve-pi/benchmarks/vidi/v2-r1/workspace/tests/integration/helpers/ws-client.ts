/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * A test client for a live board: a real Y.Doc that speaks exactly the framing
 * the browser's WebsocketProvider uses (y-websocket frames around
 * y-protocols/sync and y-protocols/awareness) over a real WebSocket obtained
 * from the Worker's upgrade response. Design: Fixtures — "Integration clients
 * are real Y.Doc instances speaking y-protocols over WebSockets obtained from
 * SELF.fetch upgrade responses".
 */
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../../src/shared/protocol';
import { newBoardId } from '../../../src/shared/board-id';

/** One frame the room sent us, classified with the production decoder. */
export interface IncomingFrame {
  /** y-websocket message type: 0 sync, 1 awareness, 3 query awareness. */
  type: number;
  /** For sync frames: the y-protocols/sync message kind; null otherwise. */
  syncKind: number | null;
  /** The complete frame, y-websocket type prefix included. */
  raw: Uint8Array;
}

/** Wrap a y-protocols/sync message in the y-websocket frame prefix. */
export const syncFrame = (
  write: (encoder: encoding.Encoder) => void,
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

/** Wrap an awareness update in the y-websocket frame prefix. */
export const awarenessFrame = (body: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
};

/** A body for awareness frames: any bytes the room must relay untouched. */
export const awarenessBody = (seed: number): Uint8Array =>
  new Uint8Array([seed, seed + 1, seed + 2, seed + 3]);

/** A y-websocket sync Update frame carrying `body` as the Yjs update. */
export const updateFrame = (body: Uint8Array): Uint8Array =>
  syncFrame((encoder) => {
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, body);
  });

/** A y-websocket frame whose message type is none of the three we know. */
export const unknownTypeFrame = (type: number): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  return encoding.toUint8Array(encoder);
};

/** Poll `check` until it holds; a clear error (with the reason) if it never does. */
export const waitFor = async (
  check: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

/** Poll an asynchronous `check` until it holds. Waiting on something inside a
 * durable object has to be polled from the outside, because the object's own
 * state can only be read from within it. */
export const waitForAsync = async (
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await tick();
  }
};

/** Give already-queued frames a chance to be delivered. */
export const tick = (ms = 10): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Notes as a comparable string. The note ids are shared by the document, and
 * the fields are written in the same order by the same code, so two clients
 * that agree on the board agree on this string — which is what lets a test wait
 * for convergence without depending on `snapshot()`'s (z, id) order.
 */
export const canonicalNotes = (notes: readonly StickySnapshot[]): string =>
  JSON.stringify([...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

/** Do these clients see exactly the same board? */
export const seeSameBoard = (...clients: SyncClient[]): boolean => {
  const [first, ...rest] = clients as [SyncClient, ...SyncClient[]];
  const expected = canonicalNotes(first.notes);
  return rest.every((client) => canonicalNotes(client.notes) === expected);
};

/** Every string any object of this client's document holds. */
export const allText = (client: SyncClient): string[] => {
  const found: string[] = [];
  client.doc.getMap<Y.Map<unknown>>('objects').forEach((note, id) => {
    note.forEach((value, key) => {
      if (typeof value === 'string') found.push(`${id}.${key}=${value}`);
      else if (value instanceof Y.Text) found.push(`${id}.${key}=${value.toString()}`);
    });
  });
  return found;
};

export class SyncClient {
  readonly frames: IncomingFrame[] = [];
  readonly boardId: string;
  readonly doc: Y.Doc;
  closeCode: number | null = null;
  private socket: WebSocket | null = null;

  private constructor(boardId: string, doc: Y.Doc) {
    this.boardId = boardId;
    this.doc = doc;
  }

  /** Open the board's WebSocket and start the y-websocket handshake. */
  static async connect(boardId: string = newBoardId()): Promise<SyncClient> {
    const doc = new Y.Doc();
    // What the browser client does before it connects (story 2).
    initDoc(doc);
    return SyncClient.connectWith(boardId, doc);
  }

  /**
   * Connect an existing document to a board: what a provider reconnect does,
   * where the document (with everything the person had) outlives the socket.
   *
   * `room` defaults to the Worker (the normal path, address and all); passing a
   * stub connects the same document to a particular room object, which is how a
   * test reaches a freshly created instance of a board.
   */
  static async connectWith(
    boardId: string,
    doc: Y.Doc,
    room: { fetch(input: Request | string, init?: RequestInit): Promise<Response> } = SELF,
  ): Promise<SyncClient> {
    const client = new SyncClient(boardId, doc);
    const response = await room.fetch(`https://vidi6.test/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error(`no WebSocket in the response (status ${response.status})`);
    }
    client.attach(socket);
    return client;
  }

  private attach(socket: WebSocket): void {
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(event.data as string | ArrayBuffer);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
    });
    socket.accept();
    // Local edits go to the room the way the browser provider does: an update
    // that came *from* the room is never sent back to it, and a client that is
    // no longer connected sends nothing.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.socket !== null && origin !== this) {
        this.send(syncFrame((encoder) => syncProtocol.writeUpdate(encoder, update)));
      }
    });
    this.sendSyncStep1();
  }

  private handleMessage(data: string | ArrayBuffer): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'query-awareness') {
      this.frames.push({ type: MESSAGE_QUERY_AWARENESS, syncKind: null, raw: new Uint8Array() });
      return;
    }
    if (decoded.kind === 'invalid') {
      throw new Error('the room sent a frame this client cannot decode');
    }
    if (decoded.kind === 'awareness') {
      this.frames.push({ type: MESSAGE_AWARENESS, syncKind: null, raw: decoded.payload });
      return;
    }
    const raw = decoded.payload;
    const decoder = decoding.createDecoder(raw);
    decoding.readVarUint(decoder); // y-websocket message type
    const kindPosition = decoder.pos;
    const syncKind = decoding.readVarUint(decoder);
    decoder.pos = kindPosition; // readSyncMessage reads the kind itself
    this.frames.push({ type: MESSAGE_SYNC, syncKind, raw });
    const encoder = encoding.createEncoder();
    // A reply is a y-websocket frame too: the sync message goes behind a prefix
    // of its own, exactly like the frame that arrived.
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this, (error: Error) => {
      // A real provider would log and carry on; a test client must not, because
      // a frame it cannot apply is exactly the bug these tests look for.
      throw new Error(`the room sent something this client could not apply: ${String(error)}`);
    });
    if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
  }

  private framesOf(kind: number): IncomingFrame[] {
    return this.frames.filter((frame) => frame.syncKind === kind);
  }

  /** SyncStep1 frames received: what the room asked us for. */
  get syncStep1s(): number {
    return this.framesOf(syncProtocol.messageYjsSyncStep1).length;
  }

  /** SyncStep2 frames received: the state the room was missing. */
  get syncStep2s(): number {
    return this.framesOf(syncProtocol.messageYjsSyncStep2).length;
  }

  /** Document updates received: changes other people made. */
  get updates(): Uint8Array[] {
    return this.framesOf(syncProtocol.messageYjsUpdate).map((frame) => frame.raw);
  }

  /** Awareness frames received, bytes included. */
  get awarenessReceived(): Uint8Array[] {
    return this.frames
      .filter((frame) => frame.type === MESSAGE_AWARENESS)
      .map((frame) => frame.raw);
  }

  /** This client's view of the board. */
  get notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** The note's text as this client sees it, or '' when it is gone. */
  textOf(noteId: string): string {
    return getStickyText(this.doc, noteId)?.toString() ?? '';
  }

  /** The board-model operations, i.e. exactly what a person does. */
  addNote(at: { x: number; y: number }): string {
    return createSticky(this.doc, at);
  }

  /** Type `text`, at the end unless a position is given. */
  type(noteId: string, text: string, at?: number): void {
    getStickyText(this.doc, noteId)?.insert(at ?? this.textOf(noteId).length, text);
  }

  move(noteId: string, x: number, y: number): void {
    moveObject(this.doc, noteId, x, y);
  }

  setColor(noteId: string, color: string): void {
    setStickyColor(this.doc, noteId, color);
  }

  remove(noteId: string): void {
    deleteObject(this.doc, noteId);
  }

  send(bytes: Uint8Array): void {
    if (this.socket === null) return; // hung up already: nothing to send to
    this.socket.send(bytes);
  }

  /** A text frame: the one thing this framing never carries. */
  sendText(text: string): void {
    this.socket?.send(text);
  }

  /** Raw bytes, for frames no honest client would send. */
  sendRaw(bytes: Uint8Array): void {
    this.socket?.send(bytes);
  }

  sendSyncStep1(): void {
    this.send(syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc)));
  }

  sendAwareness(body: Uint8Array): void {
    this.send(awarenessFrame(body));
  }

  /**
   * Wait for the initial exchange to finish in both directions: the room asked
   * us for our state and we applied the state it was missing.
   */
  async waitForSync(): Promise<void> {
    await waitFor(
      () => this.syncStep1s >= 1 && this.syncStep2s >= 1,
      `initial sync with board ${this.boardId} (received ${this.frames.length} frames)`,
    );
  }

  /** Wait until this socket has been closed, from either side, and report the
   * code. The room answers a close the client started, so a polite hang-up is
   * reported here too — a page that closed its tab learns that it worked. */
  async waitForClose(): Promise<number> {
    await waitFor(() => this.closeCode !== null, 'the room to close this socket');
    return this.closeCode as number;
  }

  /** Hang up cleanly. */
  close(): void {
    this.socket?.close();
  }

  /**
   * Stop listening and close the connection without letting the room know it
   * happened yet, so its next write to this socket lands on a dead pipe.
   */
  hangUpWithoutSayingGoodbye(): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    socket.close();
  }
}
