/**
 * The board's storage, tested on the storage a board actually uses.
 *
 * These run inside workerd, in a real Durable Object, on the SQLite-backed storage a real
 * board's bytes sit in. That is not thoroughness for its own sake: what is under test is
 * SQLite's behaviour — a BLOB that comes back as an `ArrayBuffer`, rows in insertion order, a
 * transaction that unwrites itself — and none of it can be shown by a fake that merely agrees to
 * behave that way.
 *
 * Every test gets a board id of its own. A Durable Object's storage outlives the object, so a
 * board used by one test would be found, with its notes still in it, by the next — which is the
 * behaviour this story is about, and the reason a shared fixture would make these tests prove
 * nothing.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';
import { chunkBytes, joinChunks } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { damage, largeBoard, retroBoard, seededBoard, type SeededBoard } from '../fixtures/boards';

/** Room-level access to the namespace, which is what `cloudflare:test` hands back untyped. */
const namespace = () => env.BOARD_ROOM as unknown as DurableObjectNamespace<BoardRoom>;

/**
 * Run something on a board's storage, inside that board's Durable Object.
 *
 * The room is not what these tests are about — its store is — so each test makes documents of
 * its own and hands them to the store, the way the room does.
 */
function inRoom<T>(boardId: string, work: (room: BoardRoom) => T): Promise<T> {
  const id = namespace().idFromName(boardId);
  return runInDurableObject(namespace().get(id), (room: BoardRoom) => work(room));
}

/** Write a board's changes into storage, the way a room does as they arrive. */
function writeBoard(room: BoardRoom, board: SeededBoard): void {
  for (const update of board.updates) room.store.append(update);
}

/** Fold a board's log away regardless of how long it happens to be. */
function fold(room: BoardRoom, doc: Y.Doc): boolean {
  return room.store.compactIfNeeded(doc, true);
}

/**
 * The row whose bytes create `noteId` — the first row that, applied in order, makes that note
 * exist. Found rather than guessed at, because a note is not one row: creating it and typing into
 * it are separate changes, and a test that damaged an arbitrary row would have expectations that
 * depend on what happened to be in that row.
 */
function rowThatCreates(updates: readonly Uint8Array[], noteId: string): number {
  const probe = new Y.Doc();
  for (const [index, update] of updates.entries()) {
    Y.applyUpdate(probe, update);
    if (snapshot(probe).some((note) => note.id === noteId)) {
      probe.destroy();
      return index;
    }
  }
  probe.destroy();
  return -1;
}

/**
 * Notes ordered by id, because `snapshot` orders them the way a board draws them — one layer
 * raised over another — and two boards assembled in a different order come out the same board in
 * a different order. What these tests need to know is which notes are on the board and what each
 * one holds, not which order the drawing order happened to come out in.
 */
function byId(notes: readonly { id: string }[]): readonly { id: string }[] {
  return [...notes].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

describe('a board nobody has ever edited (TC-03, TC-25)', () => {
  it('has tables, an empty document, and no rows of its own', async () => {
    const board = newBoardId();
    const result = await inRoom(board, (room) => {
      // The room has already migrated and read itself by the time a test can reach it; doing it
      // again proves the migration is one that can be run twice.
      room.store.migrate();
      const doc = new Y.Doc();
      return {
        loaded: room.store.load(doc),
        notes: snapshot(doc),
        stats: room.store.stats(),
        version: room.store.meta('storage_schema_version'),
        rows: room.store.logEntries().length,
      };
    });

    expect(result.loaded).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toEqual([]);
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION));
    // Opening a board is not editing it. A board nobody has touched stays empty in the tables as
    // well as on screen, and does not acquire a row because somebody looked at it.
    expect(result.rows).toBe(0);
    expect(result.stats).toMatchObject({ updates: 0, bytes: 0, snapshot: { chunks: 0, unreadable: false }, quarantined: { count: 0 } });
  });
});

describe('writing one change (TC-04)', () => {
  it('adds a row as long as the change it holds', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const update = source.updates[0];
    expect(update).toBeDefined();

    const result = await inRoom(board, (room) => {
      room.store.append(update);
      return { entries: room.store.logEntries(), counters: room.store.logCounters() };
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].bytes).toBe(update.byteLength);
    // The `bytes` column is the length of the data, not a guess at it: the sums that decide when
    // a log should be folded away are taken from that column, so a wrong number here is a board
    // folded at the wrong time.
    expect(result.entries[0].bytes).toBe(result.entries[0].data.byteLength);
    expect(Array.from(result.entries[0].data)).toEqual(Array.from(update));
    expect(result.counters).toEqual({ updates: 1, bytes: update.byteLength });
  });
});

describe('reading back a board that is only a log (TC-05)', () => {
  it('gives back the board it was given', async () => {
    const board = newBoardId();
    const source = retroBoard();
    expect(source.expected).toHaveLength(25);

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      return { loaded, notes: snapshot(doc), rows: room.store.logEntries().length };
    });

    expect(result.loaded).toEqual({ ok: true, quarantined: 0 });
    expect(result.rows).toBe(source.updates.length);
    // Not "the right number of notes": the same notes, in the same places, with the same text,
    // colours and stacking, rebuilt out of 60-odd rows.
    expect(result.notes).toEqual(source.expected);
  });
});

describe('folding a long log away (TC-06)', () => {
  it('turns 500 rows into one snapshot, and reads back the same board', async () => {
    const board = newBoardId();
    const source = retroBoard();

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const before = room.store.logCounters();
      // The rest of the rows are repeats of this board's own changes: they change nothing — the
      // board is the same board afterwards — which is what lets this test be about 500 rows
      // rather than about 500 edits.
      while (room.store.logCounters().updates < COMPACTION_UPDATE_COUNT) {
        room.store.append(source.updates[room.store.logCounters().updates % source.updates.length]);
      }
      const atThreshold = room.store.logCounters();
      const lastSeq = room.store.logEntries().at(-1)?.seq ?? 0;

      const doc = new Y.Doc();
      room.store.load(doc);
      const performed = room.store.compactIfNeeded(doc);

      return {
        before,
        atThreshold,
        performed,
        lastSeq,
        stats: room.store.stats(),
        reload: room.store.load(new Y.Doc()),
        notes: snapshot(doc),
      };
    });

    expect(result.before.updates).toBeLessThan(COMPACTION_UPDATE_COUNT);
    expect(result.atThreshold.updates).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.performed).toBe(true);
    // The log is empty and the snapshot is what it became. This is what bounds how long it takes
    // to read a board back, however many years it has been in use.
    expect(result.stats.updates).toBe(0);
    expect(result.stats.bytes).toBe(0);
    expect(result.stats.snapshot.chunks).toBeGreaterThanOrEqual(1);
    expect(result.stats.snapshot.throughSeq).toBe(result.lastSeq);
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toEqual(source.expected);
  });

  it('leaves a log that is short enough exactly as it was', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      const performed = room.store.compactIfNeeded(doc);
      return {
        performed,
        rows: room.store.logEntries().length,
        chunks: room.store.stats().snapshot.chunks,
        through: room.store.stats().snapshot.throughSeq,
      };
    });
    // Below the threshold there is no compaction at all: not a write, not a read, not one row
    // moved. Folding is a cost, and paying it every few changes is how a board gets slow.
    expect(result.performed).toBe(false);
    expect(result.rows).toBe(source.updates.length);
    expect(result.chunks).toBe(0);
    expect(result.through).toBe(0);
  });
});

describe('a snapshot plus the changes after it (TC-07)', () => {
  it('applies the snapshot and only the rows that come after it', async () => {
    const board = newBoardId();
    const source = retroBoard();

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const folded = new Y.Doc();
      room.store.load(folded);
      expect(fold(room, folded)).toBe(true);
      const through = room.store.stats().snapshot.throughSeq;

      // Three notes added after the snapshot, written the way they arrive: as updates.
      const later = seededBoard(3, 0x11);
      for (const update of later.updates) room.store.append(update);
      const rows = room.store.logEntries();

      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      return {
        through,
        loaded,
        notes: snapshot(doc),
        extra: later.expected.length,
        // Every row the load had to read, which is the thing a snapshot exists to limit.
        read: rows.map((row) => row.seq),
        expected: [...source.expected, ...later.expected],
      };
    });

    expect(result.through).toBeGreaterThan(0);
    expect(result.loaded).toEqual({ ok: true, quarantined: 0 });
    // The board came back as its snapshot plus exactly the changes after it: the notes that were
    // folded away and the new ones, with nothing doubled and nothing missed.
    expect(byId(result.notes)).toEqual(byId(result.expected));
    expect(new Set(result.notes.map((note) => note.id)).size).toBe(result.notes.length);
    expect(result.read.every((seq) => seq > result.through)).toBe(true);
  });
});

describe('a board too big for one row (TC-08)', () => {
  it('stores a large board in chunks that read back as one board', async () => {
    const board = newBoardId();
    // 2,000 notes, which is the size the PRD names and a real board: text in every note, six
    // colours, positions and stacking. The encoded snapshot decides how many rows it needs, and
    // the test checks the store came to the same number rather than being told it in advance.
    const source = largeBoard(2000);
    expect(source.expected).toHaveLength(2000);

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      const encoded = Y.encodeStateAsUpdate(doc);
      const performed = room.store.compactIfNeeded(doc);
      const stats = room.store.stats();
      const rows = room.store.snapshotRows();
      const fresh = new Y.Doc();
      const reload = room.store.load(fresh);
      return {
        loaded,
        encoded: encoded.byteLength,
        performed,
        stats,
        rows: rows.map((row) => ({ index: row.index, bytes: row.bytes })),
        reload,
        notes: snapshot(doc),
        reloadNotes: snapshot(fresh),
      };
    });

    expect(result.loaded).toEqual({ ok: true, quarantined: 0 });
    expect(result.performed).toBe(true);
    // A snapshot is cut into rows so no single row has to be enormous. The row count is derived
    // from the bytes instead of hard-coded, so this says the store did the arithmetic the design
    // says it does.
    expect(result.stats.snapshot.chunks).toBe(Math.ceil(result.encoded / SNAPSHOT_CHUNK_BYTES));
    expect(result.stats.snapshot.chunks).toBeGreaterThan(1);
    expect(result.rows.map((row) => row.index)).toEqual(result.rows.map((_, index) => index + 1));
    expect(result.rows.every((row) => row.bytes <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    // And the board that comes back out of those rows is the board that went in.
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    expect(result.reloadNotes).toEqual(source.expected);
  }, 120_000);

  it('rejoins the rows into the bytes that were cut', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      fold(room, doc);
      return {
        encoded: Y.encodeStateAsUpdate(doc),
        rows: room.store.snapshotRows().map((row) => row.data),
      };
    });
    // The rows are the snapshot, cut and rejoined: no re-encoding, no normalising, and the order
    // they were written in is the order they come back in.
    expect(Array.from(joinChunks(result.rows))).toEqual(Array.from(result.encoded));
    expect(chunkBytes(result.encoded).length).toBe(result.rows.length);
  });
});

describe('a damaged row in the log (TC-09)', () => {
  it('quarantines that row and loads the rest of the board', async () => {
    const board = newBoardId();
    const source = retroBoard();
    // The row that creates the seventh note, so the damage is done to exactly one note.
    const victim = source.expected[6];
    expect(victim).toBeDefined();

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const entries = room.store.logEntries();
      const index = rowThatCreates(source.updates, victim.id);
      const target = entries[index];
      const damaged = damage.truncated(target.data);
      room.store.damageUpdate(target.seq, damaged);

      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      return {
        index,
        seq: target.seq,
        damaged: damaged.byteLength,
        loaded,
        notes: snapshot(doc),
        stats: room.store.stats(),
        quarantine: room.store.quarantine(),
        rows: room.store.logEntries().length,
      };
    });

    expect(result.index).toBeGreaterThan(-1);
    // One bad note is that note's problem: the board loads, and says how much of it did not.
    expect(result.loaded.ok).toBe(true);
    // The other 24 notes are there as they were written — same places, same text, same colours,
    // same stacking — and the one that would not read is not there as an empty note or as half a
    // note. It is simply not there, and something was written down about it.
    expect(result.notes).toEqual(source.expected.filter((note) => note.id !== victim.id));
    expect(result.notes).toHaveLength(24);

    // The damaged row keeps its bytes and the error that moved it, so that "the room forgot my
    // note" has an answer which is not "it did, and we threw the note away".
    const moved = result.quarantine.find((row) => row.seq === result.seq);
    expect(moved).toBeDefined();
    expect(moved?.bytes).toBe(result.damaged);
    expect(moved?.error.length).toBeGreaterThan(0);
    // The log is shorter by exactly the rows that moved, and the number the room is told is the
    // number that moved.
    expect(result.rows).toBe(source.updates.length - result.quarantine.length);
    if (result.loaded.ok) expect(result.loaded.quarantined).toBe(result.quarantine.length);
    expect(result.stats.quarantined.count).toBe(result.quarantine.length);
  });

  it('moves the rows that refer to an unreadable note out of the log too, and says why', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const victim = source.expected[6];
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const entries = room.store.logEntries();
      const index = rowThatCreates(source.updates, victim.id);
      room.store.damageUpdate(entries[index].seq, damage.truncated(entries[index].data));
      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      return {
        seq: entries[index].seq,
        loaded,
        notes: snapshot(doc),
        quarantine: room.store.quarantine(),
        later: entries.filter((entry) => entry.seq > entries[index].seq).length,
      };
    });

    // This is the failure that does not fail. A note is usually more than one row — created, then
    // written into, then maybe moved — and the rows after a damaged one refer to something this
    // board never received. Yjs does not report that: it parks the update and carries on, which
    // would leave a board with holes in it and nothing said anywhere. So those rows are moved out
    // too, each with a reason that names what happened, and the count the room is given covers
    // all of them.
    expect(result.loaded.ok).toBe(true);
    expect(result.notes).toHaveLength(24);
    expect(result.quarantine.length).toBeGreaterThan(1);
    const reasons = result.quarantine.map((row) => row.error);
    expect(reasons.some((reason) => reason.includes('refers to changes the board does not have'))).toBe(true);
    // Every one of them kept its bytes: a person who wants that note back has the note.
    expect(result.quarantine.every((row) => row.bytes > 0)).toBe(true);
    // And the rows that had nothing to do with that note are still in the log, in order.
    expect(result.later).toBeGreaterThan(0);
  });

  it('quarantines a row that is the right length and nonsense', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const victim = source.expected[3];
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const entries = room.store.logEntries();
      const index = rowThatCreates(source.updates, victim.id);
      room.store.damageUpdate(entries[index].seq, damage.random(entries[index].bytes));
      const doc = new Y.Doc();
      const loaded = room.store.load(doc);
      return { loaded, notes: snapshot(doc), quarantine: room.store.quarantine() };
    });
    expect(result.loaded.ok).toBe(true);
    expect(result.notes).toEqual(source.expected.filter((note) => note.id !== victim.id));
    expect(result.quarantine.length).toBeGreaterThan(0);
  });
});

describe('a damaged snapshot (TC-10)', () => {
  it('refuses to load, and changes nothing while refusing', async () => {
    const board = newBoardId();
    const source = retroBoard();

    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      fold(room, doc);
      const before = room.store.stats();

      room.store.corruptSnapshot();
      const failed = room.store.load(new Y.Doc());
      return { before, after: room.store.stats(), failed, notes: snapshot(doc) };
    });

    // A snapshot is most of the board. Loading past it would mean showing a board with its old
    // notes gone and calling that the board, which is the one thing a board is never allowed to
    // say about itself.
    expect(result.failed.ok).toBe(false);
    if (!result.failed.ok) expect(result.failed.reason).toBe('snapshot-unreadable');
    // Nothing deleted, nothing moved out of the log: a load that could not read the board has no
    // business changing it.
    expect(result.after.quarantined).toEqual({ count: 0, bytes: 0 });
    // The rows are still there, damaged: 8 bytes of nonsense written over one of them is the
    // damage, and the rest of the snapshot is exactly as long as it was.
    expect(result.after.snapshot.chunks).toBe(result.before.snapshot.chunks);
    expect(result.after.updates).toBe(result.before.updates);
    expect(result.after.bytes).toBe(result.before.bytes);
  });

  it('leaves the document it was handed holding nothing', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      fold(room, doc);
      room.store.corruptSnapshot();
      const fresh = new Y.Doc();
      const failed = room.store.load(fresh);
      return { failed, notes: snapshot(fresh) };
    });
    // A load that fails applies nothing: the room is left holding nothing rather than half a
    // board, which is the difference between "this board could not be loaded" and a board that
    // looks empty and is not.
    expect(result.failed.ok).toBe(false);
    expect(result.notes).toEqual([]);
  });

  it('refuses to fold a log away while the snapshot it is ahead of cannot be read', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      fold(room, doc);
      room.store.corruptSnapshot();
      while (room.store.logCounters().updates < COMPACTION_UPDATE_COUNT) {
        room.store.append(source.updates[room.store.logCounters().updates % source.updates.length]);
      }
      const before = room.store.logCounters();
      const performed = room.store.compactIfNeeded(doc);
      return { performed, before, after: room.store.logCounters(), stats: room.store.stats() };
    });
    // The one write that empties the log is not attempted while the board's contents are
    // unreadable: that is how damage turns into loss.
    expect(result.performed).toBe(false);
    expect(result.stats.snapshot.unreadable).toBe(true);
    expect(result.after.updates).toBe(COMPACTION_UPDATE_COUNT);
  });
});

describe('a compaction that cannot be written (TC-11)', () => {
  it('rolls back, keeping the snapshot it had and the log it meant to fold', async () => {
    const board = newBoardId();
    const source = retroBoard();

    const result = await inRoom(board, (room) => {
      // A board that has been folded once, so there is an old snapshot to lose, with changes
      // after it, so there is a log to lose as well.
      writeBoard(room, source);
      const folded = new Y.Doc();
      room.store.load(folded);
      fold(room, folded);
      const before = room.store.stats();

      const later = seededBoard(2, 0x77);
      for (const update of later.updates) room.store.append(update);
      const rows = room.store.logEntries().length;

      // Fail the statement *after* the old snapshot was deleted. This is the failure that would be
      // catastrophic without a transaction: a board left with no snapshot and a log that had been
      // emptied on the way in.
      const doc = new Y.Doc();
      room.store.load(doc);
      room.store.injectFailure('compaction', 1);
      const performed = room.store.compactIfNeeded(doc, true);

      const reloaded = new Y.Doc();
      return {
        before,
        performed,
        after: room.store.stats(),
        rows,
        remaining: room.store.logEntries().length,
        reload: room.store.load(reloaded),
        reloadNotes: snapshot(reloaded),
        notes: snapshot(doc),
        whole: [...source.expected, ...later.expected],
        failures: room.store.failures.length,
        lines: room.store.lines.filter((line) => line.startsWith('compaction')),
      };
    });

    expect(result.performed).toBe(false);
    // Both halves of the board survived: the snapshot that was there, and every log row that was
    // going to be folded into the one that was not written.
    expect(result.after.snapshot.chunks).toBe(result.before.snapshot.chunks);
    expect(result.after.snapshot.throughSeq).toBe(result.before.snapshot.throughSeq);
    expect(result.remaining).toBe(result.rows);
    expect(result.failures).toBe(1);
    expect(result.lines.some((line) => line.includes('rolled-back'))).toBe(true);
    // And the board is still a board: read back from the snapshot that survived and the log that
    // was not folded, it is the whole board, including the changes that arrived after the fold.
    expect(result.reload.ok).toBe(true);
    expect(byId(result.reloadNotes)).toEqual(byId(result.whole));
    expect(byId(result.notes)).toEqual(byId(result.whole));
  });

  it('says nothing to anybody, because the notes are safe either way', async () => {
    const board = newBoardId();
    const source = retroBoard();
    const result = await inRoom(board, (room) => {
      writeBoard(room, source);
      const doc = new Y.Doc();
      room.store.load(doc);
      // Nothing is armed: a board under its threshold is not folded, and a board that is asked to
      // be folded and is under its threshold is not made worse by being asked.
      const performed = room.store.compactIfNeeded(doc);
      return { performed, notes: snapshot(doc), failures: room.store.failures.length };
    });
    expect(result.performed).toBe(false);
    expect(result.failures).toBe(0);
    expect(result.notes).toEqual(source.expected);
  });
});
