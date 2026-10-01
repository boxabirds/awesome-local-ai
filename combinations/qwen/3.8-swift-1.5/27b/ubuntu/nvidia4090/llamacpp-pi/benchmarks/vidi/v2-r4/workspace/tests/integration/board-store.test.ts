import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model.ts';
import {
  STORAGE_SCHEMA_VERSION,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config.ts';
import { truncatedUpdate, randomBytesOfLength } from '../fixtures/boards.ts';

type StoreFn<T> = (store: BoardStore) => T;

/**
 * Run `fn` with a fresh `BoardStore` backed by a real Durable Object SQLite database.
 * Each call uses a brand-new board id, so storage is isolated per test.
 */
function inStore<T>(fn: StoreFn<T>): Promise<T> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    return fn(store);
  });
}

/**
 * Make `n` incremental Yjs updates by applying `mutate` `n` times on a fresh doc,
 * capturing each update. Returns the doc (final state) and the list of updates.
 */
function captureNUpdates(n: number, mutate: (doc: Y.Doc, i: number) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  initDoc(doc);
  for (let i = 0; i < n; i++) mutate(doc, i);
  doc.off('update', handler);
  return { doc, updates };
}

/** Build a doc with 2 stickies (meaningful snapshot) plus `n` log updates. */
function docWithStickiesAndLog(n: number): { doc: Y.Doc; updates: Uint8Array[]; original: ReturnType<typeof snapshot> } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  initDoc(doc);
  createSticky(doc, { x: 0, y: 0 });
  createSticky(doc, { x: 10, y: 10 });
  const original = snapshot(doc);
  const map = doc.getMap('log');
  for (let i = 0; updates.length < n; i++) map.set(String(i), i);
  doc.off('update', handler);
  return { doc, updates, original };
}

describe('BoardStore (real Durable Object SQLite)', () => {
  it('TC-03: empty board loads with schema version and tables', async () => {
    const r = await inStore((store) => {
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      const version = (store.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
        .toArray()[0] as { value: string } | undefined)?.value;
      const tables = (
        store.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray() as { name: string }[]
      ).map((t) => t.name);
      return { loadResult, version, tables, notes: snapshot(doc).length };
    });
    expect(r.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(r.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(r.notes).toBe(0);
    for (const t of ['updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta']) {
      expect(r.tables).toContain(t);
    }
  });

  it('TC-04: append writes one row with bytes = length', async () => {
    const r = await inStore((store) => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 10, y: 20 });
      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);
      const rows = store.storage.sql.exec('SELECT bytes FROM updates').toArray() as { bytes: number }[];
      return { rowCount: rows.length, bytes: rows[0]?.bytes, len: update.length };
    });
    expect(r.rowCount).toBe(1);
    expect(r.bytes).toBe(r.len);
  });

  it('TC-05: 25-note board loads into fresh doc equal to original', async () => {
    const { doc, updates } = captureNUpdates(25, (d, i) => createSticky(d, { x: i * 37, y: i * 11 }));
    const original = snapshot(doc);
    const r = await inStore((store) => {
      for (const u of updates) store.append(u);
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      return { loadResult, reloaded: snapshot(fresh) };
    });
    expect(r.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(r.reloaded).toEqual(original);
  });

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT threshold', async () => {
    const { doc, updates, original } = docWithStickiesAndLog(COMPACTION_UPDATE_COUNT);
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT);
    const r = await inStore((store) => {
      for (const u of updates) store.append(u);
      const maxSeqBefore = (store.storage.sql
        .exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates')
        .toArray()[0] as { m: number }).m;
      const compacted = store.compactIfNeeded(doc);
      const updatesCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      const chunksCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const throughSeq = (store.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .toArray()[0] as { value: string } | undefined)?.value;
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      return { compacted, updatesCount, chunksCount, throughSeq, loadResult, reloaded: snapshot(fresh), maxSeqBefore };
    });
    expect(r.compacted).toBe(true);
    expect(r.updatesCount).toBe(0);
    expect(r.chunksCount).toBeGreaterThanOrEqual(1);
    expect(r.throughSeq).toBe(String(r.maxSeqBefore));
    expect(r.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(r.reloaded).toEqual(original);
  });

  it('TC-07: snapshot + 3 log updates reload has all', async () => {
    const doc = new Y.Doc();
    const updates1: Uint8Array[] = [];
    let handler = (u: Uint8Array) => updates1.push(u);
    doc.on('update', handler);
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const map = doc.getMap('log');
    for (let i = 0; updates1.length < COMPACTION_UPDATE_COUNT; i++) map.set(String(i), i);
    doc.off('update', handler);
    const updates2: Uint8Array[] = [];
    handler = (u: Uint8Array) => updates2.push(u);
    doc.on('update', handler);
    createSticky(doc, { x: 100, y: 0 });
    createSticky(doc, { x: 200, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    doc.off('update', handler);
    const finalSnapshot = snapshot(doc);
    expect(updates2.length).toBeGreaterThanOrEqual(3);

    const r = await inStore((store) => {
      for (const u of updates1) store.append(u);
      store.compactIfNeeded(doc);
      for (const u of updates2) store.append(u);
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      return { loadResult, reloaded: snapshot(fresh) };
    });
    expect(r.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(r.reloaded).toEqual(finalSnapshot);
  });

  it('TC-08: large board compaction produces multiple chunks and reloads equal', async () => {
    const { doc, updates } = captureNUpdates(PERSIST_TESTED_NOTES, (d, i) => {
      const id = createSticky(d, { x: (i % 10) * 100, y: Math.floor(i / 10) * 80 });
      const text = getStickyText(d, id);
      if (text) text.insert(0, 'note ' + i + ' ' + 'x'.repeat(280));
    });
    const original = snapshot(doc);
    expect(original.length).toBe(PERSIST_TESTED_NOTES);
    const r = await inStore((store) => {
      for (const u of updates) store.append(u);
      const compacted = store.compactIfNeeded(doc);
      const chunksCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      return { compacted, chunksCount, loadResult, reloaded: snapshot(fresh) };
    });
    expect(r.compacted).toBe(true);
    expect(r.chunksCount).toBeGreaterThan(1);
    expect(r.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(r.reloaded).toEqual(original);
  });

  it('TC-09: damaged log row is quarantined, others present', async () => {
    const { updates } = captureNUpdates(25, (d, i) => createSticky(d, { x: i, y: 0 }));
    const r = await inStore((store) => {
      for (const u of updates) store.append(u);
      const row7 = store.storage.sql.exec('SELECT data FROM updates WHERE seq = 7').toArray()[0] as { data: Uint8Array };
      store.storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', truncatedUpdate(row7.data));
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const quarantined = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM quarantined_updates').toArray()[0] as { c: number }).c;
      const updatesCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      const qRow = store.storage.sql.exec('SELECT seq, error FROM quarantined_updates').toArray()[0] as { seq: number; error: string };
      return { loadResult, quarantined, updatesCount, qRow, reloaded: snapshot(fresh) };
    });
    expect(r.loadResult).toEqual({ ok: true, quarantined: 1 });
    expect(r.quarantined).toBe(1);
    // 26 rows (1 initDoc + 25 stickies) minus 1 quarantined = 25
    expect(r.updatesCount).toBe(25);
    expect(r.qRow.seq).toBe(7);
    expect(r.qRow.error).toBeTruthy();
    // Yjs updates are incremental deltas: rows after the damaged one depend on it and
    // become no-ops, so the notes that survive are those applied before seq 7
    // (initDoc + stickies 1..5 = 5 notes).
    expect(r.reloaded.length).toBe(5);
  });

  it('TC-10: corrupted snapshot yields snapshot-unreadable, nothing deleted', async () => {
    const { doc, updates } = docWithStickiesAndLog(COMPACTION_UPDATE_COUNT);
    const r = await inStore((store) => {
      for (const u of updates) store.append(u);
      store.compactIfNeeded(doc);
      const chunksBefore = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const updatesBefore = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      // corrupt chunk 0
      store.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesOfLength(200));
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const chunksAfter = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const updatesAfter = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      const quarantined = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM quarantined_updates').toArray()[0] as { c: number }).c;
      return { loadResult, chunksBefore, chunksAfter, updatesBefore, updatesAfter, quarantined };
    });
    expect(r.loadResult).toEqual({ ok: false, reason: 'snapshot-unreadable' });
    expect(r.chunksAfter).toBe(r.chunksBefore); // nothing deleted
    expect(r.updatesAfter).toBe(r.updatesBefore); // nothing deleted
    expect(r.quarantined).toBe(0); // nothing quarantined
  });

  it('TC-11: failed compaction rolls back, previous chunks and log unchanged', async () => {
    const doc = new Y.Doc();
    const updates1: Uint8Array[] = [];
    let handler = (u: Uint8Array) => updates1.push(u);
    doc.on('update', handler);
    initDoc(doc);
    const map1 = doc.getMap('l1');
    for (let i = 0; updates1.length < COMPACTION_UPDATE_COUNT; i++) map1.set(String(i), i);
    doc.off('update', handler);
    const updates2: Uint8Array[] = [];
    handler = (u: Uint8Array) => updates2.push(u);
    doc.on('update', handler);
    const map2 = doc.getMap('l2');
    for (let i = 0; updates2.length < COMPACTION_UPDATE_COUNT; i++) map2.set(String(i), i);
    doc.off('update', handler);

    const r = await inStore((store) => {
      for (const u of updates1) store.append(u);
      store.compactIfNeeded(doc); // successful compaction
      const chunksAfterFirst = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const updatesAfterFirst = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      for (const u of updates2) store.append(u);
      // inject a failure on the snapshot chunk INSERT (after DELETE snapshot_chunks)
      const origExec = store.storage.sql.exec.bind(store.storage.sql);
      (store.storage.sql as unknown as { exec: unknown }).exec = (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO snapshot_chunks')) throw new Error('injected compaction failure');
        return origExec(sql, ...(params as []));
      };
      const compacted = store.compactIfNeeded(doc);
      const chunksAfterFail = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      const updatesAfterFail = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      return { chunksAfterFirst, updatesAfterFirst, compacted, chunksAfterFail, updatesAfterFail };
    });
    expect(r.chunksAfterFirst).toBeGreaterThanOrEqual(1);
    expect(r.updatesAfterFirst).toBe(0);
    expect(r.compacted).toBe(false);
    expect(r.chunksAfterFail).toBe(r.chunksAfterFirst); // rolled back
    expect(r.updatesAfterFail).toBe(COMPACTION_UPDATE_COUNT); // log unchanged
  });

  it('TC-25: migrate on never-edited board writes no update or chunk rows', async () => {
    const r = await inStore((store) => {
      const updatesCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      const chunksCount = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      return { updatesCount, chunksCount };
    });
    expect(r.updatesCount).toBe(0);
    expect(r.chunksCount).toBe(0);
  });
});
