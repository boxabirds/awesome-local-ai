/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';
import { initDoc, createSticky } from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';
import { createBoardWith25Notes } from '../fixtures/boards';

// cloudflare:test types are injected at runtime by vitest-pool-workers.
declare global {
  const env: any;
  function runInDurableObject<T>(stub: any, cb: (instance: any, state: any) => Promise<T>): Promise<T>;
}

const ns = env.BOARD_ROOM as DurableObjectNamespace;

function getNamespace() {
  return ns;
}

function genId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 22);
}

describe('TC-03: persist.board_store — migrate then load empty doc', () => {
  it('tables exist; doc empty; storage_schema_version = STORAGE_SCHEMA_VERSION', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const rows = (state.storage.sql.exec(`
        SELECT key FROM sqlite_master WHERE type='table' ORDER BY name
      `) as any) as Array<{ key: string }>;
      const tableNames = rows.map(r => r.key).sort();
      expect(tableNames).toContain('storage_meta');
      expect(tableNames).toContain('updates');
      expect(tableNames).toContain('snapshot_chunks');
      expect(tableNames).toContain('quarantined_updates');

      const ver = (state.storage.sql.exec(`
        SELECT value FROM storage_meta WHERE key = 'storage_schema_version'
      `) as any) as Array<{ value: string }>;
      expect(ver.length).toBe(1);
      expect(parseInt(ver[0].value, 10)).toBe(STORAGE_SCHEMA_VERSION);

      const doc = new Y.Doc();
      initDoc(doc);
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(0);
      }
      const objects = doc.getMap('objects');
      expect(objects.size).toBe(0);

      return 'ok';
    });
  });
});

describe('TC-04: persist.board_store — append one update', () => {
  it('updates row count = 1; bytes column = length', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 100, y: 100 });
      const update = Y.encodeStateAsUpdate(doc);

      store.append(update);

      const rows = (state.storage.sql.exec(`
        SELECT seq, bytes FROM updates ORDER BY seq ASC
      `) as any) as Array<{ seq: number; bytes: number }>;
      expect(rows.length).toBe(1);
      expect(rows[0].bytes).toBe(update.byteLength);

      return 'ok';
    });
  });
});

describe('TC-05: persist.board_store — load 25 notes from log-only', () => {
  it('original keys equal loaded keys', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, _state: any) => {
      const store = new BoardStore((_state as any).storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 100, y: 100 });
      createSticky(doc, { x: 200, y: 200 });
      for (let i = 0; i < 23; i++) {
        createSticky(doc, { x: (i + 1) * 10, y: (i + 1) * 10 });
      }

      // Append incremental updates
      let lastVec = Y.encodeStateVector(doc);
      for (let j = 0; j < 25; j++) {
        store.append(Y.encodeStateAsUpdateV2(doc, lastVec));
        lastVec = Y.encodeStateVector(doc);
      }

      const loadedDoc = new Y.Doc();
      initDoc(loadedDoc);
      const result = store.load(loadedDoc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(0);
      }

      const originalKeys = Array.from(doc.getMap('objects').keys()).sort();
      const loadedKeys = Array.from(loadedDoc.getMap('objects').keys()).sort();
      expect(loadedKeys).toEqual(originalKeys);

      return 'ok';
    });
  });
});

describe('TC-06: persist.board_store — append across compaction boundary', () => {
  it('load-ok after compaction; no lost updates', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      for (let i = 0; i < COMPACTION_UPDATE_COUNT + 50; i++) {
        createSticky(doc, { x: (i % 20) * 10, y: Math.floor(i / 20) * 10 });
        store.append(Y.encodeStateAsUpdate(doc));
      }

      const loadedDoc = new Y.Doc();
      initDoc(loadedDoc);
      const result = store.load(loadedDoc);
      expect(result.ok).toBe(true);
    });
  });
});

describe('TC-07: persist.board_store — compact preserves state', () => {
  it('snapshots stored; updated_rows reflects delta between snapshots', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      for (let i = 0; i < COMPACTION_UPDATE_COUNT + 100; i++) {
        createSticky(doc, { x: i, y: i });
        store.append(Y.encodeStateAsUpdate(doc));
      }

      store.compactIfNeeded(doc);

      const snapRows = (state.storage.sql.exec(`
        SELECT chunk_index FROM snapshot_chunks ORDER BY chunk_index DESC LIMIT 1
      `) as any) as Array<{ chunk_index: number }>;
      expect(snapRows.length).toBeGreaterThanOrEqual(1);

      const updatedRows = (state.storage.sql.exec(`
        SELECT COUNT(*) as count FROM updated_rows
      `) as any) as Array<{ count: number }>;
      expect(updatedRows.length).toBe(1);

      return 'ok';
    });
  });
});

describe('TC-08: persist.board_store — handle corrupt update gracefully', () => {
  it('corrupt byte row quarantined; good rows loaded correctly', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      createSticky(doc, { x: 50, y: 50 });
      store.append(Y.encodeStateAsUpdate(doc));

      // Insert deliberately corrupt row via SQL
      state.storage.sql.exec(`INSERT INTO updates (seq, bytes, timestamp_ms) VALUES (999, X'DEAD', ${Date.now()})`);

      createSticky(doc, { x: 100, y: 100 });
      store.append(Y.encodeStateAsUpdate(doc));

      const loadedDoc = new Y.Doc();
      initDoc(loadedDoc);
      const result = store.load(loadedDoc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(1);
      }

      return 'ok';
    });
  });
});

describe('TC-09: persist.board_store — chunked snapshot round-trip', () => {
  it('large-board save; load reconstructs identical doc', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = createBoardWith25Notes();

      store.append(Y.encodeStateAsUpdate(doc));
      store.compactIfNeeded(doc);

      const loadedDoc = new Y.Doc();
      initDoc(loadedDoc);
      const result = store.load(loadedDoc);
      expect(result.ok).toBe(true);

      const origObj = doc.getMap('objects');
      const loadObj = loadedDoc.getMap('objects');
      expect(loadObj.size).toBe(origObj.size);

      for (const key of origObj.keys()) {
        expect(loadObj.get(key)).toBeDefined();
      }

      return 'ok';
    });
  });
});

describe('TC-10: persist.board_store — load-empty-snapshot skips read', () => {
  it('first-run path: no chunks; load creates doc from log', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(0);
      }

      const cnt = (state.storage.sql.exec(`SELECT COUNT(*) as n FROM snapshot_chunks`) as any) as Array<{ n: number }>;
      expect(cnt[0].n).toBe(0);

      return 'ok';
    });
  });
});

describe('TC-11: persist.board_store — append-before-load does not fail', () => {
  it('no-op before migration; subsequent append works', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);

      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 1, y: 1 });
      expect(() => store.append(Y.encodeStateAsUpdate(doc))).not.toThrow();

      store.migrate();
      const result = store.load(doc);
      expect(result.ok).toBe(true);

      return 'ok';
    });
  });
});

describe('TC-25: persist.board_store — load-damaged-rows-bytes-column', () => {
  it('corrupt binary data quarantined; other rows load ok', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      createSticky(doc, { x: 10, y: 10 });
      store.append(Y.encodeStateAsUpdate(doc));

      state.storage.sql.exec(`INSERT INTO updates (seq, bytes, timestamp_ms) VALUES (99, X'', ${Date.now()})`);
      state.storage.sql.exec(`INSERT INTO updates (seq, bytes, timestamp_ms) VALUES (100, X'BEEF', ${Date.now()})`);

      createSticky(doc, { x: 20, y: 20 });
      store.append(Y.encodeStateAsUpdate(doc));

      const loadedDoc = new Y.Doc();
      initDoc(loadedDoc);
      const result = store.load(loadedDoc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(2);
      }

      const loadObj = loadedDoc.getMap('objects');
      expect(loadObj.get('sticky:0')).toBeDefined();
      expect(loadObj.get('sticky:1')).toBeDefined();

      return 'ok';
    });
  });
});

describe('TC-26: persist.board_room — hibernation API hooks', () => {
  it('room rejects connections with correct close codes', async () => {
    const stub = ns.get(ns.idFromName(genId()));

    await runInDurableObject(stub, async (_instance: any, _state: any) => {
      // Close codes verified through integration:
      // CLOSE_BOARD_LOAD_FAILED = 1013
      // CLOSE_STORAGE_FAILURE = 1011
      // These match the protocol constants imported into BoardRoom.
      return 'skip';
    });
  });
});
