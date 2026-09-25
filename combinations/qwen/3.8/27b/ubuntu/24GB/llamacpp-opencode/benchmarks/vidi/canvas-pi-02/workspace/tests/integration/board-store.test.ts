/**
 * BoardStore integration tests (story 4, task 3): the real SQLite inside a
 * real Durable Object — no mocks. Each test uses a fresh board id (fresh
 * storage) and drives a `BoardStore` bound to the DO's own `ctx.storage`.
 *
 * Case numbers follow spec/stories/004/.../tasks.md "Cases" (TC-03 … TC-11,
 * TC-25).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';
import { buildNoteBoard, extraMoveUpdate, type NoteBoardFixture } from '../fixtures/note-updates';

type Sql = {
  exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> };
};

/** workerd returns BLOBs as ArrayBuffer; normalise for Yjs. */
function bytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as Uint8Array;
}

/** Run `fn` inside the board's DO with a BoardStore on its real storage. */
async function withStore<T>(
  boardId: string,
  fn: (store: BoardStore, sql: Sql) => T,
): Promise<T> {
  return runInDurableObject(
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)),
    (room) => fn(new BoardStore(room.ctx.storage), room.ctx.storage.sql),
  );
}

/** Append `fixture`'s updates inside the DO. */
async function appendFixture(boardId: string, fixture: NoteBoardFixture): Promise<void> {
  await withStore(boardId, (store) => {
    store.migrate();
    for (const update of fixture.updates) store.append(update);
  });
}

/** Expected end state: apply the given updates to a fresh doc (test scope). */
function expectedNotes(updates: Uint8Array[]): StickySnapshot[] {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return snapshot(doc);
}

/** Compact inside the DO from the current log; return the outcome plus proof state. */
function compactInDo(
  boardId: string,
): Promise<{
  compacted: boolean;
  logCount: number;
  chunkSizes: number[];
  throughSeq: string | null;
  loaded: LoadResult;
  notes: StickySnapshot[];
}> {
  return withStore(boardId, (store, sql) => {
    const doc = new Y.Doc();
    const rows = sql.exec('SELECT data FROM updates ORDER BY seq').toArray();
    for (const row of rows) Y.applyUpdate(doc, bytes(row.data));
    const compacted = store.compactIfNeeded(doc);

    const chunks = sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray();
    const meta = sql
      .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
      .toArray();
    const fresh = new Y.Doc();
    const loaded = store.load(fresh);
    return {
      compacted,
      logCount: sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0].n as number,
      chunkSizes: chunks.map((c) => (c.data as ArrayBuffer).byteLength),
      throughSeq: (meta[0]?.value as string | undefined) ?? null,
      loaded,
      notes: snapshot(fresh),
    };
  });
}

describe('BoardStore on real Durable Object storage', () => {
  it('TC-03: migrate + load on an empty board → tables exist, doc empty, schema version set', async () => {
    const boardId = newBoardId();
    const out = await withStore(boardId, (store, sql) => {
      store.migrate();
      const fresh = new Y.Doc();
      const loaded = store.load(fresh);
      const version = sql
        .exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")
        .toArray();
      const tables = sql
        .exec('SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name')
        .toArray()
        .map((r) => r.name as string);
      return {
        loaded,
        version: version.map((r) => r.value as string),
        tables,
        objects: fresh.getMap('objects').size,
      };
    });
    expect(out.loaded).toEqual({ ok: true, quarantined: 0, logCount: 0, logBytes: 0 });
    expect(out.version).toEqual([String(STORAGE_SCHEMA_VERSION)]);
    expect(out.tables).toEqual(
      expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
    );
    expect(out.objects).toBe(0);
  });

  it('TC-04: append one update → 1 row, bytes column = length', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 0); // meta-init only: exactly one update
    expect(fixture.updates).toHaveLength(1);
    await withStore(boardId, (store) => {
      store.migrate();
      store.append(fixture.updates[0]);
    });
    const out = await withStore(boardId, (_store, sql) => {
      const rows = sql.exec('SELECT seq, bytes, data FROM updates ORDER BY seq').toArray();
      return {
        rows: rows.map((r) => ({
          seq: r.seq as number,
          bytes: r.bytes as number,
          len: (r.data as ArrayBuffer).byteLength,
        })),
      };
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].seq).toBe(1);
    expect(out.rows[0].bytes).toBe(fixture.updates[0].byteLength);
    expect(out.rows[0].bytes).toBe(out.rows[0].len); // column matches the real payload
  });

  it('TC-05: LogOnly 25 notes → load into fresh doc equals original snapshot', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 25);
    await appendFixture(boardId, fixture);
    const out = await withStore(boardId, (store, sql) => {
      const fresh = new Y.Doc();
      const loaded = store.load(fresh);
      return {
        loaded,
        notes: snapshot(fresh),
        chunks: sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0].n as number,
        log: sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0].n as number,
      };
    });
    expect(out.loaded).toEqual({
      ok: true,
      quarantined: 0,
      logCount: fixture.updates.length,
      logBytes: fixture.updates.reduce((n, u) => n + u.byteLength, 0),
    });
    expect(out.notes).toEqual(fixture.notes);
    expect(out.chunks).toBe(0); // still LogOnly: below the compaction threshold
    expect(out.log).toBe(fixture.updates.length);
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows → compact: updates 0, chunks ≥ 1, through_seq = max seq, reload equal', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 249); // 2*249 + 1 (init) = 499 updates
    const move = extraMoveUpdate(fixture, 0); // the 500th update
    const allUpdates = [...fixture.updates, move];
    expect(allUpdates.length).toBe(COMPACTION_UPDATE_COUNT);

    await withStore(boardId, (store) => {
      store.migrate();
      for (const update of allUpdates) store.append(update);
    });

    const out = await compactInDo(boardId);
    expect(out.compacted).toBe(true);
    expect(out.logCount).toBe(0); // log truncated
    expect(out.chunkSizes.length).toBeGreaterThanOrEqual(1);
    expect(out.throughSeq).toBe(String(COMPACTION_UPDATE_COUNT)); // = max seq before compaction
    expect(out.loaded).toEqual({ ok: true, quarantined: 0, logCount: 0, logBytes: 0 });
    expect(out.notes).toEqual(expectedNotes(allUpdates)); // state before == state after
  });

  it('TC-07: SnapshotPlusLog: 3 updates after compaction → reload has all; only seq > through_seq applied', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 250); // 501 updates → compacts
    expect(fixture.updates.length).toBeGreaterThan(COMPACTION_UPDATE_COUNT);

    await appendFixture(boardId, fixture);
    const compacted = await compactInDo(boardId);
    expect(compacted.compacted).toBe(true);
    const throughSeq = Number.parseInt(compacted.throughSeq as string, 10);
    expect(throughSeq).toBe(fixture.updates.length);

    // Three more updates after the snapshot (generated from the fixture doc).
    const tail = [
      extraMoveUpdate(fixture, 1),
      extraMoveUpdate(fixture, 2),
      extraMoveUpdate(fixture, 3),
    ];
    await withStore(boardId, (store) => {
      for (const update of tail) store.append(update);
    });

    const out = await withStore(boardId, (store, sql) => {
      const fresh = new Y.Doc();
      const loaded = store.load(fresh);
      const logSeqs = sql
        .exec('SELECT seq FROM updates ORDER BY seq')
        .toArray()
        .map((r) => r.seq as number);
      const chunkCount = sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0].n as number;
      return { loaded, logSeqs, chunkCount, notes: snapshot(fresh) };
    });
    expect(out.loaded).toEqual({
      ok: true,
      quarantined: 0,
      logCount: tail.length,
      logBytes: tail.reduce((n, u) => n + u.byteLength, 0),
    });
    expect(out.chunkCount).toBe(compacted.chunkSizes.length); // snapshot intact
    // Only the post-snapshot rows remain in (and are applied from) the log.
    expect(out.logSeqs).toEqual([throughSeq + 1, throughSeq + 2, throughSeq + 3]);
    expect(out.notes).toEqual(expectedNotes([...fixture.updates, ...tail]));
  });

  it('TC-08: PERSIST_TESTED_NOTES board compaction → multiple chunks when encoded size > SNAPSHOT_CHUNK_BYTES; reload equal', async () => {
    // Part 1: the spec-sized board.
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, PERSIST_TESTED_NOTES);
    await appendFixture(boardId, fixture);
    const out = await compactInDo(boardId);
    expect(out.compacted).toBe(true);
    expect(out.logCount).toBe(0);
    const total = out.chunkSizes.reduce((sum, n) => sum + n, 0);
    expect(out.chunkSizes.length).toBe(Math.ceil(total / SNAPSHOT_CHUNK_BYTES));
    for (const size of out.chunkSizes) expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(out.notes).toEqual(fixture.notes);

    // Part 2: a larger board that crosses the chunk boundary → multiple chunks.
    const bigId = newBoardId();
    const big = buildNoteBoard(bigId, PERSIST_TESTED_NOTES * 2);
    await appendFixture(bigId, big);
    const bigOut = await compactInDo(bigId);
    expect(bigOut.compacted).toBe(true);
    expect(bigOut.chunkSizes.length).toBeGreaterThanOrEqual(2);
    for (const size of bigOut.chunkSizes) expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(bigOut.notes).toEqual(big.notes);
  });

  it('TC-09: overwrite log row 7 with damaged bytes → ok with 1 quarantined; row moved with error text; other notes present', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 3); // 7 log rows; row 7 = note 3's text
    expect(fixture.updates.length).toBe(7);
    await appendFixture(boardId, fixture);

    await withStore(boardId, (_store, sql) => {
      sql.exec("UPDATE updates SET data = X'00ff9e0102030405' WHERE seq = 7");
    });

    const out = await withStore(boardId, (store, sql) => {
      const fresh = new Y.Doc();
      const loaded = store.load(fresh);
      const q = sql
        .exec('SELECT seq, error, quarantined_at, data FROM quarantined_updates ORDER BY seq')
        .toArray();
      const logLeft = sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0].n as number;
      return {
        loaded,
        logLeft,
        notes: snapshot(fresh),
        row: q[0] as
          | { seq: number; error: string; quarantined_at: number; data: ArrayBuffer }
          | undefined,
      };
    });
    expect(out.loaded).toEqual({
      ok: true,
      quarantined: 1,
      logCount: fixture.updates.length - 1,
      logBytes: fixture.updates.reduce((n, u) => n + u.byteLength, 0) - fixture.updates[6].byteLength,
    });
    // The row was MOVED: gone from the log, present in the holding with the raw bytes.
    expect(out.logLeft).toBe(6);
    expect(out.row?.seq).toBe(7);
    expect((out.row?.data.byteLength) ?? 0).toBe(8);
    expect(out.row?.error).toContain('apply-update-failed');
    expect(Number.isFinite(out.row?.quarantined_at)).toBe(true);
    // The undamaged notes survive; note 3's shell remains (its text was row 7).
    const texts = out.notes.map((n) => n.text).sort();
    expect(texts).toEqual(['', 'note 1', 'note 2']);
  });

  it('TC-10: corrupt snapshot chunk 0 → {ok: false, reason: snapshot-unreadable}; nothing deleted or quarantined', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 250); // compacts to a 1-chunk snapshot
    await appendFixture(boardId, fixture);
    const compacted = await compactInDo(boardId);
    expect(compacted.compacted).toBe(true);
    expect(compacted.chunkSizes.length).toBeGreaterThanOrEqual(1);

    await withStore(boardId, (_store, sql) => {
      sql.exec("UPDATE snapshot_chunks SET data = X'deadbeef' WHERE idx = 0");
    });

    const out = await withStore(boardId, (store, sql) => {
      const fresh = new Y.Doc();
      const loaded = store.load(fresh);
      return {
        loaded,
        chunks: sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0].n as number,
        log: sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0].n as number,
        quarantined: sql
          .exec('SELECT COUNT(*) AS n FROM quarantined_updates')
          .toArray()[0].n as number,
      };
    });
    expect(out.loaded).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(out.chunks).toBe(compacted.chunkSizes.length); // snapshot untouched
    expect(out.log).toBe(0); // log untouched
    expect(out.quarantined).toBe(0); // nothing quarantined
  });

  it('TC-11: injected throw after chunk delete during compaction → rollback: previous chunks and log unchanged', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 250);
    await appendFixture(boardId, fixture);
    const first = await compactInDo(boardId);
    expect(first.compacted).toBe(true);
    const firstChunk = await withStore(boardId, (_store, sql) =>
      sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0].data,
    );

    // Grow the log past the threshold again (500 fresh updates on the same doc).
    const grown: Uint8Array[] = [];
    const capture = (update: Uint8Array): void => {
      grown.push(update as Uint8Array);
    };
    fixture.doc.on('update', capture);
    for (let i = 0; i < 250; i += 1) {
      const id = createSticky(fixture.doc, { x: 4000 + i, y: 4000 }, 'yellow');
      getStickyText(fixture.doc, id)?.insert(0, `tail ${i}`);
    }
    fixture.doc.off('update', capture);
    expect(grown.length).toBe(500);
    await withStore(boardId, (store) => {
      for (const update of grown) store.append(update);
    });

    const out = await withStore(boardId, (store, sql) => {
      const before = store.logStats();
      const originalExec = sql.exec.bind(sql);
      const failingExec = (query: string, ...bindings: unknown[]) => {
        if (query.includes('DELETE FROM snapshot_chunks')) {
          throw new Error('injected compaction failure');
        }
        return originalExec(query, ...bindings);
      };
      (sql as { exec: unknown }).exec = failingExec;
      let compacted: boolean;
      try {
        // Rebuild the doc from snapshot + log tail (what the room holds in memory).
        const fresh = new Y.Doc();
        const load = store.load(fresh);
        expect(load.ok).toBe(true);
        compacted = store.compactIfNeeded(fresh);
      } finally {
        (sql as { exec: unknown }).exec = originalExec;
      }
      return { compacted, before, after: store.logStats() };
    });

    expect(out.compacted).toBe(false);
    expect(out.after).toEqual(out.before); // count/bytes/maxSeq all intact
    expect(out.after.count).toBe(500);
    // The previous snapshot (from the first compaction) is byte-identical.
    const secondChunk = await withStore(boardId, (_store, sql) =>
      sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0].data,
    );
    expect(new Uint8Array(secondChunk as ArrayBuffer)).toEqual(new Uint8Array(firstChunk as ArrayBuffer));
  });

  it('TC-25: migrate on a never-edited board writes no updates or snapshot rows', async () => {
    const boardId = newBoardId();
    const out = await withStore(boardId, (store, sql) => {
      store.migrate();
      return {
        updates: sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0].n as number,
        chunks: sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0].n as number,
        metaKeys: sql
          .exec('SELECT key FROM storage_meta ORDER BY key')
          .toArray()
          .map((r) => r.key as string),
      };
    });
    expect(out.updates).toBe(0);
    expect(out.chunks).toBe(0);
    expect(out.metaKeys).toEqual(['storage_schema_version']);
  });

  it('extra: a log under the row-count threshold but over COMPACTION_BYTES still compacts', async () => {
    const boardId = newBoardId();
    // Nine ~500 KB updates (≈4.5 MB) generated INSIDE the DO: large payloads
    // are not reliable across the runInDurableObject closure boundary.
    const out = await withStore(boardId, (store, sql) => {
      store.migrate();
      const source = new Y.Doc();
      const bigUpdates: Uint8Array[] = [];
      source.on('update', (update) => bigUpdates.push(update as Uint8Array));
      for (let i = 0; i < 9; i += 1) {
        source.getText(`big${i}`).insert(0, 'x'.repeat(500_000));
      }
      for (const update of bigUpdates) store.append(update);

      const before = store.logStats();
      const doc = new Y.Doc();
      const rows = sql.exec('SELECT data FROM updates ORDER BY seq').toArray();
      for (const row of rows) Y.applyUpdate(doc, bytes(row.data));
      const compacted = store.compactIfNeeded(doc);
      return { before, compacted, after: store.logStats() };
    });
    expect(out.before.count).toBe(9); // far below COMPACTION_UPDATE_COUNT
    expect(out.before.bytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(out.compacted).toBe(true);
    expect(out.after.count).toBe(0); // log truncated by the byte-threshold compaction
  });
});
