/**
 * TC-03 to TC-11 and TC-25 (persist.board_store) — one board's SQLite storage,
 * inside a real Durable Object in real workerd: real `ctx.storage.sql`, real
 * transactions, real rollback. Nothing here mocks storage; where a failure is
 * needed the SQL layer is made to throw (`./broken-storage`), and the code path
 * under test is the store's own.
 *
 * The store is tested through the bytes the product makes (`../fixtures/boards`
 * builds boards with `src/shared/board-model.ts`), because a storage test that
 * wrote invented bytes would only prove that invented bytes survive.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import * as Y from 'yjs';

import { createSticky, moveObject } from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';

import type { LoadResult } from '../../src/worker/board-store';

import { blob, breakSql, countRows, query, tableNames, updateSeqs } from './broken-storage';
import { applyAndLog, collectErrors, logUntilRows } from './seed';
import { largeBoard, noteIds, notesOf, randomBlob, retroBoard, truncatedUpdate } from '../fixtures/boards';

interface StoreAccess {
  readonly store: BoardStore;
  readonly storage: DurableObjectStorage;
}

/**
 * Open one board's storage. The same board name reaches the same Durable Object,
 * which is how "close it and open it again" is tested without a process restart:
 * a second `BoardStore` over the same storage is a second life.
 */
function openStore<T>(board: string, run: (access: StoreAccess) => T): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board));
  return runInDurableObject(stub, (_room, state) =>
    run({ store: new BoardStore(state.storage), storage: state.storage }),
  );
}

const encode = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

/** Two documents hold the same state, byte for byte. */
function sameState(a: Y.Doc, b: Y.Doc): boolean {
  const left = encode(a);
  const right = encode(b);
  return left.byteLength === right.byteLength && left.every((value, i) => value === right[i]);
}

/** A `BLOB` column back into bytes. */
function asBytes(value: SqlStorageValue): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('expected a BLOB column');
}

/** A failed read, with the reason it gave. */
function why(result: LoadResult | undefined): {
  reason: string;
  error: string;
  quarantined: number;
} {
  if (result === undefined || result.ok) throw new Error('expected the board to refuse to open');
  return { reason: result.reason, error: result.error, quarantined: result.quarantined ?? 0 };
}

/** A doc holding exactly these updates, oldest first. */
function docOf(updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

const idOf = (note: { id: string }): string => note.id;

describe('a board is written down (TC-03, TC-04, TC-05, TC-25)', () => {
  // TC-25 runs first on purpose: that opening a board nobody edited leaves
  // nothing behind is only observable on a board nobody has written to.
  it('TC-25: opening a never-edited board creates the tables and no rows', async () => {
    const out = await openStore('store-tc-25', ({ store, storage }) => {
      store.migrate();
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        tables: tableNames(storage),
        updates: countRows(storage, 'updates'),
        chunks: countRows(storage, 'snapshot_chunks'),
        notes: noteIds(fresh).length,
        load,
      };
    });

    expect(out.tables).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
    );
    expect(out.updates).toBe(0);
    expect(out.chunks).toBe(0);
    expect(out.notes).toBe(0);
    expect(out.load).toEqual({ ok: true, quarantined: 0 });
  });

  it('TC-03: stores one row per Yjs update, counting its bytes', async () => {
    const out = await openStore('store-tc-03', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      const twelve = built.updates.slice(0, 12);
      for (const update of twelve) store.append(update);
      return {
        stored: query(storage, 'SELECT seq, bytes FROM updates ORDER BY seq ASC').map((row) => ({
          seq: Number(row.seq),
          bytes: Number(row.bytes),
        })),
        written: twelve.map((update) => update.byteLength),
      };
    });

    expect(out.stored).toHaveLength(12);
    expect(out.stored.map((row) => row.bytes)).toEqual(out.written);
    expect(out.stored.every((row) => row.bytes > 0)).toBe(true);
    // `seq` only goes up: "everything after the snapshot" is one indexed query.
    expect(out.stored.map((row) => row.seq)).toEqual([...out.stored.map((row) => row.seq)].sort((a, b) => a - b));
  });

  it('TC-04: closes and opens again with the same notes, byte for byte', async () => {
    const out = await openStore('store-tc-04', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      // The schema transaction plus ten notes; then this life of the board ends.
      const ten = built.updates.slice(0, 11);
      for (const update of ten) store.append(update);

      // A second life: a new store over the same storage, a new document.
      const reopened = new BoardStore(storage);
      const loaded = new Y.Doc();
      const load = reopened.load(loaded);

      return {
        load,
        notes: noteIds(loaded).length,
        identical: sameState(loaded, docOf(ten)),
        rows: countRows(storage, 'updates'),
      };
    });

    expect(out.load).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(10);
    expect(out.rows).toBe(11);
    // Byte equality, not "it renders the same": a board that comes back one byte
    // different is a board someone will lose edits on.
    expect(out.identical).toBe(true);
  });

  it('TC-05: reads the log back so the last word about a position wins', async () => {
    const out = await openStore('store-tc-05', ({ store, storage }) => {
      store.migrate();

      // A: create a note. B: create another. C: move the first one away.
      const doc = new Y.Doc();
      const captured: Uint8Array[] = [];
      doc.on('update', (update) => captured.push(update.slice()));
      const moved = createSticky(doc, { x: 200, y: 200 });
      createSticky(doc, { x: 600, y: 600 });
      if (typeof moved !== 'string') throw new Error('the fixture note was not created');
      if (!moveObject(doc, moved, 1_400, 900)) throw new Error('the move was refused');
      for (const update of captured) store.append(update);

      const loaded = new Y.Doc();
      const load = store.load(loaded);

      // The design's negative case: the same rows, read in the other order.
      const reversed = new Y.Doc();
      for (const row of query(storage, 'SELECT data FROM updates ORDER BY seq DESC')) {
        Y.applyUpdate(reversed, asBytes(row.data));
      }
      const noteAt = (doc: Y.Doc): number | undefined =>
        notesOf(doc).find((note) => note.id === moved)?.x;

      return {
        load,
        movedTo: noteAt(loaded),
        createdAt: 200 - STICKY_SIZE_WORLD / 2,
        reversedTo: noteAt(reversed),
        sameEitherWay: sameState(loaded, reversed),
      };
    });

    expect(out.load).toEqual({ ok: true, quarantined: 0 });
    // The move was the last word, and it is what comes back. (Creation centres
    // the point it is given, so the note started at 100.)
    expect(out.movedTo).toBe(1_400);
    expect(out.createdAt).toBe(100);
    // And, unlike a diff-based log, Yjs updates merge to the same board whatever
    // order they are read in. The order is about work done, not about who wins:
    // see NOTES.md for what this says about TC-05's negative case.
    expect(out.reversedTo).toBe(1_400);
    expect(out.sameEitherWay).toBe(true);
  });
});

describe('the log is folded into a snapshot (TC-06, TC-07, TC-08)', () => {
  it('TC-06: compacts at COMPACTION_UPDATE_COUNT rows and reloads identically', async () => {
    const out = await openStore('store-tc-06', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      const doc = applyAndLog(store, built.updates);
      // The design's fixture: 25 notes, then filler edits up to the threshold.
      logUntilRows(store, storage, doc, COMPACTION_UPDATE_COUNT);
      const chunksBefore = countRows(storage, 'snapshot_chunks');
      const folded = store.compactIfNeeded(doc);

      const reloaded = new Y.Doc();
      const load = store.load(reloaded);
      // A fresh store over the same storage must see the same board: `seq`
      // continued past what the snapshot already holds.
      const reopened = new BoardStore(storage);
      const again = new Y.Doc();
      const secondLoad = reopened.load(again);

      return {
        folded,
        load,
        secondLoad,
        rows: countRows(storage, 'updates'),
        chunksBefore,
        chunks: countRows(storage, 'snapshot_chunks'),
        notes: noteIds(reloaded).length,
        identical: sameState(reloaded, doc),
        secondIdentical: sameState(again, doc),
      };
    });

    expect(out.folded).toBe(true);
    expect(out.rows).toBe(0);
    expect(out.chunksBefore).toBe(0);
    expect(out.chunks).toBeGreaterThanOrEqual(1);
    expect(out.notes).toBe(25);
    expect(out.load).toEqual({ ok: true, quarantined: 0 });
    expect(out.identical).toBe(true);
    expect(out.secondLoad).toEqual({ ok: true, quarantined: 0 });
    expect(out.secondIdentical).toBe(true);
  });

  it('TC-07: a compaction that fails leaves the log alone and is tried again', async () => {
    const out = await openStore('store-tc-07', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      const doc = applyAndLog(store, built.updates);
      logUntilRows(store, storage, doc, COMPACTION_UPDATE_COUNT);
      const rowsBefore = countRows(storage, 'updates');
      const seqsBefore = updateSeqs(storage);

      // Break the write in the middle of the fold, so its transaction rolls back.
      const restore = breakSql(
        storage,
        (sql) => /INSERT INTO snapshot_chunks/.test(sql),
        'simulated: the snapshot row was refused',
      );
      let folded = true;
      const errors = collectErrors(() => {
        folded = store.compactIfNeeded(doc);
      });
      restore();

      // What storage holds now, before anything else touches it.
      const rowsDuring = countRows(storage, 'updates');
      const chunksDuring = countRows(storage, 'snapshot_chunks');
      const seqsDuring = updateSeqs(storage);

      const after = new Y.Doc();
      const load = store.load(after);
      // Nothing was forgotten, so the next change tries the fold again.
      const retried = store.compactIfNeeded(doc);

      return {
        folded,
        errors,
        load,
        notes: noteIds(after).length,
        rowsBefore,
        rowsDuring,
        rowsAfter: countRows(storage, 'updates'),
        chunksDuring,
        sameRows: JSON.stringify(seqsBefore) === JSON.stringify(seqsDuring),
        retried,
      };
    });

    // It reports the failure instead of throwing through the room.
    expect(out.folded).toBe(false);
    expect(out.errors.join('\n')).toContain('rolled back');
    // The log survives a rolled-back compaction: that is the difference between
    // a board that opens slowly and a board that lost everything.
    expect(out.rowsDuring).toBe(out.rowsBefore);
    expect(out.sameRows).toBe(true);
    expect(out.chunksDuring).toBe(0);
    expect(out.load).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(25);
    expect(out.retried).toBe(true);
    expect(out.rowsAfter).toBe(0);
  });

  it('TC-08: a 2000-note board is stored as several chunks and reloads whole', async () => {
    const out = await openStore('store-tc-08', ({ store, storage }) => {
      const built = largeBoard();
      store.migrate();
      const doc = new Y.Doc();
      built.updates.forEach((update) => {
        store.append(update);
        Y.applyUpdate(doc, update);
      });
      const encodedBytes = encode(doc).byteLength;
      const folded = store.compactIfNeeded(doc);
      const reloaded = new Y.Doc();
      const load = store.load(reloaded);

      return {
        seeded: noteIds(doc).length,
        encodedBytes,
        folded,
        load,
        chunks: countRows(storage, 'snapshot_chunks'),
        rows: countRows(storage, 'updates'),
        notes: noteIds(reloaded).length,
        identical: sameState(reloaded, doc),
      };
    });

    expect(out.seeded).toBe(2_000);
    expect(out.folded).toBe(true);
    expect(out.rows).toBe(0);
    // A board this size does not fit in one chunk row; chunking is what keeps it
    // under the per-row limit of SQLite-backed Durable Objects.
    if (out.encodedBytes > SNAPSHOT_CHUNK_BYTES) {
      expect(out.chunks).toBeGreaterThan(1);
    }
    expect(out.load).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(2_000);
    expect(out.identical).toBe(true);
  });
});

describe('a log row that cannot be read (TC-09, TC-10)', () => {
  /** Damage one logged row, read the board back, and report what came of it. */
  const damageAndReload = (
    board: string,
    damage: (stored: Uint8Array) => Uint8Array,
    rowIndex: number,
  ) =>
    openStore(board, ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      applyAndLog(store, built.updates);
      const rows = updateSeqs(storage);
      const target = rows[rowIndex];
      const stored = asBytes(query(storage, 'SELECT data FROM updates WHERE seq = ?', target)[0].data);
      const damaged = damage(stored);
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        blob(damaged),
        damaged.byteLength,
        target,
      );

      const loaded = new Y.Doc();
      let load: LoadResult | undefined;
      const errors = collectErrors(() => {
        load = store.load(loaded);
      });
      const notesAfter = noteIds(loaded);
      const missing = built.notes.map(idOf).filter((id) => !notesAfter.includes(id));

      // The bad row is out of the log, so reading the board again is clean —
      // including for a store that has never seen this board.
      const second = new Y.Doc();
      const secondLoad = new BoardStore(storage).load(second);

      return {
        load,
        errors,
        notes: notesAfter.length,
        missing,
        target,
        logged: built.notes.length,
        logRows: countRows(storage, 'updates'),
        loggedRows: rows.length,
        secondLoad,
        quarantined: query(storage, 'SELECT seq, bytes, error, data FROM quarantined_updates').map(
          (row) => ({
            seq: Number(row.seq),
            bytes: Number(row.bytes),
            hasError: String(row.error).length > 0,
            kept: asBytes(row.data).byteLength,
          }),
        ),
        notesSecondLoad: noteIds(second).length,
      };
    });

  /*
   * The design expected one damaged row to cost one change. It does not, and
   * this suite measured it: every update the board writes comes from one
   * client's clock, so a row whose clock range is missing is held by Yjs as
   * not-yet-applicable, and so is every row after it. Truncate row 7 of the log
   * and the board comes back with 1 note of 25 (apply row 7 again and they are
   * all there). So the store cannot "load the rest" without showing a board
   * that is missing most of itself with nothing on screen to say so; it refuses
   * to open the board instead, and `persist.load_failure` says what happened.
   * See NOTES.md.
   */
  it('TC-09: a board with a truncated update refuses to open, and says so', async () => {
    const out = await damageAndReload('store-tc-09', (stored) => truncatedUpdate(stored), 6);

    const failure = why(out.load);
    expect(failure.reason).toBe('log-unreadable');
    expect(failure.error).toContain(`seq=${out.target}`);
    expect(failure.quarantined).toBe(1);

    // The row is recorded with its bytes and the error, for whoever fixes it.
    expect(out.quarantined).toHaveLength(1);
    expect(out.quarantined[0].seq).toBe(out.target);
    expect(out.quarantined[0].hasError).toBe(true);
    expect(out.quarantined[0].kept).toBeGreaterThan(0);
    // ...and it stays in the log, because deleting it would leave a hole whose
    // loads succeed with the tail gone.
    expect(out.logRows).toBe(out.loggedRows);

    // The board that did get built is not servable: it is missing far more than
    // the one row, which is exactly why the read fails rather than continuing.
    expect(out.notes).toBeLessThan(out.logged);
    expect(out.missing.length).toBeGreaterThan(1);

    // The room logs it: a change that went missing must be visible somewhere.
    expect(out.errors.join('\n')).toContain(`seq=${out.target}`);

    // Every retry ends the same way — the same board is never opened half-read.
    const again = why(out.secondLoad);
    expect(again.reason).toBe('log-unreadable');
    expect(out.notesSecondLoad).toBe(out.notes);
  });

  it('TC-10: a board with random bytes in a row refuses to open, and says so', async () => {
    const out = await damageAndReload('store-tc-10', (stored) => randomBlob(stored.byteLength), 2);

    const failure = why(out.load);
    expect(failure.reason).toBe('log-unreadable');
    expect(failure.error).toContain(`seq=${out.target}`);
    expect(out.quarantined).toHaveLength(1);
    expect(out.quarantined[0].seq).toBe(out.target);
    expect(out.logRows).toBe(out.loggedRows);
    expect(why(out.secondLoad).reason).toBe('log-unreadable');
  });

  it('TC-10 (negative): an unreadable snapshot loads nothing and quarantines nothing', async () => {
    const out = await openStore('store-tc-10-snapshot', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      const doc = applyAndLog(store, built.updates);
      logUntilRows(store, storage, doc, COMPACTION_UPDATE_COUNT);
      expect(store.compactIfNeeded(doc)).toBe(true);
      const chunksBefore = countRows(storage, 'snapshot_chunks');
      const rowsBefore = countRows(storage, 'updates');

      // Damage the snapshot itself.
      const firstChunk = storage.sql
        .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx LIMIT 1')
        .one();
      const original = asBytes(firstChunk.data);
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ?, bytes = ? WHERE idx = ?',
        blob(randomBlob(original.byteLength, 21)),
        original.byteLength,
        Number(firstChunk.idx),
      );

      const untouched = new Y.Doc();
      const load = store.load(untouched);
      return {
        load,
        notes: noteIds(untouched).length,
        stillBlank: sameState(untouched, new Y.Doc()),
        chunks: countRows(storage, 'snapshot_chunks'),
        chunksBefore,
        rows: countRows(storage, 'updates'),
        rowsBefore,
        quarantined: countRows(storage, 'quarantined_updates'),
      };
    });

    // Not a board with a hole in it: a board that cannot be read at all.
    expect(out.load.ok).toBe(false);
    expect(out.load).toMatchObject({ reason: 'snapshot-unreadable' });
    expect(out.notes).toBe(0);
    // The failed apply left the document as it was: blank.
    expect(out.stillBlank).toBe(true);
    // Nothing deleted, nothing moved: the failure is reported, not acted on.
    expect(out.chunks).toBe(out.chunksBefore);
    expect(out.rows).toBe(out.rowsBefore);
    expect(out.quarantined).toBe(0);
  });
});

describe('storage refuses to write (TC-11)', () => {
  it('rethrows a SQL error, leaving the log and the counters where they were', async () => {
    const out = await openStore('store-tc-11', ({ store, storage }) => {
      const built = retroBoard();
      store.migrate();
      const doc = applyAndLog(store, built.updates.slice(0, 4));
      const rowsBefore = countRows(storage, 'updates');
      const seqsBefore = updateSeqs(storage);

      const restore = breakSql(
        storage,
        (sql) => /INSERT INTO updates/.test(sql),
        'simulated: the write did not land',
      );
      let message = 'no error thrown';
      try {
        store.append(built.updates[8]);
      } catch (error) {
        message = String(error);
      }
      const rowsDuring = countRows(storage, 'updates');
      const seqsDuring = updateSeqs(storage);
      restore();

      // A later write works, and is counted once — not twice.
      store.append(built.updates[9]);
      return {
        message,
        rows: { before: rowsBefore, during: rowsDuring, after: countRows(storage, 'updates') },
        sameRows: JSON.stringify(seqsBefore) === JSON.stringify(seqsDuring),
        // Nothing was counted while storage was failing, so this board is still
        // nowhere near the compaction threshold.
        folded: store.compactIfNeeded(doc),
      };
    });

    expect(out.message).toContain('the write did not land');
    // The failed insert is not there, and neither is a half-written one.
    expect(out.rows.during).toBe(out.rows.before);
    expect(out.sameRows).toBe(true);
    expect(out.rows.after).toBe(out.rows.before + 1);
    expect(out.folded).toBe(false);
  });
});
