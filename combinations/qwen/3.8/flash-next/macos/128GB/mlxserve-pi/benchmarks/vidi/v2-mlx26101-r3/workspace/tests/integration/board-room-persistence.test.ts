import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SELF, runInDurableObject } from 'cloudflare:test';
import * as syncProtocol from 'y-protocols/sync';
import {
  Participant,
  SocketLog,
  boardId,
  encodeFrame,
  encodeSync,
  sameBoard,
  waitFor,
} from './helpers/ws-client';
import {
  boardStub,
  boardStubId,
  countRows,
  openRoom,
} from './helpers/storage';
import { noteSeeds, truncated, writeNote } from '../fixtures/boards';
import { BoardStore } from '../../src/worker/board-store';
import { COMPACTION_UPDATE_COUNT, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { initDoc, moveObject, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { armStoreFault, clearStoreFaults } from '../../src/worker/store-faults';

/**
 * Story 4, task 5: a `BoardRoom` that keeps its board in storage.
 *
 * These run the room exactly as story 3's tests do - real sockets, real `Y.Doc`s, nothing mocked
 * below the socket - and ask the questions storage adds: was a change in storage before anybody
 * was told about it (TC-12); does a board come back when nobody stayed connected (TC-13); does a
 * write that fails stop the relay rather than the relay hiding the failure (TC-14); is a board
 * that cannot be read answered honestly instead of shown empty (TC-15); is the retry after that
 * throttled, and does the board come back once it can be read (TC-16); is refused garbage not
 * stored (TC-17); does a socket the runtime accepted a long time ago still get what it is owed
 * (TC-18); and is a read that fails told apart from a board that cannot be read (TC-26).
 *
 * ## What these tests cannot do, and what is tested instead
 *
 * The design says "a new room instance over the same storage" for TC-13 and TC-18. There is no
 * way to build that from outside: the runtime hands a `DurableObjectState` - and with it one
 * board's storage - to that board's object alone, so no test can hand a board to a constructor
 * but the runtime's own. Building a second `BoardRoom` inside the first would hang two message
 * handlers off one set of sockets, which is not what a restart does either.
 *
 * So what a new instance is *observed* to do is tested from outside - everybody disconnects, then
 * a client whose document is empty is handed the whole board - and the part that needs a second
 * pair of hands over the same rows is tested where two pairs genuinely exist: TC-05, TC-07 and
 * TC-25 at the store, with a fresh `Y.Doc` over storage the room wrote; TC-19 to TC-21 at the
 * level of a process that really does stop and start. TC-16 is the room saying it read the board
 * again, in a way that cannot be faked: the room's own line about *not* reading it is part of the
 * assertion, captured from the isolate the object itself runs in.
 */

/** The bytes of a statement's `data` column, taken inside the object that owns them. */
function bytesOf(state: DurableObjectState, query: string): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (const row of state.storage.sql.exec<{ data: ArrayBuffer }>(query)) {
    chunks.push(new Uint8Array(row['data']));
  }
  return chunks;
}

/** One chunk's worth of bytes back into one array, the way the store joins its own. */
function join(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** One client's opening move: the document is initialised, as a person's first edit needs. */
function initialise(doc: Y.Doc): void {
  initDoc(doc);
}

/** The board as a document that has never seen this room reads it out of the room's own rows. */
async function storedBoard(name: string): Promise<Y.Doc> {
  const bytes = await runInDurableObject(boardStub(name), (_room, state) => {
    const doc = new Y.Doc();
    new BoardStore(state.storage).load(doc);
    return Y.encodeStateAsUpdate(doc) as Uint8Array<ArrayBuffer>;
  });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

/** The texts on a board, sorted, so nothing depends on the order the notes were made in. */
function texts(doc: Y.Doc): string[] {
  return snapshot(doc)
    .map((note) => note.text)
    .sort();
}

/** The same, from a client's point of view. */
function clientTexts(participant: Participant): string[] {
  return [...participant.snapshot().map((note) => note.text)].sort();
}

/** How many rows a board's log holds. */
function logRows(name: string): Promise<number> {
  return countRows(boardStub(name), 'updates');
}

/** Wait for the room to have written this many rows: the write itself, not a sleep. */
async function waitForRows(stub: ReturnType<typeof boardStub>, count: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await runInDurableObject(stub, (_room, state) => {
      const seen: number[] = [];
      for (const row of state.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM updates',
      )) {
        seen.push(Number(row['count']));
      }
      return seen;
    });
    if ((rows[0] ?? 0) >= count || Date.now() > deadline) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

/**
 * Put `count` notes on a board through a real connection, as a person would, and wait until the
 * room has written them.
 *
 * The returned client is the copy everybody else's board is compared against. One transaction per
 * note, so one note is one update is one row: the shape a person's edit has.
 */
async function writeNotes(name: string, count = 25): Promise<Participant> {
  const stub = boardStub(name);
  const writer = new Participant();
  await writer.connect(name);
  await writer.waitFor(() => writer.synced, 'the room to answer with the board');
  initialise(writer.doc);
  for (const note of noteSeeds(count)) {
    writeNote(writer.doc, note);
  }
  await waitForRows(stub, count + 1);
  return writer;
}

/**
 * Keep editing until the room has folded its log up, which is how a board comes to have a snapshot.
 *
 * The room compacts at COMPACTION_UPDATE_COUNT rows, so this is how a test gets the state a board
 * is in after an afternoon of work without waiting for an afternoon. The moves alternate over two
 * positions, so the board keeps exactly the notes it had.
 */
async function untilCompacted(name: string, writer: Participant): Promise<void> {
  const stub = boardStub(name);
  const [note] = writer.snapshot();
  if (note === undefined) {
    throw new Error('there was no note to move');
  }
  for (let step = 0; step < COMPACTION_UPDATE_COUNT + 2; step += 1) {
    moveObject(writer.doc, note.id, step % 2 === 0 ? 20 : 24, 20);
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    if ((await countRows(stub, 'snapshot_chunks')) > 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`the room did not fold its log up after ${COMPACTION_UPDATE_COUNT} changes`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** A socket on `name`, recorded, without speaking any protocol. */
async function rawSocket(name: string): Promise<SocketLog> {
  const response = await SELF.fetch(
    new Request(`http://localhost/api/rooms/${name}`, { headers: { Upgrade: 'websocket' } }),
  );
  return new SocketLog(response);
}

/** Everything the room says about storage, from now until `stop`. */
function captureRoomLog(): { lines: () => string[]; stop: () => void } {
  const seen: string[] = [];
  const errors = console.error;
  console.error = (...args: unknown[]): void => {
    seen.push(args.map(String).join(' '));
  };
  return {
    lines: () => [...seen],
    stop: (): void => {
      console.error = errors;
    },
  };
}

describe('a change is in storage before anybody is told about it (TC-12)', () => {
  it('has the row by the time the other person sees the change', async () => {
    const name = boardId();
    await openRoom(boardStub(name));
    const alex = new Participant();
    const sam = new Participant();
    await alex.connect(name);
    await sam.connect(name);
    await alex.waitFor(() => alex.synced && sam.synced, 'both to be synced');

    writeNote(alex.doc, { x: 30, y: 40, color: 'yellow', text: 'seen before saved' });
    // The relay is what the second person waits for, and the moment it arrives is the moment the
    // row has to be in storage. There is no sleep here: it is the order that is being asserted,
    // and the row is asked for at the first moment the change is visible to anybody.
    await waitFor(() => sam.snapshot().length === 1, 'the change to reach the other person');
    expect(await logRows(name)).toBeGreaterThanOrEqual(1);

    // And that row is the board: a document that has never seen this room reads the note back out
    // of it, position and colour included, although neither was ever repeated to anybody else.
    // The position is compared against what the person who made it sees, because where the model
    // puts a note's point in its own coordinates is the model's business, not this test's.
    const saved = await storedBoard(name);
    expect(texts(saved)).toEqual(['seen before saved']);
    expect(snapshot(saved).map((note) => [note.x, note.y, note.color])).toEqual(
      alex.snapshot().map((note) => [note.x, note.y, note.color]),
    );
    expect(sam.updateFrames().length).toBeGreaterThanOrEqual(1);
  });
});

describe('the board comes back with nobody left connected (TC-13)', () => {
  it('hands the whole board to a client that arrives after everybody went away', async () => {
    const name = boardId();
    const stub = boardStub(name);
    await openRoom(stub);
    const alex = await writeNotes(name, 25);
    const board = alex.snapshot();
    // Everybody goes. Nothing is holding this board either: its sockets were accepted with the
    // hibernating API, so the runtime is free to put the object away between one connection and
    // the next, and what the next person is handed has to come out of the rows.
    alex.close();
    await waitForRows(stub, 26);

    const late = new Participant();
    await late.connect(name);
    await late.waitFor(() => late.snapshot().length === 25, 'the whole board to arrive');
    expect(sameBoard(late.snapshot(), board)).toBe(true);
    expect(clientTexts(late)).toEqual(clientTexts(alex));
  });
});

describe('a write that fails stops the relay rather than the relay hiding it (TC-14)', () => {
  it('loses nothing: the change is held, then saved and delivered once storage works', async () => {
    const name = boardId();
    const stub = boardStub(name);
    await openRoom(stub);
    const alex = new Participant();
    const sam = new Participant();
    await alex.connect(name);
    await sam.connect(name);
    await alex.waitFor(() => alex.synced && sam.synced, 'both to be synced');

    // The room cannot write. Not a slow write, and not one that succeeds later in the same change:
    // the statement itself fails.
    armStoreFault(boardStubId(name), 'append');
    writeNote(alex.doc, { x: 60, y: 60, color: 'pink', text: 'written while storage was broken' });

    // Both are told, with a code that says the room is what gave up.
    expect((await sam.waitForClose()).code).toBe(CLOSE_STORAGE_FAILURE);
    expect((await alex.waitForClose()).code).toBe(CLOSE_STORAGE_FAILURE);
    // The change was never relayed: Sam, connected the whole time, was sent nothing.
    expect(sam.updateFrames()).toEqual([]);
    expect(clientTexts(sam)).toEqual([]);
    // And nothing was stored, so the board is not quietly half-saved.
    expect(await logRows(name)).toBe(0);
    // Alex still has his work, which is the point of the room keeping its document: the person who
    // made the change is not the one who loses it.
    expect(clientTexts(alex)).toEqual(['written while storage was broken']);

    // Storage is fixed. Sam comes back first, with an empty board; Alex after, still holding the
    // change - and it is the ordinary sync that saves it, the room remembering nothing about the
    // failure to make that happen.
    clearStoreFaults(boardStubId(name));
    await sam.connect(name);
    await sam.waitFor(() => sam.synced, 'Sam to be synced with an empty board');
    expect(sam.updateFrames()).toEqual([]);

    await alex.connect(name);
    await sam.waitFor(
      () => clientTexts(sam).includes('written while storage was broken'),
      'the held change to reach Sam at last',
    );
    expect(await logRows(name)).toBe(1);
    expect(texts(await storedBoard(name))).toEqual(['written while storage was broken']);
  });
});

describe('a board that cannot be read (TC-15, TC-16), and a read that fails (TC-26)', () => {
  /**
   * A board of 25 notes, folded into a snapshot, whose snapshot has then been damaged.
   *
   * The damage is done to the row the room itself wrote, by cutting it short - the way a write
   * that stopped halfways looks - and it is done while the room is holding a good board in memory,
   * which is what makes the question interesting: the room *could* serve what it has in memory.
   * It must not. `repair` puts the bytes back and stops listening to the room's log.
   */
  async function boardWithDamagedSnapshot(): Promise<{
    name: string;
    board: readonly StickySnapshot[];
    lines: () => string[];
    repairNow: () => Promise<void>;
    stop: () => void;
  }> {
    const name = boardId();
    const stub = boardStub(name);
    await openRoom(stub);
    const alex = await writeNotes(name, 25);
    await untilCompacted(name, alex);
    expect(await countRows(stub, 'snapshot_chunks')).toBe(1);
    const board = alex.snapshot();

    const whole = await runInDurableObject(stub, (_room, state) => {
      const chunks = bytesOf(state, 'SELECT data FROM snapshot_chunks ORDER BY idx');
      const bytes = chunks[0] ?? new Uint8Array(0);
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        truncated(bytes, 0.5),
      );
      return join(chunks);
    });
    const capture = captureRoomLog();
    return {
      name,
      board,
      lines: capture.lines,
      // Putting the row back and stopping the listen are separate, because TC-16 needs the board
      // repaired while it is still listening: what it asserts next is something the room says
      // after the repair.
      repairNow: async (): Promise<void> => {
        await runInDurableObject(stub, (_room, state) => {
          state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', whole);
        });
      },
      stop: capture.stop,
    };
  }

  /**
   * Get the room to the state in which it reads the board again.
   *
   * A room reads its board when it is woken, and when a connection arrives after a failure; there
   * is no way to ask for either directly. A write that fails leaves the room with everybody
   * disconnected and storage known-bad, which is exactly the state in which the next connection is
   * meant to try storage again - so this is not a trick, it is the path the story describes.
   */
  async function bringTheRoomToRetry(name: string): Promise<void> {
    armStoreFault(boardStubId(name), 'append');
    const writer = new Participant();
    await writer.connect(name);
    await writer.waitFor(
      () => writer.synced || writer.log.closed,
      'a connection, or the room refusing it',
    );
    writeNote(writer.doc, { x: 5, y: 5, color: 'blue', text: 'the write that cannot be saved' });
    expect((await writer.waitForClose()).code).toBe(CLOSE_STORAGE_FAILURE);
    clearStoreFaults(boardStubId(name));
  }

  it('refuses a board whose snapshot it cannot read, and stores nothing from whoever arrives', async () => {
    const { name, lines, stop } = await boardWithDamagedSnapshot();
    try {
      await bringTheRoomToRetry(name);
      const rows = await logRows(name);

      // Somebody arrives. The room tries storage, and storage gives back something it cannot read.
      const socket = await rawSocket(name);
      // This client does not wait to be asked: it sends what it has straight away, which is what a
      // page that was holding changes does. A room that cannot read its board must not add to it,
      // because it does not know what the board is.
      const holding = new Y.Doc();
      initialise(holding);
      writeNote(holding, {
        x: 1,
        y: 1,
        color: 'yellow',
        text: 'held while the board was unreadable',
      });
      socket.send(
        encodeFrame(
          MESSAGE_SYNC,
          encodeSync((encoder) => {
            syncProtocol.writeSyncStep2(encoder, holding);
          }),
        ),
      );
      expect((await socket.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      // Given a moment to be answered, the socket is told nothing: not a document, not an error
      // message, not an empty board.
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      expect(socket.frames).toEqual([]);
      // And the row this client offered is not in the log.
      expect(await logRows(name)).toBe(rows);
      expect(lines().some((line) => line.includes('snapshot-unreadable'))).toBe(true);
    } finally {
      // Every test gets a board nobody has used before, so a damaged row left here is rows on a
      // board nobody reads again; what has to be put back is the room's log, which the room owns.
      stop();
    }
  });

  it('does not read the board again straight away, and serves it once the damage is repaired', async () => {
    const { name, board, lines, repairNow, stop } = await boardWithDamagedSnapshot();
    try {
      await bringTheRoomToRetry(name);
      // The connection that made the room try storage is the first to be refused.
      const first = await rawSocket(name);
      expect((await first.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      const refusedAt = Date.now();

      // The damage is repaired, and the person presses reload straight away. The board could be
      // read now, but pressing reload ten times must not make the room read a board it has only
      // just found it cannot read.
      await repairNow();
      const tooSoon = await rawSocket(name);
      expect((await tooSoon.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      const waited = Date.now() - refusedAt;
      expect(waited).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);
      // The room says which of the two it did, and it says it did not read the board. That line is
      // the assertion: an implementation that read again on every connection would not write it.
      expect(
        lines().some((line) => /not loaded again \d+ms after the last attempt/.test(line)),
      ).toBe(true);

      // Give it the interval it asked for. Same object, no restart: the retry is the room's own,
      // and what it serves is what is in the rows.
      await new Promise((resolve) => {
        setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS - waited + 250);
      });
      const late = new Participant();
      await late.connect(name);
      await late.waitFor(() => late.snapshot().length === 25, 'the repaired board to be served');
      expect(sameBoard(late.snapshot(), board)).toBe(true);
      // The room read the board on its own, in the same object, without being restarted: there is
      // no other way a document it had refused a minute ago gets served.
    } finally {
      // Every test gets a board nobody has used before, so a damaged row left here is rows on a
      // board nobody reads again; what has to be put back is the room's log, which the room owns.
      stop();
    }
  });

  it('tells a read that failed apart from a board it cannot read, and refuses the connection either way', async () => {
    const name = boardId();
    await openRoom(boardStub(name));
    const alex = await writeNotes(name, 25);
    // The room is left holding a good board, and then the log read is made to fail.
    await bringTheRoomToRetry(name);
    armStoreFault(boardStubId(name), 'load:read-log');
    const capture = captureRoomLog();
    try {
      const socket = await rawSocket(name);
      expect((await socket.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      // The person is refused, and the room says to itself which of the two failures this was: a
      // board it cannot read is `snapshot-unreadable`, a read that failed is `sql-error`, and the
      // difference is what decides whether the rows are worth another look.
      expect(capture.lines().some((line) => line.includes('could not be loaded (sql-error'))).toBe(
        true,
      );
      // Nothing was lost by a read that failed: the rows are untouched, all 25 notes still there
      // for the next attempt to find.
      expect(texts(await storedBoard(name))).toHaveLength(25);
      // Not a line about the board's contents being unreadable: the rows are fine, the read is
      // what failed, and the room says so rather than treating the board as damaged.
      expect(capture.lines().some((line) => line.includes('snapshot-unreadable'))).toBe(false);
      void alex;
    } finally {
      clearStoreFaults(boardStubId(name));
      capture.stop();
    }
  });
});

describe('refused garbage is not stored (TC-17)', () => {
  it('closes the socket that sent it and leaves the log alone', async () => {
    const name = boardId();
    await openRoom(boardStub(name));
    const alex = await writeNotes(name, 25);
    const before = await logRows(name);
    expect(before).toBe(26);
    const board = alex.snapshot();

    alex.sendBytes(encodeFrame(MESSAGE_SYNC, new Uint8Array([1, 2, 3, 4])));
    expect((await alex.waitForClose()).code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await logRows(name)).toBe(before);

    // The board that nobody could damage is still the board, and the next person finds it.
    expect(texts(await storedBoard(name))).toEqual([...board.map((note) => note.text)].sort());
    const late = new Participant();
    await late.connect(name);
    await late.waitFor(() => late.snapshot().length === 25, 'the board to be served');
  });
});

describe('a socket the runtime accepted a long time ago still gets what it is owed (TC-18)', () => {
  it('relays to the first connection after two others came and went', async () => {
    const name = boardId();
    await openRoom(boardStub(name));
    const alex = new Participant();
    await alex.connect(name);
    await alex.waitFor(() => alex.synced, 'the board');

    // Sam arrives, works, and leaves.
    const sam = new Participant();
    await sam.connect(name);
    await sam.waitFor(() => sam.synced, 'Sam to be synced');
    writeNote(sam.doc, { x: 10, y: 10, color: 'green', text: 'from Sam' });
    await alex.waitFor(() => clientTexts(alex).includes('from Sam'), 'Alex to see Sam’s note');
    const framesSoFar = alex.frames.length;
    sam.close();

    // Somebody else arrives on the same board and works. Alex is still on the socket opened at the
    // start: the room never re-accepted it and keeps no list of its own, because the list it
    // relays to is the runtime's - the only list that would still be there after the object had
    // been put to sleep and woken again with the same sockets.
    const nadia = new Participant();
    await nadia.connect(name);
    await nadia.waitFor(() => nadia.synced, 'Nadia to be synced with the board');
    expect(clientTexts(nadia)).toContain('from Sam');
    writeNote(nadia.doc, { x: 30, y: 30, color: 'violet', text: 'from Nadia' });
    await alex.waitFor(() => clientTexts(alex).includes('from Nadia'), 'Alex to see it');
    expect(alex.frames.length).toBeGreaterThan(framesSoFar);

    // And Sam, who was away while it happened, comes back to the whole board rather than to the
    // half of it his socket missed.
    await sam.connect(name);
    await sam.waitFor(() => clientTexts(sam).includes('from Nadia'), 'Sam to catch up');
  });
});
