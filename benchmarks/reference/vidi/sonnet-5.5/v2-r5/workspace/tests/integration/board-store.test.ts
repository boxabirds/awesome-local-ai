import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { LOCAL_ORIGIN, createSticky, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT, PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import {
  build25NoteBoard, buildLargeBoard, randomBytes, recordUpdates, truncated,
} from '../fixtures/boards';

/** Runs `fn` against a fresh BoardStore over the real SQLite storage of a brand-new Durable Object. */
async function withStore<T>(fn: (store: BoardStore, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, async (_instance, state) => {
    // The room already created its tables; start from a clean slate so the store is tested alone.
    for (const t of ['updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta']) {
      state.storage.sql.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    return fn(new BoardStore(state.storage), state.storage);
  });
}

const count = (storage: DurableObjectStorage, table: string) =>
  Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
const meta = (storage: DurableObjectStorage, key: string) =>
  storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0]?.value as string | undefined;
const snap = (doc: Y.Doc) => JSON.stringify(snapshot(doc));

function loadFresh(store: BoardStore): { doc: Y.Doc; result: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  return { doc, result: store.load(doc) };
}

describe('BoardStore (persist.board_store)', () => {
  it('TC-03 migrate then load on an empty board', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual([]);
      for (const t of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
        expect(() => count(storage, t)).not.toThrow();
      }
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-04 append stores one row whose bytes column equals the length', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { updates } = recordUpdates((d) => { createSticky(d, { x: 1, y: 2 }); });
      expect(count(storage, 'updates')).toBe(0);
      store.append(updates[0]);
      expect(count(storage, 'updates')).toBe(1);
      expect(Number(storage.sql.exec('SELECT bytes FROM updates').one().bytes)).toBe(updates[0].length);
    });
  });

  it('TC-05 load of a log-only board equals the original', async () => {
    await withStore((store) => {
      store.migrate();
      const { doc, updates } = recordUpdates((d) => { build25NoteBoard(d); });
      updates.forEach((u) => store.append(u));
      const { doc: loaded, result } = loadFresh(store);
      expect(result.ok).toBe(true);
      expect(snapshot(loaded)).toHaveLength(25);
      expect(snap(loaded)).toBe(snap(doc));
    });
  });

  it('TC-06 compaction at COMPACTION_UPDATE_COUNT rows empties the log and keeps the board', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { doc, updates } = recordUpdates((d) => { build25NoteBoard(d); });
      // pad with real keystroke updates to exactly COMPACTION_UPDATE_COUNT rows
      const objects = doc.getMap('objects');
      const ytext = (objects.get([...objects.keys()][0]) as Y.Map<unknown>).get('text') as Y.Text;
      doc.on('update', (u: Uint8Array) => updates.push(u));
      while (updates.length < COMPACTION_UPDATE_COUNT) doc.transact(() => ytext.insert(0, 'x'), LOCAL_ORIGIN);
      updates.slice(0, COMPACTION_UPDATE_COUNT - 1).forEach((u) => store.append(u));
      expect(store.compactIfNeeded(doc)).toBe(false); // 499 rows
      store.append(updates[COMPACTION_UPDATE_COUNT - 1]);
      const maxSeq = Number(storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(maxSeq));
      expect(snap(loadFresh(store).doc)).toBe(snap(doc));
    });
  });

  it('TC-07 only rows after snapshot_through_seq are applied on load', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { doc, updates } = recordUpdates((d) => { build25NoteBoard(d); });
      updates.forEach((u) => store.append(u));
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      const throughSeq = Number(meta(storage, 'snapshot_through_seq'));
      doc.on('update', (u: Uint8Array) => store.append(u));
      for (let i = 0; i < 3; i += 1) createSticky(doc, { x: i, y: i });
      expect(count(storage, 'updates')).toBe(3);
      expect(Number(storage.sql.exec('SELECT MIN(seq) AS m FROM updates').one().m)).toBeGreaterThan(throughSeq);
      // A stale row at or below through_seq must be ignored (it is already inside the snapshot).
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', throughSeq, randomBytes(8), 8);
      const { doc: loaded, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toHaveLength(28);
      expect(snap(loaded)).toBe(snap(doc));
    });
  });

  it('TC-08 a PERSIST_TESTED_NOTES board compacts into several chunks and reloads equal', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const doc = buildLargeBoard(PERSIST_TESTED_NOTES);
      const encoded = Y.encodeStateAsUpdate(doc);
      expect(encoded.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      store.append(encoded);
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThan(1);
      const { doc: loaded } = loadFresh(store);
      expect(snapshot(loaded)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snap(loaded)).toBe(snap(doc));
    });
  });

  for (const [name, damage] of [['truncated', truncated], ['random bytes', (b: Uint8Array) => randomBytes(b.length)]] as const) {
    it(`TC-09 one damaged log row (${name}) is quarantined, the rest loads`, async () => {
      await withStore((store, storage) => {
        store.migrate();
        const { updates } = recordUpdates((d) => { build25NoteBoard(d); });
        updates.forEach((u) => store.append(u));
        const rows = storage.sql.exec('SELECT seq, data FROM updates ORDER BY seq').toArray();
        const target = rows[6];
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damage(new Uint8Array(target.data as ArrayBuffer)), target.seq);
        const before = count(storage, 'updates');
        const { doc, result } = loadFresh(store);
        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(count(storage, 'updates')).toBe(before - 1);
        const q = storage.sql.exec('SELECT seq, error FROM quarantined_updates').toArray();
        expect(q).toHaveLength(1);
        expect(q[0].seq).toBe(target.seq);
        expect(String(q[0].error).length).toBeGreaterThan(0);
        expect(snapshot(doc).length).toBeGreaterThan(0);
      });
    });
  }

  it('TC-10 a damaged snapshot is reported and nothing is deleted or quarantined', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { doc, updates } = recordUpdates((d) => { build25NoteBoard(d); });
      updates.forEach((u) => store.append(u));
      store.compactIfNeeded(doc, true);
      store.append(Y.encodeStateAsUpdate(doc)); // a log row after the snapshot
      const chunk = new Uint8Array(storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
      const chunksBefore = count(storage, 'snapshot_chunks');
      const rowsBefore = count(storage, 'updates');
      const result = new BoardStore(storage).load(new Y.Doc());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');
      expect(count(storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(count(storage, 'updates')).toBe(rowsBefore);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11 a failure inside compaction rolls back: snapshot and log are untouched', async () => {
    await withStore((store, storage) => {
      store.migrate();
      const { doc, updates } = recordUpdates((d) => { build25NoteBoard(d); });
      updates.slice(0, 10).forEach((u) => store.append(u));
      expect(store.compactIfNeeded(doc, true)).toBe(true); // a previous good snapshot
      updates.slice(10).forEach((u) => store.append(u));
      const chunksBefore = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray()
        .map((r) => [r.idx, [...new Uint8Array(r.data as ArrayBuffer)].join(',')]);
      const rowsBefore = count(storage, 'updates');
      const throughBefore = meta(storage, 'snapshot_through_seq');

      const failing = {
        transactionSync: <R>(fn: () => R) => storage.transactionSync(fn),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected failure after chunk delete');
            return storage.sql.exec(query, ...(bindings as never[]));
          },
        },
      } as unknown as DurableObjectStorage;
      const broken = new BoardStore(failing);
      expect(broken.compactIfNeeded(doc, true)).toBe(false);

      const chunksAfter = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray()
        .map((r) => [r.idx, [...new Uint8Array(r.data as ArrayBuffer)].join(',')]);
      expect(chunksAfter).toEqual(chunksBefore);
      expect(count(storage, 'updates')).toBe(rowsBefore);
      expect(meta(storage, 'snapshot_through_seq')).toBe(throughBefore);
      expect(snap(loadFresh(store).doc)).toBe(snap(doc));
    });
  });

  it('TC-25 migrating a never-edited board writes no update or snapshot rows', async () => {
    await withStore((store, storage) => {
      store.migrate();
      loadFresh(store);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
    });
  });
});
