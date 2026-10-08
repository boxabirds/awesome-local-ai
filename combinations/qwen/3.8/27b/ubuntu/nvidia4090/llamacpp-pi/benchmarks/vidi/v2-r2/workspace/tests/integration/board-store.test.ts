/**
 * BoardStore against real Durable Object SQLite in workerd (design
 * TC-03…TC-11, TC-25). No mocks: real `runInDurableObject` state, real
 * SQLite, real Yjs bytes built by the shared fixtures.
 *
 * Each test uses a fresh random board id; `isolatedStorage` is off for the
 * pool (vitest.config.ts), so board ids must never be reused.
 */

import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, moveObject, setStickyColor, snapshot } from '../../src/shared/board-model';
import {
  BoardSql,
  BoardStore,
  fromStorage,
} from '../../src/worker/board-store';
import { BoardRoom } from '../../src/worker/board-room';
import {
  buildLargeBoard,
  buildRetroBoard,
  scrambleUpdate,
} from '../fixtures/boards';

/** Runs `fn` with a BoardStore over the board's real Durable Object storage. */
async function inBoard(
  boardId: string,
  fn: (store: BoardStore, sql: BoardSql) => void,
): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject<BoardRoom, void>(stub, (instance, state) => {
    const store = new BoardStore(fromStorage(state.storage));
    store.migrate();
    fn(store, store.storage.sql);
  });
}

/** Buffers the doc's Yjs update events; take() drains them. */
class UpdateCollector {
  private buffer: Uint8Array[] = [];

  constructor(doc: Y.Doc) {
    doc.on('update', (update) => this.buffer.push(update));
  }

  take(): Uint8Array[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

function buildAndCollect(build: (doc: Y.Doc) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const collector = new UpdateCollector(doc);
  build(doc);
  return { doc, updates: collector.take() };
}

function appendAll(store: BoardStore, updates: readonly Uint8Array[]): void {
  for (const update of updates) {
    store.append(update);
  }
}

function rowCount(sql: BoardSql, table: string): number {
  return Number(sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).one().c);
}

function asBytes(value: unknown): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : (value as Uint8Array);
}

describe('TC-03 empty board', () => {
  it('migrate creates the tables, load yields an empty doc, version is recorded', async () => {
    await inBoard(newBoardId(), (store, sql) => {
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual([]);

      const tables = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray();
      const names = tables.map((row) => row.name as string);
      for (const table of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
        expect(names).toContain(table);
      }
      const version = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
        .one();
      expect(version.value).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });
});

describe('TC-04 append', () => {
  it('one update stores exactly one row whose bytes equal the update', async () => {
    await inBoard(newBoardId(), (store, sql) => {
      const doc = new Y.Doc();
      const collector = new UpdateCollector(doc);
      createSticky(doc, { x: 0, y: 0 });
      const [update] = collector.take();
      expect(update).toBeDefined();

      store.append(update);

      expect(rowCount(sql, 'updates')).toBe(1);
      const row = sql.exec('SELECT data, bytes FROM updates').one();
      expect(row.bytes).toBe(update.byteLength);
      expect(Array.from(asBytes(row.data))).toEqual(Array.from(update));
    });
  });
});

describe('TC-05 log-only load', () => {
  it('a 25-note board round-trips through load byte-for-byte (ids included)', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);
    const expected = snapshot(doc);
    expect(expected).toHaveLength(25);

    await inBoard(newBoardId(), (store) => {
      appendAll(store, updates);
      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh)).toEqual(expected);
    });
  });
});

describe('TC-06 compaction at the count threshold', () => {
  it('exactly COMPACTION_UPDATE_COUNT rows compact to a snapshot; reload is identical', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      // Grow the log to exactly the threshold with deterministic moves.
      const collector = new UpdateCollector(doc);
      const firstId = snapshot(doc)[0].id;
      for (let i = 0; rowCount(sql, 'updates') < COMPACTION_UPDATE_COUNT; i += 1) {
        expect(moveObject(doc, firstId, 10_000 + i, 20_000 + i)).toBe(true);
        appendAll(store, collector.take());
      }
      expect(rowCount(sql, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      const maxSeq = Number(sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);

      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(rowCount(sql, 'updates')).toBe(0);
      expect(rowCount(sql, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      const through = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .one();
      expect(through.value).toBe(String(maxSeq));

      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh)).toEqual(snapshot(doc));
    });
  });
});

describe('TC-07 snapshot plus log rows', () => {
  it('load applies the snapshot and only the rows above through_seq', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      // Pad to the threshold and compact (snapshot v1, empty log).
      const collector = new UpdateCollector(doc);
      const firstId = snapshot(doc)[0].id;
      for (let i = 0; rowCount(sql, 'updates') < COMPACTION_UPDATE_COUNT; i += 1) {
        moveObject(doc, firstId, 10_000 + i, 20_000 + i);
        appendAll(store, collector.take());
      }
      expect(store.compactIfNeeded(doc)).toBe(true);
      const through = Number(
        sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq').one().value,
      );

      // Three changes after compaction (each its own update): a move, a
      // colour change and another move.
      const last = snapshot(doc).at(-1)!;
      const secondToLast = snapshot(doc).find((n) => n.id !== last.id)!;
      moveObject(doc, last.id, 42_000, 43_000);
      setStickyColor(doc, last.id, 'violet');
      moveObject(doc, secondToLast.id, 44_000, 45_000);
      const tailUpdates = collector.take();
      expect(tailUpdates).toHaveLength(3);
      appendAll(store, tailUpdates);

      // Only rows above through_seq exist in the log.
      expect(rowCount(sql, 'updates')).toBe(3);
      const minSeq = Number(sql.exec('SELECT MIN(seq) AS m FROM updates').one().m);
      expect(minSeq).toBeGreaterThan(through);

      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh)).toEqual(snapshot(doc));
    });
  });
});

describe('TC-08 large board', () => {
  it('2000 notes compact into multiple chunks (every chunk <= SNAPSHOT_CHUNK_BYTES) and reload identical', async () => {
    const { doc, updates } = buildAndCollect(buildLargeBoard);
    expect(updates.length).toBeGreaterThan(COMPACTION_UPDATE_COUNT);

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      expect(store.compactIfNeeded(doc)).toBe(true);

      const chunkSizes = sql
        .exec('SELECT length(data) AS n FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((row) => Number(row.n));
      expect(chunkSizes.length).toBeGreaterThan(1);
      for (const size of chunkSizes) {
        expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      expect(rowCount(sql, 'updates')).toBe(0);

      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh)).toEqual(snapshot(doc));
    });
  });
});

describe('TC-09 one damaged log row', () => {
  it('a damaged row is quarantined verbatim; load continues; all other notes present', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);
    expect(updates.length).toBe(53);
    const sourceTopId = snapshot(doc).reduce((a, b) => (a.z > b.z ? a : b)).id;

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      // Row 53 (the last update: the final stacking z-set). Damaging an
      // earlier row would silently drop every later note (Yjs item-chain
      // integration), so the design's "exactly one row lost, all other
      // notes present" capability is exercised on the last row. The damage
      // is same-length scrambling: truncation of a multi-message Yjs update
      // is applied partially (complete prefix messages land before the
      // throw), while a same-length scramble is rejected wholesale.
      const corrupted = scrambleUpdate(updates[52]);
      sql.exec('UPDATE updates SET data = ? WHERE seq = 53', corrupted);

      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 1 });

      expect(rowCount(sql, 'quarantined_updates')).toBe(1);
      const quarantined = sql.exec('SELECT seq, data, error FROM quarantined_updates').one();
      expect(quarantined.seq).toBe(53);
      expect(Array.from(asBytes(quarantined.data))).toEqual(Array.from(corrupted));
      expect(String(quarantined.error).length).toBeGreaterThan(0);
      expect(rowCount(sql, 'updates')).toBe(52);

      // All 25 notes are present; only the final z-set is missing. Note ids
      // are stable through load (they live in the stored bytes).
      const notes = snapshot(fresh);
      expect(notes).toHaveLength(25);
      const original = snapshot(doc);
      const zOfLoaded = (id: string) => notes.find((n) => n.id === id)?.z;
      for (const n of original) {
        const loaded = notes.find((m) => m.id === n.id);
        expect(loaded).toBeDefined();
        // Every note except the top of the stacked trio is byte-identical.
        if (n.id !== sourceTopId) {
          expect(loaded).toEqual(n);
        }
      }
      // The trio's top note kept its creation z (the z-set row was quarantined).
      expect(zOfLoaded(sourceTopId)).toBe(25);
    });
  });
});

describe('TC-10 damaged snapshot', () => {
  it('a corrupted chunk yields snapshot-unreadable and deletes/quarantines nothing', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      const collector = new UpdateCollector(doc);
      const firstId = snapshot(doc)[0].id;
      for (let i = 0; rowCount(sql, 'updates') < COMPACTION_UPDATE_COUNT; i += 1) {
        moveObject(doc, firstId, 10_000 + i, 20_000 + i);
        appendAll(store, collector.take());
      }
      expect(store.compactIfNeeded(doc)).toBe(true); // small board: one chunk
      expect(rowCount(sql, 'snapshot_chunks')).toBe(1);
      const through = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .one();

      const chunk = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
      const corrupted = scrambleUpdate(asBytes(chunk.data));
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', corrupted);

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('snapshot-unreadable');
        expect(result.error.length).toBeGreaterThan(0);
      }
      // Nothing was deleted or quarantined.
      expect(rowCount(sql, 'updates')).toBe(0);
      expect(rowCount(sql, 'quarantined_updates')).toBe(0);
      expect(rowCount(sql, 'snapshot_chunks')).toBe(1);
      expect(
        sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq').one(),
      ).toEqual(through);
    });
  });
});

describe('TC-11 SQL failure during compaction', () => {
  it('a failing statement rolls the transaction back; previous snapshot and log survive', async () => {
    const { doc, updates } = buildAndCollect(buildRetroBoard);

    await inBoard(newBoardId(), (store, sql) => {
      appendAll(store, updates);
      const collector = new UpdateCollector(doc);
      const firstId = snapshot(doc)[0].id;
      for (let i = 0; rowCount(sql, 'updates') < COMPACTION_UPDATE_COUNT; i += 1) {
        moveObject(doc, firstId, 10_000 + i, 20_000 + i);
        appendAll(store, collector.take());
      }
      expect(store.compactIfNeeded(doc)).toBe(true); // snapshot v1
      const v1Chunks = rowCount(sql, 'snapshot_chunks');
      const v1Through = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .one().value;

      // Grow the log to the threshold again…
      for (let i = 0; rowCount(sql, 'updates') < COMPACTION_UPDATE_COUNT; i += 1) {
        moveObject(doc, firstId, 30_000 + i, 40_000 + i);
        appendAll(store, collector.take());
      }
      expect(rowCount(sql, 'updates')).toBe(COMPACTION_UPDATE_COUNT);

      // …and make the first statement after DELETE snapshot_chunks fail
      // once (one-shot, so the verification load afterwards is unaffected).
      const realSql = store.storage.sql;
      let afterDelete = false;
      let threw = false;
      store.storage.sql = {
        exec: (query: string, ...bindings: unknown[]) => {
          if (!threw && afterDelete) {
            threw = true;
            throw new Error('injected compaction failure');
          }
          if (query.includes('DELETE FROM snapshot_chunks')) {
            afterDelete = true;
          }
          return realSql.exec(query, ...bindings);
        },
        databaseSize: 0,
      };
      expect(store.compactIfNeeded(doc)).toBe(false);

      // The transaction rolled back: v1 snapshot and the full log are intact.
      expect(rowCount(sql, 'snapshot_chunks')).toBe(v1Chunks);
      expect(
        sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq').one(),
      ).toEqual({ value: v1Through });
      expect(rowCount(sql, 'updates')).toBe(COMPACTION_UPDATE_COUNT);

      // The board still loads (v1 snapshot + the 500-row log = full state).
      const fresh = new Y.Doc();
      expect(store.load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh)).toEqual(snapshot(doc));
    });
  });
});

describe('TC-25 never-edited board', () => {
  it('opening a board stores zero rows (tables only)', async () => {
    await inBoard(newBoardId(), (_store, sql) => {
      expect(rowCount(sql, 'updates')).toBe(0);
      expect(rowCount(sql, 'snapshot_chunks')).toBe(0);
      expect(rowCount(sql, 'quarantined_updates')).toBe(0);
    });
  });
});
