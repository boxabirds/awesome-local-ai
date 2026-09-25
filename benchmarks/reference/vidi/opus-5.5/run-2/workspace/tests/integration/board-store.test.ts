/**
 * BoardStore against real SQLite-backed Durable Object storage (persist.board_store,
 * TC-03 to TC-11, TC-25). Each test uses its own board (its own object and database).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import {
  RETRO_NOTES,
  buildLargeBoard,
  buildRetroBoard,
  randomBytesLike,
  recordUpdates,
  truncatedUpdate,
} from '../fixtures/boards';
import { createSticky, moveObject, setStickyColor } from '../../src/shared/board-model';

type Storage = DurableObjectStorage;

/** Runs `fn` with the real storage of a fresh board's Durable Object. */
async function withStorage<T>(fn: (storage: Storage) => T | Promise<T>): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_instance, state) => fn(state.storage));
}

function count(storage: Storage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

function tables(storage: Storage): string[] {
  return storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .toArray()
    .map((r) => r.name)
    .sort();
}

function meta(storage: Storage, key: string): string | undefined {
  return storage.sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0]?.value;
}

function seqs(storage: Storage): number[] {
  return storage.sql.exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq').toArray().map((r) => r.seq);
}

function chunks(storage: Storage): Uint8Array[] {
  return storage.sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
    .toArray()
    .map((r) => new Uint8Array(r.data));
}

/** Builds the 25-note board and appends one log row per update. */
function seedRetro(store: BoardStore): Y.Doc {
  const doc = new Y.Doc();
  const updates = recordUpdates(doc, () => buildRetroBoard(doc));
  updates.forEach((u) => store.append(u));
  return doc;
}

function reload(storage: Storage): { doc: Y.Doc; result: ReturnType<BoardStore['load']>; store: BoardStore } {
  const store = new BoardStore(storage);
  store.migrate();
  const doc = new Y.Doc();
  const result = store.load(doc);
  return { doc, result, store };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe('BoardStore (persist.board_store)', () => {
  it('TC-03 migrate then load an empty board: tables exist, doc empty, schema version recorded', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.migrate(); // idempotent
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(tables(storage)).toEqual(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']);
      expect(snapshot(doc)).toEqual([]);
      expect(doc.store.clients.size).toBe(0);
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-25 opening a never-edited board writes no update or snapshot rows', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.load(new Y.Doc());
      store.compactIfNeeded(new Y.Doc());
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-04 append one update: 0 → 1 row, bytes column equals its length', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      const doc = new Y.Doc();
      const [update] = recordUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
      store.append(update!);
      const rows = storage.sql.exec<{ data: ArrayBuffer; bytes: number }>('SELECT data, bytes FROM updates').toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.bytes).toBe(update!.length);
      expect(sameBytes(new Uint8Array(rows[0]!.data), update!)).toBe(true);
    });
  });

  it('TC-05 LogOnly 25 notes reload equal to the original', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = seedRetro(store);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(RETRO_NOTES);
      expect(snapshot(doc)).toEqual(snapshot(original));
    });
  });

  it('TC-06 compaction at COMPACTION_UPDATE_COUNT rows: log → snapshot, reload equal', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = seedRetro(store);
      const id = snapshot(original)[0]!.id;
      // Top the log up to exactly the threshold with real moves.
      let step = 0;
      while (count(storage, 'updates') < COMPACTION_UPDATE_COUNT - 1) {
        const [u] = recordUpdates(original, () => moveObject(original, id, ++step, step));
        store.append(u!);
        expect(store.compactIfNeeded(original)).toBe(false);
      }
      const [last] = recordUpdates(original, () => moveObject(original, id, ++step, step));
      store.append(last!);
      const before = seqs(storage);
      expect(before).toHaveLength(COMPACTION_UPDATE_COUNT);
      expect(count(storage, 'snapshot_chunks')).toBe(0);

      expect(store.compactIfNeeded(original)).toBe(true);

      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(before.at(-1)));
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(original));
      // Nothing left to compact.
      expect(store.compactIfNeeded(original)).toBe(false);
    });
  });

  it('TC-07 SnapshotPlusLog: 3 changes after compaction reload on top of the snapshot', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = seedRetro(store);
      expect(store.compact(original)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));
      const ids = snapshot(original).map((n) => n.id);
      const more = recordUpdates(original, () => {
        setStickyColor(original, ids[0]!, 'violet');
        moveObject(original, ids[1]!, -99, 77);
        createSticky(original, { x: 5000, y: 5000 }, 'green');
      });
      expect(more).toHaveLength(3);
      more.forEach((u) => store.append(u));
      expect(seqs(storage).every((s) => s > through)).toBe(true);
      // A stale row at or below through_seq (as if left behind) must not be applied.
      const stale = new Y.Doc();
      const [ghost] = recordUpdates(stale, () => createSticky(stale, { x: 1, y: 1 }));
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', through, ghost!, ghost!.length);

      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(original));
      expect(snapshot(doc)).toHaveLength(RETRO_NOTES + 1);
    });
  });

  it(`TC-08 a ${PERSIST_TESTED_NOTES}-note board compacts into several chunks and reloads equal`, async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = new Y.Doc();
      const updates = recordUpdates(original, () => buildLargeBoard(original));
      updates.forEach((u) => store.append(u));
      expect(store.compactIfNeeded(original)).toBe(true);
      const encoded = Y.encodeStateAsUpdate(original).length;
      const stored = chunks(storage);
      expect(stored.length).toBe(Math.ceil(encoded / SNAPSHOT_CHUNK_BYTES));
      if (encoded > SNAPSHOT_CHUNK_BYTES) expect(stored.length).toBeGreaterThan(1);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snapshot(doc)).toEqual(snapshot(original));
    });
  });

  it('TC-08 a snapshot larger than one chunk is split and rejoined byte-exact', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = new Y.Doc();
      // ~1,000 characters per note × 2,000 notes guarantees more than one chunk.
      const updates = recordUpdates(original, () => buildLargeBoard(original));
      const texts = original.getMap('objects');
      recordUpdates(original, () => {
        original.transact(() => {
          texts.forEach((obj) => ((obj as Y.Map<unknown>).get('text') as Y.Text).insert(0, 'x'.repeat(700)));
        });
      }).forEach((u) => updates.push(u));
      updates.forEach((u) => store.append(u));
      expect(store.compact(original)).toBe(true);
      expect(Y.encodeStateAsUpdate(original).length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      expect(chunks(storage).length).toBeGreaterThan(1);
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(original));
    });
  });

  describe('TC-09 one damaged log row is quarantined and the rest loads', () => {
    const damages: [string, (u: Uint8Array) => Uint8Array][] = [
      ['truncated', truncatedUpdate],
      ['random bytes', (u) => randomBytesLike(u)],
    ];
    for (const [name, damage] of damages) {
      it(name, async () => {
        await withStorage((storage) => {
          const store = new BoardStore(storage);
          store.migrate();
          // Each note written by a different person (client), as on a real shared board,
          // so no other row depends on the damaged one.
          const original = new Y.Doc();
          const ids: string[] = [];
          const updates: Uint8Array[] = [];
          for (let i = 0; i < RETRO_NOTES; i++) {
            const author = new Y.Doc();
            Y.applyUpdate(author, Y.encodeStateAsUpdate(original));
            const own = recordUpdates(author, () => ids.push(createSticky(author, { x: i * 250, y: 0 }, 'blue')));
            own.forEach((u) => Y.applyUpdate(original, u));
            updates.push(...own);
          }
          expect(updates).toHaveLength(RETRO_NOTES);
          updates.forEach((u) => store.append(u));
          const row7 = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 7').one();
          const damaged = damage(new Uint8Array(row7.data));
          storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', damaged);
          const before = count(storage, 'updates');

          const { doc, result } = reload(storage);

          expect(result).toEqual({ ok: true, quarantined: 1 });
          expect(count(storage, 'updates')).toBe(before - 1);
          expect(seqs(storage)).not.toContain(7);
          const q = storage.sql
            .exec<{ seq: number; data: ArrayBuffer; error: string; quarantined_at: number }>('SELECT * FROM quarantined_updates')
            .toArray();
          expect(q).toHaveLength(1);
          expect(q[0]!.seq).toBe(7);
          expect(sameBytes(new Uint8Array(q[0]!.data), damaged)).toBe(true);
          expect(q[0]!.error.length).toBeGreaterThan(0);
          expect(q[0]!.quarantined_at).toBeGreaterThan(0);
          expect(snapshot(doc).map((n) => n.id).sort()).toEqual(ids.filter((_, i) => i !== 6).sort());
          const byId = new Map(snapshot(original).map((n) => [n.id, n]));
          for (const n of snapshot(doc)) expect(n).toEqual(byId.get(n.id));
        });
      });
    }
  });

  it('TC-10 a damaged snapshot fails the load and changes nothing', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = seedRetro(store);
      store.compact(original);
      const more = recordUpdates(original, () => createSticky(original, { x: 0, y: 900 }));
      more.forEach((u) => store.append(u));
      const [chunk0] = chunks(storage);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncatedUpdate(chunk0!));
      const before = { updates: seqs(storage), chunks: count(storage, 'snapshot_chunks') };

      const { result } = reload(storage);

      expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
      expect(seqs(storage)).toEqual(before.updates);
      expect(count(storage, 'snapshot_chunks')).toBe(before.chunks);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11 a failure inside compaction rolls back: previous snapshot and log intact', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const original = seedRetro(store);
      store.compact(original);
      const more = recordUpdates(original, () => {
        for (let i = 0; i < 3; i++) createSticky(original, { x: i * 300, y: 1200 });
      });
      more.forEach((u) => store.append(u));
      const before = {
        chunks: chunks(storage),
        seqs: seqs(storage),
        through: meta(storage, 'snapshot_through_seq'),
      };

      // Fail the first statement after `DELETE FROM snapshot_chunks`, inside the real transaction.
      let deleted = false;
      const failing = {
        transactionSync: storage.transactionSync.bind(storage),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (deleted) throw new Error('injected failure after DELETE snapshot_chunks');
            if (query.startsWith('DELETE FROM snapshot_chunks')) deleted = true;
            return storage.sql.exec(query, ...bindings);
          },
        },
      } as unknown as Storage;
      const faulty = new BoardStore(failing);
      expect(faulty.compact(original)).toBe(false);
      expect(deleted).toBe(true);

      const after = chunks(storage);
      expect(after.length).toBe(before.chunks.length);
      after.forEach((c, i) => expect(sameBytes(c, before.chunks[i]!)).toBe(true));
      expect(seqs(storage)).toEqual(before.seqs);
      expect(meta(storage, 'snapshot_through_seq')).toBe(before.through);
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(original));
    });
  });
});
