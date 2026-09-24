/**
 * Story 4 · BoardStore integration tests (TC-03 … TC-11, TC-25).
 *
 * Runs inside workerd against a *real* SQLite-backed Durable Object (design
 * "Mock vs real boundaries": the store under test is exercised against the
 * real engine; failures are injected by wrapping `StorageLike`, which sits
 * outside SQLite so real transaction semantics still apply).
 *
 * Each test uses its own Durable Object id, so state never leaks between
 * cases; `afterEach` also aborts all objects to drop in-memory state.
 */
import { env, runInDurableObject, abortAllDurableObjects } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, type StorageLike } from '../../src/worker/board-store';
import { COMPACTION_UPDATE_COUNT, PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';
import {
  fullSnapshot,
  makeLargeDoc,
  makeRetroDoc,
  randomBytesLike,
  truncatedUpdate,
} from '../../tests/fixtures/boards';
import { snapshot } from '../../src/shared/board-model';

afterEach(async () => {
  abortAllDurableObjects();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Run `fn` inside a fresh-ish Durable Object for the given board name. */
function inRoom<T>(name: string, fn: (store: BoardStore, storage: StorageLike) => T): Promise<T> {
  const ns = env.BOARD_ROOM;
  if (ns === undefined) throw new Error('BOARD_ROOM binding missing');
  const stub = ns.get(ns.idFromName(name));
  return runInDurableObject(stub, (_instance, state) =>
    fn(new BoardStore(state.storage), state.storage),
  );
}

function tableCount(storage: StorageLike, table: string): number {
  return Number(storage.sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).one()?.['c'] ?? 0);
}

function docEquals(a: Y.Doc, b: Y.Doc): boolean {
  // Content-level equality: the render snapshot (what users see).
  return JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));
}

describe('BoardStore schema (TC-03, TC-25)', () => {
  it('TC-03: migrate + load on an empty board leaves tables present, doc empty, version set', async () => {
    await inRoom('tc-03', (store, storage) => {
      store.migrate();
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(doc.getMap('objects').size).toBe(0);
      expect(storage.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`).toArray().length)
        .toBeGreaterThanOrEqual(4);
      const version = storage.sql
        .exec(`SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`)
        .one();
      expect(version?.['value']).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-25: migrate on a never-edited board creates no update or snapshot rows', async () => {
    await inRoom('tc-25', (store, storage) => {
      store.migrate();
      expect(tableCount(storage, 'updates')).toBe(0);
      expect(tableCount(storage, 'snapshot_chunks')).toBe(0);
      expect(tableCount(storage, 'quarantined_updates')).toBe(0);
    });
  });
});

describe('BoardStore log (TC-04, TC-05)', () => {
  it('TC-04: append writes one row whose bytes column equals the update length', async () => {
    const { doc, updates } = makeRetroDoc();
    const first = updates[0] as Uint8Array;
    await inRoom('tc-04', (store, storage) => {
      store.migrate();
      expect(store.logRowCount).toBe(0);
      store.append(first);
      expect(tableCount(storage, 'updates')).toBe(1);
      const row = storage.sql.exec(`SELECT bytes, LENGTH(data) AS len FROM updates`).one();
      expect(row?.['bytes']).toBe(first.byteLength);
      expect(row?.['len']).toBe(first.byteLength);
      void doc;
    });
  });

  it('TC-05: a 25-note log replays into a fresh doc identically', async () => {
    const { doc: original, updates } = makeRetroDoc();
    const expected = JSON.stringify(snapshot(original));
    await inRoom('tc-05', (store, _storage) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(snapshot(fresh))).toBe(expected);
      expect(docEquals(original, fresh)).toBe(true);
    });
  });
});

describe('BoardStore compaction (TC-06, TC-07, TC-08, TC-11)', () => {  /** `count` small, distinct, valid updates (one transaction each). */
  function makeUpdates(count: number): Uint8Array[] {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => {
      updates.push(update.slice());
    });
    const map = doc.getMap<unknown>('log');
    for (let i = 0; i < count; i += 1) {
      doc.transact(() => {
        map.set(`k${i}`, `v${i}`);
      });
    }
    return updates;
  }

  it('TC-06: at COMPACTION_UPDATE_COUNT rows, compaction clears the log and reloads identically', async () => {
    const updates = makeUpdates(COMPACTION_UPDATE_COUNT);
    expect(updates.length).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    const original = new Y.Doc();
    for (const update of updates) Y.applyUpdate(original, update);

    await inRoom('tc-06', (store, storage) => {
      store.migrate();
      for (const update of updates) store.append(update);
      expect(tableCount(storage, 'updates')).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
      const maxSeqBefore = Number(
        storage.sql.exec(`SELECT MAX(seq) AS m FROM updates`).one()?.['m'] ?? 0,
      );

      expect(store.compactIfNeeded(original)).toBe(true);

      // State *after*: log truncated, snapshot present, watermark advanced.
      expect(tableCount(storage, 'updates')).toBe(0);
      expect(tableCount(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      const through = storage.sql
        .exec(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`)
        .one();
      expect(through?.['value']).toBe(String(maxSeqBefore));

      // And the reload is identical.
      const fresh = new Y.Doc();
      expect(store.load(fresh).ok).toBe(true);
      expect(JSON.stringify(fresh.toJSON())).toBe(JSON.stringify(original.toJSON()));
    });
  });

  it('TC-07: after compaction only rows above the watermark are replayed', async () => {
    const before = makeUpdates(COMPACTION_UPDATE_COUNT);
    const doc = new Y.Doc();
    for (const update of before) Y.applyUpdate(doc, update);

    await inRoom('tc-07', (store, storage) => {
      store.migrate();
      for (const update of before) store.append(update);
      expect(store.compactIfNeeded(doc)).toBe(true);
      const throughAfterCompact = storage.sql
        .exec(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`)
        .one()?.['value'];
      expect(throughAfterCompact).toBeDefined();

      // Three more changes after compaction.
      const tail = makeUpdates(3);
      const withTail = new Y.Doc();
      Y.applyUpdate(withTail, fullSnapshot(doc));
      for (const update of tail) {
        Y.applyUpdate(withTail, update);
        store.append(update);
      }
      expect(tableCount(storage, 'updates')).toBe(3);

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(true);
      // Only rows above the watermark were replayed on top of the snapshot,
      // yet the total state matches the source doc exactly.
      expect(docEquals(fresh, withTail)).toBe(true);
      expect(tableCount(storage, 'updates')).toBe(3);
    });
  });

  it('TC-08: a large board compacts into >1 chunk when it exceeds the chunk size, and reloads identically', async () => {
    // A realistically large board: 2,000 notes with 10–300 char texts.
    const { doc, updates } = makeLargeDoc(PERSIST_TESTED_NOTES);
    const encoded = Y.encodeStateAsUpdate(doc);
    expect(encoded.byteLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    await inRoom('tc-08', (store, storage) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const compacted = store.compactIfNeeded(doc);
      expect(compacted).toBe(true);
      expect(tableCount(storage, 'snapshot_chunks')).toBeGreaterThan(1);
      expect(tableCount(storage, 'updates')).toBe(0);
      const fresh = new Y.Doc();
      expect(store.load(fresh).ok).toBe(true);
      expect(docEquals(doc, fresh)).toBe(true);
    });
  });

  it('TC-11: a failure injected after the chunk delete rolls the whole compaction back', async () => {
    const doc = new Y.Doc();

    await inRoom('tc-11', (store, storage) => {
      store.migrate();
      // State before: a compacted board…
      const first = makeUpdates(COMPACTION_UPDATE_COUNT);
      for (const update of first) {
        Y.applyUpdate(doc, update);
        store.append(update);
      }
      expect(store.compactIfNeeded(doc)).toBe(true);
      expect(tableCount(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);

      // …plus a fresh log above the threshold.
      const tail = makeUpdates(COMPACTION_UPDATE_COUNT);
      for (const update of tail) {
        Y.applyUpdate(doc, update);
        store.append(update);
      }
      const chunksBefore = storage.sql.exec(`SELECT idx, data FROM snapshot_chunks ORDER BY idx`).toArray();
      const logBefore = tableCount(storage, 'updates');

      // A wrapper that throws on the first statement *after* the chunk delete.
      let deleted = false;
      let threw = false;
      const failing: StorageLike = {
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.startsWith('DELETE FROM snapshot_chunks')) {
              deleted = true;
            } else if (deleted && !threw) {
              threw = true;
              throw new Error('injected failure');
            }
            return storage.sql.exec(query, ...bindings);
          },
        },
        transactionSync: (closure) => storage.transactionSync(closure),
      };

      const failingStore = new BoardStore(failing);
      const probe = new Y.Doc();
      failingStore.load(probe); // sync the injected store's row counters
      expect(failingStore.compactIfNeeded(doc)).toBe(false);
      expect(threw).toBe(true);

      // Nothing changed: previous chunks and log rows are intact (negative).
      const chunksAfter = storage.sql.exec(`SELECT idx, data FROM snapshot_chunks ORDER BY idx`).toArray();
      expect(chunksAfter.length).toBe(chunksBefore.length);
      expect(tableCount(storage, 'updates')).toBe(logBefore);
    });
  });
});

describe('BoardStore damage handling (TC-09, TC-10)', () => {
  it('TC-09: one damaged log row is quarantined; every other note survives', async () => {
    const { doc: original, updates } = makeRetroDoc();
    expect(updates.length).toBeGreaterThan(7);
    const target = updates[6] as Uint8Array;
    // Both damage shapes from the design: truncated + same-length random.
    const damaged = truncatedUpdate(target, 10);
    expect(() => Y.applyUpdate(new Y.Doc(), damaged)).toThrow();
    expect(() => Y.applyUpdate(new Y.Doc(), randomBytesLike(target.byteLength, 0xabc))).toThrow();

    await inRoom('tc-09', (store, storage) => {
      store.migrate();
      let i = 0;
      for (const update of updates) {
        // Row 7 (seq 7) is replaced with damaged bytes after insert.
        store.append(update);
        i += 1;
      }
      storage.sql.exec(
        `UPDATE updates SET data = ?, bytes = ? WHERE seq = 7`,
        damaged,
        damaged.byteLength,
      );
      const logBefore = tableCount(storage, 'updates');

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.quarantined).toBe(1);
      expect(tableCount(storage, 'updates')).toBe(logBefore - 1);
      const quarantined = storage.sql
        .exec(`SELECT seq, error FROM quarantined_updates`)
        .toArray();
      expect(quarantined.length).toBe(1);
      expect(String(quarantined[0]?.['error']).length).toBeGreaterThan(0);

      // The rest of the board is intact (negative: only that one change lost).
      const healthy = new Y.Doc();
      updates.forEach((update, index) => {
        if (index !== 6) Y.applyUpdate(healthy, update);
      });
      expect(JSON.stringify(snapshot(fresh))).toBe(JSON.stringify(snapshot(healthy)));
    });
  });

  it('TC-10: a corrupted snapshot fails the load honestly, deleting nothing', async () => {
    const { doc: original } = makeRetroDoc();
    const snapshotBytes = fullSnapshot(original);
    expect(snapshotBytes.byteLength).toBeGreaterThan(64);

    await inRoom('tc-10', (store, storage) => {
      store.migrate();
      // Seed a healthy snapshot then corrupt chunk 0.
      storage.sql.exec(
        `INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?)`,
        snapshotBytes.slice(0, Math.floor(snapshotBytes.byteLength / 2)),
      );
      storage.sql.exec(
        `INSERT INTO snapshot_chunks (idx, data) VALUES (1, ?)`,
        snapshotBytes.slice(Math.floor(snapshotBytes.byteLength / 2)),
      );
      const chunksBefore = tableCount(storage, 'snapshot_chunks');
      storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = 0`, randomBytesLike(256, 0x99));

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('snapshot-unreadable');
      // Negative: nothing deleted or quarantined.
      expect(tableCount(storage, 'snapshot_chunks')).toBe(chunksBefore);
      expect(tableCount(storage, 'quarantined_updates')).toBe(0);
      expect(fresh.getMap('objects').size).toBe(0);
    });
  });
});