/**
 * A person at the board with no browser.
 *
 * Two things a browser is bad at, for a persistence test: putting 2000 notes on a
 * board, and reading one back while the browser is not involved. Both are done here,
 * over a real WebSocket to the real room, speaking the same frames `y-websocket`
 * speaks (SyncStep1 on open, `y-protocols/sync` after that) with the same
 * `src/shared/board-model` mutators the client uses.
 *
 * `seedBoard` writes and `readBoard` reads. Reading through a *second* connection is
 * what makes the seed trustworthy: the room is one object handling one thing at a
 * time, so a newcomer that can see the notes is a room that has applied them — and a
 * room that applies them has, by this story's own rule, stored them first.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { MESSAGE_SYNC, decodeMessage, frameBytes } from '../../../src/shared/protocol';

/** The room endpoint for a board, as a `ws://` URL next to a dev server's origin. */
function roomEndpoint(origin: string, boardId: string): string {
  return `${origin.replace(/^http/, 'ws')}/api/rooms/${encodeURIComponent(boardId)}`;
}

/** The first byte of a sync payload, without consuming anything. */
function peekSyncType(payload: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return -1;
  }
}

/** One y-websocket frame. */
function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export interface ConnectOptions {
  /** Do not ask the room for its content — a writer that has nothing to learn. */
  quiet?: boolean;
}

/** One connection to one board's room, synced and then left open until closed. */
export class BoardConnection {
  readonly doc: Y.Doc;
  /** Sync frames received, so a test can say "the room sent an update". */
  updatesReceived = 0;
  /** The frame count the room had sent when the first sync finished. */
  #synced = false;
  #closed = false;
  readonly #socket: WebSocket;
  readonly #opened: Promise<void>;

  private constructor(socket: WebSocket, doc: Y.Doc) {
    this.#socket = socket;
    this.doc = doc;
    this.#opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('the socket could not be opened')), { once: true });
    });
    socket.addEventListener('message', (event) => this.#onMessage(event.data));
    socket.addEventListener('close', () => {
      this.#closed = true;
    });
  }

  /** Open, and resolve once the handshake has been sent. */
  static async join(boardId: string, origin: string, doc: Y.Doc, options: ConnectOptions = {}): Promise<BoardConnection> {
    const socket = new WebSocket(roomEndpoint(origin, boardId));
    socket.binaryType = 'arraybuffer';
    const connection = new BoardConnection(socket, doc);
    await connection.#opened;
    if (!options.quiet) socket.send(frame((encoder) => syncProtocol.writeSyncStep1(encoder, doc)));
    return connection;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Wait until the room has sent its side of the first sync. */
  async waitForSync(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.#synced && !this.#closed) {
      if (Date.now() > deadline) throw new Error('the room never finished the first sync');
      await sleep(20);
    }
  }

  close(): void {
    if (!this.#closed) this.#socket.close(1000, 'done');
  }

  async #onMessage(data: unknown): Promise<void> {
    const bytes = await frameBytes(data);
    const decoded = decodeMessage(bytes ?? 'not a binary frame');
    if (decoded.kind !== 'sync') return;

    // `decoded.payload` still begins with the sync type, which is what
    // `readSyncMessage` expects to read itself: peek at it with a decoder of its own
    // rather than consuming it from the one handed to Yjs.
    const syncType = peekSyncType(decoded.payload);
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);

    if (syncType === 0) {
      // The room is asking what we have. This is how a seeded board gets there.
      const decoder = decoding.createDecoder(decoded.payload);
      decoding.readVarUint(decoder);
      syncProtocol.writeSyncStep2(reply, this.doc, decoding.readVarUint8Array(decoder));
      this.#socket.send(encoding.toUint8Array(reply));
      this.#synced = true;
      return;
    }

    this.updatesReceived += syncType === 2 ? 1 : 0;
    syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, this.doc, 'room');
    await this.#sendIfWritten(reply);
    this.#synced = true;
  }

  async #sendIfWritten(reply: encoding.Encoder): Promise<void> {
    if (encoding.length(reply) > 1) this.#socket.send(encoding.toUint8Array(reply));
  }
}

/**
 * Put notes on a board and make sure the room has them: write them, sync, then let a
 * fresh connection confirm the count. The confirmation is the part that matters — a
 * seed nobody verified turns a persistence test into a test of nothing.
 */
export async function seedBoard(
  origin: string,
  boardId: string,
  fill: (doc: Y.Doc) => void,
  expectedNotes: number
): Promise<void> {
  const doc = new Y.Doc();
  initDoc(doc);
  fill(doc);
  const writer = await BoardConnection.join(boardId, origin, doc);
  // The room answers a SyncStep2 with nothing, so the writer waits for the room's own
  // SyncStep1 (it sends one when a socket is accepted) before hanging up.
  await sleep(300);
  writer.close();

  const deadline = Date.now() + 60_000;
  for (;;) {
    const notes = await readBoard(origin, boardId);
    if (notes.length >= expectedNotes) return;
    if (Date.now() > deadline) {
      throw new Error(`the board only holds ${notes.length} of ${expectedNotes} seeded notes`);
    }
    await sleep(250);
  }
}

/** What a newcomer sees on a board: every note, bottom to top. */
export async function readBoard(origin: string, boardId: string): Promise<readonly StickySnapshot[]> {
  const doc = new Y.Doc();
  const reader = await BoardConnection.join(boardId, origin, doc);
  try {
    await reader.waitForSync();
    // One more beat for updates that follow the first SyncStep2.
    await sleep(100);
    return snapshot(doc);
  } finally {
    reader.close();
  }
}
