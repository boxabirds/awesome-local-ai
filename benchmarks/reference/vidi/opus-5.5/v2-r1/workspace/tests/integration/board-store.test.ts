// persist.board_store against the real SQLite storage of a real Durable Object.
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { moveObject, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore, bridgeMissing } from '../../src/worker/board-store';
import { largeBoard, randomBytesLike, retroBoard, truncated } from '../fixtures/boards';

/** Runs `fn` with the storage of a fresh board's Durable Object. */
function withStorage<R>(fn: (storage: DurableObjectStorage) => R | Promise<R>): Promise<R> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_room, state) => fn(state.storage));
}

function count(storage: DurableObjectStorage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

function rows<T extends Record<string, SqlStorageValue>>(storage: DurableObjectStorage, query: string) {
  return storage.sql.exec<T>(query).toArray();
}

function meta(storage: DurableObjectStorage, key: string): string | undefined {
  return rows<{ value: string }>(storage, `SELECT value FROM storage_meta WHERE key = '${key}'`)[0]
    ?.value;
}

function tables(storage: DurableObjectStorage): string[] {
  return rows<{ name: string }>(storage, "SELECT name FROM sqlite_master WHERE type = 'table'").map(
    (r) => r.name,
  );
}

function chunks(storage: DurableObjectStorage): Uint8Array[] {
  return rows<{ data: ArrayBuffer }>(storage, 'SELECT data FROM snapshot_chunks ORDER BY idx').map(
    (r) => new Uint8Array(r.data),
  );
}

function logRows(storage: DurableObjectStorage) {
  return rows<{ seq: number; data: ArrayBuffer; bytes: number }>(
    storage,
    'SELECT seq, data, bytes FROM updates ORDER BY seq',
  ).map((r) => ({ seq: r.seq, data: new Uint8Array(r.data), bytes: r.bytes }));
}

function freshStore(storage: DurableObjectStorage): BoardStore {
  const store = new BoardStore(storage);
  store.migrate();
  return store;
}

function reload(storage: DurableObjectStorage) {
  const doc = new Y.Doc();
  const result = new BoardStore(storage).load(doc);
  return { doc, result };
}

/** Appends every update of `board` as its own log row. */
function appendAll(store: BoardStore, updates: Uint8Array[]) {
  for (const u of updates) store.append(u);
}

/** Records the updates `change` makes to `doc`. */
function changes(doc: Y.Doc, change: () => void): Uint8Array[] {
  const out: Uint8Array[] = [];
  const on = (u: Uint8Array) => out.push(u);
  doc.on('update', on);
  change();
  doc.off('update', on);
  return out;
}

describe('persist.board_store', () => {
  it('TC-03 migrate on an empty board: tables exist, loads an empty doc, schema version recorded', async () => {
    await withStorage((storage) => {
      const store = freshStore(storage);
      store.migrate(); // idempotent
      expect(tables(storage)).toEqual(
        expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
      );
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual([]);
      expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(new Y.Doc()));
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-25 a never-edited board has tables but no update or snapshot rows', async () => {
    await withStorage((storage) => {
      freshStore(storage).load(new Y.Doc());
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-04 append stores one row whose bytes column is the update length', async () => {
    const { updates } = retroBoard();
    await withStorage((storage) => {
      const store = freshStore(storage);
      expect(count(storage, 'updates')).toBe(0);
      store.append(updates[1]);
      const log = logRows(storage);
      expect(log).toHaveLength(1);
      expect(log[0].bytes).toBe(updates[1].length);
      expect(log[0].data).toEqual(updates[1]);
    });
  });

  it('TC-05 a 25-note log reloads into a fresh doc equal to the original', async () => {
    const { doc, updates } = retroBoard();
    expect(snapshot(doc)).toHaveLength(25);
    await withStorage((storage) => {
      appendAll(freshStore(storage), updates);
      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toEqual(snapshot(doc));
    });
  });

  it('TC-06 compaction at COMPACTION_UPDATE_COUNT rows: log emptied, snapshot written, reload equal', async () => {
    const { doc, updates } = retroBoard();
    const id = snapshot(doc)[0].id;
    let i = 0;
    while (updates.length < COMPACTION_UPDATE_COUNT) {
      updates.push(...changes(doc, () => moveObject(doc, id, i, ++i)));
    }
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates.slice(0, -1));
      // One row below the threshold: nothing happens.
      expect(store.compactIfNeeded(doc)).toBe(false);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
      expect(count(storage, 'snapshot_chunks')).toBe(0);

      store.append(updates[updates.length - 1]);
      const maxSeq = logRows(storage).at(-1)!.seq;
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(maxSeq));

      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toEqual(snapshot(doc));
    });
  });

  it('TC-07 snapshot plus log: later rows are applied on top, only rows after through_seq', async () => {
    const { doc, updates } = retroBoard();
    const [a, b] = snapshot(doc);
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates);
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));

      const more = changes(doc, () => {
        moveObject(doc, a.id, 1234, 567);
        moveObject(doc, b.id, -50, -60);
        moveObject(doc, a.id, 1300, 600);
      });
      expect(more).toHaveLength(3);
      appendAll(store, more);
      const log = logRows(storage);
      expect(log).toHaveLength(3);
      expect(log.every((r) => r.seq > through)).toBe(true);

      // A stale row at or below through_seq (as if a truncation were missed) must be ignored.
      storage.sql.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        through,
        randomBytesLike(updates[3]),
        updates[3].length,
      );

      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toEqual(snapshot(doc));
      expect(snapshot(loaded).find((n) => n.id === a.id)).toMatchObject({ x: 1300, y: 600 });
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it(`TC-08 a ${PERSIST_TESTED_NOTES}-note board compacts into chunked rows and reloads equal`, async () => {
    const { doc, updates } = largeBoard();
    expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
    const encoded = Y.encodeStateAsUpdate(doc).length;
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates);
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      const stored = chunks(storage);
      expect(stored).toHaveLength(Math.ceil(encoded / SNAPSHOT_CHUNK_BYTES));
      if (encoded > SNAPSHOT_CHUNK_BYTES) expect(stored.length).toBeGreaterThan(1);
      for (const c of stored) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);

      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(loaded)).toEqual(snapshot(doc));
    });
  });

  it('TC-08 chunking holds for snapshots over SNAPSHOT_CHUNK_BYTES (several chunk rows)', async () => {
    // Enough notes that the encoded board is certainly larger than one chunk.
    const { doc, updates } = largeBoard(PERSIST_TESTED_NOTES * 2, 4000);
    const encoded = Y.encodeStateAsUpdate(doc).length;
    expect(encoded).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates);
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      expect(chunks(storage).length).toBeGreaterThan(1);
      const { doc: loaded } = reload(storage);
      expect(snapshot(loaded)).toEqual(snapshot(doc));
    });
  });

  it.each([
    ['truncated', truncated],
    ['random bytes', (u: Uint8Array) => randomBytesLike(u)],
  ])('TC-09 a damaged log row (%s) is quarantined; everything else loads', async (_kind, damage) => {
    const { doc, updates } = retroBoard();
    // What the board looks like with only row 7 (the 7th update) missing.
    const expected = new Y.Doc();
    updates.forEach((u, i) => i !== 6 && Y.applyUpdate(expected, u));
    bridgeMissing(expected, null);
    await withStorage((storage) => {
      appendAll(freshStore(storage), updates);
      const damaged = damage(updates[6]);
      storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', damaged);
      const before = count(storage, 'updates');

      const { doc: loaded, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 1 });
      expect(count(storage, 'updates')).toBe(before - 1);
      const q = rows<{ seq: number; data: ArrayBuffer; error: string; quarantined_at: number }>(
        storage,
        'SELECT * FROM quarantined_updates',
      );
      expect(q).toHaveLength(1);
      expect(q[0].seq).toBe(7);
      expect(new Uint8Array(q[0].data)).toEqual(damaged);
      expect(q[0].error).not.toBe('');
      expect(q[0].quarantined_at).toBeGreaterThan(0);

      expect(snapshot(loaded)).toEqual(snapshot(expected));
      // Only the note that change touched differs; every other note is identical.
      const loadedNotes = snapshot(loaded).map((n) => JSON.stringify(n));
      const lost = snapshot(doc).filter((n) => !loadedNotes.includes(JSON.stringify(n)));
      expect(lost.length).toBeLessThanOrEqual(1);
      expect(snapshot(loaded).length).toBeGreaterThanOrEqual(snapshot(doc).length - 1);
      // Loading again finds nothing more to quarantine.
      expect(reload(storage).result).toEqual({ ok: true, quarantined: 0 });
    });
  });

  it.each([
    ['truncated', truncated],
    ['random bytes', (u: Uint8Array) => randomBytesLike(u)],
  ])('TC-10 a damaged snapshot (%s) fails the load and changes nothing', async (_kind, damage) => {
    const { doc, updates } = retroBoard();
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates);
      store.compactIfNeeded(doc, true);
      const more = changes(doc, () => moveObject(doc, snapshot(doc)[0].id, 5, 5));
      appendAll(store, more);
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        damage(chunks(storage)[0]),
      );
      const before = { chunks: chunks(storage), log: logRows(storage) };

      const { result } = reload(storage);
      expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
      expect(result.ok === false && result.error).toBeTruthy();
      expect(chunks(storage)).toEqual(before.chunks);
      expect(logRows(storage)).toEqual(before.log);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11 a failing statement during compaction rolls back: snapshot and log unchanged', async () => {
    const { doc, updates } = retroBoard();
    await withStorage((storage) => {
      const store = freshStore(storage);
      appendAll(store, updates);
      store.compactIfNeeded(doc, true);
      appendAll(
        store,
        changes(doc, () => {
          for (let i = 0; i < 3; i++) moveObject(doc, snapshot(doc)[0].id, i * 10, 0);
        }),
      );
      const before = {
        chunks: chunks(storage),
        log: logRows(storage),
        through: meta(storage, 'snapshot_through_seq'),
      };
      expect(before.log).toHaveLength(3);

      // Fails right after the old snapshot rows were deleted.
      const failing = {
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected write failure');
            return storage.sql.exec(query, ...(bindings as SqlStorageValue[]));
          },
        },
        transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
      } as unknown as DurableObjectStorage;
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      let result: boolean;
      try {
        result = new BoardStore(failing).compactIfNeeded(doc, true);
      } finally {
        console.error = original;
      }
      expect(result).toBe(false);
      expect(errors).toHaveLength(1);
      expect(chunks(storage)).toEqual(before.chunks);
      expect(logRows(storage)).toEqual(before.log);
      expect(meta(storage, 'snapshot_through_seq')).toBe(before.through);
      expect(snapshot(reload(storage).doc)).toEqual(snapshot(doc));
    });
  });
});
