/**
 * Integration tests for `BoardStore` against real SQLite-backed Durable Object storage
 * (`persist.board_store`, TC-03 to TC-11, TC-25). Each test uses a fresh random board id,
 * so its Durable Object (and therefore its SQLite database) is isolated even though
 * `isolatedStorage` is off. Storage is never mocked: only SQL *write* failures are injected
 * by wrapping `BoardStore` outside SQLite (TC-11) so the real transaction semantics apply.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { BoardStore } from '../../src/worker/board-store.js';
import type { BoardRoom } from '../../src/worker/board-room.js';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model.js';
import { newBoardId } from '../../src/shared/board-id.js';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config.js';
import {
  damagedFixtures,
  largeBoard,
  retro25Board,
  retro25BoardWithRows,
  type GeneratedBoard,
} from '../fixtures/boards.js';

const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/**
 * Wrap real DO storage so any SQL statement whose query matches `predicate` throws. The
 * wrapper sits OUTSIDE SQLite: it re-exposes the real `transactionSync`, so a throw inside
 * a `transactionSync` closure still rolls the whole statement set back exactly as a real
 * disk error would. Only `sql.exec` and `transactionSync` are used by `BoardStore`.
 */
const failingStorage = (
  storage: DurableObjectStorage,
  predicate: (query: string) => boolean,
): DurableObjectStorage =>
  ({
    sql: {
      exec: (query: string, ...binds: unknown[]) => {
        if (predicate(query)) throw new Error(`injected SQL failure for: ${query}`);
        return storage.sql.exec(query, ...(binds as never[]));
      },
    },
    transactionSync: (closure: () => unknown) => storage.transactionSync(closure),
  }) as unknown as DurableObjectStorage;

const notesOf = (doc: Y.Doc): readonly StickySnapshot[] => snapshot(doc);

/** Compare two note snapshots ignoring wall-clock `createdAt`. */
const sameNotes = (a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.color !== y.color ||
      x.text !== y.text ||
      x.z !== y.z
    )
      return false;
  }
  return true;
};

describe('BoardStore: empty board migrate + load (TC-03, TC-25)', () => {
  it('TC-03 migrate then load leaves a fresh, empty document at the current schema version', async () => {
    const boardId = newBoardId();
    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        version: store.schemaVersion(),
        notes: notesOf(fresh).length,
        ok: result.ok,
      };
    });
    expect(out.ok).toBe(true);
    expect(out.notes).toBe(0);
    expect(out.version).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-25 migrate on a never-edited board writes no update or snapshot rows', async () => {
    const boardId = newBoardId();
    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      return {
        updates: store.logRowCount(),
        chunks: store.snapshotChunkCount(),
        quarantined: store.quarantineCount(),
      };
    });
    expect(out).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
  });
});

describe('BoardStore: append + load log-only', () => {
  it('TC-04 append one update -> 1 row, bytes column equals its length', async () => {
    const boardId = newBoardId();
    const first = retro25Board().updates[0]!;
    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      store.append(first);
      const bytes = state.storage.sql
        .exec<{ bytes: number }>('SELECT bytes FROM updates ORDER BY seq')
        .toArray();
      return { rows: store.logRowCount(), bytes };
    });
    expect(out.rows).toBe(1);
    expect(out.bytes).toEqual([{ bytes: first.byteLength }]);
  });

  it('TC-05 log-only 25 notes: load into a fresh doc equals the original snapshot', async () => {
    const boardId = newBoardId();
    const board: GeneratedBoard = retro25Board();
    const original = snapshot(board.doc);
    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of board.updates) store.append(u);
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return { rows: store.logRowCount(), notes: notesOf(fresh), ok: result.ok };
    });
    expect(out.ok).toBe(true);
    expect(out.rows).toBe(board.updates.length);
    expect(sameNotes(out.notes, original)).toBe(true);
  });
});

describe('BoardStore: compaction', () => {
  it('TC-06 at the row threshold, compaction empties the log and reload equals the original', async () => {
    const boardId = newBoardId();
    const board = retro25BoardWithRows(COMPACTION_UPDATE_COUNT);
    expect(board.updates).toHaveLength(COMPACTION_UPDATE_COUNT);
    const original = snapshot(board.doc);

    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const live = new Y.Doc();

      // One row below the threshold: compaction is a no-op (boundary), log intact.
      const below = board.updates.slice(0, COMPACTION_UPDATE_COUNT - 1);
      for (const u of below) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      const belowCompacted = store.compactIfNeeded(live);
      const rowsBelow = store.logRowCount();

      // Reach exactly the threshold, then compact.
      const last = board.updates[COMPACTION_UPDATE_COUNT - 1]!;
      store.append(last);
      Y.applyUpdate(live, last);
      const maxSeq = state.storage.sql
        .exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates')
        .one().m;
      const compacted = store.compactIfNeeded(live);

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        belowCompacted,
        rowsBelow,
        compacted,
        rowsAfter: store.logRowCount(),
        chunks: store.snapshotChunkCount(),
        through: store.snapshotThroughSeq(),
        maxSeq,
        notes: notesOf(fresh),
        ok: result.ok,
      };
    });

    expect(out.belowCompacted).toBe(false); // threshold-1 does not compact
    expect(out.rowsBelow).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(out.compacted).toBe(true);
    expect(out.rowsAfter).toBe(0); // log truncated
    expect(out.chunks).toBeGreaterThanOrEqual(1);
    expect(out.through).toBe(out.maxSeq);
    expect(out.ok).toBe(true);
    expect(sameNotes(out.notes, original)).toBe(true);
  });

  it('TC-07 snapshot + log: only rows above through_seq apply after three more updates', async () => {
    const boardId = newBoardId();
    // One board, so the "extra" updates continue the same document deterministically.
    const board = retro25BoardWithRows(COMPACTION_UPDATE_COUNT + 3);
    expect(board.updates.length).toBe(COMPACTION_UPDATE_COUNT + 3);

    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const live = new Y.Doc();
      // Fold the first COMPACTION_UPDATE_COUNT updates into a snapshot.
      for (const u of board.updates.slice(0, COMPACTION_UPDATE_COUNT)) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      store.compactIfNeeded(live);
      const through = store.snapshotThroughSeq();

      // Three more updates written after the compaction.
      const extra = board.updates.slice(COMPACTION_UPDATE_COUNT);
      for (const u of extra) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      const rowsNow = state.storage.sql
        .exec<{ seq: number }>('SELECT seq FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        through,
        logRowsAbove: rowsNow.length,
        notes: notesOf(fresh),
        live: notesOf(live),
        ok: result.ok,
      };
    });

    expect(out.ok).toBe(true);
    // Only the 3 rows with seq > through_seq remain in the log.
    expect(out.logRowsAbove).toBe(3);
    // The reloaded doc has everything (snapshot) plus the 3 later changes, identical to live.
    expect(sameNotes(out.notes, out.live)).toBe(true);
  });

  it('TC-08 compacting a PERSIST_TESTED_NOTES board produces a chunked snapshot that reloads equal', async () => {
    const boardId = newBoardId();
    const board = largeBoard();
    const original = snapshot(board.doc);

    const out = await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const live = new Y.Doc();
      for (const u of board.updates) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      // The encoded snapshot size we expect to store, to predict the chunk count.
      const encoded = Y.encodeStateAsUpdate(live);
      const expectedChunks = Math.ceil(encoded.byteLength / SNAPSHOT_CHUNK_BYTES);
      const compacted = store.compactIfNeeded(live);
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        encodedBytes: encoded.byteLength,
        expectedChunks,
        compacted,
        chunks: store.snapshotChunkCount(),
        notes: notesOf(fresh),
        ok: result.ok,
      };
    });

    expect(out.compacted).toBe(true);
    expect(out.ok).toBe(true);
    // A large board is split into multiple chunks once its encoded size exceeds one chunk.
    expect(out.chunks).toBe(Math.max(1, out.expectedChunks));
    if (out.encodedBytes > SNAPSHOT_CHUNK_BYTES) expect(out.chunks).toBeGreaterThan(1);
    expect(sameNotes(out.notes, original)).toBe(true);
  });
});

describe('BoardStore: damage handling', () => {
  it('TC-09 a damaged log row is quarantined; every other note still loads', async () => {
    const boardId = newBoardId();
    const board = retro25Board();
    const original = snapshot(board.doc);

    const out = await runInDurableObject(
      stubFor(boardId),
      (_inst, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const u of board.updates) store.append(u);
        const totalBefore = store.logRowCount();

        // Corrupt log row seq 7 with its OWN bytes flipped, so those exact (not-already-
        // applied) bytes fail to apply on the next load and get quarantined.
        const own = new Uint8Array(
          state.storage.sql
            .exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 7')
            .one().data,
        );
        const broken = own.map((byte) => byte ^ 0xff); // == corruptBytes(own)
        state.storage.sql.exec(
          'UPDATE updates SET data = ?, bytes = ? WHERE seq = 7',
          broken.buffer.slice(0),
          broken.byteLength,
        );

        const fresh = new Y.Doc();
        const result = store.load(fresh);
        return {
          totalBefore,
          result,
          rowsAfter: store.logRowCount(),
          quarantined: store.quarantineCount(),
          quarantineError: state.storage.sql
            .exec<{ error: string }>('SELECT error FROM quarantined_updates')
            .toArray(),
          notes: notesOf(fresh),
        };
      },
    );

    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.quarantined).toBe(1);
    expect(out.quarantined).toBe(1);
    expect(out.rowsAfter).toBe(out.totalBefore - 1); // damaged row removed from the log
    expect(out.quarantineError[0]!.error.length).toBeGreaterThan(0); // error text stored
    // The board still opens with the other notes intact (only the damaged change is missing).
    expect(out.notes.length).toBeGreaterThan(0);
    expect(out.notes.length).toBeLessThanOrEqual(original.length);
  });

  it('TC-10 a damaged snapshot is fatal: LoadFailed with nothing deleted or quarantined', async () => {
    const boardId = newBoardId();
    const board = retro25BoardWithRows(COMPACTION_UPDATE_COUNT);

    const out = await runInDurableObject(
      stubFor(boardId),
      (_inst, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        const live = new Y.Doc();
        for (const u of board.updates) {
          store.append(u);
          Y.applyUpdate(live, u);
        }
        store.compactIfNeeded(live); // a real snapshot now exists
        const chunksBefore = store.snapshotChunkCount();
        const rowsBefore = state.storage.sql
          .exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates')
          .one().c;

        // Corrupt chunk 0 with random bytes of the same length.
        const original = new Uint8Array(
          state.storage.sql
            .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
            .one().data,
        );
        const { random } = damagedFixtures(original);
        state.storage.sql.exec(
          'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
          random.buffer.slice(0),
        );

        const fresh = new Y.Doc();
        const result = store.load(fresh);
        return {
          result,
          chunksAfter: store.snapshotChunkCount(),
          rowsAfter: state.storage.sql
            .exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates')
            .one().c,
          quarantined: store.quarantineCount(),
          chunksBefore,
          rowsBefore,
        };
      },
    );

    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.reason).toBe('snapshot-unreadable');
    // Nothing was deleted or quarantined by the failed snapshot load.
    expect(out.chunksAfter).toBe(out.chunksBefore);
    expect(out.rowsAfter).toBe(out.rowsBefore);
    expect(out.quarantined).toBe(0);
  });

  it('TC-11 a compaction that throws after chunk delete rolls back: previous snapshot and log intact', async () => {
    const boardId = newBoardId();
    const first = retro25BoardWithRows(COMPACTION_UPDATE_COUNT);
    const second = retro25BoardWithRows(COMPACTION_UPDATE_COUNT, 5); // a second full batch

    const out = await runInDurableObject(
      stubFor(boardId),
      (_inst, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        const live = new Y.Doc();
        for (const u of first.updates) {
          store.append(u);
          Y.applyUpdate(live, u);
        }
        store.compactIfNeeded(live); // baseline snapshot; log now empty
        const chunksBefore = store.snapshotChunkCount();
        const chunksBeforeRaw = state.storage.sql
          .exec<{ idx: number; data: ArrayBuffer }>('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
          .toArray();

        // Enough new rows to cross the threshold again for a second compaction.
        for (const u of second.updates) {
          store.append(u);
          Y.applyUpdate(live, u);
        }
        const rowsBefore = state.storage.sql
          .exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates')
          .one().c;

        // A store whose `DELETE FROM updates` throws, injected OUTSIDE SQLite. Load it into a
        // fresh doc to seed its in-memory row count so compaction actually runs.
        const failing = new BoardStore(
          failingStorage(state.storage, (q) => q.startsWith('DELETE FROM updates')),
        );
        const seedDoc = new Y.Doc();
        failing.load(seedDoc); // seeds logCount from the real log
        const failingResult = failing.compactIfNeeded(live);

        return {
          failingResult,
          chunksAfter: store.snapshotChunkCount(),
          rowsAfter: state.storage.sql
            .exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates')
            .one().c,
          chunksBefore,
          rowsBefore,
          intactAfter: state.storage.sql
            .exec<{ idx: number; data: ArrayBuffer }>('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
            .toArray(),
          chunksBeforeRaw,
        };
      },
    );

    expect(out.rowsBefore).toBe(COMPACTION_UPDATE_COUNT);
    expect(out.failingResult).toBe(false); // compaction reported failure
    expect(out.chunksAfter).toBe(out.chunksBefore); // previous chunks intact (rollback)
    expect(out.rowsAfter).toBe(out.rowsBefore); // log rows intact (rollback)
    expect(Array.from(new Uint8Array(out.intactAfter[0]!.data))).toEqual(
      Array.from(new Uint8Array(out.chunksBeforeRaw[0]!.data)),
    );
  });
});
