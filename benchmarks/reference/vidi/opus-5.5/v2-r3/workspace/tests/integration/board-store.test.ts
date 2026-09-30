// BoardStore against real Durable Object SQLite storage (isolated per test).
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, moveObject, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import { largeBoard, randomBytesLike, recordUpdates, retroBoard, truncated } from '../fixtures/boards';

type Storage = DurableObjectStorage;

/** Runs `fn` with a fresh board object's real storage. */
function withStorage<R>(fn: (storage: Storage) => R | Promise<R>): Promise<R> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_instance, state) => fn(state.storage));
}

function count(storage: Storage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

function tables(storage: Storage): string[] {
  return storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((r) => r.name);
}

function meta(storage: Storage, key: string): string | undefined {
  return storage.sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0]?.value;
}

function seqs(storage: Storage): number[] {
  return storage.sql
    .exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq')
    .toArray()
    .map((r) => r.seq);
}

/** A fresh doc loaded from storage by a fresh store (as after a restart). */
function reload(storage: Storage): { doc: Y.Doc; store: BoardStore; result: ReturnType<BoardStore['load']> } {
  const store = new BoardStore(storage);
  store.migrate();
  const doc = new Y.Doc();
  const result = store.load(doc);
  return { doc, store, result };
}

/** Appends every update of the 25-note retro board, one row per transaction. */
function appendRetro(store: BoardStore): { doc: Y.Doc; updates: Uint8Array[] } {
  const rec = recordUpdates((d) => retroBoard(d));
  for (const u of rec.updates) store.append(u);
  return rec;
}

/** Appends the retro board, then padding updates up to exactly COMPACTION_UPDATE_COUNT rows. */
function appendRetroToThreshold(store: BoardStore): Y.Doc {
  const doc = new Y.Doc();
  let rows = 0;
  doc.on('update', (u: Uint8Array) => {
    store.append(u);
    rows++;
  });
  retroBoard(doc);
  const id = snapshot(doc)[0].id;
  let i = 0;
  while (rows < COMPACTION_UPDATE_COUNT) moveObject(doc, id, 1000 + i++, 0);
  return doc;
}

describe('BoardStore schema (persist.board_store)', () => {
  it('TC-03: migrate + load on an empty board → tables exist, doc empty, schema version set', () =>
    withStorage((storage) => {
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(tables(storage)).toEqual(
        expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
      );
      expect(snapshot(doc)).toEqual([]);
      expect(doc.store.clients.size).toBe(0);
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    }));

  it('TC-25: opening a never-edited board creates tables only, no update or snapshot rows', () =>
    withStorage((storage) => {
      reload(storage);
      reload(storage); // migrate is idempotent
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    }));
});

describe('BoardStore append and load', () => {
  it('TC-04: append one update → 1 row whose bytes column equals its length', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const { updates } = recordUpdates((d) => createSticky(d, { x: 0, y: 0 }));
      expect(updates).toHaveLength(1);
      expect(count(storage, 'updates')).toBe(0);
      store.append(updates[0]);
      expect(count(storage, 'updates')).toBe(1);
      const row = storage.sql.exec<{ data: ArrayBuffer; bytes: number }>('SELECT data, bytes FROM updates').one();
      expect(row.bytes).toBe(updates[0].byteLength);
      expect(Array.from(new Uint8Array(row.data))).toEqual(Array.from(updates[0]));
    }));

  it('TC-05: a 25-note log loads into a fresh doc equal to the original', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const { doc: original } = appendRetro(store);
      expect(snapshot(original)).toHaveLength(25);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(snapshot(original));
    }));
});

describe('BoardStore compaction', () => {
  it('TC-06: at COMPACTION_UPDATE_COUNT rows, compaction moves the log into a snapshot', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const original = appendRetroToThreshold(store);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      const maxSeq = Math.max(...seqs(storage));
      expect(store.compactIfNeeded(original)).toBe(true);
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(maxSeq));
      const { doc, result } = reload(storage);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toEqual(snapshot(original));
      // Nothing more to do until the threshold is reached again.
      expect(store.compactIfNeeded(original)).toBe(false);
    }));

  it('TC-06 boundary: one row below COMPACTION_UPDATE_COUNT does not compact', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const doc = new Y.Doc();
      doc.on('update', (u: Uint8Array) => store.append(u));
      const id = createSticky(doc, { x: 0, y: 0 });
      for (let i = 1; i < COMPACTION_UPDATE_COUNT - 1; i++) moveObject(doc, id, i, 0);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
      expect(store.compactIfNeeded(doc)).toBe(false);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      // A reloaded store knows the count too (tracked from load).
      const again = reload(storage);
      expect(again.store.compactIfNeeded(again.doc)).toBe(false);
      moveObject(doc, id, -1, 0);
      expect(store.compactIfNeeded(doc)).toBe(true);
    }));

  it('TC-07: snapshot plus 3 later updates → reload has everything; only rows after through_seq are replayed', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const original = appendRetroToThreshold(store);
      expect(store.compactIfNeeded(original)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));
      const [a, b] = snapshot(original);
      moveObject(original, a.id, -999, -999);
      getStickyText(original, b.id)!.insert(0, 'after snapshot ');
      createSticky(original, { x: 5000, y: 5000 }, 'pink');
      expect(seqs(storage)).toHaveLength(3);
      expect(seqs(storage).every((s) => s > through)).toBe(true);
      // A stale row at or below through_seq must never be replayed.
      const { updates: stale } = recordUpdates((d) => createSticky(d, { x: 1, y: 1 }));
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', through, stale[0].slice().buffer, stale[0].byteLength);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(snapshot(original));
      expect(snapshot(doc)).toHaveLength(26);
    }));

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into ceil(size / SNAPSHOT_CHUNK_BYTES) chunks and reloads equal', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const original = largeBoard(PERSIST_TESTED_NOTES);
      store.append(Y.encodeStateAsUpdate(original));
      expect(store.compact(original)).toBe(true);
      const size = Y.encodeStateAsUpdate(original).byteLength;
      console.log(`TC-08: ${PERSIST_TESTED_NOTES}-note snapshot is ${size} bytes`);
      expect(count(storage, 'snapshot_chunks')).toBe(Math.ceil(size / SNAPSHOT_CHUNK_BYTES));
      const { doc, result } = reload(storage);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(snapshot(doc)).toEqual(snapshot(original));
    }));

  it('TC-08: when the encoded board exceeds the chunk size it is split into several chunks and reloads equal', () =>
    withStorage((storage) => {
      const original = largeBoard(PERSIST_TESTED_NOTES);
      const size = Y.encodeStateAsUpdate(original).byteLength;
      const chunk = Math.ceil(size / 5);
      const store = new BoardStore(storage, { chunkBytes: chunk });
      store.migrate();
      expect(store.compact(original)).toBe(true);
      expect(count(storage, 'snapshot_chunks')).toBe(5);
      const { doc, result } = reload(storage);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toEqual(snapshot(original));
    }));
});

describe('BoardStore damage', () => {
  for (const [kind, damage] of [
    ['truncated', truncated],
    ['random bytes', randomBytesLike],
  ] as const) {
    it(`TC-09: a damaged log row (${kind}) is quarantined; everything else loads`, () =>
      withStorage((storage) => {
        const { store } = reload(storage);
        const { doc: original, updates } = appendRetro(store);
        const rows = seqs(storage);
        const seq7 = rows[6];
        const damaged = damage(updates[6]);
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged.slice().buffer, seq7);
        const before = count(storage, 'updates');
        const { doc, result } = reload(storage);
        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(count(storage, 'updates')).toBe(before - 1);
        expect(seqs(storage)).not.toContain(seq7);
        const q = storage.sql
          .exec<{ seq: number; data: ArrayBuffer; error: string; quarantined_at: number }>('SELECT * FROM quarantined_updates')
          .toArray();
        expect(q).toHaveLength(1);
        expect(q[0].seq).toBe(seq7);
        expect(q[0].error.length).toBeGreaterThan(0);
        expect(Array.from(new Uint8Array(q[0].data))).toEqual(Array.from(damaged));
        // Only the note row 7 changed differs; later changes by the same writer still load.
        const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
        const differing = snapshot(original).filter((n) => JSON.stringify(byId.get(n.id)) !== JSON.stringify(n));
        expect(differing).toHaveLength(1);
        expect(snapshot(doc).length).toBeGreaterThanOrEqual(24);
        expect(doc.store.pendingStructs).toBeNull();
        // A second load does not quarantine again.
        expect(reload(storage).result).toEqual({ ok: true, quarantined: 0 });
      }));
  }

  for (const [kind, damage] of [
    ['truncated', truncated],
    ['random bytes', randomBytesLike],
  ] as const) {
    it(`TC-10: a damaged snapshot chunk (${kind}) fails the load; nothing is deleted or quarantined`, () =>
      withStorage((storage) => {
        const { store } = reload(storage);
        const original = appendRetroToThreshold(store);
        expect(store.compactIfNeeded(original)).toBe(true);
        createSticky(original, { x: 0, y: 900 });
        const chunk0 = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
        const damaged = damage(new Uint8Array(chunk0.data));
        storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged.slice().buffer);
        const before = { updates: count(storage, 'updates'), chunks: count(storage, 'snapshot_chunks') };
        const { result } = reload(storage);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe('snapshot-unreadable');
        expect(count(storage, 'updates')).toBe(before.updates);
        expect(count(storage, 'snapshot_chunks')).toBe(before.chunks);
        expect(count(storage, 'quarantined_updates')).toBe(0);
      }));
  }

  it('TC-11: a statement failing after DELETE snapshot_chunks rolls the compaction back', () =>
    withStorage((storage) => {
      const { store } = reload(storage);
      const original = appendRetroToThreshold(store);
      expect(store.compactIfNeeded(original)).toBe(true);
      createSticky(original, { x: 0, y: 900 });
      const chunksBefore = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray();
      const rowsBefore = storage.sql.exec('SELECT seq, data FROM updates ORDER BY seq').toArray();
      const throughBefore = meta(storage, 'snapshot_through_seq');
      let deletedChunks = false;
      const failing = {
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (query.startsWith('DELETE FROM snapshot_chunks')) deletedChunks = true;
            else if (deletedChunks && query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected write failure');
            return storage.sql.exec(query, ...bindings);
          },
        },
        transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
      } as unknown as Storage;
      const errors: unknown[] = [];
      const origError = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      let compacted: boolean;
      try {
        compacted = new BoardStore(failing).compact(original);
      } finally {
        console.error = origError;
      }
      expect(compacted).toBe(false);
      expect(deletedChunks).toBe(true);
      expect(errors).toHaveLength(1);
      expect(storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray()).toEqual(chunksBefore);
      expect(storage.sql.exec('SELECT seq, data FROM updates ORDER BY seq').toArray()).toEqual(rowsBefore);
      expect(meta(storage, 'snapshot_through_seq')).toBe(throughBefore);
      const { doc } = reload(storage);
      expect(snapshot(doc)).toEqual(snapshot(original));
    }));

  it('TC-26 (store): an SQL error while reading → ok:false, reason sql-error', () =>
    withStorage((storage) => {
      reload(storage);
      const failing = {
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (query.startsWith('SELECT')) throw new Error('injected read failure');
            return storage.sql.exec(query, ...bindings);
          },
        },
        transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
      } as unknown as Storage;
      const result = new BoardStore(failing).load(new Y.Doc());
      expect(result).toEqual({ ok: false, reason: 'sql-error', error: 'injected read failure' });
    }));
});
