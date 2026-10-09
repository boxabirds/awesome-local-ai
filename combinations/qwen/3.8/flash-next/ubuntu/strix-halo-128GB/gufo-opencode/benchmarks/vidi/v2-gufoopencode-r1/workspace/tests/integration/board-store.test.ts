import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestHarness } from 'wrangler';
import { getStickyText, moveObject, setStickyColor } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';
import { damagedVariants, largeBoard, retroBoard, snapshotOf } from '../fixtures/boards';

let base = '';
let closeHarness: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const harness = createTestHarness({
    workers: [
      {
        config: {
          name: 'board-store-test',
          main: 'tests/integration/board-store-worker.ts',
          compatibility_date: '2026-09-17',
          durable_objects: { bindings: [{ name: 'STORE', class_name: 'BoardStoreTestRoom' }] },
          migrations: [{ tag: 'v1', new_sqlite_classes: ['BoardStoreTestRoom'] }]
        }
      }
    ]
  });
  const { url } = await harness.listen();
  base = url.toString().replace(/\/$/, '') + '/';
  closeHarness = () => harness.close();
}, 180_000);

afterAll(async () => {
  if (closeHarness !== null) await closeHarness();
});

function api(id: string, action: string, init?: RequestInit): Promise<Response> {
  const separator = action.includes('?') ? '&' : '?';
  return fetch(`${base}${action}${separator}id=${encodeURIComponent(id)}`, init);
}

async function raw<T = Record<string, unknown>>(id: string, query: string, params: unknown[] = []): Promise<T[]> {
  const response = await api(id, 'raw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, params })
  });
  const body = (await response.json()) as { rows: T[] };
  return body.rows;
}

interface Stats {
  schemaVersion: number | null;
  snapshotThroughSeq: number;
  updateCount: number;
  updateBytes: number;
  chunkCount: number;
  quarantinedCount: number;
}

async function stats(id: string): Promise<Stats> {
  return (await (await api(id, 'stats')).json()) as Stats;
}

async function appendAll(id: string, updates: readonly Uint8Array[]): Promise<void> {
  for (const update of updates) {
    const appended = await api(id, 'append', { method: 'POST', body: update });
    expect(appended.ok).toBe(true);
  }
}

async function migrate(id: string): Promise<void> {
  expect((await api(id, 'migrate', { method: 'POST' })).ok).toBe(true);
}

async function forceCompact(id: string): Promise<void> {
  const response = await api(id, 'compact?force=1', { method: 'POST' });
  expect(((await response.json()) as { done: boolean }).done).toBe(true);
}

async function loadDoc(id: string): Promise<{ ok: boolean; reason?: string; doc: Y.Doc; quarantined: number }> {
  const response = await api(id, 'load');
  if (response.headers.get('x-load-ok') !== '1') {
    const body = (await response.json()) as { ok: boolean; reason: string };
    return { ok: false, reason: body.reason, doc: new Y.Doc(), quarantined: 0 };
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
  return { ok: true, doc, quarantined: Number(response.headers.get('x-quarantined') ?? '0') };
}

function sameNote(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('BoardStore against real Durable Object SQLite', () => {
  it('TC-03 migrate creates the tables and versioned meta; an empty board loads empty', async () => {
    const id = newBoardId();
    await migrate(id);
    for (const table of ['updates', 'snapshot_chunks', 'quarantined_updates']) {
      const rows = await raw<{ n: number }>(id, `SELECT COUNT(*) AS n FROM ${table}`);
      expect(Number(rows[0]['n'])).toBe(0);
    }
    const version = await raw<{ value: string }>(
      id,
      "SELECT value FROM storage_meta WHERE key = 'storage_schema_version'"
    );
    expect(atob(version[0]['value'])).toBe(String(STORAGE_SCHEMA_VERSION));
    const loaded = await loadDoc(id);
    expect(loaded.ok).toBe(true);
    expect(snapshotOf(loaded.doc)).toBe('[]');
    expect(loaded.quarantined).toBe(0);
  });

  it('TC-25 migrate on a never-edited board writes no update or snapshot rows', async () => {
    const id = newBoardId();
    await migrate(id);
    expect(Number((await raw<{ n: number }>(id, 'SELECT COUNT(*) AS n FROM updates'))[0]['n'])).toBe(0);
    expect(Number((await raw<{ n: number }>(id, 'SELECT COUNT(*) AS n FROM snapshot_chunks'))[0]['n'])).toBe(0);
  });

  it('TC-04 append stores one row with the exact byte length', async () => {
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, [board.updates[0]]);
    const rows = await raw<{ seq: number; bytes: number }>(id, 'SELECT seq, bytes FROM updates');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]['seq'])).toBe(1);
    expect(Number(rows[0]['bytes'])).toBe(board.updates[0].length);
  });

  it('TC-05 a 25-note log-only board loads into a fresh doc exactly', async () => {
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, board.updates);
    const loaded = await loadDoc(id);
    expect(snapshotOf(loaded.doc)).toBe(board.snapshot);
  });

  it('TC-06 compaction at the update-count threshold collapses the log and reloads identically', async () => {
    const id = newBoardId();
    const board = retroBoard();
    // Pad the log up to COMPACTION_UPDATE_COUNT with real (tiny) Yjs updates.
    while (board.updates.length < 500) {
      const scratch = new Y.Doc();
      scratch.getMap('meta').set('pad' + String(board.updates.length), board.updates.length);
      board.updates.push(Y.encodeStateAsUpdate(scratch));
    }
    const expected = snapshotOf(board.doc);
    await migrate(id);
    await appendAll(id, board.updates);
    const compacted = await api(id, 'compact', { method: 'POST' });
    expect(((await compacted.json()) as { done: boolean }).done).toBe(true);
    const after = await stats(id);
    expect(after.updateCount).toBe(0);
    expect(after.chunkCount).toBeGreaterThanOrEqual(1);
    expect(after.snapshotThroughSeq).toBe(500);
    const loaded = await loadDoc(id);
    expect(snapshotOf(loaded.doc)).toBe(expected);
  }, 60_000);

  it('TC-07 log rows after a snapshot are replayed on top of it', async () => {
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, board.updates);
    await forceCompact(id);
    const through = (await stats(id)).snapshotThroughSeq;

    const ids = [...board.doc.getMap('objects').keys()];
    const extraBefore = board.updates.length;
    moveObject(board.doc, ids[0], 1234, 5678);
    setStickyColor(board.doc, ids[1], 'pink');
    getStickyText(board.doc, ids[2])?.insert(0, ' appended after snapshot');
    const extra = board.updates.slice(extraBefore);
    expect(extra).toHaveLength(3);
    await appendAll(id, extra);

    const rows = await raw<{ seq: number }>(id, 'SELECT seq FROM updates');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Number(row['seq'])).toBeGreaterThan(through);

    const loaded = await loadDoc(id);
    expect(snapshotOf(loaded.doc)).toBe(snapshotOf(board.doc));
  });

  it('TC-08 a PERSIST_TESTED_NOTES board compacts into multiple chunks and reloads identically', async () => {
    const id = newBoardId();
    const board = largeBoard(7, 2000);
    const encoded = Y.encodeStateAsUpdate(board.doc);
    expect(encoded.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    await migrate(id);
    await appendAll(id, [encoded]);
    await forceCompact(id);
    const after = await stats(id);
    expect(after.chunkCount).toBe(Math.ceil(encoded.length / SNAPSHOT_CHUNK_BYTES));
    expect(after.chunkCount).toBeGreaterThan(1);
    const maxChunk = await raw<{ m: number }>(id, 'SELECT MAX(LENGTH(data)) AS m FROM snapshot_chunks');
    expect(Number(maxChunk[0]['m'])).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    const loaded = await loadDoc(id);
    expect(snapshotOf(loaded.doc)).toBe(board.snapshot);
  }, 120_000);

  it('TC-09 a damaged log row is quarantined and only that change is missing', async () => {
    const id = newBoardId();
    const board = retroBoard();
    const rowCount = board.updates.length;
    await migrate(id);
    await appendAll(id, board.updates);

    // Damage the newest change (the last log row). The loader quarantines the
    // row and opens the board with everything else intact.
    const damaged = damagedVariants(board.updates[rowCount - 1]).randomSameLength;
    const overwritten = await api(id, 'raw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        params: ['b64:' + Buffer.from(damaged).toString('base64'), damaged.length, rowCount]
      })
    });
    expect(overwritten.ok).toBe(true);

    const loaded = await loadDoc(id);
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(1);
    const after = await stats(id);
    expect(after.updateCount).toBe(rowCount - 1);
    expect(after.quarantinedCount).toBe(1);
    const quarantinedRows = await raw<{ seq: number; error: string }>(
      id,
      'SELECT seq, error FROM quarantined_updates'
    );
    expect(Number(quarantinedRows[0]['seq'])).toBe(rowCount);
    expect(String(quarantinedRows[0]['error']).length).toBeGreaterThan(0);

    // Every note is present; exactly one carries the missing change.
    const notes = JSON.parse(snapshotOf(loaded.doc)) as Array<Record<string, unknown>>;
    const originals = JSON.parse(board.snapshot) as Array<Record<string, unknown>>;
    expect(notes).toHaveLength(originals.length);
    const byId = new Map(originals.map((note) => [String(note['id']), note]));
    const differing = notes.filter((note) => !sameNote(note, byId.get(String(note["id"]))));
    expect(differing).toHaveLength(1);
  });

  it('TC-09b a damaged row mid-log quarantines cleanly without failing the whole board', async () => {
    // A Yjs log must be replayed in strict order: rows after a gap cannot
    // re-attach to the same client's struct chain, so damage in the middle of
    // a never-compacted log degrades. The contract that still holds: the load
    // succeeds, the poison row is quarantined, and the board is not wiped.
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, board.updates);
    const damaged = damagedVariants(board.updates[6]).randomSameLength;
    await api(id, 'raw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'UPDATE updates SET data = ?, bytes = ? WHERE seq = 7',
        params: ['b64:' + Buffer.from(damaged).toString('base64'), damaged.length]
      })
    });
    const loaded = await loadDoc(id);
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(1);
    const notes = JSON.parse(snapshotOf(loaded.doc)) as Array<Record<string, unknown>>;
    const originals = JSON.parse(board.snapshot) as Array<Record<string, unknown>>;
    const survivors = notes.filter((note) =>
      originals.some((o) => o['id'] === note['id'] && o['text'] === note['text'])
    );
    expect(survivors.length).toBeGreaterThan(0);
  });

  it('TC-10 a damaged snapshot fails the load without deleting or quarantining anything', async () => {
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, board.updates);
    await forceCompact(id);
    const before = await stats(id);

    const garbage = await raw<{ g: string }>(
      id,
      'SELECT hex(randomblob(LENGTH((SELECT data FROM snapshot_chunks WHERE idx = 0)))) AS g'
    );
    const corrupted = Buffer.from(garbage[0]['g'], 'hex');
    const damaged = await api(id, 'raw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        params: ['b64:' + corrupted.toString('base64')]
      })
    });
    expect(damaged.ok).toBe(true);

    const loaded = await loadDoc(id);
    expect(loaded.ok).toBe(false);
    expect(loaded.reason).toBe('snapshot-unreadable');

    const after = await stats(id);
    expect(after.chunkCount).toBe(before.chunkCount);
    expect(after.updateCount).toBe(before.updateCount);
    expect(after.quarantinedCount).toBe(0);
  });

  it('TC-11 a write failure mid-compaction rolls the transaction back', async () => {
    const id = newBoardId();
    const board = retroBoard();
    await migrate(id);
    await appendAll(id, board.updates);
    await forceCompact(id);

    const ids = [...board.doc.getMap('objects').keys()];
    const extraBefore = board.updates.length;
    moveObject(board.doc, ids[3], 10, 10);
    moveObject(board.doc, ids[4], 20, 20);
    moveObject(board.doc, ids[5], 30, 30);
    await appendAll(id, board.updates.slice(extraBefore));

    const before = await stats(id);
    const chunkData = await raw<{ idx: number; data: string }>(
      id,
      'SELECT idx, data FROM snapshot_chunks ORDER BY idx'
    );

    const faulty = await api(id, 'compact-fault', { method: 'POST' });
    expect(((await faulty.json()) as { done: boolean }).done).toBe(false);

    expect(await stats(id)).toEqual(before);
    const chunkDataAfter = await raw<{ idx: number; data: string }>(
      id,
      'SELECT idx, data FROM snapshot_chunks ORDER BY idx'
    );
    expect(chunkDataAfter).toEqual(chunkData);
  });
});
