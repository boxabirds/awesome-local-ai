import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { StoreFaults } from '../../src/worker/board-store';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { moveObject, snapshot } from '../../src/shared/board-model';
import {
  boardBuiltByWriters,
  boardBuiltInSteps,
  denseBoard,
  garbled,
  noteSeeds,
  sameBoard,
  updateOfDocument,
  updateOfNote,
  truncated,
} from '../fixtures/boards';
import {
  boardStub,
  countRows,
  insideBoard,
  openRoom,
  selectNumber,
  selectRows,
  selectText,
} from './helpers/storage';

/**
 * persist.board_store against the storage it will really use.
 *
 * Everything below runs inside a Durable Object, on that object's own SQLite database: a
 * `BoardStore` writing real rows, a real `Y.Doc` read back out of them, and the room's own
 * `migrate` having built the tables in the first place. A description of a board is not what is
 * being tested here; the rows are.
 *
 * Every test gets a board nobody has used before, so no test reads another test's storage.
 */

/** The row count of a table, asked from inside the object. */
function rowsIn(storage: DurableObjectStorage, table: string): number {
  for (const row of storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`)) {
    return Number(row['count']);
  }
  return 0;
}

/** One `storage_meta` value, asked from inside the object. */
function meta(storage: DurableObjectStorage, key: string): string | null {
  for (const row of storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key)) {
    return String(row['value']);
  }
  return null;
}

/** The largest log row number stored, asked from inside the object. */
function maxSeq(storage: DurableObjectStorage): number {
  for (const row of storage.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM updates')) {
    return Number(row['seq']);
  }
  return 0;
}

/** The rows of a statement, asked from inside the object. */
function query(storage: DurableObjectStorage, sql: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const row of storage.sql.exec(sql)) {
    rows.push(row);
  }
  return rows;
}

/** A board of 25 notes that has been edited `edits` times since, one update per edit. */
function boardWithEdits(edits: number): { updates: Uint8Array[]; live: Y.Doc } {
  const built = boardBuiltInSteps(25);
  const live = built.doc;
  const notes = snapshot(live);
  const later: Uint8Array[] = [];
  live.on('update', (update: Uint8Array) => {
    later.push(update);
  });
  while (built.updates.length + later.length < edits) {
    const done = later.length;
    const note = notes[done % notes.length];
    if (note === undefined) {
      throw new Error(`the 25-note fixture gave back ${notes.length} notes`);
    }
    // Always somewhere it is not already, so the model never answers "no change" and writes
    // nothing - which would leave the test waiting for a row that will never come.
    moveObject(live, note.id, note.x + done + 1, note.y);
    if (later.length === done) {
      throw new Error(`moving ${note.id} wrote no update`);
    }
  }
  return { updates: [...built.updates, ...later], live };
}

describe('TC-03 a board that was never used loads as an empty one', () => {
  it('creates the tables, holds nothing, and knows its version', async () => {
    const stub = boardStub();
    expect(await openRoom(stub)).toBe(426);

    const seen = await insideBoard(stub, (store, storage) => {
      // Running migrate again over the tables the room just made is what opening the same board
      // for the hundredth time does: it must neither fail nor change anything.
      store.migrate();
      const doc = new Y.Doc();
      return {
        load: store.load(doc),
        version: store.schemaVersion(),
        notes: snapshot(doc).length,
        updates: rowsIn(storage, 'updates'),
        chunks: rowsIn(storage, 'snapshot_chunks'),
        quarantined: rowsIn(storage, 'quarantined_updates'),
        metaRows: rowsIn(storage, 'storage_meta'),
        metaVersion: meta(storage, 'storage_schema_version'),
      };
    });

    expect(seen.load).toEqual({ ok: true, quarantined: 0 });
    expect(seen.notes).toBe(0);
    expect(seen.version).toBe(STORAGE_SCHEMA_VERSION);
    expect(seen.metaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    expect([seen.updates, seen.chunks, seen.quarantined]).toEqual([0, 0, 0]);
    expect(seen.metaRows).toBe(1);
  });
});

describe('TC-04 one appended update is one row', () => {
  it('stores the update and its length', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const update = updateOfNote('Faster onboarding');

    expect(await countRows(stub, 'updates')).toBe(0);

    const seen = await insideBoard(stub, (store, storage) => {
      store.append(update);
      return {
        rows: query(storage, 'SELECT seq, bytes, length(data) AS stored FROM updates'),
        counts: store.counts(),
      };
    });

    expect(seen.rows).toEqual([{ seq: 1, bytes: update.byteLength, stored: update.byteLength }]);
    expect(seen.counts).toEqual({ rows: 1, bytes: update.byteLength, throughSeq: 0 });
    expect(await countRows(stub, 'updates')).toBe(1);
  });
});

describe('TC-05 a board that is only a log of updates loads back whole', () => {
  it('reads 25 notes out of the rows they were written in', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltInSteps(25);

    const seen = await insideBoard(stub, (store) => {
      for (const update of built.updates) {
        store.append(update);
      }
      const fresh = new Y.Doc();
      return {
        load: store.load(fresh),
        rows: store.counts(),
        notes: snapshot(fresh).length,
        same: sameBoard(fresh, built.doc),
        equal: JSON.stringify(snapshot(fresh)) === JSON.stringify(snapshot(built.doc)),
      };
    });

    expect(seen.load).toEqual({ ok: true, quarantined: 0 });
    expect(seen.notes).toBe(25);
    expect(seen.same).toBe(true);
    expect(seen.equal).toBe(true);
    expect(seen.rows.rows).toBe(built.updates.length);
  });
});

describe('TC-06 a log the length of the threshold folds into a snapshot', () => {
  it('empties the log and keeps the board', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const { updates, live } = boardWithEdits(COMPACTION_UPDATE_COUNT);

    const seen = await insideBoard(stub, (store, storage) => {
      for (const update of updates) {
        store.append(update);
      }
      const before = { rows: rowsIn(storage, 'updates'), maxSeq: maxSeq(storage) };
      const compacted = store.compactIfNeeded(live);
      return {
        before,
        compacted,
        updatesAfter: rowsIn(storage, 'updates'),
        chunks: rowsIn(storage, 'snapshot_chunks'),
        throughSeq: meta(storage, 'snapshot_through_seq'),
        counts: store.counts(),
        load: store.load(new Y.Doc()),
      };
    });

    expect(seen.before.rows).toBe(COMPACTION_UPDATE_COUNT);
    expect(seen.compacted).toBe(true);
    expect(seen.updatesAfter).toBe(0);
    expect(seen.chunks).toBeGreaterThanOrEqual(1);
    expect(seen.throughSeq).toBe(String(seen.before.maxSeq));
    expect(seen.counts).toEqual({ rows: 0, bytes: 0, throughSeq: seen.before.maxSeq });
    expect(seen.load).toEqual({ ok: true, quarantined: 0 });

    // And the folded-up board is the same board.
    const reloaded = await insideBoard(stub, (store) => {
      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      return sameBoard(fresh, live);
    });
    expect(reloaded).toBe(true);
  });

  it('leaves a log one row short of the threshold alone (boundary)', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const { updates, live } = boardWithEdits(COMPACTION_UPDATE_COUNT - 1);

    const seen = await insideBoard(stub, (store, storage) => {
      for (const update of updates) {
        store.append(update);
      }
      return {
        rows: rowsIn(storage, 'updates'),
        compacted: store.compactIfNeeded(live),
        chunks: rowsIn(storage, 'snapshot_chunks'),
        counts: store.counts(),
      };
    });

    expect(seen.rows).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(seen.counts.rows).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(seen.compacted).toBe(false);
    expect(seen.chunks).toBe(0);
  });
});

describe('TC-07 a snapshot with updates on top of it loads as one board', () => {
  it('applies only the rows above the snapshot', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltInSteps(25);
    const live = built.doc;
    const notes = snapshot(live);

    const seen = await insideBoard(stub, (store, storage) => {
      for (const update of built.updates) {
        store.append(update);
      }
      const first = store.compactIfNeeded(live, true);
      const throughSeq = Number(meta(storage, 'snapshot_through_seq'));

      // Three more edits, three more rows - the shape of a board people are still using.
      const after: Uint8Array[] = [];
      live.on('update', (update: Uint8Array) => {
        after.push(update);
      });
      for (const [index, note] of notes.slice(0, 3).entries()) {
        moveObject(live, note.id, note.x + 31 * (index + 1), note.y + 7);
      }
      for (const update of after) {
        store.append(update);
      }

      const fresh = new Y.Doc();
      return {
        first,
        throughSeq,
        load: store.load(fresh),
        logRows: rowsIn(storage, 'updates'),
        applied: after.length,
        notes: snapshot(fresh).length,
        same: sameBoard(fresh, live),
        maxSeq: maxSeq(storage),
      };
    });

    expect(seen.first).toBe(true);
    expect(seen.load).toEqual({ ok: true, quarantined: 0 });
    expect(seen.applied).toBe(3);
    // Only the three rows above the snapshot are left to replay, and the snapshot itself starts
    // where the old log ended.
    expect(seen.logRows).toBe(3);
    expect(seen.maxSeq).toBeGreaterThan(seen.throughSeq);
    expect(seen.notes).toBe(25);
    expect(seen.same).toBe(true);
  });
});

describe('TC-08 a board of the product size folds into chunks that fit', () => {
  it('writes several chunks, none of them too big, and loads back the same board', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const dense = denseBoard();

    const seen = await insideBoard(stub, (store, storage) => {
      const whole = updateOfDocument(dense);
      store.append(whole);
      const live = new Y.Doc();
      Y.applyUpdate(live, whole);

      const compacted = store.compactIfNeeded(live, true);
      const chunks: number[] = [];
      for (const row of storage.sql.exec(
        'SELECT length(data) AS bytes FROM snapshot_chunks ORDER BY idx',
      )) {
        chunks.push(Number(row['bytes']));
      }
      const fresh = new Y.Doc();
      return {
        boardNotes: snapshot(dense).length,
        chunkSizes: chunks,
        throughSeq: Number(meta(storage, 'snapshot_through_seq') ?? '0'),
        logRows: rowsIn(storage, 'updates'),
        compacted,
        load: store.load(fresh),
        loadedNotes: snapshot(fresh).length,
        same: sameBoard(fresh, dense),
      };
    });

    expect(seen.boardNotes).toBe(PERSIST_TESTED_NOTES);
    expect(seen.compacted).toBe(true);
    // The board is bigger than one chunk, which is the only reason there is more than one.
    expect(seen.chunkSizes.length).toBeGreaterThan(1);
    expect(Math.max(...seen.chunkSizes)).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(seen.throughSeq).toBeGreaterThan(0);
    expect(seen.logRows).toBe(0);
    expect(seen.load).toEqual({ ok: true, quarantined: 0 });
    expect(seen.loadedNotes).toBe(PERSIST_TESTED_NOTES);
    expect(seen.same).toBe(true);
  });
});

describe('TC-09 one damaged row in the log costs one change, not the board', () => {
  it('quarantines the row and loads every other note, on a board several people wrote', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltByWriters();
    const damagedSeq = 7;
    const source = built.updates[damagedSeq - 1];
    if (source === undefined) {
      throw new Error(`the fixture wrote ${built.updates.length} updates`);
    }
    // A cut-short version of what was there: what a write that stopped halfway looks like to
    // whoever reads it back.
    const damaged = truncated(source, 0.9);

    const seen = await insideBoard(stub, (store, storage) => {
      for (const update of built.updates) {
        store.append(update);
      }
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        damaged,
        damaged.byteLength,
        damagedSeq,
      );

      const fresh = new Y.Doc();
      const load = store.load(fresh);

      // What the board would have been without the change that row held.
      const expected = new Y.Doc();
      for (const [index, update] of built.updates.entries()) {
        if (index + 1 !== damagedSeq) {
          Y.applyUpdate(expected, update);
        }
      }
      const quarantined = query(
        storage,
        'SELECT seq, error, length(data) AS bytes FROM quarantined_updates',
      );
      return {
        load,
        updates: rowsIn(storage, 'updates'),
        rowsWritten: built.updates.length,
        quarantined,
        notes: snapshot(fresh).length,
        sameWithoutThatChange: sameBoard(fresh, expected),
        // The damaged row is out of the log, so the next open of the board does not pay for it
        // a second time.
        secondLoad: store.load(new Y.Doc()),
      };
    });

    expect(seen.load).toEqual({ ok: true, quarantined: 1 });
    expect(seen.updates).toBe(seen.rowsWritten - 1);
    const [row] = seen.quarantined;
    expect(seen.quarantined).toHaveLength(1);
    expect(row?.['seq']).toBe(damagedSeq);
    expect(row?.['bytes']).toBe(damaged.byteLength);
    expect(typeof row?.['error']).toBe('string');
    expect((row?.['error'] as unknown as string).length).toBeGreaterThan(0);
    // One change is missing, and it is the one that was damaged; the other 24 notes are there,
    // and they are the notes they were.
    expect(seen.notes).toBe(24);
    expect(seen.sameWithoutThatChange).toBe(true);
    expect(seen.secondLoad).toEqual({ ok: true, quarantined: 0 });
  });

  it('costs the changes queued behind it when they are all from one person, and says so', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltInSteps();
    const seeds = noteSeeds();
    const damagedSeq = 7;
    const damaged = truncated(built.updates[damagedSeq - 1] ?? new Uint8Array(), 0.9);
    // Row 1 is the schema version, so row 7 holds the sixth note.
    const lostSeed = seeds[damagedSeq - 2];
    const survivingSeeds = seeds.slice(0, damagedSeq - 2);
    if (lostSeed === undefined) {
      throw new Error('the 25-note fixture is shorter than the row being damaged');
    }

    const seen = await insideBoard(stub, (store, storage, notices) => {
      for (const update of built.updates) {
        store.append(update);
      }
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        damaged,
        damaged.byteLength,
        damagedSeq,
      );
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      const notes = snapshot(fresh);
      return {
        load,
        notes: notes.length,
        texts: notes.map((note) => note.text),
        quarantined: rowsIn(storage, 'quarantined_updates'),
        saidItOutLoud: notices.some((notice) => notice.includes('short of content')),
        namedTheRow: notices.some((notice) => notice.includes(`row ${damagedSeq}`)),
      };
    });

    // The board opens, rather than being written off: the damage is one row and the rest of the
    // log is readable.
    expect(seen.load).toEqual({ ok: true, quarantined: 1 });
    expect(seen.quarantined).toBe(1);
    // What comes back is what was written before the hole, in the order it was written. Yjs will
    // not apply a client's changes across a hole in that client's run of changes, so the damaged
    // row and everything that came after it from the same page cannot be recovered - which is
    // why the damage has to be reported rather than looked past.
    expect(seen.texts).toEqual(survivingSeeds.map((seed) => seed.text));
    expect(seen.texts).not.toContain(lostSeed.text);
    expect(seen.notes).toBeGreaterThan(0);
    expect(seen.notes).toBeLessThan(25);
    // And it is not silent damage: the row is named, and the fact that the board came back short
    // of what was saved is written down where whoever runs this can see it.
    expect(seen.namedTheRow).toBe(true);
    expect(seen.saidItOutLoud).toBe(true);
  });
});

describe('TC-10 a snapshot that cannot be read is reported, not worked around', () => {
  it('says the snapshot is unreadable and deletes nothing', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltInSteps(25);

    const seen = await insideBoard(stub, (store, storage) => {
      for (const update of built.updates) {
        store.append(update);
      }
      const live = new Y.Doc();
      for (const update of built.updates) {
        Y.applyUpdate(live, update);
      }
      store.compactIfNeeded(live, true);
      const before = {
        chunks: rowsIn(storage, 'snapshot_chunks'),
        updates: rowsIn(storage, 'updates'),
        throughSeq: meta(storage, 'snapshot_through_seq'),
      };

      // Rot in chunk 0: the same number of bytes, none of them the same bytes.
      for (const row of storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0')) {
        storage.sql.exec(
          'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
          garbled(new Uint8Array(row['data'] as ArrayBuffer)),
        );
      }

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        before,
        load,
        after: {
          chunks: rowsIn(storage, 'snapshot_chunks'),
          updates: rowsIn(storage, 'updates'),
          quarantined: rowsIn(storage, 'quarantined_updates'),
          throughSeq: meta(storage, 'snapshot_through_seq'),
        },
        notes: snapshot(fresh).length,
      };
    });

    expect(seen.load.ok).toBe(false);
    expect(seen.load.ok ? 'loaded' : seen.load.reason).toBe('snapshot-unreadable');
    // Nothing was thrown away in the attempt: whatever is stored is still stored, and the
    // unreadable snapshot was not quietly turned into an empty board.
    expect(seen.after).toEqual({ ...seen.before, quarantined: 0 });
    expect(seen.notes).toBeLessThan(25);
  });
});

describe('TC-11 a compaction that fails halfway leaves the board as it was', () => {
  it('rolls the whole fold-up back', async () => {
    const stub = boardStub();
    await openRoom(stub);
    const built = boardBuiltInSteps(25);
    const live = built.doc;
    const notes = snapshot(live);

    // The second fold-up is the one that fails, and it fails after the old snapshot has already
    // been deleted - the moment at which a badly written compaction loses a board.
    let foldingUp = false;
    const faults: StoreFaults = {
      hit(step): void {
        if (foldingUp && step === 'compact:write-chunks') {
          throw new Error('injected SQL failure while writing the new snapshot');
        }
      },
    };

    const seen = await insideBoard(
      stub,
      (store, storage) => {
        for (const update of built.updates) {
          store.append(update);
        }
        const first = store.compactIfNeeded(live, true);
        const good = {
          chunks: rowsIn(storage, 'snapshot_chunks'),
          throughSeq: meta(storage, 'snapshot_through_seq'),
        };

        foldingUp = true;
        const extra: Uint8Array[] = [];
        live.on('update', (update: Uint8Array) => {
          extra.push(update);
        });
        for (const [index, note] of notes.slice(0, 2).entries()) {
          moveObject(live, note.id, note.x + 41 * (index + 1), note.y);
        }
        for (const update of extra) {
          store.append(update);
        }

        const compacted = store.compactIfNeeded(live, true);
        const after = {
          chunks: rowsIn(storage, 'snapshot_chunks'),
          throughSeq: meta(storage, 'snapshot_through_seq'),
          logRows: rowsIn(storage, 'updates'),
        };
        // The board still loads: the snapshot that was there before, plus the log that survived
        // the rollback.
        const fresh = new Y.Doc();
        const load = store.load(fresh);
        foldingUp = false;
        return { first, good, compacted, after, extra: extra.length, load, same: sameBoard(fresh, live) };
      },
      { faults },
    );

    expect(seen.first).toBe(true);
    expect(seen.good.chunks).toBeGreaterThan(0);
    expect(seen.compacted).toBe(false);
    expect(seen.after.chunks).toBe(seen.good.chunks);
    expect(seen.after.throughSeq).toBe(seen.good.throughSeq);
    expect(seen.after.logRows).toBe(seen.extra);
    expect(seen.load).toEqual({ ok: true, quarantined: 0 });
    expect(seen.same).toBe(true);
  });
});

describe('TC-25 opening a board nobody has edited writes nothing', () => {
  it('creates tables and no rows', async () => {
    const stub = boardStub();
    expect(await openRoom(stub)).toBe(426);

    expect(await countRows(stub, 'updates')).toBe(0);
    expect(await countRows(stub, 'snapshot_chunks')).toBe(0);
    expect(await countRows(stub, 'quarantined_updates')).toBe(0);
    expect(await selectNumber(stub, 'SELECT COUNT(*) AS count FROM storage_meta')).toBe(1);
    expect(
      await selectText(stub, 'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version'),
    ).toBe(String(STORAGE_SCHEMA_VERSION));
    // The tables are there, because a statement against them answers.
    expect(await selectRows(stub, 'SELECT seq, data, bytes FROM updates LIMIT 1')).toEqual([]);
  });
});
