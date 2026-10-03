/**
 * A board client inside the worker: a real `Y.Doc` and a real WebSocket to a
 * BoardRoom, speaking the same frames `y-websocket` speaks.
 *
 * It is deliberately a *client* and not a mock: it sends a SyncStep1 when the
 * socket opens, applies what the room answers with `y-protocols/sync`, replies to
 * the room's own SyncStep1 with its whole document, and pushes every local change
 * as a `sync/update`. What it adds is a record of the frames that arrived, because
 * the tests ask things like "did the sender get an echo?" and "did both ends get
 * identical awareness bytes?" — questions about frames, not about documents.
 *
 * Two details are workerd's, not the web's:
 *
 * - `binaryType` is `'blob'` until it is set to `'arraybuffer'`, and
 * - a socket taken out of a fetch response belongs to the caller only after
 *   `accept()`.
 *
 * Both are true of the room's own socket too, so the room sets them as well.
 */
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import * as Y from 'yjs';

import { initDoc, snapshot } from '../../../src/shared/board-model';
import type { StickySnapshot } from '../../../src/shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../../../src/shared/protocol';

/** Marks changes that came from the room, so they are not sent back to it. */
const FROM_ROOM = Symbol('from-room');

export interface ReceivedFrame {
  kind: 'sync' | 'awareness' | 'query-awareness';
  bytes: Uint8Array;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

/**
 * Open a socket to `boardId`'s room and hand back the frame endpoint.
 *
 * `doc` is optional on purpose: the same document can be connected, disconnected
 * and connected again, which is what a person reloading a page does, and what the
 * restart and catch-up tests need. What a new client counts fresh is the frames,
 * not the board.
 */
export async function connectRoom(boardId: string, doc?: Y.Doc): Promise<RoomClient> {
  const response = await SELF.fetch(
    new Request(`https://board.test/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
  const socket = response.webSocket;
  if (!socket) {
    throw new Error(`no WebSocket in the response (status ${String(response.status)})`);
  }
  socket.binaryType = 'arraybuffer';
  const client = new RoomClient(socket, doc);
  socket.accept();
  client.sendSyncStep1();
  await client.waitFor(() => client.sawSyncStep2, 'the room never answered SyncStep1');
  return client;
}

export class RoomClient {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly frames: ReceivedFrame[] = [];
  /** `update` frames received, which is what "did B get the change" means. */
  updates = 0;
  sawSyncStep2 = false;
  closeInfo: CloseInfo | null = null;

  private readonly socket: WebSocket;
  private readonly onLocalUpdate: (update: Uint8Array, origin: unknown) => void;
  private closed = false;

  constructor(socket: WebSocket, doc?: Y.Doc) {
    this.socket = socket;
    this.doc = doc ?? new Y.Doc();
    this.awareness = new Awareness(this.doc);
    initDoc(this.doc);
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleFrame(event.data as ArrayBuffer | string);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closed = true;
      this.closeInfo = { code: event.code, reason: event.reason };
    });
    socket.addEventListener('error', () => {
      this.closed = true;
      this.closeInfo = this.closeInfo ?? { code: 1006, reason: 'error' };
    });
    // Anything the room did not tell us about is our own change: send it.
    this.onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === FROM_ROOM || this.closed) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeUpdate(encoder, update);
      this.send(encoder);
    };
    this.doc.on('update', this.onLocalUpdate);
  }

  /** Ask the room for everything it has that this client lacks. */
  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, this.doc);
    this.send(encoder);
  }

  private send(encoder: encoding.Encoder): void {
    if (this.closed) return;
    try {
      this.socket.send(encoding.toUint8Array(encoder));
    } catch {
      this.closed = true;
    }
  }

  /** Send a frame exactly as built, for the malformed-traffic tests. */
  sendRaw(data: ArrayBuffer | string | Uint8Array): void {
    if (this.closed) return;
    try {
      this.socket.send(data instanceof Uint8Array ? data.slice() : data);
    } catch {
      this.closed = true;
    }
  }

  /** Publish awareness state and let the room relay it, as a client would. */
  sendAwareness(state: unknown): void {
    this.awareness.setLocalStateField('test', state);
    const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoder);
  }

  awarenessFrames(): Uint8Array[] {
    return this.frames.filter((frame) => frame.kind === 'awareness').map((frame) => frame.bytes);
  }

  /** This board as the app would draw it. */
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Every note as one line each, so a failure says what differed. */
  board(): string[] {
    return this.notes().map(
      (note) => `${note.id} x=${note.x} y=${note.y} z=${note.z} ${note.color} "${note.text}"`,
    );
  }

  async waitFor(predicate: () => boolean, description: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting: ${description}`);
      await sleep(20);
    }
  }

  /** Wait until the board holds `count` notes, i.e. a change made elsewhere arrived. */
  async waitForNotes(count: number, timeoutMs = 5000): Promise<void> {
    await this.waitFor(() => this.notes().length === count, `${count} notes on the board`, timeoutMs);
  }

  /** Close cleanly, as a person closing a tab does. */
  close(code = 1000): void {
    if (this.closed) return;
    try {
      this.socket.close(code, 'test over');
    } catch {
      // Already gone; the close listener said so first.
    }
  }

  /** Whether the room closed this socket with the "undecodable" code. */
  rejected(): boolean {
    return this.closeInfo?.code === CLOSE_UNSUPPORTED_DATA;
  }

  /**
   * Give up on this socket. The document stays alive: a person who reloads the
   * page keeps what they had, and so does a test that reconnects.
   */
  destroy(): void {
    this.closed = true;
    this.doc.off('update', this.onLocalUpdate);
    this.awareness.destroy();
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }

  /** Drop the document too, when the test is finished with the whole client. */
  destroyCompletely(): void {
    this.destroy();
    this.doc.destroy();
  }

  private handleFrame(data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);
    if (decoded.kind === 'invalid') {
      throw new Error(`the room sent a frame no client can use: ${decoded.reason}`);
    }
    if (decoded.kind === 'query-awareness') {
      this.frames.push({ kind: 'query-awareness', bytes: new Uint8Array() });
      return;
    }
    if (decoded.kind === 'awareness') {
      this.frames.push({ kind: 'awareness', bytes: decoded.payload });
      const decoder = new decoding.Decoder(decoded.payload);
      applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), FROM_ROOM);
      return;
    }
    this.frames.push({ kind: 'sync', bytes: decoded.payload });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const syncKind = readSyncMessage(
      new decoding.Decoder(decoded.payload),
      encoder,
      this.doc,
      FROM_ROOM,
    );
    if (syncKind === messageYjsSyncStep2) this.sawSyncStep2 = true;
    if (syncKind === messageYjsUpdate) this.updates += 1;
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) this.socket.send(reply);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
