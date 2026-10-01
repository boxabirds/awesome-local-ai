import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, moveObject, snapshot } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import { largeBoard, randomBytesLike, recordUpdates, retroBoard, truncated } from '../fixtures/boards';


/** Runs `fn` inside a fresh Durable Object (isolated real SQLite storage) with a BoardStore over it. */
async function inRoom<T>(fn: (store: BoardStore, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, async (_instance, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    return fn(store, state.storage);
  });
}

const rows = (storage: DurableObjectStorage, table: string): number =>
  Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
const meta = (storage: DurableObjectStorage, key: string): string | undefined =>
  storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0]?.value as string | undefined;
const sorted = (doc: Y.Doc) => JSON.stringify([...snapshot(doc)].sort((a, b) => (a.id < b.id ? -1 : 1)));
const loaded = (store: BoardStore) => {
  const doc = new Y.Doc();
  const result = store.load(doc);
  return { doc, result };
};

/** A doc with 25 notes plus enough move updates that at least `total` updates were recorded. */
function boardWithRows(total: number) {
  return recordUpdates((doc) => {
    const ids = retroBoard(doc);
    let count = 0;
    doc.on('update', () => (count += 1));
    for (let i = 0; count < total; i++) moveObject(doc, ids[i % ids.length], 1000 + i, 2000 + i);
  });
}

describe('BoardStore', () => {
  it('TC-03: migrate + load on an empty board', async () => {
    await inRoom((store, storage) => {
      const { doc, result } = loaded(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(0);
      for (const table of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
        expect(rows(storage, table), table).toBeGreaterThanOrEqual(0);
      }
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-04: append writes one row whose bytes column equals the length', async () => {
    const { updates } = recordUpdates((d) => retroBoard(d, 1));
    await inRoom((store, storage) => {
      expect(rows(storage, 'updates')).toBe(0);
      store.append(updates[0]);
      expect(rows(storage, 'updates')).toBe(1);
      const row = storage.sql.exec('SELECT data, bytes FROM updates').one();
      expect(row.bytes).toBe(updates[0].length);
      expect((row.data as ArrayBuffer).byteLength).toBe(updates[0].length);
    });
  });

  it('TC-05: LogOnly load equals the original', async () => {
    const { doc: original, updates } = recordUpdates((d) => retroBoard(d));
    await inRoom((store) => {
      updates.forEach((u) => store.append(u));
      const { doc, result } = loaded(store);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toHaveLength(25);
      expect(sorted(doc)).toBe(sorted(original));
    });
  });

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT rows empties the log into a snapshot', async () => {
    const { updates: recorded } = boardWithRows(COMPACTION_UPDATE_COUNT);
    const updates = recorded.slice(0, COMPACTION_UPDATE_COUNT);
    const original = new Y.Doc();
    updates.forEach((u) => Y.applyUpdate(original, u));
    expect(updates.length).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    await inRoom((store, storage) => {
      updates.slice(0, COMPACTION_UPDATE_COUNT - 1).forEach((u) => store.append(u));
      expect(store.compactIfNeeded(original)).toBe(false); // one below the threshold
      expect(rows(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
      store.append(updates[COMPACTION_UPDATE_COUNT - 1]);
      const maxSeq = Number(storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);
      expect(rows(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(rows(storage, 'snapshot_chunks')).toBe(0);
      expect(store.compactIfNeeded(original)).toBe(true);
      expect(rows(storage, 'updates')).toBe(0);
      expect(rows(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(maxSeq));
  
      expect(sorted(loaded(store).doc)).toBe(sorted(original));
    });
  });

  it('TC-07: SnapshotPlusLog applies only rows after the snapshot', async () => {
    const { doc: original, updates } = recordUpdates((d) => retroBoard(d));
    await inRoom((store, storage) => {
      updates.forEach((u) => store.append(u));
      expect(store.compactIfNeeded(original, true)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));
      const ids = snapshot(original).map((n) => n.id);
      const extra: Uint8Array[] = [];
      original.on('update', (u: Uint8Array) => extra.push(u));
      for (let i = 0; i < 3; i++) moveObject(original, ids[i], 700 + i, 800 + i);
      extra.forEach((u) => store.append(u));
      expect(extra).toHaveLength(3);
      const remaining = storage.sql.exec('SELECT MIN(seq) AS m FROM updates').one();
      expect(Number(remaining.m)).toBeGreaterThan(through);
      const { doc } = loaded(store);
      expect(sorted(doc)).toBe(sorted(original));
      expect(snapshot(doc).find((n) => n.id === ids[0])?.x).toBe(700);
    });
  });

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into chunks and reloads equal', async () => {
    const { doc: original, updates } = recordUpdates((d) => largeBoard(d));
    expect(snapshot(original)).toHaveLength(PERSIST_TESTED_NOTES);
    await inRoom((store, storage) => {
      updates.forEach((u) => store.append(u));
      expect(store.compactIfNeeded(original, true)).toBe(true);
      const size = Y.encodeStateAsUpdate(original).length;
      const chunks = rows(storage, 'snapshot_chunks');
      console.log(`TC-08 encoded size ${size} bytes in ${chunks} chunk(s)`);
      expect(chunks).toBe(Math.ceil(size / SNAPSHOT_CHUNK_BYTES));
      if (size > SNAPSHOT_CHUNK_BYTES) expect(chunks).toBeGreaterThan(1);
      expect(sorted(loaded(store).doc)).toBe(sorted(original));
    });
  });

  it('TC-08b: a snapshot larger than one chunk is split and reassembled', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const big = doc.getText('big');
    // Incompressible-ish content so the encoded state exceeds one chunk regardless of fixture size.
    const rand = (i: number) => String.fromCharCode(33 + ((i * 7919) % 90));
    big.insert(0, Array.from({ length: SNAPSHOT_CHUNK_BYTES + 5000 }, (_, i) => rand(i)).join(''));
    await inRoom((store, storage) => {
      store.append(Y.encodeStateAsUpdate(doc));
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      expect(rows(storage, 'snapshot_chunks')).toBeGreaterThan(1);
      const { doc: again } = loaded(store);
      expect(again.getText('big').toString()).toBe(big.toString());
    });
  });

  it('TC-09: one damaged log row is quarantined, everything else loads', async () => {
    const { doc: original, updates } = recordUpdates((d) => retroBoard(d));
    for (const [name, bad] of [
      ['truncated', truncated(updates[updates.length - 1])],
      ['random bytes', randomBytesLike(updates[updates.length - 1])],
    ] as const) {
      await inRoom((store, storage) => {
        updates.forEach((u) => store.append(u));
        const before = rows(storage, 'updates');
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', bad.slice(), updates.length);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { doc, result } = loaded(store);
        errors.mockRestore();
        expect(result, name).toEqual({ ok: true, quarantined: 1 });
        expect(rows(storage, 'updates')).toBe(before - 1);
        const q = storage.sql.exec('SELECT seq, error FROM quarantined_updates').one();
        expect(q.seq).toBe(updates.length);
        expect(String(q.error).length).toBeGreaterThan(0);
        // The damaged row was the last change (a stacking bump): all 25 notes are there, only that change is missing.
        const got = snapshot(doc);
        expect(got).toHaveLength(25);
        const want = snapshot(original);
        for (const n of want) {
          const g = got.find((x) => x.id === n.id);
          expect(g?.text).toBe(n.text);
          expect(g?.x).toBe(n.x);
        }
      });
    }
  });

  it('TC-10: a damaged snapshot is unreadable and nothing is deleted or quarantined', async () => {
    const { doc: original, updates } = recordUpdates((d) => retroBoard(d));
    await inRoom((store, storage) => {
      updates.forEach((u) => store.append(u));
      store.compactIfNeeded(original, true);
      store.append(updates[0]); // a log row after the snapshot
      const chunk = new Uint8Array(storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk).slice());
      const logRows = rows(storage, 'updates');
      const chunks = rows(storage, 'snapshot_chunks');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = loaded(store);
      errors.mockRestore();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');
      expect(rows(storage, 'updates')).toBe(logRows);
      expect(rows(storage, 'snapshot_chunks')).toBe(chunks);
      expect(rows(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11: a failure during compaction rolls back; snapshot and log are unchanged', async () => {
    const { doc: original, updates } = recordUpdates((d) => retroBoard(d));
    await inRoom((real, storage) => {
      updates.forEach((u) => real.append(u));
      expect(real.compactIfNeeded(original, true)).toBe(true);
      real.append(updates[1]);
      const chunksBefore = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray();
      const logBefore = rows(storage, 'updates');
      const throughBefore = meta(storage, 'snapshot_through_seq');

      const failing = {
        transactionSync: (fn: () => unknown) => storage.transactionSync(fn),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (/INSERT INTO snapshot_chunks/.test(query)) throw new Error('injected failure after DELETE');
            return storage.sql.exec(query, ...(bindings as never[]));
          },
        },
      } as unknown as DurableObjectStorage;
      const store = new BoardStore(failing);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(store.compactIfNeeded(original, true)).toBe(false);
      errors.mockRestore();

      const chunksAfter = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray();
      expect(chunksAfter).toHaveLength(chunksBefore.length);
      expect(chunksAfter.map((c) => new Uint8Array(c.data as ArrayBuffer))).toEqual(
        chunksBefore.map((c) => new Uint8Array(c.data as ArrayBuffer)),
      );
      expect(rows(storage, 'updates')).toBe(logBefore);
      expect(meta(storage, 'snapshot_through_seq')).toBe(throughBefore);
    });
  });

  it('TC-25: opening a never-edited board creates tables but no rows', async () => {
    await inRoom((store, storage) => {
      store.load(new Y.Doc());
      expect(rows(storage, 'updates')).toBe(0);
      expect(rows(storage, 'snapshot_chunks')).toBe(0);
      expect(rows(storage, 'quarantined_updates')).toBe(0);
    });
  });
});

