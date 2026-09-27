// BoardStore against REAL Durable Object SQLite (spec: persist.board_store,
// TC-03 to TC-11, TC-25). Every test drives a fresh board id (fresh DO
// instance, fresh storage) through runInDurableObject, so the SQL engine,
// transactions and blob handling are the real ones.

import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  BoardStore,
  type BoardSql,
  type BoardStorage,
} from '../../src/worker/board-store';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import {
  createSticky,
  initDoc,
  moveObject,
  snapshot,
} from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  appendAll,
  buildWithUpdates,
  makeLargeBoard,
  makeRetroBoard,
  padWithMoves,
  randomBytes,
  sameState,
} from '../fixtures/boards';

/** Run `fn` inside a fresh board's DO with a new BoardStore over its storage. */
async function withFreshStore(fn: (store: BoardStore) => Promise<unknown> | unknown): Promise<unknown> {
  const boardId = newBoardId();
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject<BoardRoom, unknown>(stub, (room) => {
    const store = new BoardStore(room.ctx.storage as unknown as BoardStorage);
    return fn(store);
  });
}

/** Wrap a storage's SQL surface so matching statements throw (fault injection). */
function failingStorage(storage: BoardStorage, failOn: (query: string) => boolean): BoardStorage {
  const sql = new Proxy(storage.sql, {
    get(target, prop) {
      if (prop === 'exec') {
        return (query: string, ...bindings: unknown[]) => {
          if (failOn(query)) throw new Error(`injected SQL failure: ${query}`);
          return (target as BoardSql).exec(
            query,
            ...(bindings as (string | number | boolean | null | Uint8Array | ArrayBuffer)[]),
          );
        };
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { sql, transactionSync: (fn) => storage.transactionSync(fn) };
}

// Row readers shared by the assertions.
const updatesCount = (store: BoardStore) =>
  store.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]?.n as number;
const firstBytes = (store: BoardStore) =>
  store.storage.sql.exec('SELECT bytes FROM updates ORDER BY seq LIMIT 1').toArray()[0]?.bytes as number;
const chunksCount = (store: BoardStore) =>
  store.storage.sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0]?.n as number;
const chunkData = (store: BoardStore, idx: number) =>
  store.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', idx).toArray()[0]?.data as
    | ArrayBuffer
    | undefined;
const quarantinedRows = (store: BoardStore) =>
  store.storage.sql
    .exec('SELECT seq, error, quarantined_at FROM quarantined_updates ORDER BY seq')
    .toArray() as { seq: number; error: string; quarantined_at: number }[];
const throughSeq = (store: BoardStore): number => {
  const value = store.storage.sql
    .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
    .toArray()[0]?.value as string | undefined;
  return value === undefined ? 0 : Number(value);
};

/** Load a store's persisted board into a fresh in-memory doc. */
function loadFresh(store: BoardStore): { doc: Y.Doc; result: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  return { doc, result: store.load(doc) };
}

describe('BoardStore (real Durable Object SQLite)', () => {
  it('TC-03: migrate + load on an empty board creates the schema and an empty doc', async () => {
    await withFreshStore((store) => {
      store.migrate();
      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });

      const tables = store.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .toArray()
        .map((r) => r.name as string);
      expect(tables).toEqual(
        expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
      );

      const version = store.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
        .toArray()[0]?.value as string;
      expect(version).toBe(String(STORAGE_SCHEMA_VERSION));

      // The doc is empty (no objects, no meta written by the load).
      expect(doc.getMap('objects').size).toBe(0);
      expect(doc.getMap('meta').size).toBe(0);
    });
  });

  it('TC-04: append one update adds one row with the exact byte count', async () => {
    const built = buildWithUpdates((doc) => {
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
    });
    const update = built.updates[built.updates.length - 1]!;
    await withFreshStore((store) => {
      store.migrate();
      expect(updatesCount(store)).toBe(0);
      store.append(update);
      expect(updatesCount(store)).toBe(1);
      expect(firstBytes(store)).toBe(update.length);
    });
  });

  it('TC-05: a LogOnly 25-note board loads into a fresh doc byte-equivalent', async () => {
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, built);
      expect(chunksCount(store)).toBe(0);
      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(sameState(snapshot(doc), built.state)).toBe(true);
    });
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows, compact replaces the log with a snapshot', async () => {
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    const extra = padWithMoves(built.doc, idsOf(built), COMPACTION_UPDATE_COUNT - built.updates.length);
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, { updates: [...built.updates, ...extra] });
      expect(updatesCount(store)).toBe(COMPACTION_UPDATE_COUNT);

      expect(store.compactIfNeeded(built.doc)).toBe(true);
      expect(updatesCount(store)).toBe(0);
      expect(chunksCount(store)).toBeGreaterThanOrEqual(1);
      expect(throughSeq(store)).toBe(COMPACTION_UPDATE_COUNT);

      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(sameState(snapshot(doc), snapshot(built.doc))).toBe(true);
    });
  });

  it('TC-07: after compaction, only rows with seq > through_seq are applied on load', async () => {
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    const extra = padWithMoves(built.doc, idsOf(built), COMPACTION_UPDATE_COUNT - built.updates.length);
    const three = padWithMoves(built.doc, idsOf(built), 3);
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, { updates: [...built.updates, ...extra] });
      expect(store.compactIfNeeded(built.doc)).toBe(true);
      const through = throughSeq(store);
      appendAll(store, { updates: three });
      expect(updatesCount(store)).toBe(3);
      const seqs = store.storage.sql
        .exec('SELECT seq FROM updates ORDER BY seq')
        .toArray()
        .map((r) => r.seq as number);
      expect(seqs.every((s) => s > through)).toBe(true);

      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(sameState(snapshot(doc), snapshot(built.doc))).toBe(true);
    });
  });

  it(`TC-08: a ${PERSIST_TESTED_NOTES}-note board compacts into multiple chunks and reloads equal`, async () => {
    const built = buildWithUpdates((doc) => makeLargeBoard(doc));
    const encoded = Y.encodeStateAsUpdate(built.doc);
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, built);
      expect(updatesCount(store)).toBe(built.updates.length);

      expect(store.compactIfNeeded(built.doc)).toBe(true);
      expect(updatesCount(store)).toBe(0);
      if (encoded.length > SNAPSHOT_CHUNK_BYTES) {
        expect(chunksCount(store)).toBeGreaterThan(1);
      }
      expect(throughSeq(store)).toBe(built.updates.length);

      const loaded = loadFresh(store);
      expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
      expect(sameState(snapshot(loaded.doc), built.state)).toBe(true);
    });
  });

  it('TC-09: one damaged log row is quarantined; the rest of the board loads intact', async () => {
    // Build the 25-note board, add two more log rows (a 26th note, then a
    // move) and corrupt the LAST row (the move). Two Yjs facts shape the
    // fixture: (1) Yjs drops items of a type after a missing update, so the
    // "all other rows load" property holds for the final row of the log;
    // (2) Yjs applyUpdate is not atomic (a truncated update can apply
    // partially before throwing), so the corruption is same-length random
    // bytes, which fail at the update header (spec Fixtures offer both).
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    const extraUpdates: Uint8Array[] = [];
    const handler = (u: Uint8Array) => {
      extraUpdates.push(u);
    };
    built.doc.on('update', handler);
    createSticky(built.doc, { x: 9000, y: 9000 });
    const expectedState = snapshot(built.doc); // board before the move
    moveObject(built.doc, built.state[0]!.id, 50, 50);
    built.doc.off('update', handler);
    const all = [...built.updates, ...extraUpdates];
    // The move = last row; corrupt it with same-length random bytes.
    const damaged = randomBytes(all[all.length - 1]!.length, 99);

    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, { updates: all });
      // Corrupt the last row in the real table.
      store.storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged, all.length);

      const { doc, result } = loadFresh(store);
      expect(result).toEqual({ ok: true, quarantined: 1 });

      const quarantined = quarantinedRows(store);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]!.seq).toBe(all.length);
      expect(quarantined[0]!.error.length).toBeGreaterThan(0);
      expect(updatesCount(store)).toBe(all.length - 1);

      // The loaded board is the board before the damaged move.
      expect(sameState(snapshot(doc), expectedState)).toBe(true);
    });
  });

  it('TC-10: a damaged snapshot is LoadFailed and deletes nothing', async () => {
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, built);
      expect(store.compactForTests(built.doc)).toBe(true);
      const beforeChunks = chunksCount(store);
      const beforeLog = updatesCount(store);
      const originalChunk = chunkData(store, 0)!;

      // Corrupt chunk 0 in the real table (same length, random bytes).
      store.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
        randomBytes(originalChunk.byteLength),
        0,
      );

      const { result } = loadFresh(store);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');

      // Nothing was deleted or quarantined.
      expect(chunksCount(store)).toBe(beforeChunks);
      expect(updatesCount(store)).toBe(beforeLog);
      expect(quarantinedRows(store)).toHaveLength(0);
    });
  });

  it('TC-11: a SQL failure mid-compaction rolls back; previous chunks and log survive', async () => {
    const built = buildWithUpdates((doc) => makeRetroBoard(doc));
    const extra = padWithMoves(built.doc, idsOf(built), COMPACTION_UPDATE_COUNT - built.updates.length);
    const three = padWithMoves(built.doc, idsOf(built), 3);
    await withFreshStore((store) => {
      store.migrate();
      appendAll(store, { updates: [...built.updates, ...extra] });
      expect(store.compactIfNeeded(built.doc)).toBe(true);
      const previousChunk = chunkData(store, 0)!;
      appendAll(store, { updates: three });
      expect(updatesCount(store)).toBe(3);

      // Inject a failure on the log-deletion statement inside the compaction
      // transaction (after the snapshot chunks were replaced).
      store.storage = failingStorage(store.storage, (q) => q.includes('DELETE FROM updates'));

      expect(store.compactIfNeeded(built.doc)).toBe(false);

      // Rollback: previous snapshot intact, log intact, through_seq unchanged.
      expect(chunkData(store, 0)).toEqual(previousChunk);
      expect(updatesCount(store)).toBe(3);
      expect(throughSeq(store)).toBe(COMPACTION_UPDATE_COUNT);
    });
  });

  it('TC-25: migrate on a never-edited board writes no update or snapshot rows', async () => {
    await withFreshStore((store) => {
      store.migrate();
      expect(updatesCount(store)).toBe(0);
      expect(chunksCount(store)).toBe(0);
      expect(quarantinedRows(store)).toHaveLength(0);
    });
  });
});

function idsOf(built: { doc: Y.Doc }): string[] {
  return snapshot(built.doc).map((n) => n.id);
}
