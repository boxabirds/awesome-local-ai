/**
 * Integration tests for persist.board_store: the real BoardStore against
 * real Durable Object SQLite inside a real Durable Object (workerd). No
 * mocks; each test uses a fresh board id (fresh object, fresh database).
 *
 * Covers TC-03 to TC-11 and TC-25.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore, type BoardStorage } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import {
  largeBoardPosition,
  makeRetroBoardDoc,
  mulberry32,
  nextUpdate,
  phrase,
  randomBytesOfLength,
} from '../fixtures/boards';

const ALL_COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** One row of a query, or undefined when the query returned no rows. */
function one(storage: BoardStorage, query: string, ...bindings: unknown[]): any {
  return storage.sql.exec(query, ...bindings).toArray()[0];
}

/** Run `fn` against a fresh board's storage inside a real Durable Object. */
async function withStore<T>(
  fn: (store: BoardStore, storage: BoardStorage) => T | Promise<T>,
): Promise<T> {
  const boardId = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) => {
    const storage = room.rawStorage as unknown as BoardStorage;
    const store = new BoardStore(storage);
    store.migrate();
    return fn(store, storage);
  });
}

function count(storage: BoardStorage, table: string): number {
  return (one(storage, `SELECT COUNT(*) AS c FROM ${table}`) as { c: number }).c;
}

/**
 * Build a 25-note board with exactly COMPACTION_UPDATE_COUNT log rows
 * (25 single-note updates + filler text edits) and compact it.
 */
function buildCompactedBoard(
  store: BoardStore,
  storage: BoardStorage,
): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    store.append(
      nextUpdate(doc, () => {
        // The first update carries the base schema (objects map creation);
        // without it Yjs drops the map-set items on a fresh doc.
        if (i === 0) initDoc(doc);
        const id = createSticky(doc, { x: i * 40, y: 0 }, ALL_COLORS[i % ALL_COLORS.length]);
        ids.push(id);
        getStickyText(doc, id)!.insert(0, `note ${i}`);
      }),
    );
  }
  for (let i = 0; i < COMPACTION_UPDATE_COUNT - 25; i++) {
    store.append(nextUpdate(doc, () => getStickyText(doc, ids[i % 25])!.insert(0, 'x')));
  }
  expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
  expect(store.compactIfNeeded(doc)).toBe(true);
  expect(count(storage, 'updates')).toBe(0);
  return { doc, ids };
}

describe('persist.board_store (real Durable Object SQLite)', () => {
  it('TC-03: migrate + load on an empty board → tables exist, doc empty, schema version set', () =>
    withStore((store, storage) => {
      const tables = storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray() as Array<{ name: string }>;
      for (const t of [
        'storage_meta',
        'updates',
        'snapshot_chunks',
        'quarantined_updates',
      ]) {
        expect(tables.map((r) => r.name), t).toContain(t);
      }
      const version = one(storage, 'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version') as {
        value: string;
      };
      expect(version.value).toBe(String(STORAGE_SCHEMA_VERSION));

      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(0);
    }));

  it('TC-04: append one update → 1 row, bytes column equals length', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 1, y: 1 });
      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);
      expect(count(storage, 'updates')).toBe(1);
      const row = one(storage, 'SELECT bytes FROM updates ORDER BY seq') as { bytes: number };
      expect(row.bytes).toBe(update.length);
    }));

  it('TC-05: LogOnly 25 notes → load into fresh doc equals original snapshot', () =>
    withStore((store) => {
      const original = makeRetroBoardDoc();
      const bytes = Y.encodeStateAsUpdate(original);
      store.append(bytes);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(Array.from(Y.encodeStateAsUpdate(reloaded))).toEqual(Array.from(bytes));
      expect(snapshot(reloaded)).toHaveLength(25);
    }));

  it('TC-06: at COMPACTION_UPDATE_COUNT rows → compact: log 0, chunks ≥ 1, through_seq = max seq, reload equal', () =>
    withStore((store, storage) => {
      const { doc } = buildCompactedBoard(store, storage);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      const through = one(storage, 'SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq') as {
        value: string;
      };
      expect(Number(through.value)).toBe(COMPACTION_UPDATE_COUNT);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(Array.from(Y.encodeStateAsUpdate(reloaded))).toEqual(
        Array.from(Y.encodeStateAsUpdate(doc)),
      );
    }));

  it('TC-07: SnapshotPlusLog: 3 updates after compaction → reload has all; only seq > through_seq applied', () =>
    withStore((store, storage) => {
      const { doc, ids } = buildCompactedBoard(store, storage);
      for (let i = 0; i < 3; i++) {
        store.append(nextUpdate(doc, () => getStickyText(doc, ids[i])!.insert(0, `+${i}`)));
      }
      expect(count(storage, 'updates')).toBe(3);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(Array.from(Y.encodeStateAsUpdate(reloaded))).toEqual(
        Array.from(Y.encodeStateAsUpdate(doc)),
      );
    }));

  it('TC-08: PERSIST_TESTED_NOTES board → compaction produces multiple chunks; reload equal', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      const rng = mulberry32(42);
      const perBatch = PERSIST_TESTED_NOTES / COMPACTION_UPDATE_COUNT; // 4
      for (let b = 0; b < COMPACTION_UPDATE_COUNT; b++) {
        store.append(
          nextUpdate(doc, () => {
            if (b === 0) initDoc(doc);
            for (let k = 0; k < perBatch; k++) {
              const i = b * perBatch + k;
              const id = createSticky(doc, largeBoardPosition(i), ALL_COLORS[i % ALL_COLORS.length]);
              getStickyText(doc, id)!.insert(0, phrase(rng));
            }
          }),
        );
      }
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);

      const full = Y.encodeStateAsUpdate(doc);
      expect(full.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThan(1);
      expect(count(storage, 'updates')).toBe(0);

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(Array.from(Y.encodeStateAsUpdate(reloaded))).toEqual(Array.from(full));
      expect(snapshot(reloaded)).toHaveLength(PERSIST_TESTED_NOTES);
    }), 120000);

  it('TC-09: one damaged log row → quarantined with error text; all other notes present', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        store.append(
          nextUpdate(doc, () => {
            if (i === 0) initDoc(doc);
            const id = createSticky(doc, { x: i * 40, y: 0 }, ALL_COLORS[i % ALL_COLORS.length]);
            ids.push(id);
            getStickyText(doc, id)!.insert(0, `note ${i}`);
          }),
        );
      }

      // Damage row 7: replace its bytes with garbage so applyUpdate throws.
      const row7 = one(storage, 'SELECT data FROM updates WHERE seq = 7') as {
        data: ArrayBuffer;
      };
      const damaged = randomBytesOfLength(new Uint8Array(row7.data).length, 7);
      storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged, 7).toArray();

      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 1 });
      expect(count(storage, 'updates')).toBe(24);
      expect(count(storage, 'quarantined_updates')).toBe(1);
      const q = one(storage, 'SELECT seq, error, quarantined_at FROM quarantined_updates') as {
        seq: number;
        error: string;
        quarantined_at: number;
      };
      expect(q.seq).toBe(7);
      expect(q.error.length).toBeGreaterThan(0);
      expect(q.quarantined_at).toBeGreaterThan(0);

      // persist.partial_damage: the damaged row is quarantined and every
      // other saved change is intact. (Each log row is self-contained, so
      // the changes of row 7 itself survive in the later rows — the board
      // opens fully, which satisfies "all other saved content intact.")
      const notes = snapshot(reloaded);
      expect(notes).toHaveLength(25);
      for (const id of ids) {
        expect(notes.find((n) => n.id === id), id).toBeTruthy();
      }
    }));

  it('TC-10: damaged snapshot → ok:false reason snapshot-unreadable; nothing deleted or quarantined', () =>
    withStore((store, storage) => {
      const doc = makeRetroBoardDoc();
      store.append(Y.encodeStateAsUpdate(doc));
      store.compact(doc);
      expect(count(storage, 'snapshot_chunks')).toBe(1);

      const chunk = one(storage, 'SELECT data FROM snapshot_chunks WHERE idx = 0') as {
        data: ArrayBuffer;
      };
      const damaged = randomBytesOfLength(new Uint8Array(chunk.data).length);
      storage.sql
        .exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', damaged, 0)
        .toArray();

      const reloaded = new Y.Doc();
      const result = store.load(reloaded);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('snapshot-unreadable');
        expect(result.error.length).toBeGreaterThan(0);
      }
      // Negative: the failed load must not delete or quarantine anything.
      expect(count(storage, 'snapshot_chunks')).toBe(1);
      expect(count(storage, 'quarantined_updates')).toBe(0);
      expect(count(storage, 'updates')).toBe(0);
      const after = one(storage, 'SELECT data FROM snapshot_chunks WHERE idx = 0') as {
        data: ArrayBuffer;
      };
      expect(Array.from(new Uint8Array(after.data))).toEqual(Array.from(damaged));
    }));

  it('TC-11: compaction failure after chunk delete → rollback: previous chunks and log intact; returns false', () =>
    withStore((store, storage) => {
      const doc = makeRetroBoardDoc();
      store.append(Y.encodeStateAsUpdate(doc));
      store.compact(doc);
      const originalChunk = one(storage, 'SELECT data FROM snapshot_chunks WHERE idx = 0') as {
        data: ArrayBuffer;
      };

      // 10 more log updates.
      const firstNote = snapshot(doc)[0].id;
      for (let i = 0; i < 10; i++) {
        store.append(nextUpdate(doc, () => getStickyText(doc, firstNote)!.insert(0, 'x')));
      }
      expect(count(storage, 'updates')).toBe(10);

      // Inject a throw right after the DELETE FROM snapshot_chunks runs.
      let armed = true;
      const failingStorage: BoardStorage = {
        sql: {
          exec: (q: string, ...bindings: unknown[]) => {
            if (armed && q.includes('DELETE FROM snapshot_chunks')) {
              armed = false;
              storage.sql.exec(q, ...bindings).toArray();
              throw new Error('injected compaction failure');
            }
            return storage.sql.exec(q, ...bindings);
          },
        },
        transactionSync: (fn: () => void) => storage.transactionSync(fn),
      };
      const failingStore = new BoardStore(failingStorage);
      expect(failingStore.compact(doc)).toBe(false);

      // The transaction rolled back: previous chunk and log are intact.
      const after = one(storage, 'SELECT data FROM snapshot_chunks WHERE idx = 0') as {
        data: ArrayBuffer;
      };
      expect(Array.from(new Uint8Array(after.data))).toEqual(
        Array.from(new Uint8Array(originalChunk.data)),
      );
      expect(count(storage, 'snapshot_chunks')).toBe(1);
      expect(count(storage, 'updates')).toBe(10);

      // The real store is unaffected and the board reloads fully.
      const reloaded = new Y.Doc();
      expect(store.load(reloaded)).toEqual({ ok: true, quarantined: 0 });
      expect(Array.from(Y.encodeStateAsUpdate(reloaded))).toEqual(
        Array.from(Y.encodeStateAsUpdate(doc)),
      );
    }));

  it('TC-25: a never-edited board has zero update and snapshot rows (only tables)', () =>
    withStore((_store, storage) => {
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    }));
});
