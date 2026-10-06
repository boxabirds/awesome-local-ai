/**
 * Putting a board into a running server from the test process.
 *
 * Seeding two thousand notes through the browser would take longer than the thing it sets up, and
 * a board planted by editing storage would not prove that a server can be *reached* into. So this
 * is an ordinary participant: a real `Y.Doc`, the real board model, the real y-websocket framing
 * over a real WebSocket. Whatever it writes is what a person's board would have been, and the
 * restart test that follows reads it back.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
import { MESSAGE_SYNC, syncFrame } from '../../../src/shared/protocol';

/** Marks the seeding script's own changes, so nothing it receives is echoed back. */
const LOCAL = Symbol('seeding');
/** Marks changes that arrived from the room. */
const REMOTE = Symbol('remote');

const OPEN_TIMEOUT_MS = 30_000;
/** Above this much unsent data the seeder pauses: a socket is not an infinite queue. */
const BUFFERED_LIMIT_BYTES = 256 * 1024;

function rest(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/**
 * One participant on a board, from the test process: the same exchange the browser provider has,
 * with no browser in it.
 */
class BoardConnection {
  readonly doc = new Y.Doc();
  readonly socket: WebSocket;
  #stepTwoSeen = false;
  #failure: unknown = null;
  #closed: { code: number; reason: string } | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => this.#receive(event.data));
    socket.addEventListener('close', (event) => {
      this.#closed = { code: event.code, reason: event.reason };
    });
  }

  /** Opens the board and waits for the room's answer to our SyncStep1. */
  static async open(wsBaseUrl: string, boardId: string): Promise<BoardConnection> {
    const socket = new WebSocket(`${wsBaseUrl}/api/rooms/${boardId}`);
    socket.binaryType = 'arraybuffer';
    const connection = new BoardConnection(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`connecting to board ${boardId} timed out`)),
        OPEN_TIMEOUT_MS,
      );
      const done = (error: Error | null) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      socket.addEventListener('open', () => done(null));
      socket.addEventListener('error', () =>
        done(new Error(`connecting to board ${boardId} failed`)),
      );
    });
    connection.#sendSync((encoder) => syncProtocol.writeSyncStep1(encoder, connection.doc));
    await connection.waitFor(() => connection.#stepTwoSeen, OPEN_TIMEOUT_MS, 'the room never synced');
    return connection;
  }

  /** Every change made here in one transaction goes to the room as its own frame. */
  forwardLocalChanges(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL) return;
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      this.#send(syncFrame(encoding.toUint8Array(encoder)));
    });
  }

  /** Pauses until the socket has handed its backlog on, so a fast writer cannot outrun it. */
  async drain(): Promise<void> {
    while (this.socket.bufferedAmount > BUFFERED_LIMIT_BYTES) await rest(10);
    // one turn of the event loop, so the last frame is actually on its way
    await rest(0);
  }

  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Why the room hung up, if it did: a close code is part of this story's contract. */
  closedAs(): string {
    const closed = this.#closed;
    return closed === null ? 'still open' : `code ${closed.code}${closed.reason ? ` (${closed.reason})` : ''}`;
  }

  async waitFor(condition: () => boolean, timeoutMs: number, message: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.#failure) throw new Error(String(this.#failure));
      if (this.#closed) throw new Error(`${message}: the room closed the connection, ${this.closedAs()}`);
      if (condition()) return;
      if (Date.now() > deadline) throw new Error(message);
      await rest(20);
    }
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, 'done');
      await rest(50);
    }
  }

  #send(bytes: Uint8Array): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`the room closed the connection while writing: ${this.closedAs()}`);
    }
    // the socket wants a buffer it owns, so hand it a copy rather than a view over a shared pool
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.socket.send(copy.buffer as ArrayBuffer);
  }

  /** Wraps a sync message in the outer frame the room reads. */
  #sendSync(write: (encoder: encoding.Encoder) => void): void {
    const encoder = encoding.createEncoder();
    write(encoder);
    this.#send(syncFrame(encoding.toUint8Array(encoder)));
  }

  #receive(data: unknown): void {
    const bytes = asBytes(data);
    if (bytes === null) return;
    try {
      const decoder = decoding.createDecoder(bytes);
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return; // awareness: nothing to apply
      const encoder = encoding.createEncoder();
      const type = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE);
      if (type === syncProtocol.messageYjsSyncStep2) this.#stepTwoSeen = true;
      const reply = encoding.toUint8Array(encoder);
      if (reply.length > 0) this.#send(syncFrame(reply));
    } catch (error) {
      // a sync the room got wrong is a failure of this story, not something to carry on past
      this.#failure = error;
    }
  }
}

/** The words a seeded note carries, stable for a given index. */
function noteText(index: number): string {
  const lines = [
    'The import tool is still the slowest thing in the app.',
    'Board search would save me ten minutes a day.',
    'Nobody could tell who had moved the note.',
    'Export to PDF before the quarter review.',
    'The loading state made me think my board was empty.',
  ];
  const base = lines[index % lines.length] ?? '';
  return index % 7 === 0 ? `${base}\nand a second line` : base;
}

/**
 * Writes a board of `notes` notes onto a running server: notes in rows of forty, in all six
 * colours, every one with text, some moved and some raised along the way.
 *
 * One note is one transaction and therefore one frame, which is what a person's board looks like
 * from the room's side - and at this size it is also what makes the room fold its log a few times
 * before the test being measured even starts.
 */
export async function seedBoard(
  wsBaseUrl: string,
  boardId: string,
  notes: number,
): Promise<readonly StickySnapshot[]> {
  const connection = await BoardConnection.open(wsBaseUrl, boardId);
  connection.forwardLocalChanges();
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  const ids: string[] = [];

  try {
    for (let index = 0; index < notes; index += 1) {
      Y.transact(
        connection.doc,
        () => {
          const id = createSticky(
            connection.doc,
            { x: (index % 40) * 240, y: Math.floor(index / 40) * 240 },
            colors[index % colors.length],
          );
          getStickyText(connection.doc, id)?.insert(0, noteText(index));
          ids.push(id);
          // a board that has been lived in has also been tidied
          const moved = ids[index - 3];
          if (index % 11 === 10 && moved) {
            moveObject(connection.doc, moved, (index % 40) * 240 + 12, 60);
          }
          const raised = ids[index - 5];
          if (index % 17 === 16 && raised) bringToFront(connection.doc, raised);
        },
        LOCAL,
      );
      if (index % 50 === 49) await connection.drain();
    }
    await connection.drain();
  } catch (error) {
    await rest(200); // let the close event land, so the reason can be told
    throw new Error(
      `seeding stopped after ${ids.length} of ${notes} notes: ${String(error)}; ` +
        `the connection is ${connection.closedAs()}`,
    );
  }
  const seeded = connection.notes();
  await connection.close();

  // confirmed from a second connection, so "the socket accepted my writes" is not the standard
  const check = await BoardConnection.open(wsBaseUrl, boardId);
  await check.waitFor(() => check.notes().length >= notes, 60_000, 'the room never held the board');
  await check.close();

  return seeded;
}

/**
 * Adds `moves` small changes to a board that already exists - one note nudged a little, each in its
 * own transaction - so a board can be pushed past the room's compaction threshold without becoming
 * a big one.
 *
 * A log that long is what makes the room fold its snapshot, and the snapshot is the only stored
 * thing whose damage refuses the whole board: a damaged log row costs that change and nothing more.
 */
export async function nudgeBoard(
  wsBaseUrl: string,
  boardId: string,
  moves: number,
): Promise<void> {
  const connection = await BoardConnection.open(wsBaseUrl, boardId);
  connection.forwardLocalChanges();
  try {
    const ids = connection.notes().map((note) => note.id);
    if (ids.length === 0) throw new Error('this board has no note to move');
    for (let index = 0; index < moves; index += 1) {
      Y.transact(
        connection.doc,
        () => moveObject(connection.doc, ids[index % ids.length] as string, 20 + index, 30 + index % 7),
        LOCAL,
      );
      if (index % 50 === 49) await connection.drain();
    }
    await connection.drain();
  } finally {
    await connection.close();
  }
}

/**
 * Reads a board back through a fresh connection: the cheapest check that it is still there, and
 * what a restart test compares the browser's board against.
 */
export async function readBoard(
  wsBaseUrl: string,
  boardId: string,
  expectNotes?: number,
): Promise<readonly StickySnapshot[]> {
  const connection = await BoardConnection.open(wsBaseUrl, boardId);
  if (expectNotes !== undefined) {
    await connection.waitFor(
      () => connection.notes().length >= expectNotes,
      60_000,
      `the board never came back with ${expectNotes} notes`,
    );
  }
  const notes = connection.notes();
  await connection.close();
  return notes;
}
