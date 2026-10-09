import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc, moveObject } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import {
  largeBoard,
  notesOf,
  randomBytes,
  retroBoard,
  truncatedCopy,
} from '../fixtures/boards';

/**
 * The store against real Durable Object SQLite (`cloudflare:test`): every row and
 * byte written here is a real row on a real (local) disk. Failure injection happens
 * through `BoardStore.testBeforeExec`, which makes a statement throw inside the same
 * synchronous transaction a real disk failure would occupy — nothing about the
 * database is faked (design's mock-vs-real table: "no mocks, no mocks, no mocks").
 */

/** Run against one board's storage; the store is freshly constructed each call,
 *  which is exactly what a woken Durable Object does. */
async function inStorage<T>(
  boardId: string,
  fn: (store: BoardStore, storage: DurableObjectStorage) => T,
): Promise<T> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  return runInDurableObject(stub, (_instance, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    return fn(store, state.storage);
  });
}

/** Append every update of a source document as its own log row. */
async function seed(updates: readonly Uint8Array[]): Promise<string> {
  const boardId = newBoardId();
  await inStorage(boardId, (store) => {
    for (const update of updates) store.append(update);
  });
  return boardId;
}

function countRows(storage: DurableObjectStorage, table: string): number {
  // `table` is always a literal below, never input.
  return storage.sql
    .exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)
    .one().total;
}

const readMeta = (storage: DurableObjectStorage, key: string): string => {
  const row = storage.sql
    .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
    .next();
  return row.done === true ? '' : row.value.value;
};

/**
 * Grow a fixture document's update list to exactly `target` rows by moving its first
 * note around (each move is a real change, and the row count is what compaction
 * thresholds are named in).
 */
function growTo(retro: { doc: Y.Doc; updates: Uint8Array[] }, target: number): void {
  const firstNote = notesOf(retro.doc)[0].id;
  let x = 100;
  while (retro.updates.length < target) {
    const before = retro.updates.length;
    if (!moveObject(retro.doc, firstNote, (x += 1), 100)) {
      throw new Error('move produced no update');
    }
    if (retro.updates.length === before) throw new Error('move emitted no update');
  }
  retro.updates.length = target; // exact, whatever the last transaction emitted
}

/**
 * A board built one note per transaction *by a distinct author* (each note comes
 * from its own Y.Doc, i.e. its own client id), so log row N+1 is note N and — what
 * makes row-level damage analysable — every later row survives quarantining any
 * single row, because yjs only refuses to skip inside one client's own update
 * stream (`persist.partial_damage`, and the reason TC-09 expects 24 of 25).
 */
function authoredNoteBoard(noteCount: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const board = new Y.Doc();
  const updates: Uint8Array[] = [];
  // The board mirrors the final state for snapshot comparisons; only its own init
  // transaction is part of the log, author transactions are appended explicitly.
  let collecting = true;
  board.on('update', (update: Uint8Array) => {
    if (collecting) updates.push(update.slice());
  });
  initDoc(board);
  collecting = false;
  for (let index = 0; index < noteCount; index += 1) {
    // A new participant joins the board so far, makes exactly one change, and that
    // change is the row the room would store.
    const author = new Y.Doc();
    Y.applyUpdate(author, Y.mergeUpdates(updates));
    const own: Uint8Array[] = [];
    author.on('update', (update: Uint8Array) => own.push(update.slice()));
    author.transact(() => {
      const objects = author.getMap<Y.Map<unknown>>('objects');
      const item = new Y.Map<unknown>();
      item.set('type', 'sticky');
      item.set('x', 100 + index * 40);
      item.set('y', 100);
      item.set('color', 'yellow');
      item.set('text', new Y.Text(`note ${index}`));
      item.set('z', index + 1);
      item.set('createdAt', 1_700_000_000_000 + index);
      objects.set(`note-${index}`, item);
    });
    if (own.length !== 1) throw new Error(`expected one update from one transaction, got ${own.length}`);
    for (const update of own) {
      updates.push(update);
      Y.applyUpdate(board, update);
    }
  }
  return { doc: board, updates };
}

describe('BoardStore on real SQLite', () => {
  it('TC-25 migrate creates its tables and writes no update rows', async () => {
    const boardId = newBoardId();
    await inStorage(boardId, (store, storage) => {
      const tables = storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((row) => row.name);
      for (const table of ['updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta']) {
        expect(tables).toContain(table);
      }
      // A board that was only ever opened stays honestly empty.
      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(notesOf(fresh)).toEqual([]);
      expect(countRows(storage, 'updates')).toBe(0);
      expect(countRows(storage, 'snapshot_chunks')).toBe(0);
      // `storage_schema_version` exists from the first migration (design file layout).
      expect(Number(readMeta(storage, 'storage_schema_version'))).toBe(STORAGE_SCHEMA_VERSION);
    });
  });

  it('TC-04 one appended update is one row with its size recorded', async () => {
    const retro = retroBoard();
    const boardId = await seed([retro.updates[0]]);
    await inStorage(boardId, (_store, storage) => {
      const rows = storage.sql
        .exec<{ seq: number; bytes: number }>('SELECT seq, bytes FROM updates')
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].bytes).toBe(retro.updates[0].length);
    });
  });

  it('TC-05 a log-only board loads identical to its source', async () => {
    const retro = retroBoard();
    const boardId = await seed(retro.updates);
    await inStorage(boardId, (store, storage) => {
      expect(countRows(storage, 'updates')).toBe(retro.updates.length);
      const loaded = new Y.Doc();
      expect(store.load(loaded)).toEqual({ ok: true, quarantined: 0 });
      expect(notesOf(loaded)).toEqual(notesOf(retro.doc));
      expect(notesOf(loaded).length).toBe(25); // the fixture really is 25 notes
    });
  });

  it('TC-06 compaction at exactly COMPACTION_UPDATE_COUNT rows', async () => {
    const retro = retroBoard();
    growTo(retro, COMPACTION_UPDATE_COUNT);
    const boardId = await seed(retro.updates);
    await inStorage(boardId, (store, storage) => {
      expect(countRows(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      const merged = new Y.Doc();
      expect(store.load(merged)).toEqual({ ok: true, quarantined: 0 });
      expect(store.compactIfNeeded(merged)).toBe(true);

      expect(countRows(storage, 'updates')).toBe(0);
      expect(countRows(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      // through_seq is the max seq the snapshot replaced.
      expect(Number(readMeta(storage, 'snapshot_through_seq'))).toBe(COMPACTION_UPDATE_COUNT);
      // The snapshot describes the same board.
      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(notesOf(reloaded)).toEqual(notesOf(retro.doc));
    });
  }, 60_000);

  it('TC-07 after compaction only rows above through_seq apply', async () => {
    const retro = retroBoard();
    growTo(retro, COMPACTION_UPDATE_COUNT);
    const boardId = await seed(retro.updates);
    await inStorage(boardId, (store, storage) => {
      const merged = new Y.Doc();
      store.load(merged);
      expect(store.compactIfNeeded(merged)).toBe(true); // through = 500

      // A row deliberately at or below through_seq: bytes that would explode (and be
      // quarantined) if load applied rows the snapshot already covers.
      const junk = randomBytes(24, 7);
      storage.sql.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        1,
        junk,
        junk.length,
      );

      // Three more real changes, above through_seq, edited into the source board.
      const start = retro.updates.length;
      const firstNote = notesOf(retro.doc)[0].id;
      moveObject(retro.doc, firstNote, 99_999, 99_999);
      moveObject(retro.doc, firstNote, 99_998, 99_998);
      moveObject(retro.doc, firstNote, 99_997, 99_997);
      const extra = retro.updates.slice(start);
      expect(extra).toHaveLength(3);
      for (const update of extra) store.append(update);

      const loaded = new Y.Doc();
      // The junk row is skipped (quarantined would be 1 if it had been applied) and
      // stays on disk untouched.
      expect(store.load(loaded)).toEqual({ ok: true, quarantined: 0 });
      expect(countRows(storage, 'quarantined_updates')).toBe(0);
      expect(
        storage.sql
          .exec<{ total: number }>('SELECT COUNT(*) AS total FROM updates WHERE seq = 1')
          .one().total,
      ).toBe(1);
      // The three rows above through_seq did apply: the board is current.
      expect(notesOf(loaded)).toEqual(notesOf(retro.doc));
    });
  }, 60_000);

  it('TC-08 a large board compacts into multiple chunks and loads back identical', async () => {
    const big = largeBoard();
    expect(notesOf(big.doc)).toHaveLength(PERSIST_TESTED_NOTES);
    const boardId = await seed(big.updates);
    await inStorage(
      boardId,
      (store, storage) => {
        const merged = new Y.Doc();
        expect(store.load(merged)).toEqual({ ok: true, quarantined: 0 });
        expect(store.compactIfNeeded(merged)).toBe(true);
        const chunks = storage.sql
          .exec<{ idx: number; data: ArrayBuffer }>(
            'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
          )
          .toArray();
        // A 2000-note board's snapshot is over one chunk, and every chunk stays under
        // the chunk size: the whole point of chunking.
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
          expect(chunk.data.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
        }
        expect(countRows(storage, 'updates')).toBe(0);

        const reloaded = new Y.Doc();
        expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
        expect(notesOf(reloaded)).toEqual(notesOf(big.doc));
        expect(notesOf(reloaded)).toHaveLength(2_000);
      },
    );
  }, 180_000);

  // Two forms of damaged bytes in the log (design: "a truncated update, random bytes").
  describe.each([
    ['a truncated update', (update: Uint8Array) => truncatedCopy(update)],
    ['random bytes', (update: Uint8Array) => randomBytes(update.length)],
  ])('TC-09: %s', (_label, damage) => {
    it('quarantines one row and loads the other 24 notes intact', async () => {
      const board = authoredNoteBoard(25);
      const boardId = await seed(board.updates); // row 1 = init, rows 2..26 = the notes
      await inStorage(boardId, (store, storage) => {
        const damaged = storage.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 7')
          .one().data;
        const broken = damage(new Uint8Array(damaged));
        storage.sql.exec(
          'UPDATE updates SET data = ?, bytes = ? WHERE seq = 7',
          broken,
          broken.length,
        );

        const loaded = new Y.Doc();
        const result = store.load(loaded);
        expect(result.ok).toBe(true);
        expect(result.ok && result.quarantined).toBe(1);

        const quarantined = storage.sql
          .exec<{ seq: number; error: string; quarantined_at: number }>(
            'SELECT seq, error, quarantined_at FROM quarantined_updates',
          )
          .toArray();
        expect(quarantined).toHaveLength(1);
        expect(quarantined[0].seq).toBe(7);
        expect(quarantined[0].error.length).toBeGreaterThan(0);
        expect(Number.isFinite(quarantined[0].quarantined_at)).toBe(true);

        // One damaged change cost one change: 24 of 25 notes are there, and they are
        // exactly the source notes minus the one row 7 created.
        const missing = new Set(notesOf(board.doc).map((note) => note.id));
        for (const note of notesOf(loaded)) missing.delete(note.id);
        expect(notesOf(loaded)).toHaveLength(24);
        expect([...missing]).toEqual(['note-5']); // row 7 created the sixth note
        expect(countRows(storage, 'updates')).toBe(25);
      });
    });
  });

  it('TC-09 gap guard: a paused author stream blocks compaction from truncating what it still needs', async () => {
    // One author, many transactions: quarantining one middle row pauses that
    // author's later rows (yjs integrates a client's structs only against its own
    // clock). Compaction would delete those rows from the only copy that exists,
    // so it must refuse while the log has a gap.
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update.slice()));
    initDoc(doc);
    for (let index = 0; index < 25; index += 1) {
      doc.transact(() => {
        doc.getMap<Y.Map<unknown>>('objects').set(
          `note-${index}`,
          new Y.Map<unknown>().set('type', 'sticky'),
        );
      });
    }
    const boardId = await seed(updates);
    await inStorage(boardId, (store, storage) => {
      const damaged = storage.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 7')
        .one().data;
      const broken = truncatedCopy(new Uint8Array(damaged));
      storage.sql.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = 7', broken, broken.length);

      const loaded = new Y.Doc();
      expect(store.load(loaded)).toEqual({ ok: true, quarantined: 1 });

      // Over the threshold with rows that re-apply cleanly (the first six, before
      // the gap), so only the guard can be what stops compaction.
      // 84 rounds of 6 rows: comfortably over COMPACTION_UPDATE_COUNT.
      for (let round = 0; round < 84; round += 1) {
        for (const update of updates.slice(0, 6)) store.append(update);
      }
      expect(store.compactIfNeeded(loaded)).toBe(false);
      // The still-pending rows are all still there: one quarantined, everything else kept.
      expect(countRows(storage, 'updates')).toBe(updates.length - 1 + 84 * 6);
    });
  });

  it('TC-10 a damaged snapshot fails the load and deletes nothing', async () => {
    const board = authoredNoteBoard(25);
    const boardId = await seed(board.updates);
    await inStorage(boardId, (store, storage) => {
      // Get a snapshot in place through the real compaction path: re-applying the
      // same 26 rows 20 times is idempotent for Yjs and passes the row threshold.
      const merged = new Y.Doc();
      store.load(merged);
      for (let round = 0; round < 20; round += 1) {
        for (const update of board.updates) store.append(update);
      }
      expect(store.compactIfNeeded(merged)).toBe(true);
      expect(countRows(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);

      const before = {
        updates: countRows(storage, 'updates'),
        chunks: countRows(storage, 'snapshot_chunks'),
        quarantined: countRows(storage, 'quarantined_updates'),
      };
      const chunkLength = storage.sql
        .exec<{ n: number }>('SELECT LENGTH(data) AS n FROM snapshot_chunks WHERE idx = 0')
        .one().n;
      const junk = randomBytes(chunkLength);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', junk);

      const attempted = new Y.Doc();
      const result = store.load(attempted);
      expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
      // Nothing was deleted or quarantined: the damage is reported, not widened.
      expect(countRows(storage, 'updates')).toBe(before.updates);
      expect(countRows(storage, 'snapshot_chunks')).toBe(before.chunks);
      expect(countRows(storage, 'quarantined_updates')).toBe(before.quarantined);
    });
  });

  it('TC-11 a failed compaction leaves the old snapshot and log untouched', async () => {
    const retro = retroBoard();
    growTo(retro, COMPACTION_UPDATE_COUNT);
    const boardId = await seed(retro.updates);
    await inStorage(boardId, (store, storage) => {
      const merged = new Y.Doc();
      store.load(merged); // logRows = 500

      // A first, healthy compaction gives us a real old snapshot to protect.
      expect(store.compactIfNeeded(merged)).toBe(true);
      const goodChunks = storage.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
        )
        .toArray();
      expect(goodChunks.length).toBeGreaterThanOrEqual(1);
      const throughBefore = readMeta(storage, 'snapshot_through_seq');

      // Grow the log again and fail the next compaction mid-transaction, right
      // after the old snapshot was cleared: the worst moment for a crash.
      for (const update of retro.updates) store.append(update);
      let seenDelete = false;
      store.testBeforeExec = (query: string) => {
        if (query.startsWith('DELETE FROM snapshot_chunks')) seenDelete = true;
        else if (seenDelete && query.startsWith('INSERT INTO snapshot_chunks')) {
          throw new Error('injected disk failure');
        }
      };
      expect(store.compactIfNeeded(merged)).toBe(false);
      store.testBeforeExec = undefined;

      // Old snapshot and log stand exactly as they were: the transaction rolled back.
      const chunksAfter = storage.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
        )
        .toArray();
      expect(chunksAfter).toEqual(goodChunks);
      expect(countRows(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(readMeta(storage, 'snapshot_through_seq')).toBe(throughBefore);

      // And the board still loads whole: nothing was half-applied, counters recover.
      const recovery = new Y.Doc();
      expect(store.load(recovery)).toEqual({ ok: true, quarantined: 0 });
      expect(notesOf(recovery)).toEqual(notesOf(retro.doc));
    });
  }, 60_000);
});
