/// <reference types="@cloudflare/vitest-pool-workers" />
// The board's storage, against the SQLite it actually runs on: the log, the
// chunked snapshot, the quarantining of a row that no longer decodes, and what
// a board that cannot be read reports.
//
// These tests drive `BoardStore` directly rather than through a WebSocket,
// because what they pin down is a storage fact: which rows exist after which
// call. `tests/integration/board-room-persistence.test.ts` covers what the room
// does with those facts.
//
// Spec: spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/
// design.md, section persist.board_store (TC-03 to TC-11, TC-25).
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  BoardStore,
  SCHEMA_VERSION_KEY,
  THROUGH_SEQ_KEY,
  type BoardStorage,
  type StorageFaults,
} from '../../src/worker/board-store';
import {
  BOARD_LOAD_BUDGET_MS,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { SyncClient, canonicalNotes } from './helpers/ws-client';

/**
 * A board built the way a person builds one: one transaction per change, so
 * every change is one row the store has to keep. `updates[0]` is the document
 * initialisation a client does before it connects (story 2), which is a change
 * like any other as far as storage is concerned.
 *
 * The document comes back with the updates, and keeps recording: `updates` is
 * what this board's log has to hold, whatever the test does to it next.
 */
const buildBoard = (
  notes: number,
  options: { textLength?: number } = {},
): { doc: Y.Doc; updates: Uint8Array[]; expected: readonly StickySnapshot[] } => {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array): void => {
    updates.push(update);
  });
  initDoc(doc);
  const text = options.textLength === undefined ? '' : 'x'.repeat(options.textLength);
  const ids: string[] = [];
  for (let index = 0; index < notes; index += 1) {
    ids.push(createSticky(doc, { x: index * 12, y: index * 7 }));
    if (text !== '') getStickyText(doc, ids[index]!)?.insert(0, text);
  }
  return { doc, updates, expected: snapshot(doc) };
};

/** Grow a board's log to exactly `count` rows with the changes a day of work
 * makes — drags of the first note — so a threshold can be tested on the row it
 * trips on rather than near it. */
const padLogTo = (board: { doc: Y.Doc; updates: Uint8Array[] }, count: number): void => {
  const first = snapshot(board.doc)[0]!.id;
  while (board.updates.length < count) {
    const before = board.updates.length;
    moveObject(board.doc, first, before, 0);
    if (board.updates.length !== before + 1) {
      throw new Error('a drag did not produce exactly one update');
    }
  }
};

/** Run one test's body against a board of its own, with a store on real SQLite.
 * One board id per test, so no test reads another's storage. */
const withStore = (
  body: (store: BoardStore, storage: DurableObjectStorage) => void,
  faults?: StorageFaults,
): Promise<unknown> => {
  const boardId = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_room, state) => {
    body(new BoardStore(state.storage as unknown as BoardStorage, faults), state.storage);
  });
};

const rowsIn = (storage: DurableObjectStorage, table: string): number =>
  Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]!['n']);

const metaValue = (storage: DurableObjectStorage, key: string): string | null => {
  const rows = storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
  return rows.length === 0 ? null : String(rows[0]!['value']);
};

const tableNames = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((row) => String(row['name']));

/** The bytes one stored row holds. */
const storedBytes = (
  storage: DurableObjectStorage,
  table: string,
  where: string,
  value: number,
): Uint8Array =>
  new Uint8Array(
    storage.sql.exec(`SELECT data FROM ${table} WHERE ${where} = ?`, value).toArray()[0]![
      'data'
    ] as ArrayBuffer,
  );

/** Overwrite one stored row with `fill`, same length: bytes no decoder accepts.
 * Not random: a fixed fill fails at the same place every run, so a failing test
 * stays reproducible. */
const damage = (
  storage: DurableObjectStorage,
  table: string,
  where: string,
  value: number,
  fill: number,
): number => {
  const original = storedBytes(storage, table, where, value);
  storage.sql.exec(
    `UPDATE ${table} SET data = ? WHERE ${where} = ?`,
    new Uint8Array(original.byteLength).fill(fill).buffer,
    value,
  );
  return original.byteLength;
};

/** One note as the string {@link canonicalNotes} makes of a board. */
const canonicalNote = (note: StickySnapshot): string => canonicalNotes([note]);

describe('a board on real storage (persist.board_store)', () => {
  // TC-03: an empty board opened for the first time.
  it('creates its tables and nothing else on a board never edited (TC-03)', () => {
    return withStore((store, storage) => {
      store.migrate();
      const doc = new Y.Doc();
      const result = store.load(doc);

      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual([]);
      expect(tableNames(storage)).toEqual(
        expect.arrayContaining([
          'quarantined_updates',
          'snapshot_chunks',
          'storage_meta',
          'updates',
        ]),
      );
      expect(metaValue(storage, SCHEMA_VERSION_KEY)).toBe(String(STORAGE_SCHEMA_VERSION));
      expect(rowsIn(storage, 'updates')).toBe(0);
      expect(rowsIn(storage, 'snapshot_chunks')).toBe(0);
    });
  });

  // TC-04: the log is the board's history, one row per accepted update.
  it('stores one applied update as one row with its length (TC-04)', () => {
    const board = buildBoard(1);
    return withStore((store, storage) => {
      store.migrate();
      expect(rowsIn(storage, 'updates')).toBe(0);

      for (const update of board.updates) store.append(update);

      expect(rowsIn(storage, 'updates')).toBe(board.updates.length);
      const row = storage.sql
        .exec('SELECT seq, data, bytes FROM updates ORDER BY seq')
        .toArray()[0]!;
      expect(Number(row['seq'])).toBe(1);
      expect(Number(row['bytes'])).toBe(board.updates[0]!.byteLength);
      expect(new Uint8Array(row['data'] as ArrayBuffer).byteLength).toBe(
        board.updates[0]!.byteLength,
      );

      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(doc))).toBe(canonicalNotes(board.expected));
    });
  });

  // TC-05: everything the board is, out of the log alone. This is the LogOnly
  // fixture: 25 notes, nothing compacted.
  it('reads a board back out of the log alone (TC-05)', () => {
    const board = buildBoard(25);
    return withStore((store) => {
      store.migrate();
      for (const update of board.updates) store.append(update);

      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(doc))).toBe(canonicalNotes(board.expected));
    });
  });

  // TC-06: the log's threshold, on the row the count trips, with the truncation
  // the room is not allowed to get wrong.
  it('compacts a log of exactly COMPACTION_UPDATE_COUNT rows into a snapshot (TC-06)', () => {
    const board = buildBoard(25);
    padLogTo(board, COMPACTION_UPDATE_COUNT);
    // What the board is *now*, drags included: the padding is part of the board,
    // not scaffolding around it.
    const expected = snapshot(board.doc);

    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      expect(rowsIn(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(rowsIn(storage, 'snapshot_chunks')).toBe(0);

      expect(store.compactIfNeeded(board.doc)).toBe(true);

      expect(rowsIn(storage, 'updates')).toBe(0);
      expect(rowsIn(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(metaValue(storage, THROUGH_SEQ_KEY)).toBe(String(COMPACTION_UPDATE_COUNT));
      expect(store.snapshotThroughSeq).toBe(COMPACTION_UPDATE_COUNT);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(reloaded))).toBe(canonicalNotes(expected));
    });
  });

  // TC-07: the layout a live board spends most of its life in — a snapshot with
  // a log above it — and the one rule that makes it correct: the log is applied
  // from above the snapshot, never from the bottom.
  it('loads a snapshot and only the log rows above it (TC-07)', () => {
    const board = buildBoard(25);
    padLogTo(board, COMPACTION_UPDATE_COUNT);

    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      expect(store.compactIfNeeded(board.doc)).toBe(true);

      // Three changes after the compaction. The log starts again from above the
      // seq the snapshot already contains.
      const ids = snapshot(board.doc).map((note) => note.id);
      setStickyColor(board.doc, ids[0]!, 'yellow');
      getStickyText(board.doc, ids[1]!)?.insert(0, 'after the snapshot');
      moveObject(board.doc, ids[2]!, 400, 400);
      const three = board.updates.slice(-3);
      expect(three.length).toBe(3);
      for (const update of three) store.append(update);

      expect(rowsIn(storage, 'updates')).toBe(3);
      const through = Number(metaValue(storage, THROUGH_SEQ_KEY));
      const seqs = storage.sql
        .exec('SELECT seq FROM updates ORDER BY seq')
        .toArray()
        .map((row) => Number(row['seq']));
      expect(seqs.every((seq) => seq > through)).toBe(true);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      // The board is what it was at the compaction plus these three changes —
      // which is what "only the rows above the snapshot" has to mean.
      expect(canonicalNotes(snapshot(reloaded))).toBe(canonicalNotes(snapshot(board.doc)));
      expect(snapshot(reloaded).some((note) => note.text === 'after the snapshot')).toBe(true);
    });
  });

  // TC-08: the snapshot of a board big enough to be a problem is stored in more
  // than one row, and comes back as one document.
  it('chunks the snapshot of a board of PERSIST_TESTED_NOTES notes (TC-08)', () => {
    // Text long enough that the encoded board passes SNAPSHOT_CHUNK_BYTES: this
    // test is about chunking, so the fixture has to be big enough to need it.
    const board = buildBoard(PERSIST_TESTED_NOTES, { textLength: 160 });
    const size = Y.encodeStateAsUpdate(board.doc).byteLength;
    expect(size).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    // The log holds what a live board's log holds: one row per accepted update.
    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      expect(rowsIn(storage, 'updates')).toBe(board.updates.length);

      // The fixture is "Snapshotted": compacted once, log above it empty.
      // `compact()` rather than `compactIfNeeded()` because a board this big is
      // big in notes, not in rows, and the thresholds are about rows.
      expect(store.compact(board.doc)).toBe(true);
      const chunks = rowsIn(storage, 'snapshot_chunks');
      expect(chunks).toBe(Math.ceil(size / SNAPSHOT_CHUNK_BYTES));
      expect(chunks).toBeGreaterThan(1);
      expect(rowsIn(storage, 'updates')).toBe(0);

      const reloaded = new Y.Doc();
      const startedAt = performance.now();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      const tookMs = performance.now() - startedAt;
      expect(canonicalNotes(snapshot(reloaded))).toBe(canonicalNotes(board.expected));
      expect(snapshot(reloaded).length).toBe(PERSIST_TESTED_NOTES);

      // The budget the design names, honoured here and nowhere else, because
      // nothing in the running code consults it: a board of this size is allowed
      // to be slow to open and the client just waits. What the number is for is
      // this assertion — a reading that went quadratic, or that re-read every
      // chunk it did not need, shows up in it. A local runtime is nothing like a
      // real one, which is why the margin this leaves is large on purpose.
      expect(tookMs, `reading ${String(PERSIST_TESTED_NOTES)} notes took ${String(Math.round(tookMs))}ms`).toBeLessThan(BOARD_LOAD_BUDGET_MS);
    });
  }, 120_000);

  // TC-09: one log row that no longer decodes is a damaged memory, not a damaged
  // board: it is put aside and the board opens with the rest.
  it('quarantines a log row that does not decode and opens the rest (TC-09)', () => {
    const board = buildBoard(25);
    // The damaged row is the last one. A row in the middle is a different case,
    // and the test after this one is about it: everything a later row depends on
    // went in through the row that is missing.
    const damagedSeq = board.updates.length;
    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      const before = rowsIn(storage, 'updates');

      // The fixture's damaged update: the last 10 bytes are gone, which is what
      // a write that stopped halfway through looks like to a decoder.
      const original = storedBytes(storage, 'updates', 'seq', damagedSeq);
      const truncated = original.slice(0, original.byteLength - 10);
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        truncated.slice().buffer,
        truncated.byteLength,
        damagedSeq,
      );

      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      expect(result.ok === true && result.quarantined).toBe(1);

      expect(rowsIn(storage, 'updates')).toBe(before - 1);
      expect(rowsIn(storage, 'quarantined_updates')).toBe(1);
      expect(storedBytes(storage, 'quarantined_updates', 'seq', damagedSeq).byteLength).toBe(
        truncated.byteLength,
      );
      const error = storage.sql
        .exec('SELECT error FROM quarantined_updates WHERE seq = ?', damagedSeq)
        .toArray()[0]!['error'];
      expect(String(error)).not.toBe('');

      // Everything that was readable is there, and the one note the damaged row
      // held is the only thing missing.
      const notes = snapshot(doc);
      expect(notes.length).toBe(board.expected.length - 1);
      expect(board.expected.filter((n) => !notes.some((s) => s.id === n.id)).length).toBe(1);

      // And a quarantined row stays out of the way: loading again finds nothing
      // new to quarantine.
      const again = new Y.Doc();
      expect(store.load(again)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(again))).toBe(canonicalNotes(notes));
    });
  });

  // The edge TC-09 does not reach, and the store's comment is honest about: a
  // damaged row in the *middle* of a log takes the later rows that depended on
  // what it created with it. Yjs keeps those as pending rather than inventing
  // content, so they are absent, the rest of the board is there, and nothing is
  // ever presented as an empty board. Quarantining is the best it can do with a
  // memory it cannot read; it never makes the loss bigger.
  it('opens the readable part of a board when a row in the middle of its log is damaged', () => {
    const board = buildBoard(25);
    const damagedSeq = 7;
    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      const before = rowsIn(storage, 'updates');
      damage(storage, 'updates', 'seq', damagedSeq, 0xff);

      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      expect(result.ok === true && result.quarantined).toBe(1);
      expect(rowsIn(storage, 'quarantined_updates')).toBe(1);
      expect(rowsIn(storage, 'updates')).toBe(before - 1);

      // The board opens, and it opens as a board: some notes, not none, not all.
      const notes = snapshot(doc);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length).toBeLessThan(board.expected.length);
      // What came back is a part of the board that was there: nothing invented.
      for (const note of notes) {
        expect(board.expected.some((was) => canonicalNote(was) === canonicalNote(note))).toBe(true);
      }
    });
  });

  // TC-10: a snapshot that does not decode is not an empty board. Nothing is
  // given up: the damage is reported, and the rows are left for whoever can fix
  // them.
  it('refuses to present a board whose snapshot does not decode (TC-10)', () => {
    const board = buildBoard(25);
    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      expect(store.compact(board.doc)).toBe(true);

      const chunksBefore = rowsIn(storage, 'snapshot_chunks');
      const logBefore = rowsIn(storage, 'updates');
      damage(storage, 'snapshot_chunks', 'idx', 0, 0xff);

      const loaded = store.load(new Y.Doc());
      expect(loaded.ok).toBe(false);
      expect(loaded.ok === false && loaded.reason).toBe('snapshot-unreadable');
      expect(loaded.ok === false && loaded.error).not.toBe('');

      // Nothing was deleted or quarantined: a snapshot is not a row that can be
      // skipped, and deleting it would delete the board.
      expect(rowsIn(storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(rowsIn(storage, 'updates')).toBe(logBefore);
      expect(rowsIn(storage, 'quarantined_updates')).toBe(0);
    });
  });

  // TC-11: compaction is the one moment a board could lose both its snapshot and
  // its log, so it is one transaction: a failure in the middle leaves the board
  // exactly as it was.
  it('rolls a failed compaction back without losing snapshot or log (TC-11)', () => {
    const board = buildBoard(25);
    padLogTo(board, COMPACTION_UPDATE_COUNT);
    let failNextChunkWrite = false;
    const faults: StorageFaults = {
      beforeStatement(statement: string): void {
        if (failNextChunkWrite && statement.startsWith('INSERT INTO snapshot_chunks')) {
          // A failure in the middle of compaction, from the outside: the room
          // cannot tell it from a disk that filled up.
          throw new Error('the disk is full');
        }
      },
    };

    return withStore((store, storage) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      // The fixture is "SnapshotPlusLog": a snapshot, and rows above it.
      expect(store.compactIfNeeded(board.doc)).toBe(true);
      const chunksBefore = rowsIn(storage, 'snapshot_chunks');
      const through = metaValue(storage, THROUGH_SEQ_KEY);
      for (let index = 0; index < 5; index += 1) {
        moveObject(board.doc, snapshot(board.doc)[0]!.id, 100 + index, 0);
      }
      for (const update of board.updates.slice(-5)) store.append(update);
      expect(rowsIn(storage, 'updates')).toBe(5);

      failNextChunkWrite = true;
      // The thresholds are what the room uses; the unconditional form is what a
      // fixture reaches for when it wants the failure and not the wait.
      expect(store.compact(board.doc)).toBe(false);

      // The transaction rolled back: the previous snapshot is still there chunk
      // for chunk, the log above it is intact, and the pointer never moved.
      expect(rowsIn(storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(rowsIn(storage, 'updates')).toBe(5);
      expect(metaValue(storage, THROUGH_SEQ_KEY)).toBe(through);

      // The board still loads, and still saves: failed housekeeping left the
      // board itself untouched.
      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(reloaded))).toBe(canonicalNotes(snapshot(board.doc)));
      store.append(new Uint8Array([0]));
      expect(rowsIn(storage, 'updates')).toBe(6);
    }, faults);
  });

  // TC-25: opening a board is not an edit. The tables come with the opening and
  // nothing is written, so a board nobody has ever changed stays empty instead
  // of filling up with the tracks of everyone who looked at it.
  it('writes no rows when a board that was never edited is opened (TC-25)', () => {
    return withStore((store, storage) => {
      store.migrate();
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });

      expect(tableNames(storage).length).toBeGreaterThanOrEqual(4);
      expect(rowsIn(storage, 'updates')).toBe(0);
      expect(rowsIn(storage, 'snapshot_chunks')).toBe(0);
      expect(rowsIn(storage, 'quarantined_updates')).toBe(0);
      expect(snapshot(doc)).toEqual([]);
    });
  });

  // The other half of TC-25, and the honest edge of the claim: opening a board
  // through a connection stores what that connection brought, which for a client
  // with an empty board is its document initialisation and nothing else. The
  // board is still empty afterwards; the row is the client's own state, stored
  // like any other change so a board that has never been edited still comes back
  // identically.
  it('stores nothing but the joining client’s own state when an empty board is opened', async () => {
    const boardId = newBoardId();
    const client = await SyncClient.connect(boardId);
    await client.waitForSync();
    client.close();

    const rows = await runInDurableObject(
      env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)),
      (_room, state) => {
        const doc = new Y.Doc();
        new BoardStore(state.storage as unknown as BoardStorage).load(doc);
        return {
          updates: state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]!['n'],
          chunks: state.storage.sql
            .exec('SELECT COUNT(*) AS n FROM snapshot_chunks')
            .toArray()[0]!['n'],
          notes: snapshot(doc).length,
        };
      },
    );
    expect(Number(rows.chunks)).toBe(0);
    expect(Number(rows.notes)).toBe(0);
    expect(client.notes.length).toBe(0);
    // What a first connection leaves behind is its own initialisation, one row,
    // and no note ever made it into the board.
    expect(Number(rows.updates)).toBeLessThanOrEqual(1);
  });

  // A deleted note stays deleted across a reload, and Yjs garbage-collects it,
  // which is the fact the load budget rests on: the snapshot tracks what is on
  // the board, not everything that ever happened to it.
  it('comes back without a note that was deleted before the reload', () => {
    const board = buildBoard(25);
    deleteObject(board.doc, board.expected[0]!.id);
    return withStore((store) => {
      store.migrate();
      for (const update of board.updates) store.append(update);
      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(canonicalNotes(snapshot(reloaded))).toBe(canonicalNotes(snapshot(board.doc)));
      expect(snapshot(reloaded).some((note) => note.id === board.expected[0]!.id)).toBe(false);
    });
  });
});
