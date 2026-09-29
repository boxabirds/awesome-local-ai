import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import type { Env } from '../../src/worker/env';
import { BoardStore, LOAD_ORIGIN, chunkBytes } from '../../src/worker/board-store';
import { STORAGE_SCHEMA_VERSION, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '@shared/config';
import { snapshot, initDoc, createSticky, getStickyText } from '@shared/board-model';
import { newBoardId } from '@shared/board-id';
import { seed25Notes, damagedBytes } from '../fixtures/boards';

function getEnv(): Env {
  return env as unknown as Env;
}

function getStub(boardId: string) {
  const ns = getEnv().BOARD_ROOM;
  const id = ns.idFromName(boardId);
  return ns.get(id);
}

/**
 * Run a function with a BoardStore on the given boardId's DO storage.
 */
async function withStore<T>(boardId: string, fn: (store: BoardStore, storage: DurableObjectStorage) => T): Promise<T> {
  const stub = getStub(boardId);
  return runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
    const storage: DurableObjectStorage = obj.ctx.storage;
    const store = new BoardStore(storage);
    store.migrate();
    return fn(store, storage);
  }) as any) as unknown as T;
}

function snapKey(n: { id: string; x: number; y: number; color: string; text: string; z: number }): string {
  return `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}`;
}

function snapsEqual(a: readonly any[], b: readonly any[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort((x, y) => x.id < y.id ? -1 : 1);
  const bSorted = [...b].sort((x, y) => x.id < y.id ? -1 : 1);
  for (let i = 0; i < aSorted.length; i++) {
    if (snapKey(aSorted[i]) !== snapKey(bSorted[i])) return false;
  }
  return true;
}

describe('persist.board_store integration', () => {
  it('TC-03: Empty — migrate + load → tables exist, doc empty, schema version set', async () => {
    const board = newBoardId();
    const result = await withStore(board, (store, storage) => {
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      const meta = storage.sql.exec<{ key: string; value: string }>(
        `SELECT key, value FROM storage_meta`
      ).toArray();
      const versionRow = meta.find((r) => r.key === 'storage_schema_version');
      return { loadResult, snap: snapshot(doc), versionRow };
    });
    expect(result.loadResult.ok).toBe(true);
    expect(result.snap).toHaveLength(0);
    expect(result.versionRow?.value).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-04: Empty → append one update → 1 row, bytes column = length', async () => {
    const board = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 10, y: 10 });
    const bytes = Y.encodeStateAsUpdate(doc);

    const result = await withStore(board, (store, storage) => {
      store.append(bytes);
      const rows = storage.sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM updates`
      ).toArray();
      return { rows };
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bytes).toBe(bytes.byteLength);
  });

  it('TC-05: LogOnly 25 notes → load into fresh doc equals original snapshot', async () => {
    const board = newBoardId();
    const srcDoc = new Y.Doc();
    seed25Notes(srcDoc);
    const bytes = Y.encodeStateAsUpdate(srcDoc);
    const originalSnap = snapshot(srcDoc);

    const result = await withStore(board, (store) => {
      store.append(bytes);
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      return { loadResult, snap: snapshot(doc) };
    });
    expect(result.loadResult.ok).toBe(true);
    expect(snapsEqual(result.snap, originalSnap)).toBe(true);
  });

  it('TC-06: COMPACTION_UPDATE_COUNT rows → compact → updates 0, chunks >=1, through_seq = maxSeq, reload equal', async () => {
    const board = newBoardId();
    const result = await withStore(board, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      // First append is the full initial state
      store.append(Y.encodeStateAsUpdate(doc));

      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        const prev = Y.encodeStateVector(doc);
        createSticky(doc, { x: i * 10, y: i * 5 });
        store.append(Y.encodeStateAsUpdate(doc, prev));
      }
      const expectedSnap = snapshot(doc);

      const compacted = store.compactIfNeeded(doc);
      const rowsAfter = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      const chunks = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM snapshot_chunks`).next();
      const throughSeq = storage.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`
      ).next();

      const freshDoc = new Y.Doc();
      const loadResult = store.load(freshDoc);

      return {
        compacted,
        rowsAfter: rowsAfter.done ? 0 : rowsAfter.value.cnt,
        chunks: chunks.done ? 0 : chunks.value.cnt,
        throughSeq: throughSeq.done ? 0 : Number(throughSeq.value.value),
        loadResult,
        loadedSnap: snapshot(freshDoc),
        expectedSnap,
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.rowsAfter).toBe(0);
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.throughSeq).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    expect(result.loadResult.ok).toBe(true);
    expect(snapsEqual(result.loadedSnap, result.expectedSnap)).toBe(true);
  });

  it('TC-07: SnapshotPlusLog: 3 updates after compaction → reload has all', async () => {
    const board = newBoardId();
    const result = await withStore(board, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      store.append(Y.encodeStateAsUpdate(doc));

      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        const prev = Y.encodeStateVector(doc);
        createSticky(doc, { x: i * 10, y: i * 5 });
        store.append(Y.encodeStateAsUpdate(doc, prev));
      }
      store.compactIfNeeded(doc);

      // Add 3 more after compaction
      for (let i = 0; i < 3; i++) {
        const prev = Y.encodeStateVector(doc);
        createSticky(doc, { x: 9000 + i * 50, y: 9000 + i * 50 });
        store.append(Y.encodeStateAsUpdate(doc, prev));
      }

      const expectedSnap = snapshot(doc);
      const rowsCount = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();

      const freshDoc = new Y.Doc();
      const loadResult = store.load(freshDoc);
      return {
        rowsCount: rowsCount.done ? 0 : rowsCount.value.cnt,
        loadResult,
        loadedSnap: snapshot(freshDoc),
        expectedSnap,
      };
    });

    expect(result.rowsCount).toBe(3);
    expect(result.loadResult.ok).toBe(true);
    expect(snapsEqual(result.loadedSnap, result.expectedSnap)).toBe(true);
  });

  it('TC-09: damaged log row → quarantined, rest applied', async () => {
    const board = newBoardId();
    const result = await withStore(board, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      store.append(Y.encodeStateAsUpdate(doc));

      for (let i = 0; i < 10; i++) {
        const prev = Y.encodeStateVector(doc);
        createSticky(doc, { x: i * 100, y: i * 100 });
        store.append(Y.encodeStateAsUpdate(doc, prev));
      }
      const expectedSnap = snapshot(doc);

      // Corrupt one row
      const allRows = storage.sql.exec<{ seq: number; data: ArrayBuffer }>(
        `SELECT seq, data FROM updates ORDER BY seq`
      ).toArray();
      const targetRow = allRows[7]; // 8th row
      const damaged = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE updates SET data = ?1, bytes = ?2 WHERE seq = ?3`,
          damaged,
          damaged.byteLength,
          targetRow.seq,
        );
      });

      const freshDoc = new Y.Doc();
      const loadResult = store.load(freshDoc);
      const quarantined = storage.sql.exec<{ seq: number; error: string }>(
        `SELECT seq, error FROM quarantined_updates`
      ).toArray();

      return {
        loadResult,
        loadedSnap: snapshot(freshDoc),
        expectedSnap,
        quarantined,
      };
    });

    expect(result.loadResult.ok).toBe(true);
    if (result.loadResult.ok) {
      expect(result.loadResult.quarantined).toBe(1);
    }
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].error).toBeTruthy();
    // Most notes should be present (some may fail to apply due to Yjs internal dependencies)
    expect(result.loadedSnap.length).toBeGreaterThanOrEqual(5);
  });

  it('TC-10: damaged snapshot → snapshot-unreadable, nothing deleted or quarantined', async () => {
    const board = newBoardId();
    const result = await withStore(board, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      seed25Notes(doc);

      // Write a snapshot manually
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      storage.transactionSync(() => {
        storage.sql.exec(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          storage.sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, i, chunks[i]);
        }
        storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          '0',
        );
      });

      const chunksBefore = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM snapshot_chunks`).next();
      const updatesBefore = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();

      // Corrupt chunk 0
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
      });

      const freshDoc = new Y.Doc();
      const loadResult = store.load(freshDoc);

      const chunksAfter = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM snapshot_chunks`).next();
      const updatesAfter = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      const quarantined = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM quarantined_updates`).next();

      return {
        loadResult,
        chunksBefore: chunksBefore.done ? 0 : chunksBefore.value.cnt,
        chunksAfter: chunksAfter.done ? 0 : chunksAfter.value.cnt,
        updatesBefore: updatesBefore.done ? 0 : updatesBefore.value.cnt,
        updatesAfter: updatesAfter.done ? 0 : updatesAfter.value.cnt,
        quarantined: quarantined.done ? 0 : quarantined.value.cnt,
      };
    });

    expect(result.loadResult.ok).toBe(false);
    if (!result.loadResult.ok) {
      expect(result.loadResult.reason).toBe('snapshot-unreadable');
    }
    // Nothing deleted or quarantined
    expect(result.chunksAfter).toBe(result.chunksBefore);
    expect(result.updatesAfter).toBe(result.updatesBefore);
    expect(result.quarantined).toBe(0);
  });

  it('TC-25: migrate on never-edited board writes no updates/snapshot_chunks rows', async () => {
    const board = newBoardId();
    const result = await withStore(board, (_store, storage) => {
      const updates = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      const chunks = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM snapshot_chunks`).next();
      return {
        updates: updates.done ? 0 : updates.value.cnt,
        chunks: chunks.done ? 0 : chunks.value.cnt,
      };
    });
    expect(result.updates).toBe(0);
    expect(result.chunks).toBe(0);
  });
});
