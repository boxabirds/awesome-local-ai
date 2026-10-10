/// <reference types="@cloudflare/vitest-pool-workers" />
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { initDoc, snapshot, createSticky, getStickyText } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION
} from '../../src/shared/config';
import type { BoardStore } from '../../src/worker/board-store';
import type { Env } from '../../src/worker/index';
import {
  buildLargeBoard,
  buildNoteUpdates,
  buildRetroBoard,
  randomSameLength,
  truncateLast
} from '../fixtures/boards';

// Every test uses a fresh board id (isolatedStorage is off, so DO state
// persists for the whole worker; random ids keep tests independent).
function freshStore(boardId: string) {
  const namespace = (env as unknown as Env).BOARD_ROOM;
  return namespace.get(namespace.idFromName(boardId));
}

function sqlRows(store: BoardStore, query: string, ...bindings: (string | number | null)[]) {
  return store.sql.exec(query, ...bindings).toArray();
}

function countRows(store: BoardStore, table: string): number {
  const row = sqlRows(store, `SELECT COUNT(*) AS count FROM ${table}`)[0];
  return (row?.count as number) ?? -1;
}

function metaValue(store: BoardStore, key: string): string | undefined {
  const row = sqlRows(store, 'SELECT value FROM storage_meta WHERE key = ?', key)[0];
  return row?.value as string | undefined;
}

function chunkData(store: BoardStore, idx: number): Uint8Array | undefined {
  const row = sqlRows(store, 'SELECT data FROM snapshot_chunks WHERE idx = ?', idx)[0];
  const data = row?.data as ArrayBuffer | undefined;
  return data === undefined ? undefined : new Uint8Array(data);
}

describe('BoardStore against real DO SQLite (TC-03..TC-11, TC-25)', () => {
  // TC-03 empty board: tables exist, schema version recorded, load is ok and empty.
  it('TC-03 migrate creates the schema and an empty load is a clean ready state', async () => {
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      const tables = sqlRows(store, "SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name as string
      );
      const doc = new Y.Doc();
      initDoc(doc);
      const result = store.load(doc);
      const notes = snapshot(doc).length;
      doc.destroy();
      return {
        tables,
        schema: metaValue(store, 'storage_schema_version'),
        result,
        notes
      };
    });
    expect(out.tables).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates'])
    );
    expect(out.schema).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(0);
  });

  // TC-04 one append → exactly one row whose bytes column matches.
  it('TC-04 append writes one row with a matching byte count', async () => {
    const { updates } = buildNoteUpdates(1);
    const update = updates[updates.length - 1];
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      store.append(update);
      const row = sqlRows(store, 'SELECT seq, data, bytes FROM updates')[0];
      return {
        rows: countRows(store, 'updates'),
        bytes: row?.bytes as number,
        dataLength: (row?.data as ArrayBuffer).byteLength
      };
    });
    expect(out.rows).toBe(1);
    expect(out.bytes).toBe(update.byteLength);
    expect(out.dataLength).toBe(update.byteLength);
  });

  // TC-05 log-only replay: 25 mixed notes survive an append → load round-trip.
  it('TC-05 a 25-note log-only board reloads byte-for-byte identical', async () => {
    const fixture = buildRetroBoard();
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of fixture.updates) store.append(update);
      const fresh = new Y.Doc();
      initDoc(fresh);
      const result = store.load(fresh);
      const snap = snapshot(fresh);
      fresh.destroy();
      return { result, snap };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.snap).toEqual(fixture.expected);
    expect(out.snap.length).toBe(25);
  });

  // TC-06 compaction at COMPACTION_UPDATE_COUNT rows: log empties, snapshot
  // takes over, reload identical.
  it('TC-06 compaction at the row threshold preserves state', async () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update) => updates.push(update.slice()));
    initDoc(doc);
    let i = 0;
    while (updates.length < COMPACTION_UPDATE_COUNT) {
      doc.transact(() => {
        const id = createSticky(doc, { x: (i % 25) * 260, y: Math.floor(i / 25) * 260 });
        getStickyText(doc, id)?.insert(0, `compaction note ${i}`);
      });
      i += 1;
    }
    const expected = snapshot(doc);
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of updates) store.append(update);
      const rowsBefore = countRows(store, 'updates');
      const merged = new Y.Doc();
      initDoc(merged);
      store.load(merged);
      const before = snapshot(merged);
      const compacted = store.compact(merged);
      const after = {
        updates: countRows(store, 'updates'),
        chunks: countRows(store, 'snapshot_chunks'),
        through: metaValue(store, 'snapshot_through_seq')
      };
      const reload = new Y.Doc();
      initDoc(reload);
      const result = store.load(reload);
      const afterSnap = snapshot(reload);
      merged.destroy();
      reload.destroy();
      return { rowsBefore, compacted, after, before, result, afterSnap };
    });
    expect(out.rowsBefore).toBe(COMPACTION_UPDATE_COUNT);
    expect(out.compacted).toBe(true);
    expect(out.after.updates).toBe(0);
    expect(out.after.chunks).toBeGreaterThanOrEqual(1);
    expect(out.after.through).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.afterSnap).toEqual(out.before);
    expect(out.before).toEqual(expected);
    doc.destroy();
  });

  // TC-07 snapshot + log: updates after the snapshot reload all; rows at or
  // below snapshot_through_seq are never read (a garbage row hidden below
  // the watermark stays untouched).
  it('TC-07 only log rows above the snapshot watermark are applied', async () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update) => updates.push(update.slice()));
    initDoc(doc);
    let i = 0;
    while (updates.length < COMPACTION_UPDATE_COUNT) {
      doc.transact(() => {
        const id = createSticky(doc, { x: i * 30, y: 0 });
        getStickyText(doc, id)?.insert(0, `base ${i}`);
      });
      i += 1;
    }
    // three updates after the compaction point
    const later: Uint8Array[] = [];
    for (let j = 0; j < 3; j += 1) {
      doc.transact(() => {
        const id = createSticky(doc, { x: i * 30, y: 40 });
        getStickyText(doc, id)?.insert(0, `later ${j}`);
      });
      later.push(...updates.slice(updates.length - 1));
      i += 1;
    }
    const expected = snapshot(doc);
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of updates.slice(0, COMPACTION_UPDATE_COUNT)) store.append(update);
      const merged = new Y.Doc();
      initDoc(merged);
      store.load(merged);
      store.compact(merged);
      merged.destroy();
      for (const update of later) store.append(update);
      // A damaged row far below the watermark must never be read.
      store.sql.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        1,
        randomSameLength(new Uint8Array(64)),
        64
      );
      const reload = new Y.Doc();
      initDoc(reload);
      const result = store.load(reload);
      const snap = snapshot(reload);
      const quarantined = countRows(store, 'quarantined_updates');
      const garbageStillThere =
        sqlRows(store, 'SELECT data FROM updates WHERE seq = 1').length === 1;
      reload.destroy();
      return { result, snap, quarantined, garbageStillThere };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.quarantined).toBe(0);
    expect(out.garbageStillThere).toBe(true);
    expect(out.snap).toEqual(expected);
    doc.destroy();
  });

  // TC-08 a PERSIST_TESTED_NOTES board compacts into chunk(s) matching the
  // encoded size (multiple chunks above SNAPSHOT_CHUNK_BYTES) and reloads.
  it('TC-08 the large board compacts into size-correct chunks and reloads identical', async () => {
    const fixture = buildLargeBoard();
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of fixture.updates) store.append(update);
      const merged = new Y.Doc();
      initDoc(merged);
      const loadResult = store.load(merged);
      const before = snapshot(merged);
      const encodedBytes = Y.encodeStateAsUpdate(merged).byteLength;
      const compacted = store.compact(merged);
      const chunks = countRows(store, 'snapshot_chunks');
      const updatesLeft = countRows(store, 'updates');
      const reload = new Y.Doc();
      initDoc(reload);
      const result = store.load(reload);
      const afterSnap = snapshot(reload);
      merged.destroy();
      reload.destroy();
      return { loadResult, before, encodedBytes, compacted, chunks, updatesLeft, result, afterSnap };
    });
    expect(out.loadResult.ok).toBe(true);
    expect(out.compacted).toBe(true);
    const expectedChunks = Math.ceil(out.encodedBytes / SNAPSHOT_CHUNK_BYTES);
    expect(out.chunks).toBe(expectedChunks);
    if (out.encodedBytes > SNAPSHOT_CHUNK_BYTES) {
      expect(out.chunks).toBeGreaterThan(1);
    }
    expect(out.updatesLeft).toBe(0);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.afterSnap).toEqual(out.before);
    expect(out.before.length).toBe(fixture.expected.length);
    expect(out.before).toEqual(fixture.expected);
    fixture.doc.destroy();
  });

  // TC-09 damaged log row → quarantined, everything else still loads.
  it('TC-09 a damaged log row is quarantined and the rest of the board loads', async () => {
    const { updates, texts } = buildNoteUpdates(10);
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of updates) store.append(update);
      const row = sqlRows(store, 'SELECT data FROM updates WHERE seq = 7')[0];
      const damaged = truncateLast(new Uint8Array(row?.data as ArrayBuffer));
      store.sql.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = 7', damaged, damaged.byteLength);
      const fresh = new Y.Doc();
      initDoc(fresh);
      const result = store.load(fresh);
      const snap = snapshot(fresh);
      fresh.destroy();
      const quarantined = sqlRows(
        store,
        'SELECT seq, error, quarantined_at FROM quarantined_updates'
      );
      return {
        result,
        texts: snap.map((note) => note.text),
        quarantined: quarantined.map((row2) => ({ seq: row2.seq, error: row2.error as string })),
        updatesLeft: countRows(store, 'updates'),
        stillSeq7: sqlRows(store, 'SELECT data FROM updates WHERE seq = 7').length
      };
    });
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return; // type narrowing
    expect(out.result.quarantined).toBe(1);
    expect(out.quarantined).toHaveLength(1);
    expect(out.quarantined[0].seq).toBe(7);
    expect(out.quarantined[0].error.length).toBeGreaterThan(0);
    expect(out.stillSeq7).toBe(0);
    expect(out.updatesLeft).toBe(updates.length - 1);
    // seq 7 carried one note; every other note loads with its exact text.
    const expectedTexts = updates.map((_, idx) => (idx === 0 ? null : texts[idx - 1])).filter(
      (text): text is string => text !== null && text !== 'note-5'
    );
    expect(out.texts.sort()).toEqual(expectedTexts.sort());
  });

  // TC-10 damaged snapshot → honest failure; nothing deleted or quarantined.
  it('TC-10 a damaged snapshot reports unreadable without destroying anything', async () => {
    const fixture = buildRetroBoard();
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of fixture.updates) store.append(update);
      const merged = new Y.Doc();
      initDoc(merged);
      store.load(merged);
      store.compact(merged);
      merged.destroy();
      const chunksBefore = countRows(store, 'snapshot_chunks');
      store.debugCorruptChunk0();
      const fresh = new Y.Doc();
      initDoc(fresh);
      const result = store.load(fresh);
      fresh.destroy();
      return {
        result,
        chunksAfter: countRows(store, 'snapshot_chunks'),
        chunksBefore,
        quarantined: countRows(store, 'quarantined_updates')
      };
    });
    expect(out.result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(out.chunksAfter).toBe(out.chunksBefore);
    expect(out.chunksBefore).toBeGreaterThan(0);
    expect(out.quarantined).toBe(0);
  });

  // TC-11 compaction crash rolls back: previous snapshot and log intact.
  it('TC-11 a compaction failure rolls back and the board is unaffected', async () => {
    const fixture = buildRetroBoard();
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      for (const update of fixture.updates) store.append(update);
      const merged = new Y.Doc();
      initDoc(merged);
      store.load(merged);
      store.compact(merged);
      // fresh log content that a rollback must preserve
      const extra = buildNoteUpdates(5).updates.slice(1);
      for (const update of extra) store.append(update);
      store.load(merged);
      const chunkBefore = chunkData(store, 0);
      const updatesBefore = countRows(store, 'updates');
      const throughBefore = metaValue(store, 'snapshot_through_seq');

      // Inject a throw right after the chunk table is cleared.
      const real = store.sql;
      let sawDelete = false;
      (store as unknown as { sql: SqlStorage }).sql = {
        exec(query: string, ...bindings: unknown[]) {
          if (sawDelete && query.startsWith('INSERT INTO snapshot_chunks')) {
            throw new Error('injected compaction failure');
          }
          const cursor = real.exec(query, ...(bindings as never[]));
          if (query.startsWith('DELETE FROM snapshot_chunks')) sawDelete = true;
          return cursor;
        }
      } as unknown as SqlStorage;
      const compacted = store.compact(merged);
      (store as unknown as { sql: SqlStorage }).sql = real;

      const chunkAfter = chunkData(store, 0);
      const fresh = new Y.Doc();
      initDoc(fresh);
      const result = store.load(fresh);
      const snap = snapshot(fresh);
      merged.destroy();
      fresh.destroy();
      return {
        compacted,
        rollbackSame:
          chunkBefore !== undefined &&
          chunkAfter !== undefined &&
          chunkBefore.length === chunkAfter.length &&
          chunkBefore.every((byte, idx) => byte === chunkAfter[idx]),
        updatesAfter: countRows(store, 'updates'),
        updatesBefore,
        throughBefore,
        throughAfter: metaValue(store, 'snapshot_through_seq'),
        result,
        textCount: snap.filter((note) => note.text.startsWith('note-')).length
      };
    });
    expect(out.compacted).toBe(false);
    expect(out.rollbackSame).toBe(true);
    expect(out.updatesAfter).toBe(out.updatesBefore);
    expect(out.throughAfter).toBe(out.throughBefore);
    expect(out.result.ok).toBe(true);
    expect(out.textCount).toBe(5);
  });

  // TC-25 (negative): migrate alone writes no board content.
  it('TC-25 migrate on a never-edited board writes no update or snapshot rows', async () => {
    const out = await runInDurableObject(freshStore(newBoardId()), (obj) => {
      const store = obj.debugStore();
      store.migrate();
      return { updates: countRows(store, 'updates'), chunks: countRows(store, 'snapshot_chunks') };
    });
    expect(out.updates).toBe(0);
    expect(out.chunks).toBe(0);
  });
});
