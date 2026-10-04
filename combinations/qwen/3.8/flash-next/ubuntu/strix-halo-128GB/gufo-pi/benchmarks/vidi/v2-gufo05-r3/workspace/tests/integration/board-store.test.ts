/**
 * `BoardStore` against the real SQLite storage of a Durable Object (task 3).
 *
 * Each test works on the storage of a fresh board and reads the tables back with
 * plain SQL, so "it was written" means written to the database, not to something
 * the store happens to hold in memory. Where a test needs a fresh instance it
 * constructs one over the same storage — that is exactly what a room that was
 * evicted and woken gets.
 *
 * One Yjs fact runs through the damaged-data cases: an update is a *diff*, so a
 * row that cannot be applied does not merely lose its own change — everything
 * stored after it depends on it and cannot be integrated either. Yjs keeps such
 * updates aside instead of failing, which would present a quietly truncated board.
 * The store therefore distinguishes damage at the newest end of the log (the board
 * opens, the change is quarantined) from damage with content behind it (the load
 * fails closed). See `uncoveredContent` in `board-store.ts`.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { BoardStore, checksum } from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import {
  boardKey,
  claimsMoreStructs,
  encodeBoard,
  largeBoard,
  randomBytesOf,
  retroBoard,
} from '../fixtures/boards';
import { freshBoardId } from './ws-client';

interface TableProbe {
  updates: number;
  updateBytes: number;
  maxSeq: number;
  chunks: number;
  chunkBytes: number[];
  throughSeq: number;
  meta: Record<string, string>;
  quarantined: { seq: number; error: string; bytes: number }[];
}

/** What the tables hold, as plain serialisable data. */
async function probe(boardId: string): Promise<TableProbe> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_room, state) => {
    const sql = state.storage.sql;
    const scalar = <T extends Record<string, SqlStorageValue>>(sqlText: string): T =>
      sql.exec<T>(sqlText).toArray()[0] as T;
    const updates = scalar<{ count: number | null; bytes: number | null; max: number | null }>(
      'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, MAX(seq) AS max FROM updates',
    );
    const chunks = scalar<{ count: number | null }>(
      'SELECT COUNT(*) AS count FROM snapshot_chunks',
    );
    const lengths = sql
      .exec<{ len: number }>('SELECT length(data) AS len FROM snapshot_chunks ORDER BY idx ASC')
      .toArray()
      .map((row) => row.len);
    const meta = sql
      .exec<{ key: string; value: string }>('SELECT key, value FROM storage_meta ORDER BY key ASC')
      .toArray();
    const quarantined = sql
      .exec<{ seq: number; error: string; data: ArrayBuffer }>(
        'SELECT seq, error, data FROM quarantined_updates ORDER BY seq ASC',
      )
      .toArray()
      .map((row) => ({
        seq: row.seq,
        error: row.error,
        bytes: (row.data as ArrayBuffer).byteLength,
      }));
    const out = {
      updates: updates.count ?? 0,
      updateBytes: updates.bytes ?? 0,
      maxSeq: updates.max ?? 0,
      chunks: chunks.count ?? 0,
      chunkBytes: lengths,
      throughSeq: Number.parseInt(
        meta.find((row) => row.key === 'snapshot_through_seq')?.value ?? '0',
        10,
      ),
      meta: Object.fromEntries(meta.map((row) => [row.key, row.value])),
      quarantined,
    };
    return out;
  });
}

/** Run work against one board's store, in the object's own context. */
function inStore<T>(boardId: string, body: (store: BoardStore, state: DurableObjectState) => T) {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room, state) => body(room.store, state));
}

/** A doc loaded from `boardId`'s storage, plus how the load went. */
async function loadBoard(boardId: string): Promise<{
  key: string;
  notes: number;
  result: { ok: boolean; reason?: string; error?: string };
}> {
  return inStore(boardId, (store) => {
    const doc = new Y.Doc();
    const result = store.load(doc);
    const notes = doc.getMap('objects').size;
    const out = { key: boardKey(doc), notes, result };
    doc.destroy();
    return out;
  });
}

/** Append every given update, in order, to one board's log. */
async function appendAll(boardId: string, updates: Uint8Array[]): Promise<void> {
  await inStore(boardId, (store) => {
    for (const update of updates) store.append(update);
  });
}

/** Fold whatever the log holds, in the same store instance that loaded it. */
function compactNow(boardId: string, forced = false): Promise<boolean> {
  return inStore(boardId, (store) => {
    const doc = new Y.Doc();
    const result = store.load(doc);
    if (!result.ok) throw new Error(`load before compaction failed: ${result.reason}`);
    const did = forced ? store.compact(doc) : store.compactIfNeeded(doc);
    doc.destroy();
    return did;
  });
}

describe('an empty board (TC-03, TC-25)', () => {
  it('TC-03 migrate creates the tables, records the version and loads as empty', async () => {
    const board = freshBoardId();
    await inStore(board, (store) => store.migrate());

    const after = await probe(board);
    expect(after.meta.storage_schema_version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(after.throughSeq).toBe(0);

    const loaded = await loadBoard(board);
    expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.notes).toBe(0);
    expect(loaded.key).toBe(boardKey(new Y.Doc()));
  });

  it('TC-25 migrate writes no update and no snapshot rows, on a fresh board and an edited one', async () => {
    const board = freshBoardId();
    await inStore(board, (store) => store.migrate());

    const fresh = await probe(board);
    expect(fresh.updates).toBe(0);
    expect(fresh.updateBytes).toBe(0);
    expect(fresh.chunks).toBe(0);
    expect(fresh.quarantined).toEqual([]);

    // A room that wakes re-runs migrate(). On a board with content that must
    // change nothing: opening a board is not an edit.
    const { updates } = retroBoard();
    await appendAll(board, updates);
    await inStore(board, (store) => store.migrate());

    const edited = await probe(board);
    expect(edited.updates).toBe(updates.length);
    expect(edited.updateBytes).toBeGreaterThan(0);
    expect(edited.chunks).toBe(0);
    expect(edited.quarantined).toEqual([]);
    expect(edited.meta.storage_schema_version).toBe(String(STORAGE_SCHEMA_VERSION));
  });
});

describe('the update log (TC-04, TC-05)', () => {
  it('TC-04 one appended update is one row, with its length recorded', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    // Two rows: the one that initialises the board and the one that creates a
    // note. A stored update is a diff, so reading the log from the top matters.
    const written = updates.slice(0, 2);
    const expected = new Y.Doc();
    for (const update of written) Y.applyUpdate(expected, update);

    let total = 0;
    for (const update of written) {
      await inStore(board, (store) => store.append(update));
      total += update.byteLength;
    }

    const after = await probe(board);
    expect(after.updates).toBe(2);
    expect(after.updateBytes).toBe(total);
    expect(after.maxSeq).toBe(2);
    expect(after.chunkBytes).toEqual([]);

    // Read back by a store instance that never saw the writes: what a woken room gets.
    const stored = await loadBoard(board);
    expect(stored.result).toEqual({ ok: true, quarantined: 0 });
    expect(stored.notes).toBe(1);
    expect(stored.key).toBe(boardKey(expected));
  });

  it('TC-05 a 25-note board reloads identical, and reloading changes nothing', async () => {
    const board = freshBoardId();
    const { doc: original, updates } = retroBoard();
    await appendAll(board, updates);

    const first = await loadBoard(board);
    expect(first.result).toEqual({ ok: true, quarantined: 0 });
    expect(first.notes).toBe(25);
    expect(first.key).toBe(boardKey(original));

    const second = await loadBoard(board);
    expect(second.key).toBe(first.key);
    const after = await probe(board);
    expect(after.updates).toBe(updates.length);
    expect(after.quarantined).toEqual([]);
  });
});

describe('compaction (TC-06, TC-07, TC-08, TC-11)', () => {
  it('TC-06 folds the log at COMPACTION_UPDATE_COUNT rows and the board is identical', async () => {
    const board = freshBoardId();
    const { doc: original, updates } = retroBoard();
    // Cycled up to the threshold: re-applying an update is a no-op in Yjs, so the
    // board is the 25-note one while the log is exactly as long as it gets.
    const rows = Array.from({ length: COMPACTION_UPDATE_COUNT }, (_, i) => updates[i % updates.length]!);
    await appendAll(board, rows);

    const before = await probe(board);
    expect(before.updates).toBe(COMPACTION_UPDATE_COUNT);
    expect(before.chunks).toBe(0);

    expect(await compactNow(board)).toBe(true);

    const after = await probe(board);
    expect(after.updates, 'the log is empty').toBe(0);
    expect(after.chunks, 'a snapshot was written').toBeGreaterThanOrEqual(1);
    expect(after.throughSeq, 'the snapshot covers every row it deleted').toBe(before.maxSeq);

    const loaded = await loadBoard(board);
    expect(loaded.key, 'the board is identical after folding').toBe(boardKey(original));
    expect(loaded.notes).toBe(25);

    // Below the threshold again (zero rows), so there is nothing to fold.
    expect(await compactNow(board)).toBe(false);
    expect((await loadBoard(board)).key).toBe(boardKey(original));
  });

  it('TC-07 updates written after a compaction reload together with the snapshot', async () => {
    const board = freshBoardId();
    const { doc: original, updates } = retroBoard();
    const folded = updates.slice(0, 40);
    const later = updates.slice(40);
    expect(later.length).toBeGreaterThanOrEqual(3);

    await appendAll(board, folded);
    expect(await compactNow(board, true)).toBe(true);
    const through = (await probe(board)).throughSeq;
    await appendAll(board, later);

    const after = await probe(board);
    expect(after.updates).toBe(later.length);
    expect(
      after.maxSeq - later.length + 1,
      'the new rows start after snapshot_through_seq',
    ).toBe(through + 1);

    const loaded = await loadBoard(board);
    expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.notes).toBe(25);
    expect(loaded.key).toBe(boardKey(original));
  });

  it('TC-07 loading applies only the rows after snapshot_through_seq', async () => {
    const board = freshBoardId();
    const { doc: original, updates } = retroBoard();
    await appendAll(board, updates);
    expect(await compactNow(board, true)).toBe(true);
    const through = (await probe(board)).throughSeq;
    expect(through).toBeGreaterThan(0);

    // A row with a sequence number the snapshot already covers — the shape a
    // deleted-and-resurrected row or a hand-edited database produces. Its content
    // is junk that would quarantine if it were read at all.
    const junk = randomBytesOf(64);
    await inStore(board, (_store, state) => {
      state.storage.sql.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        1,
        junk,
        junk.byteLength,
      );
    });

    const loaded = await loadBoard(board);
    expect(loaded.result, 'the row below through_seq was never read').toEqual({
      ok: true,
      quarantined: 0,
    });
    expect(loaded.key).toBe(boardKey(original));
    expect((await probe(board)).quarantined, 'nothing to quarantine').toEqual([]);
  });

  it('TC-08 the tested board size compacts into several chunks and reloads identical', async () => {
    const board = freshBoardId();
    const { doc: original } = largeBoard(PERSIST_TESTED_NOTES);
    const encoded = encodeBoard(original);
    expect(encoded.byteLength, 'big enough to need several chunks').toBeGreaterThan(
      SNAPSHOT_CHUNK_BYTES,
    );

    // Seeded as a single full-state update, the way the e2e seeds it: the store
    // then folds it, which is the part under test.
    await appendAll(board, [encoded]);
    expect(await compactNow(board, true)).toBe(true);

    const after = await probe(board);
    expect(after.updates).toBe(0);
    expect(after.chunks).toBe(Math.ceil(encoded.byteLength / SNAPSHOT_CHUNK_BYTES));
    for (const size of after.chunkBytes) {
      expect(size, 'no row approaches the per-row limit').toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
    expect(after.chunkBytes[after.chunkBytes.length - 1]).toBe(
      encoded.byteLength % SNAPSHOT_CHUNK_BYTES,
    );

    const started = Date.now();
    const loaded = await loadBoard(board);
    const elapsed = Date.now() - started;
    expect(loaded.notes).toBe(PERSIST_TESTED_NOTES);
    expect(loaded.key).toBe(boardKey(original));
    // Generous here: TC-21 holds the real BOARD_LOAD_BUDGET_MS on a real process.
    expect(elapsed, `snapshot plus short log read in ${elapsed}ms`).toBeLessThan(10_000);
  }, 120_000);

  it('TC-08 the byte threshold folds while the row count is still small', async () => {
    const board = freshBoardId();
    const { doc: original } = largeBoard(60);
    const big = encodeBoard(original);

    const stats = await inStore(board, (store) => {
      let appended = 0;
      while (store.stats().updateBytes < COMPACTION_BYTES) {
        store.append(big);
        appended += 1;
        expect(appended, 'the count threshold must not be what fires here').toBeLessThan(
          COMPACTION_UPDATE_COUNT,
        );
      }
      return store.stats();
    });
    expect(stats.updateBytes).toBeGreaterThanOrEqual(COMPACTION_BYTES);

    expect(await compactNow(board)).toBe(true);
    const after = await probe(board);
    expect(after.updates).toBe(0);
    expect(after.chunks).toBeGreaterThanOrEqual(1);
    expect((await loadBoard(board)).key).toBe(boardKey(original));
  });

  it('TC-11 a compaction that fails halfway rolls back completely', async () => {
    const board = freshBoardId();
    const { doc: original, updates } = retroBoard();
    await appendAll(board, updates);
    expect(await compactNow(board, true)).toBe(true);

    // More content in front of the snapshot, so a fold has work to do.
    const later = updates.slice(30);
    await appendAll(board, later);
    const before = await probe(board);
    expect(before.updates).toBe(later.length);

    // Fail on the insert of a new chunk: the old chunks are already deleted by
    // then, so only the transaction can protect the board.
    await inStore(board, (_store, state) => {
      state.storage.sql.exec(
        'CREATE TRIGGER injected_compaction_failure INSERT ON snapshot_chunks ' +
          "BEGIN SELECT RAISE(ABORT, 'injected: disk full'); END",
      );
    });

    expect(await compactNow(board, true)).toBe(false);

    const after = await probe(board);
    expect(after.chunks, 'the previous snapshot is still there').toBe(before.chunks);
    expect(after.chunkBytes).toEqual(before.chunkBytes);
    expect(after.updates, 'the log is still there').toBe(before.updates);
    expect(after.updateBytes).toBe(before.updateBytes);
    expect(after.throughSeq, 'nothing was marked as folded').toBe(before.throughSeq);
    expect((await loadBoard(board)).key, 'the board still reads the same').toBe(
      boardKey(original),
    );

    // With the injected failure gone, the same work succeeds.
    await inStore(board, (_store, state) => {
      state.storage.sql.exec('DROP TRIGGER injected_compaction_failure');
    });
    expect(await compactNow(board, true)).toBe(true);
    expect((await probe(board)).updates).toBe(0);
    expect((await loadBoard(board)).key).toBe(boardKey(original));
  });
});

describe('damaged data (TC-09, TC-10)', () => {
  it('TC-09 a damaged newest row is quarantined and the rest of the board opens', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    const good = updates.slice(0, 6);
    const damaged = claimsMoreStructs(updates[6]!);
    const expected = new Y.Doc();
    for (const update of good) Y.applyUpdate(expected, update);

    await appendAll(board, [...good, damaged]);
    expect((await probe(board)).updates).toBe(7);

    const loaded = await loadBoard(board);
    expect(loaded.result, 'the board opened').toEqual({ ok: true, quarantined: 1 });
    expect(loaded.key, 'everything except the damaged change').toBe(boardKey(expected));
    expect(loaded.notes, 'the notes before the damage are there').toBeGreaterThan(0);

    const after = await probe(board);
    expect(after.quarantined).toHaveLength(1);
    expect(after.quarantined[0]!.seq, 'row 7').toBe(7);
    expect(after.quarantined[0]!.error.length, 'with the reason').toBeGreaterThan(0);
    expect(after.quarantined[0]!.bytes).toBe(damaged.byteLength);
    expect(after.updates, 'the good rows stay in the log').toBe(good.length);

    // Quarantining is not repeated on the next load, and the board keeps opening
    // the same way.
    const again = await loadBoard(board);
    expect(again.result).toEqual({ ok: true, quarantined: 0 });
    expect(again.key).toBe(boardKey(expected));
    expect((await probe(board)).quarantined).toHaveLength(1);
  });

  it('TC-09 noise where the first change was is not mistaken for an empty board', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    const junk = randomBytesOf(updates[0]!.byteLength, 4242);

    await appendAll(board, [junk, ...updates.slice(1, 4)]);

    const loaded = await loadBoard(board);
    // Whether the noise is unreadable as a header or unappliable as a change, the
    // rows after it start further along than the board got to, and the load says so.
    expect(loaded.result.ok, 'the board did not open').toBe(false);
    expect(loaded.result.reason).toBe('update-log-unreadable');
    expect(loaded.result.error, 'with something a human can act on').toBeTruthy();
    expect(loaded.notes, 'nothing is presented as content').toBe(0);
  });

  it('TC-09 a row that cannot be applied with content behind it fails closed', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    const damaged = claimsMoreStructs(updates[19]!);

    await appendAll(board, [...updates.slice(0, 19), damaged, ...updates.slice(20)]);

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'the load reports the gap').toBe(false);
    expect(loaded.result.reason).toBe('update-log-unreadable');
    expect(loaded.result.error).toContain('gap');
    // What did apply is part of the board, and it sits in the document the caller
    // was handed: `load` cannot take an applied update back, so a failed load means
    // the room throws that document away and never serves it.
    expect(loaded.notes, 'the damage is not at the end of the log').toBeGreaterThan(0);
    expect(loaded.notes, 'this is only part of the board').toBeLessThan(25);

    const after = await probe(board);
    expect(after.quarantined.map((row) => row.seq), 'the unreadable row was moved out').toEqual([
      20,
    ]);
  });

  it('TC-09 a row of noise with content behind it fails closed too', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    const noise = randomBytesOf(updates[19]!.byteLength, 71);

    await appendAll(board, [...updates.slice(0, 19), noise, ...updates.slice(20)]);

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'the load reports the gap').toBe(false);
    expect(loaded.result.reason).toBe('update-log-unreadable');
    expect(loaded.notes, 'this is only part of the board').toBeLessThan(25);
  });

  it('TC-09 a change missing from the middle of the log is not a board', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    // Not damage to a row but a row that never arrived: a write lost between two
    // others. Nothing throws here, which is why it needs its own check.
    await appendAll(board, [...updates.slice(0, 19), ...updates.slice(20)]);

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'the load reports the gap').toBe(false);
    expect(loaded.result.reason).toBe('update-log-unreadable');
    expect(loaded.result.error).toContain('gap');
    expect(loaded.notes, 'this is only part of the board').toBeLessThan(25);

    const after = await probe(board);
    expect(after.quarantined, 'nothing is unreadable, so nothing is quarantined').toEqual([]);
    expect(after.updates, 'the log is left for a human to read').toBe(updates.length - 1);
  });

  it('TC-09 the quarantine is recorded once and survives a reload of the store', async () => {
    const board = freshBoardId();
    const { updates } = retroBoard();
    await appendAll(board, [...updates.slice(0, 3), claimsMoreStructs(updates[3]!)]);

    const first = await loadBoard(board);
    expect(first.result).toEqual({ ok: true, quarantined: 1 });
    const recorded = await probe(board);
    expect(recorded.quarantined).toHaveLength(1);
    expect(recorded.updateBytes).toBeGreaterThan(0);

    // Compacting what is left keeps the quarantine record and the readable rows.
    expect(await compactNow(board, true)).toBe(true);
    const after = await probe(board);
    expect(after.quarantined).toEqual(recorded.quarantined);
    expect((await loadBoard(board)).key).toBe(first.key);
  });

  it('TC-10 a snapshot chunk replaced with other bytes is fatal, and changes nothing', async () => {
    const board = freshBoardId();
    const { doc: original } = retroBoard();
    await appendAll(board, retroBoard().updates);
    expect(await compactNow(board, true)).toBe(true);

    const before = await probe(board);
    expect(before.chunks).toBeGreaterThanOrEqual(1);

    await inStore(board, (_store, state) => {
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        randomBytesOf(before.chunkBytes[0]!),
      );
    });

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'altered bytes are not served as the board').toBe(false);
    expect(loaded.result.reason).toBe('snapshot-unreadable');
    expect(loaded.result.error).toContain('digest');
    expect(loaded.notes, 'nothing was presented as the board').toBe(0);
    expect(loaded.key, 'the document is exactly as it started').toBe(boardKey(new Y.Doc()));

    const after = await probe(board);
    expect(after.chunks).toBe(before.chunks);
    expect(after.chunkBytes).toEqual(before.chunkBytes);
    expect(after.throughSeq).toBe(before.throughSeq);
    expect(after.quarantined, 'a fatal load quarantines nothing').toEqual([]);
    expect(original).toBeDefined();
  });

  it('TC-10 one changed byte inside a snapshot fails closed instead of showing altered content', async () => {
    const board = freshBoardId();
    const { doc: original } = retroBoard();
    await appendAll(board, retroBoard().updates);
    expect(await compactNow(board, true)).toBe(true);

    // Flip one bit in the middle of the snapshot. Such a byte usually decodes
    // perfectly well into *different* content, so a load that does not verify what
    // it read would show a board with something quietly changed.
    await inStore(board, (_store, state) => {
      const chunk = state.storage.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
        .toArray()[0]!;
      const intact = new Uint8Array(chunk.data);
      const bytes = intact.slice();
      bytes[Math.floor(bytes.byteLength / 2)] ^= 0x20;
      expect(checksum(bytes), 'the stored digest will not match this').not.toBe(checksum(intact));
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ?', bytes);
    });

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'the board did not open').toBe(false);
    expect(loaded.result.reason).toBe('snapshot-unreadable');
    expect(loaded.key).toBe(boardKey(new Y.Doc()));
    expect(loaded.key, 'never the altered content').not.toBe(boardKey(original));
  });

  it('TC-10 a snapshot with a chunk missing entirely is fatal', async () => {
    const board = freshBoardId();
    await appendAll(board, retroBoard().updates);
    expect(await compactNow(board, true)).toBe(true);
    const before = await probe(board);
    expect(before.chunks).toBeGreaterThanOrEqual(1);

    await inStore(board, (_store, state) => {
      state.storage.sql.exec('DELETE FROM snapshot_chunks WHERE idx = 0');
    });

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'a snapshot that lost a chunk is not reported as an empty board').toBe(
      false,
    );
    expect(loaded.result.reason).toBe('snapshot-unreadable');
    expect(loaded.result.error).toContain('no snapshot chunk is left');
    expect(loaded.notes).toBe(0);
  });

  it('TC-10 a snapshot that lost its digest row is not opened unverified', async () => {
    const board = freshBoardId();
    const { doc: original } = retroBoard();
    await appendAll(board, retroBoard().updates);
    expect(await compactNow(board, true)).toBe(true);

    await inStore(board, (_store, state) => {
      state.storage.sql.exec("DELETE FROM storage_meta WHERE key = 'snapshot_digest'");
    });

    const loaded = await loadBoard(board);
    expect(loaded.result.ok, 'unverifiable is not "fine"').toBe(false);
    expect(loaded.result.reason).toBe('snapshot-unreadable');
    expect(loaded.key).toBe(boardKey(new Y.Doc()));
    expect(original).toBeDefined();
  });
});
