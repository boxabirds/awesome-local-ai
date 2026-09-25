// persist.board_store against the real SQLite storage of a real Durable Object (one fresh object per test).
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, type BoardStorage } from '../../src/worker/board-store';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, moveObject, setStickyColor, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { largeBoard, randomBytesLike, recordBoard, retroBoard, truncatedBytes } from '../fixtures/boards';

/** Runs `fn` inside a fresh board's Durable Object with its real storage. */
function withStorage<T>(fn: (storage: DurableObjectStorage) => T | Promise<T>): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_room, state) => fn(state.storage));
}

function rows(storage: DurableObjectStorage, query: string, ...bindings: unknown[]): Record<string, SqlStorageValue>[] {
  return storage.sql.exec(query, ...bindings).toArray();
}

function count(storage: DurableObjectStorage, table: string): number {
  return Number(rows(storage, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);
}

function meta(storage: DurableObjectStorage, key: string): string | undefined {
  return rows(storage, 'SELECT value FROM storage_meta WHERE key = ?', key)[0]?.value as string | undefined;
}

function tables(storage: DurableObjectStorage): string[] {
  return rows(storage, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => String(r.name));
}

/** A fresh doc loaded from `storage` by a fresh store (as after a restart). */
function reload(storage: BoardStorage) {
  const doc = new Y.Doc();
  const store = new BoardStore(storage);
  store.migrate();
  const result = store.load(doc);
  return { doc, store, result };
}

function appendAll(store: BoardStore, updates: Uint8Array[]): void {
  for (const u of updates) store.append(u);
}

/** The 25-note retro board plus enough small moves to fill the log to exactly COMPACTION_UPDATE_COUNT rows. */
function fullLogBoard() {
  const board = retroBoard();
  const ids = snapshot(board.doc).map((n) => n.id);
  const extra = recordBoard((d) => {
    let i = 0;
    while (board.updates.length + i < COMPACTION_UPDATE_COUNT) {
      moveObject(d, ids[i % ids.length], i * 3, -i * 2);
      i++;
    }
  }, board.doc);
  return { doc: board.doc, updates: [...board.updates, ...extra.updates] };
}

describe('persist.board_store', () => {
  it('TC-03 migrate + load on empty storage: tables exist, doc empty, schema version recorded', async () => {
    await withStorage((storage) => {
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(tables(storage)).toEqual(expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']));
      expect(snapshot(doc)).toEqual([]);
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-25 migrating a never-edited board writes no update or snapshot rows', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.migrate(); // idempotent
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-04 append stores one row whose bytes column equals the update length', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const { updates } = recordBoard((d) => createSticky(d, { x: 0, y: 0 }));
      const update = Y.mergeUpdates(updates);
      expect(count(storage, 'updates')).toBe(0);
      store.append(update);
      const stored = rows(storage, 'SELECT data, bytes FROM updates');
      expect(stored).toHaveLength(1);
      expect(Number(stored[0].bytes)).toBe(update.length);
      expect([...new Uint8Array(stored[0].data as ArrayBuffer)]).toEqual([...update]);
    });
  });

  it('TC-05 a 25-note log reloads into a fresh doc identical to the original', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(25);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });

  it('TC-06 at COMPACTION_UPDATE_COUNT rows compaction folds the log into the snapshot', async () => {
    const board = fullLogBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates.slice(0, -1));
      expect(store.compactIfNeeded(board.doc)).toBe(false); // one row short
      store.append(board.updates.at(-1)!);
      const maxSeq = Number(rows(storage, 'SELECT MAX(seq) AS m FROM updates')[0].m);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(count(storage, 'snapshot_chunks')).toBe(0);

      expect(store.compactIfNeeded(board.doc)).toBe(true);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(maxSeq));
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });

  it('TC-07 after compaction, newer log rows are applied on top of the snapshot', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates);
      expect(store.compact(board.doc)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));
      const ids = snapshot(board.doc).map((n) => n.id);
      const more = recordBoard((d) => {
        moveObject(d, ids[0], 5000, 5000);
        setStickyColor(d, ids[1], 'violet');
        createSticky(d, { x: -900, y: 900 }, 'blue');
      }, board.doc);
      expect(more.updates).toHaveLength(3);
      appendAll(store, more.updates);
      const seqs = rows(storage, 'SELECT seq FROM updates ORDER BY seq').map((r) => Number(r.seq));
      expect(seqs).toHaveLength(3);
      expect(seqs.every((s) => s > through)).toBe(true);

      const { doc } = reload(storage);
      expect(snapshot(doc)).toHaveLength(26);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });

  it('TC-07 rows at or below snapshot_through_seq are not replayed', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates);
      store.compact(board.doc);
      // A stale row with a seq the snapshot already covers (would recreate a note if replayed).
      const stale = recordBoard((d) => createSticky(d, { x: 1, y: 1 })).updates;
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (1, ?, ?)', Y.mergeUpdates(stale), 1);
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });

  it(`TC-08 a ${PERSIST_TESTED_NOTES}-note board compacts into several chunks and reloads identical`, async () => {
    const board = largeBoard();
    const encoded = Y.encodeStateAsUpdate(board.doc).length;
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.append(Y.mergeUpdates(board.updates));
      expect(store.compact(board.doc)).toBe(true);
      const chunks = count(storage, 'snapshot_chunks');
      expect(chunks).toBe(Math.ceil(encoded / SNAPSHOT_CHUNK_BYTES));
      if (encoded > SNAPSHOT_CHUNK_BYTES) expect(chunks).toBeGreaterThan(1);
      const { doc, result } = reload(storage);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });

  it.each([
    ['truncated', truncatedBytes],
    ['random', (u: Uint8Array) => randomBytesLike(u, 11)],
  ])('TC-09 a damaged (%s) log row is quarantined and everything else loads', async (_kind, damage) => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates);
      const original = rows(storage, 'SELECT data FROM updates WHERE seq = 7')[0].data as ArrayBuffer;
      const bad = damage(new Uint8Array(original));
      storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', bad);
      const before = count(storage, 'updates');

      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 1 });
      expect(count(storage, 'updates')).toBe(before - 1);
      const q = rows(storage, 'SELECT seq, data, error, quarantined_at FROM quarantined_updates');
      expect(q).toHaveLength(1);
      expect(Number(q[0].seq)).toBe(7);
      expect([...new Uint8Array(q[0].data as ArrayBuffer)]).toEqual([...bad]);
      expect(String(q[0].error)).not.toBe('');
      expect(Number(q[0].quarantined_at)).toBeGreaterThan(0);

      // Row 7 is one note's text edit: every note is there, and all but at most that one are identical.
      const loaded = snapshot(doc);
      const expected = snapshot(board.doc);
      expect(loaded.map((n) => n.id).sort()).toEqual(expected.map((n) => n.id).sort());
      const differing = expected.filter((n) => JSON.stringify(loaded.find((l) => l.id === n.id)) !== JSON.stringify(n));
      expect(differing.length).toBeLessThanOrEqual(1);
    });
  });

  it.each([
    ['truncated', truncatedBytes],
    ['random', (u: Uint8Array) => randomBytesLike(u, 3)],
  ])('TC-10 a damaged (%s) snapshot fails the load and nothing is deleted or quarantined', async (_kind, damage) => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates);
      store.compact(board.doc);
      const extra = recordBoard((d) => createSticky(d, { x: 0, y: 900 }), board.doc).updates;
      appendAll(store, extra);
      const chunk0 = new Uint8Array(rows(storage, 'SELECT data FROM snapshot_chunks WHERE idx = 0')[0].data as ArrayBuffer);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damage(chunk0));
      const before = { updates: count(storage, 'updates'), chunks: count(storage, 'snapshot_chunks') };

      const { doc, result } = reload(storage);
      expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
      expect(snapshot(doc)).toEqual([]);
      expect(count(storage, 'updates')).toBe(before.updates);
      expect(count(storage, 'snapshot_chunks')).toBe(before.chunks);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11 a statement failing mid-compaction rolls back: previous snapshot and log unchanged', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board.updates.slice(0, 30));
      store.compact(board.doc);
      appendAll(store, board.updates.slice(30));
      const chunksBefore = rows(storage, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx').map((r) => [...new Uint8Array(r.data as ArrayBuffer)]);
      const logBefore = rows(storage, 'SELECT seq, bytes FROM updates ORDER BY seq');
      const throughBefore = meta(storage, 'snapshot_through_seq');

      // Real SQLite, with the first chunk insert (after the DELETE of the old chunks) made to fail.
      let deleted = false;
      const failing: BoardStorage = {
        transactionSync: (fn) => storage.transactionSync(fn),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.startsWith('DELETE FROM snapshot_chunks')) deleted = true;
            else if (deleted && query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected failure');
            return storage.sql.exec(query, ...bindings);
          },
        },
      };
      const broken = new BoardStore(failing);
      expect(broken.compact(board.doc)).toBe(false);
      expect(deleted).toBe(true);

      const chunksAfter = rows(storage, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx').map((r) => [...new Uint8Array(r.data as ArrayBuffer)]);
      expect(chunksAfter).toEqual(chunksBefore);
      expect(rows(storage, 'SELECT seq, bytes FROM updates ORDER BY seq')).toEqual(logBefore);
      expect(meta(storage, 'snapshot_through_seq')).toBe(throughBefore);
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
  });
});
