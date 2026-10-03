// Integration tests for BoardStore against real Durable Object SQLite.
// TC-03 to TC-11, TC-25.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import {
  BoardStore,
  LOAD_ORIGIN,
  type DurableObjectStorage,
} from '../../src/worker/board-store';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, snapshot, createSticky } from '../../src/shared/board-model';
import {
  makeRetroBoard,
  makeLargeBoard,
  docToBytes,
} from '../fixtures/boards';

/**
 * Run a function with the store inside the Durable Object context.
 * All SQL work must happen inside; only return simple values.
 */
async function withStore<T>(boardId: string, fn: (store: BoardStore) => Promise<T>): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let result: T | undefined;
  await runInDurableObject(stub, async (instance) => {
    const ctx = (instance as any).ctx as { storage: DurableObjectStorage };
    const store = new BoardStore(ctx.storage);
    result = await fn(store);
  });
  return result!;
}

describe('persist.board_store integration', () => {
  it('TC-03: Empty board — migrate then load → tables exist, doc empty, schema version set', async () => {
    const boardId = newBoardId();
    const result = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      const loadResult = await store.load(doc);
      const snapLen = snapshot(doc).length;

      // Verify schema version.
      const cursor = store.storage.sql as any;
      const vCursor = cursor.exec(
        "SELECT value FROM storage_meta WHERE key = 'storage_schema_version'",
      );
      const vRow = vCursor.next();
      const schemaVersion = vRow.done ? null : (vRow.value['value'] as string);

      return { loadResult, snapLen, schemaVersion };
    });

    expect(result.loadResult.ok).toBe(true);
    if (result.loadResult.ok) expect(result.loadResult.quarantined).toBe(0);
    expect(result.snapLen).toBe(0);
    expect(result.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-04: append one update → 1 row, bytes column equals length', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 10, y: 20 });
    const update = docToBytes(doc);
    const updateLen = update.length;

    const result = await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(update);
      const cursor = store.storage.sql as any;
      const row = cursor.exec('SELECT COUNT(*) as cnt, bytes FROM updates').next();
      return { cnt: row.value['cnt'] as number, bytes: row.value['bytes'] as number };
    });

    expect(result.cnt).toBe(1);
    expect(result.bytes).toBe(updateLen);
  });

  it('TC-05: LogOnly 25 notes → load into fresh doc equals original snapshot', async () => {
    const boardId = newBoardId();
    const { doc: origDoc } = makeRetroBoard();
    const origSnapshot = JSON.stringify(snapshot(origDoc));
    const update = Y.encodeStateAsUpdate(origDoc);

    await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(update);
    });

    // Load into a fresh doc and compare.
    const loadedSnap = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      const result = await store.load(doc);
      return { ok: result.ok, snap: JSON.stringify(snapshot(doc)) };
    });

    expect(loadedSnap.ok).toBe(true);
    expect(loadedSnap.snap).toBe(origSnapshot);
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows → compact → updates 0, chunks ≥ 1, reload equal', async () => {
    const boardId = newBoardId();
    const { doc } = makeRetroBoard();
    const origSnapshot = JSON.stringify(snapshot(doc));
    const update = Y.encodeStateAsUpdate(doc);

    // Store enough updates to reach the threshold.
    await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(update);
      const tiny = new Uint8Array([0x00]);
      for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
        await store.append(tiny);
      }
    });

    const result = await withStore(boardId, async (store) => {
      store.migrate();
      const countBefore = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;

      const compacted = await store.compactIfNeeded(doc);

      const countAfter = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;
      const chunkCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      const throughSeq = (store.storage.sql as any).exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").next().value['value'] as string | undefined;

      return { compacted, countBefore, countAfter, chunkCount, throughSeq };
    });

    expect(result.compacted).toBe(true);
    expect(result.countBefore).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.countAfter).toBe(0);
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.throughSeq).toBe(String(COMPACTION_UPDATE_COUNT));

    // Reload and verify the real notes are present.
    const reloaded = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      await store.load(doc);
      return JSON.stringify(snapshot(doc));
    });
    expect(reloaded).toBe(origSnapshot);
  });

  it('TC-07: SnapshotPlusLog → 3 updates after compaction → reload has all', async () => {
    const boardId = newBoardId();
    const { doc } = makeRetroBoard();
    const baseUpdate = Y.encodeStateAsUpdate(doc);

    // Store and compact the base board.
    await withStore(boardId, async (store) => {
      store.migrate();
      const tiny = new Uint8Array([0x00]);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        await store.append(tiny);
      }
      await store.append(baseUpdate);
      await store.compactIfNeeded(doc);
    });

    // Now create 3 more notes on top of the base.
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, baseUpdate, 'seed');
    for (let i = 0; i < 3; i++) {
      createSticky(doc2, { x: 5000 + i * 100, y: 5000 });
    }
    const finalSnapshot = JSON.stringify(snapshot(doc2));
    const fullUpdate2 = Y.encodeStateAsUpdate(doc2);

    // Store the new full state as an update.
    await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(fullUpdate2);
    });

    // Reload and verify all notes are present.
    const reloaded = await withStore(boardId, async (store) => {
      store.migrate();
      const d = new Y.Doc();
      const result = await store.load(d);
      return { ok: result.ok, snap: JSON.stringify(snapshot(d)) };
    });

    expect(reloaded.ok).toBe(true);
    expect(reloaded.snap).toBe(finalSnapshot);
  });

  it('TC-08: PERSIST_TESTED_NOTES board compaction → multiple chunks, reload equal', async () => {
    const boardId = newBoardId();
    const { doc } = makeLargeBoard(PERSIST_TESTED_NOTES);
    const origSnapshot = JSON.stringify(snapshot(doc));
    const encoded = Y.encodeStateAsUpdate(doc);

    // Verify the encoded size exceeds SNAPSHOT_CHUNK_BYTES.
    expect(encoded.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const result = await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(encoded);
      const tiny = new Uint8Array([0x00]);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        await store.append(tiny);
      }
      const compacted = await store.compactIfNeeded(doc);
      const chunkCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      return { compacted, chunkCount };
    });

    expect(result.compacted).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(1);

    // Reload and verify.
    const reloaded = await withStore(boardId, async (store) => {
      store.migrate();
      const d = new Y.Doc();
      const loadResult = await store.load(d);
      return { ok: loadResult.ok, snap: JSON.stringify(snapshot(d)) };
    });

    expect(reloaded.ok).toBe(true);
    expect(reloaded.snap).toBe(origSnapshot);
  });

  it('TC-09: damaged log row → quarantined, other notes present', async () => {
    const boardId = newBoardId();
    const { doc } = makeRetroBoard();
    const update = Y.encodeStateAsUpdate(doc);

    // Store the update.
    await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(update);
    });

    // Corrupt the KV data for seq 1.
    await withStore(boardId, async (store) => {
      const original = await store.storage.get('update:1');
      if (original instanceof Uint8Array && original.length > 10) {
        // Truncate the data to make it invalid.
        const damaged = original.subarray(0, original.length - 10);
        await store.storage.put('update:1', damaged);
      }
    });

    // Load should quarantine the damaged row.
    const result = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      const loadResult = await store.load(doc);
      const quarantinedCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM quarantined_updates').next().value['cnt'] as number;
      const updatesCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;
      return { loadResult, quarantinedCount, updatesCount };
    });

    expect(result.loadResult.ok).toBe(true);
    if (result.loadResult.ok) expect(result.loadResult.quarantined).toBe(1);
    expect(result.quarantinedCount).toBe(1);
    expect(result.updatesCount).toBe(0);
  });

  it('TC-10: corrupt snapshot chunk → snapshot-unreadable, nothing deleted', async () => {
    const boardId = newBoardId();
    const { doc } = makeRetroBoard();
    const update = Y.encodeStateAsUpdate(doc);

    // Store and compact to create a snapshot.
    await withStore(boardId, async (store) => {
      store.migrate();
      const tiny = new Uint8Array([0x00]);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        await store.append(tiny);
      }
      await store.append(update);
      await store.compactIfNeeded(doc);
    });

    // Corrupt chunk 0's KV data.
    await withStore(boardId, async (store) => {
      // Find the kv_key for idx 0.
      const cursor = (store.storage.sql as any).exec("SELECT kv_key FROM snapshot_chunks WHERE idx = 0");
      const row = cursor.next();
      if (!row.done) {
        const kvKey = row.value['kv_key'] as string;
        await store.storage.put(kvKey, new Uint8Array([0xff]));
      }
    });

    // Load should fail with snapshot-unreadable.
    const result = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      const loadResult = await store.load(doc);
      const quarantinedCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM quarantined_updates').next().value['cnt'] as number;
      const chunksCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      return { loadResult, quarantinedCount, chunksCount };
    });

    expect(result.loadResult.ok).toBe(false);
    if (!result.loadResult.ok) {
      expect(result.loadResult.reason).toBe('snapshot-unreadable');
    }
    expect(result.quarantinedCount).toBe(0);
    expect(result.chunksCount).toBeGreaterThanOrEqual(1);
  });

  it('TC-11: below threshold after compaction → no re-compaction, state unchanged', async () => {
    const boardId = newBoardId();
    const { doc } = makeRetroBoard();
    const update = Y.encodeStateAsUpdate(doc);

    // Store and compact.
    await withStore(boardId, async (store) => {
      store.migrate();
      const tiny = new Uint8Array([0x00]);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        await store.append(tiny);
      }
      await store.append(update);
      const compacted = await store.compactIfNeeded(doc);
      if (!compacted) throw new Error('Expected compaction to succeed');
    });

    // Verify state after first compaction.
    const beforeState = await withStore(boardId, async (store) => {
      store.migrate();
      const chunks = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      const updates = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;
      return { chunks, updates };
    });

    expect(beforeState.chunks).toBeGreaterThanOrEqual(1);
    expect(beforeState.updates).toBe(0);

    // Add one more update (below threshold) — should NOT compact.
    const afterState = await withStore(boardId, async (store) => {
      store.migrate();
      await store.append(new Uint8Array([0x01, 0x00, 0x00]));
      const compacted = await store.compactIfNeeded(doc);
      const chunks = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      const updates = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;
      return { compacted, chunks, updates };
    });

    expect(afterState.compacted).toBe(false);
    expect(afterState.chunks).toBe(beforeState.chunks);
    expect(afterState.updates).toBe(1);
  });

  it('TC-25: never-edited board → no updates/snapshot_chunks rows', async () => {
    const boardId = newBoardId();
    const result = await withStore(boardId, async (store) => {
      store.migrate();
      const doc = new Y.Doc();
      await store.load(doc);
      const updatesCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM updates').next().value['cnt'] as number;
      const chunksCount = (store.storage.sql as any).exec('SELECT COUNT(*) as cnt FROM snapshot_chunks').next().value['cnt'] as number;
      return { updatesCount, chunksCount };
    });

    expect(result.updatesCount).toBe(0);
    expect(result.chunksCount).toBe(0);
  });
});
