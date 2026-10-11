/**
 * Test-side y-websocket client for the integration project.
 *
 * Speaks the real wire format (`varUint(messageType) + content`) with
 * `y-protocols`, on top of the real board model from `src/shared/board-model.ts`,
 * so an integration client mutates a board exactly as the browser does — same
 * shared types, same `LOCAL_ORIGIN` tag, same provider-style echo rule — while
 * the room under test stays a black box (`tests/integration/README.md`).
 */

import * as awarenessProtocol from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { SELF } from 'cloudflare:test';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type PointLike,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../../src/shared/protocol';
import type { StickyColor } from '../../../src/shared/config';

export const BASE_URL = 'http://worker.local';

/** Origin tag for updates this client applied from the room (never re-sent). */
const REMOTE_ORIGIN = Symbol('integration-remote-origin');

export interface Frame {
  at: number;
  /** 'sync' | 'awareness' | 'query-awareness' | 'invalid' | 'text' */
  kind: string;
  bytes: Uint8Array;
  /** Set when this test client could not read the frame. */
  note?: string;
}

export interface CloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface RoomRequestOptions {
  /** Sends `Upgrade: websocket` unless set to false. */
  upgrade?: boolean;
  headers?: Record<string, string>;
  method?: string;
}

export function roomUrl(boardId: string): string {
  return `${BASE_URL}/api/rooms/${boardId}`;
}

/** Raw route call — used for the status code cases (400, 426). */
export function requestRoom(boardId: string, options: RoomRequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.upgrade !== false) {
    headers['Upgrade'] = 'websocket';
  }
  return SELF.fetch(roomUrl(boardId), {
    headers,
    method: options.method ?? 'GET',
    duplex: 'half',
  } as RequestInit);
}

/** Whatever the runtime hands the test side, as bytes. */
async function frameBytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error(`unexpected frame data of type ${typeof data}`);
}

export class SyncClient {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly frames: Frame[] = [];
  readonly name: string;
  private readonly socket: WebSocket;
  private readonly closePromise: Promise<CloseInfo>;
  private closeResolve!: (info: CloseInfo) => void;
  private closeInfo: CloseInfo | null = null;
  private localUpdateCount = 0;

  /** Sharing `doc` is how a client reconnects and keeps its local board. */
  constructor(name: string, socket: WebSocket, doc?: Y.Doc) {
    this.name = name;
    this.doc = doc ?? new Y.Doc();
    initDoc(this.doc);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState({ client: name });

    this.closePromise = new Promise((resolve) => {
      this.closeResolve = resolve;
    });

    this.socket = socket;
    this.socket.accept();

    this.socket.addEventListener('message', (event: MessageEvent) => {
      void this.receive(event.data);
    });
    this.socket.addEventListener('close', (event: CloseEvent) => {
      this.remember({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    });
    this.socket.addEventListener('error', () => {
      this.remember({ code: 1006, reason: 'socket error', wasClean: false });
    });

    // The provider rule: a local edit is sent, a frame from the room is not.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        this.localUpdateCount += 1;
        this.sendUpdate(update);
      }
    });

    // Same opening move as y-websocket: ask the room what it already has.
    this.sendSyncStep1();
  }

  private remember(info: CloseInfo): void {
    if (this.closeInfo === null) {
      this.closeInfo = info;
      this.closeResolve(info);
    }
  }

  get closedWith(): CloseInfo | null {
    return this.closeInfo;
  }

  get closedAt(): Promise<CloseInfo> {
    return this.closePromise;
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  get isOpen(): boolean {
    return this.socket.readyState === 1;
  }

  get syncFrames(): Frame[] {
    return this.frames.filter((frame) => frame.kind === 'sync');
  }

  get awarenessFrames(): Frame[] {
    return this.frames.filter((frame) => frame.kind === 'awareness');
  }

  get invalidFrames(): Frame[] {
    return this.frames.filter((frame) => frame.kind === 'invalid');
  }

  /** Local updates this client produced, in order. */
  get localUpdates(): number {
    return this.localUpdateCount;
  }

  /** The board as the renderer would read it. */
  get board(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  private async receive(data: unknown): Promise<void> {
    try {
      this.frames.push(await this.readFrame(data));
    } catch (error) {
      this.frames.push({
        at: Date.now(),
        kind: 'invalid',
        bytes: new Uint8Array(0),
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async readFrame(data: unknown): Promise<Frame> {
    if (typeof data === 'string') {
      return { at: Date.now(), kind: 'text', bytes: new Uint8Array(0) };
    }
    const bytes = await frameBytes(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);

    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_ORIGIN);
      const reply = encoding.toUint8Array(encoder);
      if (reply.length > 1) {
        this.send(reply);
      }
      return { at: Date.now(), kind: 'sync', bytes };
    }

    if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        REMOTE_ORIGIN,
      );
      return { at: Date.now(), kind: 'awareness', bytes };
    }

    if (type === MESSAGE_QUERY_AWARENESS) {
      return { at: Date.now(), kind: 'query-awareness', bytes };
    }

    return { at: Date.now(), kind: 'unknown', bytes };
  }

  send(bytes: Uint8Array): void {
    this.socket.send(bytes);
  }

  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /** This client's whole document, as a SyncStep2 payload. */
  sendSyncStep2(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /** A bare document update, framed the way a synced client sends one. */
  sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  sendAwareness(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  sendQueryAwareness(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Traffic the room should reject: a text frame, or bytes it cannot read. */
  sendRaw(data: string | Uint8Array): void {
    this.socket.send(data as string | ArrayBuffer);
  }

  /** A sync frame carrying bytes Yjs will not accept. */
  sendGarbageUpdate(garbage: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, garbage);
    this.send(encoding.toUint8Array(encoder));
  }

  // -- board model operations, exactly as the browser calls them ------------

  createNote(at: PointLike, color?: StickyColor): string | null {
    return createSticky(this.doc, at, color);
  }

  move(id: string, x: number, y: number): boolean {
    return moveObject(this.doc, id, x, y);
  }

  recolour(id: string, color: string): boolean {
    return setStickyColor(this.doc, id, color);
  }

  remove(id: string): boolean {
    return deleteObject(this.doc, id);
  }

  /** Insert into a note's shared text. */
  type(id: string, index: number, text: string): void {
    const value = getStickyText(this.doc, id);
    if (value === undefined) {
      return;
    }
    this.doc.transact(() => value.insert(index, text), LOCAL_ORIGIN);
  }

  textOf(id: string): string | undefined {
    const value = getStickyText(this.doc, id);
    return value === undefined ? undefined : value.toString();
  }

  note(id: string): StickySnapshot | undefined {
    return this.board.find((entry) => entry.id === id);
  }

  close(code?: number, reason?: string): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}

/** Open a socket to a board's room. Throws if the route did not upgrade. */
export async function connectClient(name: string, boardId: string, doc?: Y.Doc): Promise<SyncClient> {
  const response = await requestRoom(boardId);
  if (response.status !== 101) {
    throw new Error(`expected the room route to upgrade, got ${response.status}`);
  }
  const webSocket = response.webSocket;
  if (!webSocket) {
    throw new Error('the room route returned no WebSocket');
  }
  return new SyncClient(name, webSocket, doc);
}

/**
 * A client whose connection dropped, coming back with the board it still has
 * locally (`live.catch_up`, `sync.catch_up`).
 */
/** `connectClient`, plus waiting for the room's opening SyncStep1. */
export async function connectedClient(name: string, boardId: string, doc?: Y.Doc): Promise<SyncClient> {
  const client = await connectClient(name, boardId, doc);
  await waitFor(() => client.frames.length > 0, 5_000, `${name} to hear from the room`);
  return client;
}

export async function reconnectClient(client: SyncClient, name: string, boardId: string): Promise<SyncClient> {
  client.close();
  await waitFor(() => client.readyState === 3, 3_000, `${client.name} to finish closing`);
  return connectClient(name, boardId, client.doc);
}

export function closeAll(...clients: SyncClient[]): void {
  for (const client of clients) {
    client.close();
  }
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
  message = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Snapshot of every client, for "all screens ended identical" assertions. */
export function boards(...clients: SyncClient[]): string[] {
  return clients.map((client) => JSON.stringify(client.board));
}

export function boardsAgree(...clients: SyncClient[]): boolean {
  const [first] = boards(...clients);
  return boards(...clients).every((board) => board === first);
}

/** Awareness update for this client's own state. */
export function awarenessUpdate(client: SyncClient): Uint8Array {
  return awarenessProtocol.encodeAwarenessUpdate(client.awareness, [client.doc.clientID]);
}
