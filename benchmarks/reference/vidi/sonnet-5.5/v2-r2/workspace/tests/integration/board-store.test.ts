import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT, PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import { largeBoard, randomBytesLike, recordUpdates, retroBoard, truncatedUpdate } from '../fixtures/boards';
import { inRoom, rowCount, snap } from './helpers/room';

/** Runs `fn` against a fresh BoardStore on a board's real Durable Object SQLite storage. */
function withStore<T>(fn: (store: BoardStore, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> {
  return inRoom(newBoardId(), (_room, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    return fn(store, state.storage);
  });
}

function retroUpdates(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc);
  retroBoard(doc);
  return { doc, updates };
}

function reload(storage: DurableObjectStorage): { doc: Y.Doc; result: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  const result = new BoardStore(storage).load(doc);
  return { doc, result };
}

describe('BoardStore', () => {
  it('TC-03: migrate then load on an empty board', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(0);
      const tables = storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name);
      for (const t of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) expect(tables).toContain(t);
      const v = storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'").one().value;
      expect(v).toBe(String(STORAGE_SCHEMA_VERSION));
    }));

  it('TC-04: append writes one row whose bytes column equals the length', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      const updates = recordUpdates(doc);
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      expect(rowCount(storage.sql, 'updates')).toBe(0);
      store.append(updates[0]);
      expect(rowCount(storage.sql, 'updates')).toBe(1);
      expect(Number(storage.sql.exec('SELECT bytes FROM updates').one().bytes)).toBe(updates[0].length);
    }));

  it('TC-05: 25 notes in the log load into an identical doc', () =>
    withStore((store, storage) => {
      const { doc, updates } = retroUpdates();
      updates.forEach((u) => store.append(u));
      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toHaveLength(25);
      expect(snap(loaded)).toBe(snap(doc));
    }));

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT rows empties the log into a snapshot', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      const updates = recordUpdates(doc);
      retroBoard(doc);
      const id = snapshot(doc)[0].id;
      const text = getStickyText(doc, id)!;
      while (updates.length < COMPACTION_UPDATE_COUNT) text.insert(text.length, 'x');
      updates.slice(0, COMPACTION_UPDATE_COUNT - 1).forEach((u) => store.append(u));
      expect(store.compactIfNeeded(doc)).toBe(false);
      expect(rowCount(storage.sql, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);

      store.append(updates[COMPACTION_UPDATE_COUNT - 1]);
      const maxSeq = Number(storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(rowCount(storage.sql, 'updates')).toBe(0);
      expect(rowCount(storage.sql, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      const through = storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value;
      expect(Number(through)).toBe(maxSeq);
      expect(snap(reload(storage).doc)).toBe(snap(doc));
    }));

  it('TC-07: updates after compaction are replayed on top of the snapshot only', () =>
    withStore((store, storage) => {
      const doc = new Y.Doc();
      const updates = recordUpdates(doc);
      retroBoard(doc);
      updates.forEach((u) => store.append(u));
      expect(store.compactNow(doc)).toBe(true);
      updates.length = 0;
      const id = snapshot(doc)[1].id;
      getStickyText(doc, id)!.insert(0, 'a');
      getStickyText(doc, id)!.insert(0, 'b');
      createSticky(doc, { x: 9, y: 9 });
      expect(updates).toHaveLength(3);
      updates.forEach((u) => store.append(u));
      expect(rowCount(storage.sql, 'updates')).toBe(3);
      const { doc: loaded } = reload(storage);
      expect(snap(loaded)).toBe(snap(doc));
      expect(snapshot(loaded)).toHaveLength(26);
    }));

  it('TC-08: a large board compacts into several chunks and reloads equal', () =>
    withStore((store, storage) => {
      const doc = largeBoard(PERSIST_TESTED_NOTES);
      expect(Y.encodeStateAsUpdate(doc).length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      expect(store.compactNow(doc)).toBe(true);
      expect(rowCount(storage.sql, 'snapshot_chunks')).toBeGreaterThan(1);
      const { doc: loaded, result } = reload(storage);
      expect(result.ok).toBe(true);
      expect(snapshot(loaded)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snap(loaded)).toBe(snap(doc));
    }));

  for (const [name, damage] of [['truncated', truncatedUpdate], ['random bytes', randomBytesLike]] as const) {
    it(`TC-09: one damaged log row (${name}) is quarantined and the rest loads`, () =>
      withStore((store, storage) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { updates } = retroUpdates();
        updates.forEach((u) => store.append(u));
        const total = rowCount(storage.sql, 'updates');
        const row7 = storage.sql.exec('SELECT seq FROM updates ORDER BY seq LIMIT 1 OFFSET 6').one().seq as number;
        const original = new Uint8Array(storage.sql.exec('SELECT data FROM updates WHERE seq = ?', row7).one().data as ArrayBuffer);
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damage(original), row7);

        const { doc: loaded, result } = reload(storage);
        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(rowCount(storage.sql, 'updates')).toBe(total - 1);
        const q = storage.sql.exec('SELECT seq, error FROM quarantined_updates').toArray();
        expect(q).toHaveLength(1);
        expect(q[0].seq).toBe(row7);
        expect(String(q[0].error).length).toBeGreaterThan(0);
        expect(snapshot(loaded).length).toBeGreaterThan(0);
      }));
  }

  it('TC-10: a corrupt snapshot chunk fails the load and deletes nothing', () =>
    withStore((store, storage) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { doc, updates } = retroUpdates();
      updates.forEach((u) => store.append(u));
      store.compactNow(doc);
      updates.length = 0;
      createSticky(doc, { x: 1, y: 1 });
      store.append(updates[0]);
      const chunk0 = new Uint8Array(storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(chunk0));
      const chunks = rowCount(storage.sql, 'snapshot_chunks');
      const rows = rowCount(storage.sql, 'updates');

      const { result } = reload(storage);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');
      expect(rowCount(storage.sql, 'snapshot_chunks')).toBe(chunks);
      expect(rowCount(storage.sql, 'updates')).toBe(rows);
      expect(rowCount(storage.sql, 'quarantined_updates')).toBe(0);
    }));

  it('TC-11: a failure during compaction rolls back snapshot and log', () =>
    withStore((store, storage) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { doc, updates } = retroUpdates();
      updates.forEach((u) => store.append(u));
      store.compactNow(doc);
      updates.length = 0;
      createSticky(doc, { x: 1, y: 1 });
      getStickyText(doc, snapshot(doc)[0].id)!.insert(0, 'z');
      updates.forEach((u) => store.append(u));
      const before = {
        chunks: storage.sql.exec('SELECT idx, data FROM snapshot_chunks').toArray().map((r) => [r.idx, new Uint8Array(r.data as ArrayBuffer)]),
        rows: rowCount(storage.sql, 'updates'),
        through: storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value,
      };

      // Fail right after the old chunks are deleted: wrap sql.exec on a proxy storage.
      const failing = {
        transactionSync: storage.transactionSync.bind(storage),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected failure');
            return storage.sql.exec(query, ...bindings);
          },
        },
      } as unknown as DurableObjectStorage;
      const failingStore = new BoardStore(failing);
      expect(failingStore.compactNow(doc)).toBe(false);

      expect(rowCount(storage.sql, 'updates')).toBe(before.rows);
      expect(storage.sql.exec('SELECT idx, data FROM snapshot_chunks').toArray().map((r) => [r.idx, new Uint8Array(r.data as ArrayBuffer)])).toEqual(before.chunks);
      expect(storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value).toBe(before.through);
      expect(snap(reload(storage).doc)).toBe(snap(doc));
    }));

  it('TC-25: opening a never-edited board creates tables but no rows', () =>
    withStore((_store, storage) => {
      expect(rowCount(storage.sql, 'updates')).toBe(0);
      expect(rowCount(storage.sql, 'snapshot_chunks')).toBe(0);
      expect(rowCount(storage.sql, 'quarantined_updates')).toBe(0);
    }));
});
