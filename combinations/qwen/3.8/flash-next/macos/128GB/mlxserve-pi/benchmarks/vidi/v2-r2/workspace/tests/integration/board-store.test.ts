// `BoardStore` against real SQLite (TC-03 to TC-11, TC-25), one board id - and so
// one SQLite database - per test.
//
// TC-03/TC-04/TC-05 are the store's contract: a migration that writes no data,
// an append per update, and a load that brings the notes back unchanged.
// TC-06/TC-07/TC-08 are compaction: the log folds into the snapshot, the log is
// truncated to the rows that came after, and a board big enough to need more than
// one chunk still reloads byte-for-byte.
// TC-09/TC-10 are partial damage: one unreadable row is quarantined and the rest
// of the board is left alone.
// TC-11 is compaction's rollback: the statement fails after the old chunks are
// already deleted, and SQLite's transaction must restore them.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  largeBoard,
  padUpdates,
  randomBytesLike,
  retroBoard,
  truncatedUpdate,
} from '../fixtures/boards';
import {
  META_SCHEMA_VERSION,
  META_SNAPSHOT_THROUGH,
  withStore,
} from './helpers/store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';

describe('board store schema (TC-03, TC-25)', () => {
  it('TC-03 records the storage schema version on a fresh document', async () => {
    const value = await withStore((api) => {
      api.store.migrate();
      return api.meta(META_SCHEMA_VERSION);
    });
    expect(value).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-25 migrate writes no data rows, only the schema version', async () => {
    const counts = await withStore((api) => {
      api.store.migrate();
      return {
        meta: api.count('storage_meta'),
        updates: api.count('updates'),
        chunks: api.count('snapshot_chunks'),
        quarantined: api.count('quarantined_updates'),
        version: api.meta(META_SCHEMA_VERSION),
      };
    });
    expect(counts).toEqual({
      meta: 1,
      updates: 0,
      chunks: 0,
      quarantined: 0,
      version: String(STORAGE_SCHEMA_VERSION),
    });
  });

  it('TC-03 a second migrate is idempotent and does not add meta rows', async () => {
    const counts = await withStore((api) => {
      api.store.migrate();
      api.store.migrate();
      return api.count('storage_meta');
    });
    expect(counts).toBe(1);
  });
});

describe('append and load (TC-04, TC-05)', () => {
  it('TC-04 appends each update as its own row', async () => {
    const board = retroBoard();
    const result = await withStore((api) => {
      api.store.migrate();
      for (const update of board.updates.slice(0, 10)) api.store.append(update);
      return {
        rows: api.count('updates'),
        bytes: api.bytes('updates'),
        stored: api.store.logRows,
      };
    });
    expect(result.rows).toBe(10);
    expect(result.stored).toBe(10);
    const expectedBytes = board.updates
      .slice(0, 10)
      .reduce((total, update) => total + update.byteLength, 0);
    expect(result.bytes).toBe(expectedBytes);
  });

  it('TC-05 reloads the notes a board was built from, unchanged', async () => {
    const board = retroBoard();
    const outcome = await withStore((api) => {
      api.store.migrate();
      for (const update of board.updates) api.store.append(update);
      const reopened = api.reopen();
      return {
        result: reopened.result,
        notes: reopened.notes,
        expected: snapshot(board.doc),
        rows: api.count('updates'),
        chunks: api.count('snapshot_chunks'),
      };
    });
    expect(outcome.result).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.chunks).toBe(0); // never compacted: the log is the whole board
    expect(outcome.rows).toBe(board.updates.length);
    expect(outcome.notes).toEqual(outcome.expected);
  });

  it('TC-05 an empty board loads as an empty board, not as a failure', async () => {
    const outcome = await withStore((api) => {
      api.store.migrate();
      const reopened = api.reopen();
      return { result: reopened.result, notes: reopened.notes };
    });
    expect(outcome.result).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.notes).toEqual([]);
  });

  it('TC-05 a board is reloaded by a second board store, as a reopening room does', async () => {
    const board = retroBoard();
    const outcome = await withStore((api) => {
      api.store.migrate();
      for (const update of board.updates) api.store.append(update);
      // a store made after the writes, which has to find the log on its own
      const reopened = api.reopen();
      return { rowsAfterLoad: reopened.store.logRows, notes: reopened.notes, expected: snapshot(board.doc) };
    });
    expect(outcome.notes).toEqual(outcome.expected);
    expect(outcome.rowsAfterLoad).toBe(board.updates.length);
  });
});

describe('compaction (TC-06, TC-07, TC-08, TC-11)', () => {
  it('TC-06 folds a full log into one snapshot and truncates the log', async () => {
    const board = retroBoard();
    const updates = padUpdates(board, COMPACTION_UPDATE_COUNT);
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of updates) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      const compacted = api.store.compactIfNeeded(doc);
      const reopened = api.reopen();
      return {
        compacted,
        rows: api.count('updates'),
        chunks: api.count('snapshot_chunks'),
        through: api.meta(META_SNAPSHOT_THROUGH),
        notes: reopened.notes,
        expected: snapshot(doc),
      };
    });
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT);
    expect(outcome.compacted).toBe(true);
    expect(outcome.rows).toBe(0);
    expect(outcome.chunks).toBeGreaterThanOrEqual(1);
    expect(outcome.through).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(outcome.notes).toEqual(outcome.expected);
  });

  it('TC-07 keeps snapshot plus the rows written after it', async () => {
    const board = retroBoard();
    const first = padUpdates(board, COMPACTION_UPDATE_COUNT);
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of first) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      expect(api.store.compactIfNeeded(doc)).toBe(true);

      // twelve more real changes, made after the compaction
      const after = padUpdates(board, COMPACTION_UPDATE_COUNT + 12).slice(first.length);
      for (const update of after) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }

      const reopened = api.reopen();
      return {
        rows: api.count('updates'),
        through: api.meta(META_SNAPSHOT_THROUGH),
        chunks: api.count('snapshot_chunks'),
        notes: reopened.notes,
        expected: snapshot(doc),
        after: after.length,
      };
    });
    expect(outcome.after).toBe(12);
    expect(outcome.chunks).toBeGreaterThanOrEqual(1);
    expect(outcome.through).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(outcome.rows).toBe(12);
    expect(outcome.notes).toEqual(outcome.expected);
  });

  it('TC-08 compacts a large board into several chunks and reloads it whole', async () => {
    const board = largeBoard();
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of board.updates) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      const encoded = Y.encodeStateAsUpdate(doc).byteLength;
      const compacted = api.store.compactIfNeeded(doc);
      const reopened = api.reopen();
      return {
        encoded,
        compacted,
        chunks: api.count('snapshot_chunks'),
        snapshotBytes: api.bytes('snapshot_chunks'),
        rows: api.count('updates'),
        notes: reopened.notes,
        expected: snapshot(doc),
        notesBefore: snapshot(board.doc).length,
      };
    });
    expect(outcome.notesBefore).toBe(2000);
    // the fixture really is bigger than one chunk, which is what TC-08 is about
    expect(outcome.encoded).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(outcome.compacted).toBe(true);
    expect(outcome.chunks).toBeGreaterThan(1);
    expect(outcome.snapshotBytes).toBeLessThanOrEqual(outcome.encoded);
    expect(outcome.rows).toBe(0);
    expect(outcome.notes).toEqual(outcome.expected);
  });

  it('TC-11 rolls a failed compaction back to the previous snapshot and full log', async () => {
    const board = retroBoard();
    const first = padUpdates(board, COMPACTION_UPDATE_COUNT);
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of first) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      expect(api.store.compactIfNeeded(doc)).toBe(true);
      const chunksBefore = api.query(
        `SELECT idx, LENGTH(data) AS len FROM snapshot_chunks ORDER BY idx`,
      );
      const throughBefore = api.meta(META_SNAPSHOT_THROUGH);
      expect(chunksBefore.length).toBeGreaterThanOrEqual(1);

      // grow the log again, then fail the compaction's last statement, which runs
      // after the old chunks have already been deleted in the same transaction
      const more = padUpdates(board, COMPACTION_UPDATE_COUNT * 2).slice(first.length);
      for (const update of more) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }

      const { store, injection } = api.storeFailingOn(/INTO storage_meta/);
      const reader = new Y.Doc();
      expect(store.load(reader).ok).toBe(true);
      injection.arm();
      const compacted = store.compactIfNeeded(reader);
      injection.disarm();

      const chunksAfter = api.query(
        `SELECT idx, LENGTH(data) AS len FROM snapshot_chunks ORDER BY idx`,
      );
      const reopened = api.reopen();
      return {
        compacted,
        thrown: injection.thrown.length,
        chunksBefore,
        chunksAfter,
        throughBefore,
        throughAfter: api.meta(META_SNAPSHOT_THROUGH),
        rows: api.count('updates'),
        quarantined: api.count('quarantined_updates'),
        notes: reopened.notes,
        expected: snapshot(doc),
        more: more.length,
      };
    });
    expect(outcome.compacted).toBe(false);
    expect(outcome.thrown).toBeGreaterThan(0);
    // the previous snapshot is exactly the rows it had before the attempt
    expect(outcome.chunksAfter).toEqual(outcome.chunksBefore);
    expect(outcome.throughAfter).toBe(outcome.throughBefore);
    // and every log row is still there
    expect(outcome.rows).toBe(outcome.more);
    expect(outcome.quarantined).toBe(0);
    expect(outcome.notes).toEqual(outcome.expected);
  });

  it('TC-11 a compaction that cannot even read the log leaves everything alone', async () => {
    const board = retroBoard();
    const updates = padUpdates(board, COMPACTION_UPDATE_COUNT);
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of updates) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      const rowsBefore = api.count('updates');
      // the store reads MAX(seq) before it opens the transaction; failing the
      // compaction there means nothing was written at all
      const { store, injection } = api.storeFailingOn(/MAX\(seq\)/);
      const reader = new Y.Doc();
      store.load(reader);
      injection.arm();
      const compacted = store.compactIfNeeded(reader);
      return { compacted, rowsBefore, rowsAfter: api.count('updates'), chunks: api.count('snapshot_chunks') };
    });
    expect(outcome.compacted).toBe(false);
    expect(outcome.rowsAfter).toBe(outcome.rowsBefore);
    expect(outcome.chunks).toBe(0);
  });

  it('does not compact a log that is below both thresholds', async () => {
    const board = retroBoard();
    const updates = padUpdates(board, COMPACTION_UPDATE_COUNT - 1);
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      for (const update of updates) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      const compacted = api.store.compactIfNeeded(doc);
      return {
        compacted,
        rows: api.count('updates'),
        bytes: api.bytes('updates'),
        chunks: api.count('snapshot_chunks'),
        stored: updates.length,
      };
    });
    expect(outcome.stored).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(outcome.bytes).toBeLessThan(COMPACTION_BYTES);
    expect(outcome.compacted).toBe(false);
    expect(outcome.rows).toBe(outcome.stored);
    expect(outcome.chunks).toBe(0);
  });
});

describe('damaged rows (TC-09, TC-10)', () => {
  /** The first few updates of the retro board: init, create, type, create. */
  function firstUpdates(): Uint8Array[] {
    return retroBoard().updates.slice(0, 4);
  }

  it('TC-09 quarantines a truncated row and opens the rest of the board', async () => {
    const good = firstUpdates();
    const damaged = truncatedUpdate(good[3]!);
    expect(damaged.byteLength).toBe(good[3]!.byteLength - 10);
    const outcome = await withStore((api) => {
      api.store.migrate();
      for (const update of good.slice(0, 3)) api.store.append(update);
      // the fourth change arrives as a half-written row
      api.store.append(damaged);

      const reopened = api.reopen();
      const without = new Y.Doc();
      for (const update of good.slice(0, 3)) Y.applyUpdate(without, update);
      const withIt = new Y.Doc();
      for (const update of good) Y.applyUpdate(withIt, update);

      const quarantine = api.query(`SELECT seq, LENGTH(data) AS len, error, quarantined_at FROM quarantined_updates`);
      return {
        result: reopened.result,
        notes: reopened.notes,
        without: snapshot(without),
        withIt: snapshot(withIt),
        rows: api.count('updates'),
        quarantine,
        stored: reopened.store.logRows,
      };
    });
    expect(outcome.result).toEqual({ ok: true, quarantined: 1 });
    expect(outcome.quarantine).toHaveLength(1);
    expect(Number(outcome.quarantine[0]!.len)).toBe(damaged.byteLength);
    expect(String(outcome.quarantine[0]!.error).length).toBeGreaterThan(0);
    expect(Number(outcome.quarantine[0]!.quarantined_at)).toBeGreaterThan(0);
    // only that row moved: the three readable rows are left...
    expect(outcome.rows).toBe(3);
    expect(outcome.stored).toBe(3);
    // ...the board opens as the board, with exactly the damaged change missing
    expect(outcome.notes).toEqual(outcome.without);
    expect(outcome.notes.length).toBeGreaterThan(0);
    expect(outcome.notes).not.toEqual(outcome.withIt);
  });

  it('TC-10 quarantines a row of random bytes and leaves the other rows readable', async () => {
    const good = firstUpdates();
    const damaged = randomBytesLike(good[3]!);
    expect(damaged.byteLength).toBe(good[3]!.byteLength);
    const outcome = await withStore((api) => {
      api.store.migrate();
      for (const update of good.slice(0, 3)) api.store.append(update);
      api.store.append(damaged);

      const reopened = api.reopen();
      const without = new Y.Doc();
      for (const update of good.slice(0, 3)) Y.applyUpdate(without, update);
      return {
        result: reopened.result,
        notes: reopened.notes,
        without: snapshot(without),
        quarantined: api.count('quarantined_updates'),
        rows: api.count('updates'),
        damagedBytes: api.bytes('quarantined_updates'),
      };
    });
    expect(outcome.result).toEqual({ ok: true, quarantined: 1 });
    expect(outcome.quarantined).toBe(1);
    expect(outcome.damagedBytes).toBe(damaged.byteLength);
    expect(outcome.rows).toBe(good.length - 1);
    // every other row applied, so the board is whole apart from that one change
    expect(outcome.notes).toEqual(outcome.without);
    expect(outcome.notes.length).toBeGreaterThan(0);
  });

  it('TC-09 + TC-10 a damaged snapshot is reported as a load failure and nothing is deleted', async () => {
    const board = retroBoard();
    const outcome = await withStore((api) => {
      api.store.migrate();
      const doc = new Y.Doc();
      const updates = padUpdates(board, COMPACTION_UPDATE_COUNT);
      for (const update of updates) {
        Y.applyUpdate(doc, update);
        api.store.append(update);
      }
      expect(api.store.compactIfNeeded(doc)).toBe(true);
      const chunks = api.query(`SELECT idx, data FROM snapshot_chunks ORDER BY idx`);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // damage the stored snapshot the way a half-written row looks
      const broken = truncatedUpdate(chunks[0]!.data as Uint8Array);
      api.query(`DELETE FROM snapshot_chunks WHERE idx = 0`);
      api.query(`INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?1)`, broken);

      const rowsBefore = api.count('updates');
      const reopened = api.reopen();
      return {
        result: reopened.result,
        rowsBefore,
        rowsAfter: api.count('updates'),
        quarantined: api.count('quarantined_updates'),
        chunks: api.count('snapshot_chunks'),
        notes: reopened.notes,
      };
    });
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result).toMatchObject({ reason: 'snapshot-unreadable' });
    // nothing was deleted or quarantined on the way out
    expect(outcome.rowsAfter).toBe(outcome.rowsBefore);
    expect(outcome.quarantined).toBe(0);
    expect(outcome.chunks).toBeGreaterThanOrEqual(1);
    // and the caller gets no half-board to present as the whole thing
    expect(outcome.notes).toHaveLength(0);
  });

  it('quarantining the same row twice does not lose either copy', async () => {
    const good = firstUpdates();
    const damaged = randomBytesLike(good[3]!);
    const outcome = await withStore((api) => {
      api.store.migrate();
      api.store.append(good[0]!);
      api.store.append(good[1]!);
      api.store.append(good[2]!);
      api.store.append(damaged);
      // two loads that both find the same damaged row: the row is only gone once,
      // so the quarantine must keep one record of it
      const first = api.reopen();
      const second = api.reopen();
      return {
        first: first.result,
        second: second.result,
        quarantined: api.count('quarantined_updates'),
      };
    });
    expect(outcome.first).toEqual({ ok: true, quarantined: 1 });
    expect(outcome.second).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.quarantined).toBe(1);
  });
});

// --------------------------------------------------------------------------------
// Notes on the fixtures used above
// --------------------------------------------------------------------------------
//
// `padUpdates` grows a fixture to a given number of stored rows by moving notes
// with the real mutators, so every row is a real single-mutation update and the
// row counts these tests assert on are the counts the product would see.
