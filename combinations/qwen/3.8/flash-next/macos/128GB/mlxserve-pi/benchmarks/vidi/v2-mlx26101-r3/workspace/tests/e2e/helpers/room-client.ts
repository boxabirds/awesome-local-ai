import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_SYNC, decodeMessage } from '../../../src/shared/protocol';
import {
  initDoc,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { writeNote, type NoteSeed } from '../../fixtures/boards';
import {
  checkoutFlowEdits,
  emptyFlowIds,
  type FlowEdit,
  type FlowIds,
} from '../../fixtures/checkout-flow';

/**
 * A client that is not a browser, for the fixtures a browser test needs.
 *
 * TC-21 opens a board of `PERSIST_TESTED_NOTES` notes, which is a lot of notes to draw: putting
 * them on the board by clicking a button would spend the test's time on the fixture, and pouring
 * them into a page with `page.evaluate` would be a board that never went through the room. This is
 * the room's own sync path from the outside - the same bytes a person's browser sends, one note at
 * a time - so by the time a browser arrives the board exists the way any board exists: written by
 * the room, into its own storage, in as many rows as the edits it stands for.
 */

/** `WebSocket.OPEN`; written out because the DOM lib calls the same state `OPEN`. */
const OPEN = 1;

/** Where the room's bytes came from; an update from the room is not sent back to it. */
const FROM_ROOM = Symbol('from-room');

/** How long the room is given to take a fixture in. */
const SETTLE_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A document update, framed the way a y-websocket client frames one. */
function updateFrame(update: Uint8Array): Uint8Array<ArrayBuffer> {
  const outer = encoding.createEncoder();
  encoding.writeVarUint(outer, MESSAGE_SYNC);
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, update);
  encoding.writeUint8Array(outer, encoding.toUint8Array(inner));
  return encoding.toUint8Array(outer);
}

export class RoomClient {
  readonly doc = new Y.Doc();
  private readonly socket: WebSocket;
  private readonly opened: Promise<void>;
  private closed = false;

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.opened = new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => {
        resolve();
      });
      this.socket.addEventListener('error', () => {
        reject(new Error(`the socket to ${url} failed`));
      });
    });
    this.socket.addEventListener('message', (event: MessageEvent) => {
      this.receive(event.data);
    });
    this.socket.addEventListener('close', () => {
      this.closed = true;
    });
  }

  /** Open a socket on a board, and answer the room's "what do you have?" as a client does. */
  static async connect(url: string): Promise<RoomClient> {
    const client = new RoomClient(url);
    await client.opened;
    const step1 = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1, client.doc);
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeUint8Array(frame, encoding.toUint8Array(step1));
    client.send(encoding.toUint8Array(frame));
    return client;
  }

  private send(data: Uint8Array): void {
    this.socket.send(data);
  }

  private receive(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      return;
    }
    const decoded = decodeMessage(data);
    if (decoded.kind !== 'sync') {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(
      decoding.createDecoder(decoded.payload),
      encoder,
      this.doc,
      FROM_ROOM,
    );
    const reply = encoding.toUint8Array(encoder);
    if (reply.byteLength > 1) {
      this.send(reply);
    }
  }

  /**
   * Write a fixture onto the board one edit at a time.
   *
   * The notes have their own method because story 4's tests count rows, and a fixture that arrives as
   * one update would be a board that the room's log says somebody made in a single motion. This is the
   * general form of the same trick: the schema version and then one row per edit, each sent as what the
   * board does not have yet.
   */
  async writeEdits(edits: readonly FlowEdit[]): Promise<void> {
    initDoc(this.doc);
    this.sendUpdate(Y.encodeStateAsUpdate(this.doc));
    for (const edit of edits) {
      const since = Y.encodeStateVector(this.doc);
      edit.apply(this.doc);
      this.sendUpdate(Y.encodeStateAsUpdate(this.doc, since));
    }
  }

  /**
   * Write the notes onto the board one at a time, as a person's edits arrive one at a time.
   *
   * Each note is sent as what the board does not have yet, which is the only thing a client ever
   * sends - and so each note becomes one row in the room's log, which is what a board of this size
   * made by hand would look like.
   */
  async writeNotes(notes: readonly NoteSeed[]): Promise<void> {
    initDoc(this.doc);
    // The board has nothing of this yet, so the whole of it goes over as one update - which is what
    // a client sends when it holds something the room does not. From here on each note is sent as
    // what the board lacks, which is the only kind of update a client ever has.
    this.sendUpdate(Y.encodeStateAsUpdate(this.doc));
    for (const note of notes) {
      const since = Y.encodeStateVector(this.doc);
      writeNote(this.doc, note);
      this.sendUpdate(Y.encodeStateAsUpdate(this.doc, since));
    }
  }

  private sendUpdate(update: Uint8Array): void {
    if (update.byteLength <= 1) {
      return;
    }
    this.send(updateFrame(update));
  }

  /** What this client has been told about the board. */
  notes(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  /** Everything on the board, of whatever kind: shapes and arrows are objects too. */
  objects(): readonly ObjectSnapshot[] {
    return snapshot(this.doc);
  }

  /** Wait until the room has said it has this many objects of any kind. */
  async waitForObjects(count: number): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      if (this.objects().length >= count) {
        return;
      }
      if (this.closed || Date.now() > deadline) {
        throw new Error(
          `the room offered ${String(this.objects().length)} object(s) and wanted ${String(count)}` +
            `${this.closed ? ' before the socket closed' : ''}`,
        );
      }
      await sleep(50);
    }
  }

  /** Wait until the room has said it has this many notes. */
  async waitForNotes(count: number): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      if (this.notes().length >= count) {
        return;
      }
      if (this.closed || Date.now() > deadline) {
        throw new Error(
          `the room offered ${String(this.notes().length)} note(s) and wanted ${String(count)}` +
            `${this.closed ? ' before the socket closed' : ''}`,
        );
      }
      await sleep(50);
    }
  }

  close(): void {
    if (this.socket.readyState === OPEN) {
      this.socket.close();
    }
  }
}

/**
 * Put a board on a room, and do not come back until the room says it has the whole thing.
 *
 * The confirmation is a second connection, because the first one's document is the one that wrote
 * the board and would agree with itself whatever the room had done with the bytes. A newcomer is
 * told what the board is, and that is what a browser arriving next will be told too - which is why
 * what comes back here is the newcomer's reading, in the shape a page reports a board in: it is the
 * room's own answer, ids and all, since a note's id is given to it when it is made and is not
 * something the fixture gets to choose.
 */
export async function seedBoard(
  url: string,
  notes: readonly NoteSeed[],
): Promise< readonly WrittenNote[]> {
  const writer = await RoomClient.connect(url);
  await writer.writeNotes(notes);
  const newcomer = await RoomClient.connect(url);
  try {
    await newcomer.waitForNotes(notes.length);
    return newcomer.notes()
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, x, y, z, color, text }) => ({ id, x, y, z, color, text }));
  } finally {
    writer.close();
    newcomer.close();
  }
}

/** A note as the room reports it, which is the same list of things a page reports. */
export interface WrittenNote {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly text: string;
}

/** The number of objects the checkout flow puts on a board: four shapes and four arrows. */
const FLOW_OBJECT_COUNT = 8;

/**
 * Put the checkout flow on a board from outside the browser, and hand back the ids it was given.
 *
 * The ids are made by the fixture as it writes, and read back from a second connection: the writer's
 * own document would agree with itself no matter what the room had done with the bytes, so what is
 * checked here is the room's answer - the same one a browser arriving next will be given. A shape
 * whose id did not come back is a shape that never arrived, and a test that pressed where it thought a
 * shape was would then be pressing on empty board.
 */
export async function seedCheckoutFlow(url: string): Promise<FlowIds> {
  const ids = emptyFlowIds();
  const writer = await RoomClient.connect(url);
  await writer.writeEdits(checkoutFlowEdits(ids));
  const newcomer = await RoomClient.connect(url);
  try {
    await newcomer.waitForObjects(FLOW_OBJECT_COUNT);
    const present = new Set(newcomer.objects().map((object) => object.id));
    for (const [name, id] of [
      ...Object.entries(ids.shapes),
      ...Object.entries(ids.connectors),
    ] as [string, string][]) {
      if (!present.has(id)) {
        throw new Error(`the room never told anybody about the flow's ${name}`);
      }
    }
    return ids;
  } finally {
    writer.close();
    newcomer.close();
  }
}
