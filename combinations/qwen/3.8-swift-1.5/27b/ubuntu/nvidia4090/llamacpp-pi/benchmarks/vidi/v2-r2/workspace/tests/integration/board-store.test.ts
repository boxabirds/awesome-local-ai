import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import { startServer, stopServer, URL } from './server';
import { newBoardId } from '../../src/shared/board-id';
import {
  STORAGE_SCHEMA_VERSION,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import {
  makeRetroBoard,
  makeLargeBoard,
  damageTruncated,
  toB64,
  type GeneratedBoard,
} from '../fixtures/boards';

async function storeHook(boardId: string, op: string, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...extra }),
  });
  return res.json();
}

async function sqlHook(boardId: string, query: string, params: any[] = []): Promise<any[][]> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`sql hook failed: ${body.detail}`);
  return body.rows;
}

async function appendAll(boardId: string, board: GeneratedBoard): Promise<void> {
  await storeHook(boardId, 'append-many', { updatesB64: board.updates.map(toB64) });
}

/** Encoded snapshot size of a locally generated board. */
function encodedSize(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).length;
}

describe('BoardStore against real Durable Object SQLite (story 4)', () => {
  beforeAll(async () => {
    await startServer();
  }, 60000);
  afterAll(async () => {
    await stopServer();
  });

  it('TC-03: migrate + load on empty board → tables exist, empty doc, schema version set', async () => {
    const boardId = newBoardId();
    const res = await storeHook(boardId, 'load');
    expect(res.ok).toBe(true);
    expect(res.quarantined).toBe(0);
    expect(res.notes).toEqual([]);

    const tables = await sqlHook(boardId, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const names = tables.map((r) => r[0]).sort();
    expect(names).toEqual(
      expect.arrayContaining(['updates', 'snapshot_chunks', 'storage_meta', 'quarantined_updates'])
    );

    const schema = await sqlHook(boardId, 'SELECT value FROM storage_meta WHERE key = ?', ['storage_schema_version']);
    expect(schema).toHaveLength(1);
    expect(schema[0][0]).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-04: append one update → exactly 1 row, bytes column equals length', async () => {
    const boardId = newBoardId();
    const board = makeRetroBoard();
    const update = board.updates[board.updates.length - 1];

    const res = await storeHook(boardId, 'append', { updateB64: toB64(update) });
    expect(res.ok).toBe(true);

    const rows = await sqlHook(boardId, 'SELECT seq, bytes, length(data) FROM updates ORDER BY seq');
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(1);
    expect(rows[0][1]).toBe(update.length);
    expect(rows[0][2]).toBe(update.length);
  });

  it('TC-05: LogOnly 25-note board → load into fresh doc equals original snapshot', async () => {
    const boardId = newBoardId();
    const board = makeRetroBoard();
    expect(board.updates.length).toBe(26); // initDoc + 25 notes

    await appendAll(boardId, board);

    const res = await storeHook(boardId, 'load');
    expect(res.ok).toBe(true);
    expect(res.quarantined).toBe(0);
    expect(res.notes).toEqual(snapshot(board.doc));
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows → compact: log 0, chunks ≥ 1, through_seq = max seq, reload equal', async () => {
    const boardId = newBoardId();
    // Build a board with exactly COMPACTION_UPDATE_COUNT + 1 updates
    // (initDoc + N notes, one update each).
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u) => updates.push(u.slice()));
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const noteCount = COMPACTION_UPDATE_COUNT;
    for (let i = 0; i < noteCount; i++) {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'sticky');
      obj.set('x', i * 10);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text());
      obj.set('z', i + 1);
      obj.set('createdAt', 1700000000000 + i);
      objects.set(id, obj);
    }
    expect(updates.length).toBe(noteCount + 1);

    const before = snapshot(doc);
    await storeHook(boardId, 'append-many', { updatesB64: updates.map(toB64) });

    const maxSeqBefore = (await sqlHook(boardId, 'SELECT MAX(seq) FROM updates'))[0][0];
    expect(maxSeqBefore).toBe(noteCount + 1);

    const compactRes = await storeHook(boardId, 'compact');
    expect(compactRes.ok).toBe(true);
    expect(compactRes.compacted).toBe(true);
    expect(compactRes.notes).toEqual(before);

    const logCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logCount).toBe(0);
    const chunkCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM snapshot_chunks'))[0][0];
    expect(chunkCount).toBeGreaterThanOrEqual(1);
    const throughSeq = (await sqlHook(boardId, "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'"))[0][0];
    expect(Number(throughSeq)).toBe(Number(maxSeqBefore));

    // Reload from storage equals the pre-compaction state
    const reload = await storeHook(boardId, 'load');
    expect(reload.ok).toBe(true);
    expect(reload.quarantined).toBe(0);
    expect(reload.notes).toEqual(before);
  });

  it('TC-07: SnapshotPlusLog → 3 updates after compaction, reload has all', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u) => updates.push(u.slice()));
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const makeNote = (x: number) => {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'sticky');
      obj.set('x', x);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text());
      obj.set('z', objects.size + 1);
      obj.set('createdAt', 1700000000000 + objects.size);
      objects.set(id, obj);
    };
    makeNote(1);
    makeNote(2);
    makeNote(3);
    const phase1 = updates.slice();

    await storeHook(boardId, 'append-many', { updatesB64: phase1.map(toB64) });
    const compactRes = await storeHook(boardId, 'force-compact');
    expect(compactRes.ok).toBe(true);

    // 3 more updates after the snapshot
    makeNote(4);
    makeNote(5);
    makeNote(6);
    const phase2 = updates.slice(phase1.length);
    expect(phase2.length).toBe(3);
    await storeHook(boardId, 'append-many', { updatesB64: phase2.map(toB64) });

    const reload = await storeHook(boardId, 'load');
    expect(reload.ok).toBe(true);
    expect(reload.quarantined).toBe(0);
    expect(reload.notes).toEqual(snapshot(doc));
    expect(reload.notes).toHaveLength(6);
  });

  it('TC-08: PERSIST_TESTED_NOTES board compaction → multiple chunks, reload equal', async () => {
    const board = makeLargeBoard();
    expect(board.updates.length).toBe(PERSIST_TESTED_NOTES + 1);
    expect(encodedSize(board.doc)).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const boardId = newBoardId();
    await appendAll(boardId, board);

    const compactRes = await storeHook(boardId, 'force-compact');
    expect(compactRes.ok).toBe(true);
    expect(compactRes.chunks).toBeGreaterThanOrEqual(2);

    const chunkRows = await sqlHook(boardId, 'SELECT idx, length(data) FROM snapshot_chunks ORDER BY idx');
    expect(chunkRows.length).toBe(compactRes.chunks);
    for (let i = 1; i < chunkRows.length - 1; i++) {
      expect(chunkRows[i][1]).toBe(SNAPSHOT_CHUNK_BYTES);
    }
    const logCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logCount).toBe(0);

    const reload = await storeHook(boardId, 'load');
    expect(reload.ok).toBe(true);
    expect(reload.quarantined).toBe(0);
    expect(reload.notes).toEqual(snapshot(board.doc));
  }, 120000);

  it('TC-09: damaged log row → load ok with 1 quarantined, row moved with error, board usable', async () => {
    const boardId = newBoardId();
    const board = makeRetroBoard();
    // 26 updates: seq 1 = initDoc, seq 2..26 = notes 1..25 (z=1..25).
    // Damage seq 7 (the 6th note) with truncated bytes.
    await appendAll(boardId, board);
    const damaged = damageTruncated(board.updates[6]);
    await sqlHook(boardId, 'UPDATE updates SET data = ?, bytes = ? WHERE seq = 7', [{ b64: toB64(damaged) }, damaged.length]);

    const res = await storeHook(boardId, 'load');
    expect(res.ok).toBe(true);
    expect(res.quarantined).toBe(1);

    const q = await sqlHook(boardId, 'SELECT seq, error FROM quarantined_updates ORDER BY seq');
    expect(q).toHaveLength(1);
    expect(q[0][0]).toBe(7);
    expect(String(q[0][1]).length).toBeGreaterThan(0);

    const logCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logCount).toBe(25); // row 7 moved out

    // Yjs CRDT semantics: every note is a fresh insertion into the shared
    // `objects` map, and each insertion's item links to its predecessor
    // (`left` pointer). Skipping a middle update dangles those pointers, so
    // Yjs silently drops subsequent *insertions* (modifications of existing
    // items would still apply). The guarantees are therefore:
    //  - the board loads and is usable (no exception, snapshot works)
    //  - the damaged row is quarantined with an error
    //  - nothing *before* the damage is lost
    const baseNotes = snapshot(board.doc); // sorted by (z, id)
    const expectPresent = baseNotes.slice(0, 5); // notes z=1..5
    expect(res.notes).toEqual(expectPresent);
  });

  it('TC-10: corrupted snapshot chunk → snapshot-unreadable; nothing deleted or quarantined', async () => {
    const boardId = newBoardId();
    const board = makeRetroBoard();
    await appendAll(boardId, board);
    const compactRes = await storeHook(boardId, 'force-compact');
    expect(compactRes.ok).toBe(true);

    const corruptRes = await fetch(`${URL}/__test/boards/${boardId}/corrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(corruptRes.ok).toBe(true);

    const res = await storeHook(boardId, 'load');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('snapshot-unreadable');

    // Nothing was deleted or quarantined
    const chunkCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM snapshot_chunks'))[0][0];
    expect(chunkCount).toBe(compactRes.chunks);
    const qCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM quarantined_updates'))[0][0];
    expect(qCount).toBe(0);
    const logCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logCount).toBe(0);
  });

  it('TC-11: compaction failure after chunk delete → rollback, previous chunks and log unchanged', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u) => updates.push(u.slice()));
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const makeNote = (x: number) => {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'sticky');
      obj.set('x', x);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text());
      obj.set('z', objects.size + 1);
      obj.set('createdAt', 1700000000000 + objects.size);
      objects.set(id, obj);
    };
    for (let i = 0; i < 10; i++) makeNote(i);
    const phase1 = updates.slice();
    await storeHook(boardId, 'append-many', { updatesB64: phase1.map(toB64) });

    // Previous snapshot: 1 chunk, empty log
    const compactRes = await storeHook(boardId, 'force-compact');
    expect(compactRes.ok).toBe(true);
    const chunksBefore = (await sqlHook(boardId, 'SELECT COUNT(*) FROM snapshot_chunks'))[0][0];
    expect(chunksBefore).toBe(1);

    // Two more log rows, then a compaction whose first chunk INSERT throws
    makeNote(10);
    makeNote(11);
    const phase2 = updates.slice(phase1.length);
    await storeHook(boardId, 'append-many', { updatesB64: phase2.map(toB64) });
    const logBefore = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logBefore).toBe(2);

    const faultRes = await storeHook(boardId, 'compact-fault');
    expect(faultRes.ok).toBe(true);
    expect(faultRes.compacted).toBe(false);

    // Rollback: previous chunk and both log rows intact
    const chunksAfter = (await sqlHook(boardId, 'SELECT COUNT(*) FROM snapshot_chunks'))[0][0];
    expect(chunksAfter).toBe(chunksBefore);
    const logAfter = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logAfter).toBe(logBefore);
    const throughSeq = (await sqlHook(boardId, "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'"))[0][0];
    expect(Number(throughSeq)).toBe(11); // phase1 max seq, unchanged

    // And the board still loads fine
    const reload = await storeHook(boardId, 'load');
    expect(reload.ok).toBe(true);
    expect(reload.notes).toEqual(snapshot(doc));
  });

  it('TC-25: migrate on a never-edited board writes no updates/snapshot_chunks rows', async () => {
    const boardId = newBoardId();
    // Any store op runs migrate() first.
    const res = await storeHook(boardId, 'load');
    expect(res.ok).toBe(true);

    const logCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'))[0][0];
    expect(logCount).toBe(0);
    const chunkCount = (await sqlHook(boardId, 'SELECT COUNT(*) FROM snapshot_chunks'))[0][0];
    expect(chunkCount).toBe(0);
  });
});
