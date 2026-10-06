/**
 * A board client that runs in the test process rather than in a browser.
 *
 * Two of story 4's cases need a board with thousands of notes on it, and nobody is going to
 * click two thousand times. What this is *not* is a back door into storage: it speaks the same
 * frames over the same WebSocket that the browser's provider does, so a board built with it is
 * a board that went through the room's real receive → store → broadcast path. That is also how
 * a test confirms a board is stored: a *second* client asks the room for what it has, and the
 * room answers from the board it kept — which, per story 4, it wrote down before it said a
 * word about it.
 *
 * It is deliberately small. Anything a test needs beyond this belongs in a browser, where the
 * thing being tested is the whole product.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { newBoardId } from '../../../src/shared/board-id';
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { GRID_SPACING_WORLD, type StickyColor } from '../../../src/shared/config';
import {
  MESSAGE_SYNC,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeMessage,
} from '../../../src/shared/protocol';

const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const satisfies readonly StickyColor[];
/** Notes per row when laying a board out in a grid. */
const ROW = 20;

export interface RoomClose {
  code: number;
  reason: string;
}

/** A client on a board, in the test process. */
export class RoomClient {
  /** This client's copy of the board. */
  readonly doc = new Y.Doc();
  private readonly ws: WebSocket;
  private readonly boardId: string;
  private closedWith: RoomClose | null = null;
  private closeWaiters: Array<(close: RoomClose) => void> = [];
  /** Every byte the room sent, so far. */
  private inbound = 0;

  private constructor(boardId: string, ws: WebSocket) {
    this.boardId = boardId;
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    // Our own changes go out; changes we were told about do not come back.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this && ws.readyState === WebSocket.OPEN) this.sendUpdate(update);
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      this.receive(new Uint8Array(event.data as ArrayBuffer));
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closedWith = { code: event.code, reason: event.reason };
      for (const waiter of this.closeWaiters.splice(0)) waiter(this.closedWith);
    });
  }

  /** Opens a connection to a board and completes the handshake. */
  static async connect(wsOrigin: string, boardId: string = newBoardId()): Promise<RoomClient> {
    const ws = new WebSocket(`${wsOrigin}/api/rooms/${boardId}`);
    const client = new RoomClient(boardId, ws);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', () => {
        client.sendSyncStep1();
        resolveOpen();
      });
      ws.addEventListener('error', (event) => rejectOpen((event as ErrorEvent).message ?? 'could not connect'));
    });
    return client;
  }

  /** Still connected? */
  get open(): boolean {
    return this.closedWith === null && this.ws.readyState <= WebSocket.OPEN;
  }

  /** The board as this client sees it. */
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** How many notes this client can see. */
  get noteCount(): number {
    return this.notes().length;
  }

  /** The board this client is on. */
  get id(): string {
    return this.boardId;
  }

  /**
   * Creates `count` notes, one transaction per note, laid out in a grid with colours that
   * vary — because a board of two thousand identical notes at the same point would be a board
   * that a bug could happily truncate without anybody noticing.
   *
   * One transaction per note is the point: that is what two thousand edits *are*, and it is
   * what makes the log long enough for the room to have to fold it.
   */
  createNotes(count: number, spacedBy = GRID_SPACING_WORLD * 4): void {
    for (let index = 0; index < count; index += 1) {
      const column = index % ROW;
      const row = Math.floor(index / ROW);
      this.doc.transact(() => {
        const id = createSticky(
          this.doc,
          { x: column * spacedBy, y: row * spacedBy },
          COLORS[index % COLORS.length] as StickyColor,
        );
        // A board of blank notes would be a board that a load which stopped early could hand
        // back and nobody could tell. Each one says which of them it is.
        if (typeof id === 'string') getStickyText(this.doc, id)?.insert(0, `Note ${index + 1}`);
      }, this);
    }
  }

  /** Runs one edit as a local transaction, which is to say: sends it to the room. */
  transact(edit: (doc: Y.Doc) => void): void {
    this.doc.transact(() => edit(this.doc), this);
  }

  /** Asks the room for everything it has that this client does not. */
  sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private send(bytes: Uint8Array): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`not connected to board ${this.boardId}`);
    }
    this.ws.send(bytes);
  }

  /** Everything the room has sent us since the last call. */
  private framesSince(seen: number): number {
    return this.inbound - seen;
  }

  /**
   * Waits until the room has had nothing to say for `quietMs`. The room answers a message as
   * it processes it, so a quiet connection is a room that has finished with us.
   */
  async settle(quietMs = 200, timeoutMs = 60_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const seen = this.inbound;
      await new Promise((resolveWait) => setTimeout(resolveWait, quietMs));
      if (this.framesSince(seen) === 0 || !this.open) return;
      if (Date.now() > until) throw new Error(`the room kept sending for longer than ${timeoutMs}ms`);
    }
  }

  /**
   * Waits until this client can see `count` notes.
   *
   * Only changes *the room* made arrive here — a client's own changes are not echoed back to
   * it — so this is a question to ask a client that arrived after the board was made, which is
   * exactly what it is asked for.
   */
  async waitForNotes(count: number, timeoutMs = 120_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      if (this.noteCount >= count) return;
      if (!this.open) throw new Error(`the room closed the door (${await this.closed()} )`);
      if (Date.now() > until) {
        throw new Error(`saw ${this.noteCount} of ${count} notes after ${timeoutMs}ms`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }

  /** How the room closed the connection, waiting for it if it has not yet. */
  closed(): Promise<RoomClose> {
    if (this.closedWith) return Promise.resolve(this.closedWith);
    return new Promise((resolveClose) => {
      this.closeWaiters.push(resolveClose);
    });
  }

  /** Ends the connection. The board stays where the room put it. */
  async close(): Promise<void> {
    if (this.ws.readyState <= WebSocket.CLOSING) {
      await new Promise<void>((resolveClose) => {
        this.ws.addEventListener('close', () => resolveClose());
        this.ws.close();
        // A room that has gone away does not answer a close frame.
        setTimeout(resolveClose, 5000).unref?.();
      });
    }
  }

  private receive(frame: Uint8Array): void {
    this.inbound += 1;
    const decoded = decodeMessage(copy(frame));
    if (decoded.kind !== 'sync') return; // awareness, or something this client has no use for
    const subType = readSubType(decoded.payload);
    if (subType !== SYNC_STEP_1 && subType !== SYNC_STEP_2 && subType !== SYNC_UPDATE) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    if (subType === SYNC_STEP_1) {
      const stateVector = body(decoded.payload);
      if (stateVector.byteLength === 0) {
        // An empty state vector is not something Yjs can read; "I have nothing" is answered
        // with everything, which merges the same way.
        encoding.writeVarUint(encoder, SYNC_UPDATE);
        encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(this.doc));
      } else {
        syncProtocol.writeSyncStep2(encoder, this.doc, stateVector);
      }
    } else {
      // Origin is us, so applying it does not send it straight back.
      syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), encoder, this.doc, this);
    }

    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1 && this.ws.readyState === WebSocket.OPEN) this.ws.send(reply);
  }
}

/** The sub-type of a `sync` message, which is the first number of its payload. */
function readSubType(payload: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(payload));
  } catch {
    return -1;
  }
}

/** The body inside a sync message: everything after the sub-type and its length. */
function body(payload: Uint8Array): Uint8Array {
  try {
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder); // sub-type
    return decoding.readVarUint8Array(decoder);
  } catch {
    return new Uint8Array(0);
  }
}

/** A fresh buffer, so nothing a frame is decoded from can be moved underneath it. */
function copy(bytes: Uint8Array): ArrayBuffer {
  const copyOf = new Uint8Array(bytes.length);
  copyOf.set(bytes);
  return copyOf.buffer;
}
