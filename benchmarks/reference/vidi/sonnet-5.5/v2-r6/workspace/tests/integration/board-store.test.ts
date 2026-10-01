import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT, PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { bigBoard, retroBoard, truncated } from '../fixtures/boards';

type Ns = { BOARD_ROOM: DurableObjectNamespace<BoardRoom> };

/** Runs `fn` with a BoardStore over a brand-new, isolated Durable Object storage. */
async function withStore<T>(fn: (store: BoardStore, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> {
  const ns = (env as unknown as Ns).BOARD_ROOM;
  const stub = ns.get(ns.idFromName(newBoardId()));
  return runInDurableObject(stub, (_i, state) => fn(new BoardStore(state.storage), state.storage));
}

const count = (storage: DurableObjectStorage, table: string): number =>
  Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
const reloaded = (store: BoardStore) => {
  const doc = new Y.Doc();
  const result = store.load(doc);
  return { doc, result };
};

describe('BoardStore', () => {
  it('TC-03: empty board migrates and loads an empty doc', async () => {
    await withStore((store, storage) => {
      const { doc, result } = reloaded(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual([]);
      const v = storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'").one().value;
      expect(v).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-04: append stores one row with its byte length', async () => {
    await withStore((store, storage) => {
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      const doc = new Y.Doc();
      doc.getMap('objects').set('a', 1);
      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);
      expect(count(storage, 'updates')).toBe(1);
      expect(Number(storage.sql.exec('SELECT bytes FROM updates').one().bytes)).toBe(update.length);
    });
  });

  it('TC-05: log-only board reloads identically', async () => {
    await withStore((store) => {
      const { doc, updates } = retroBoard();
      store.migrate();
      updates.forEach((u) => store.append(u));
      const { doc: loaded, result } = reloaded(store);
      expect(result.ok).toBe(true);
      expect(snapshot(loaded)).toEqual(snapshot(doc));
      expect(snapshot(loaded)).toHaveLength(25);
    });
  });

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT rows empties the log into a snapshot', async () => {
    await withStore((store, storage) => {
      const { doc, updates } = retroBoard();
      store.migrate();
      updates.forEach((u) => store.append(u));
      const filler = new Y.Doc();
      // Pad the log to the threshold with real (empty-effect) updates.
      for (let i = updates.length; i < COMPACTION_UPDATE_COUNT - 1; i++) store.append(Y.encodeStateAsUpdate(filler));
      expect(store.compactIfNeeded(doc)).toBe(false);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
      store.append(Y.encodeStateAsUpdate(filler));
      const max = Number(storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value).toBe(String(max));
      expect(snapshot(reloaded(store).doc)).toEqual(snapshot(doc));
    });
  });

  it('TC-07: only rows after snapshot_through_seq are applied on top of the snapshot', async () => {
    await withStore((store, storage) => {
      const { doc, updates } = retroBoard();
      store.migrate();
      updates.forEach((u) => store.append(u));
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      // A stale row at/below through_seq must be ignored.
      const through = Number(storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value);
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, 0)', through, new Uint8Array([1, 2, 3]));
      const more = new Y.Doc();
      Y.applyUpdate(more, Y.encodeStateAsUpdate(doc));
      const extra: Uint8Array[] = [];
      more.on('update', (u: Uint8Array) => extra.push(u));
      const objects = more.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const ids = [...objects.keys()].slice(0, 3);
      ids.forEach((id, i) => objects.get(id)!.set('x', 9000 + i));
      extra.forEach((u) => store.append(u));
      const { doc: loaded, result } = reloaded(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toEqual(snapshot(more));
      expect(snapshot(loaded).filter((n) => n.x >= 9000)).toHaveLength(3);
    });
  });

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into several chunks and reloads equal', async () => {
    await withStore((store, storage) => {
      const { doc, updates } = bigBoard();
      store.migrate();
      updates.forEach((u) => store.append(u));
      expect(Y.encodeStateAsUpdate(doc).length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThan(1);
      const { doc: loaded } = reloaded(store);
      expect(snapshot(loaded)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snapshot(loaded)).toEqual(snapshot(doc));
    });
  });

  it('TC-09: a damaged log row is quarantined and every other note still loads', async () => {
    await withStore((store, storage) => {
      // One note per update, each from a different client, as in real use (a damaged change from
      // one client stalls that client's later changes, so the damage is isolated to one client).
      const merged = new Y.Doc();
      store.migrate();
      for (let i = 0; i < 25; i++) {
        const client = new Y.Doc();
        Y.applyUpdate(client, Y.encodeStateAsUpdate(merged));
        let update: Uint8Array | null = null;
        client.on('update', (u: Uint8Array) => { update = u; });
        createSticky(client, { x: i * 10, y: i * 10 });
        Y.applyUpdate(merged, update!);
        store.append(update!);
      }
      const rows = storage.sql.exec('SELECT seq, data FROM updates ORDER BY seq').toArray();
      const seq = Number(rows[7].seq);
      storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', truncated(new Uint8Array(rows[7].data as ArrayBuffer)), seq);
      const { doc: loaded, result } = reloaded(store);
      expect(result).toEqual({ ok: true, quarantined: 1 });
      expect(count(storage, 'updates')).toBe(24);
      const q = storage.sql.exec('SELECT seq, error FROM quarantined_updates').one();
      expect(Number(q.seq)).toBe(seq);
      expect(String(q.error).length).toBeGreaterThan(0);
      expect(snapshot(loaded)).toHaveLength(24);
    });
  });

  it('TC-10: a corrupt snapshot chunk fails the load without deleting or quarantining anything', async () => {
    await withStore((store, storage) => {
      const { doc, updates } = retroBoard();
      store.migrate();
      updates.forEach((u) => store.append(u));
      store.compactIfNeeded(doc, true);
      store.append(Y.encodeStateAsUpdate(new Y.Doc()));
      const chunk = new Uint8Array(storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
      const chunksBefore = count(storage, 'snapshot_chunks');
      const updatesBefore = count(storage, 'updates');
      const { doc: loaded, result } = reloaded(store);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');
      expect(snapshot(loaded)).toEqual([]);
      expect(count(storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(count(storage, 'updates')).toBe(updatesBefore);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11: a failure during compaction rolls everything back', async () => {
    const ns = (env as unknown as Ns).BOARD_ROOM;
    const stub = ns.get(ns.idFromName(newBoardId()));
    await runInDurableObject(stub, (_i, state) => {
      const { doc, updates } = retroBoard();
      const good = new BoardStore(state.storage);
      good.migrate();
      updates.forEach((u) => good.append(u));
      expect(good.compactIfNeeded(doc, true)).toBe(true);
      const more = Y.encodeStateAsUpdate(new Y.Doc());
      good.append(more);
      const chunksBefore = state.storage.sql.exec('SELECT idx, data FROM snapshot_chunks').toArray().length;
      const rowsBefore = count(state.storage, 'updates');
      const through = state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value;

      // Storage whose snapshot_chunks INSERT throws, after the DELETE already ran.
      const sql = state.storage.sql;
      const failing = {
        transactionSync: <R>(fn: () => R) => state.storage.transactionSync(fn),
        sql: {
          exec: (q: string, ...b: unknown[]) => {
            if (q.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected');
            return sql.exec(q, ...(b as never[]));
          },
        },
      } as unknown as DurableObjectStorage;
      const bad = new BoardStore(failing);
      expect(bad.compactIfNeeded(doc, true)).toBe(false);
      expect(count(state.storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(count(state.storage, 'updates')).toBe(rowsBefore);
      expect(state.storage.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").one().value).toBe(through);
      expect(snapshot(reloaded(good).doc)).toEqual(snapshot(doc));
    });
  });

  it('TC-25: migrating a never-edited board writes no update or snapshot rows', async () => {
    await withStore((store, storage) => {
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
    });
  });
});
