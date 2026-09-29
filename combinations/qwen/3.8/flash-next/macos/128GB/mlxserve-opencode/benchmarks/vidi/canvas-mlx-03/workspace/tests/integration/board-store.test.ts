/// <reference types="@cloudflare/vitest-pool-workers" />
// Story 4, task 3 — `persist.board_store` against real SQLite storage.
//
// Every case runs inside a real Durable Object (`env.BOARD_ROOM` +
// `runInDurableObject`), i.e. the same SQLite-backed storage a wrangler deployment
// gets, isolated per test by the pool. Where a case needs damage or a SQL failure
// it uses the seams the design names: a real byte overwrite in a real table, or a
// failing statement injected *outside* SQLite so the real transaction semantics
// still apply (design "Mock vs real boundaries").
//
// Covers TC-03 (Empty load), TC-04 (append one note), TC-05 (25 notes load),
// TC-06 + boundary (row-count compaction, 25 notes / 500 rows), TC-07
// (snapshot + log, only rows after through_seq applied), TC-08
// (PERSIST_TESTED_NOTES compaction), TC-09 (damaged log row, both byte shapes),
// TC-10 (damaged snapshot), TC-11 (failing compaction rolls back), TC-25
// (opening a board writes no rows).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { BoardStore, type LoadResult, type SqlValue } from '../../src/worker/board-store.ts';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model.ts';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config.ts';
import {
  batchedNoteUpdates,
  docFromUpdates,
  largeBoard,
  largeBoardSpecs,
  randomBytesLike,
  retroBoard,
  retroBoardWithEdits,
  specsMatch,
  specsOf,
  truncatedUpdate,
  type NoteSpec,
} from '../fixtures/boards.ts';

// The room's namespace, typed the way the other integration file types it.
const boardRoom = (env as unknown as { BOARD_ROOM: DurableObjectNamespace }).BOARD_ROOM;

/** What a case may use inside the Durable Object. */
interface Ctx {
  /** The store under test, created fresh for this call. */
  store: BoardStore;
  /** Another store over the same storage, sharing the SQL log: a reopened room. */
  makeStore(): BoardStore;
  count(table: string): number;
  /** Total stored bytes of a table's `data` column. */
  sumDataBytes(table: string): number;
  /** Stored `bytes` column total of the update log. */
  sumLogBytes(): number;
  /** `snapshot_through_seq`, or null when no snapshot has been folded yet. */
  through(): number | null;
  exec(query: string, ...bindings: unknown[]): Record<string, SqlValue>[];
  /**
   * Make the statement matching `pattern` fail *after* it ran, inside whatever
   * transaction it is part of. Injected outside SQLite, so rollback behaviour is
   * the platform's own.
   */
  failAfter(pattern: RegExp): void;
}

interface ScenarioResult {
  counts: { updates: number; chunks: number; quarantined: number };
  through: number | null;
  /** Every SQL statement issued through the spied storage, in order. */
  queries: string[];
  res?: LoadResult;
  notes?: readonly StickySnapshot[];
  noteCount?: number;
  rowsWritten?: number;
  bytesWritten?: number;
  lastSeq?: number;
  chunkCount?: number;
  chunkBytes?: number;
  chunkSizes?: number[];
  loadMs?: number;
  compacted?: boolean;
  compactedUnder?: boolean;
  schemaVersion?: string | null;
  metaRows?: number;
  logBytes?: number;
  row?: { seq: number; bytes: number; dataLength: number; error?: string };
  rowMatches?: boolean;
  quarantine?: { seq: number; bytes: number; error: string }[];
  before?: { updates: number; chunks: number; through: number | null; chunkBytes?: number; logBytes?: number };
  after?: { updates: number; chunks: number; through: number | null; chunkBytes?: number; logBytes?: number };
  totals?: { count: number; bytes: number; lastSeq: number; through: number };
}

/**
 * Run `body` inside the Durable Object that serves board `name`, with a spied
 * `sql` so statements can be asserted on and failures injected. The body runs as
 * one synchronous block inside the object — the same guarantee the room relies on.
 */
async function scenario(
  name: string,
  body: (ctx: Ctx) => Omit<ScenarioResult, 'counts' | 'through' | 'queries'>,
): Promise<ScenarioResult> {
  const stub = boardRoom.get(boardRoom.idFromName(name));
  return runInDurableObject(stub, (_obj: unknown, state: any) => {
    const queries: string[] = [];
    const real = state.storage as {
      sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, SqlValue>[] } };
      transactionSync<T>(closure: () => T): T;
    };
    let failing: RegExp | null = null;
    const spied = {
      sql: {
        exec(query: string, ...bindings: unknown[]) {
          queries.push(query);
          const cursor = real.sql.exec(query, ...bindings);
          if (failing && failing.test(query)) {
            failing = null;
            // A statement the SQLite build cannot prepare, thrown from inside the
            // same synchronous block: the enclosing transaction rolls back.
            real.sql.exec('SELECT * FROM this_table_does_not_exist');
          }
          return cursor;
        },
      },
      transactionSync<T>(closure: () => T): T {
        return real.transactionSync(closure);
      },
    };
    const scalar = (query: string): number => {
      // A case may have removed a table on purpose; then there is no number.
      try {
        const row = real.sql.exec(query).toArray()[0] as { n?: number | null } | undefined;
        return Number(row?.n ?? -1);
      } catch {
        return -1;
      }
    };
    const ctx: Ctx = {
      store: new BoardStore(spied),
      makeStore: () => new BoardStore(spied),
      count: (table) => scalar(`SELECT COUNT(*) AS n FROM ${table}`),
      sumDataBytes: (table) => scalar(`SELECT COALESCE(SUM(length(data)), 0) AS n FROM ${table}`),
      sumLogBytes: () => scalar('SELECT COALESCE(SUM(bytes), 0) AS n FROM updates'),
      through: () => {
        const rows = real.sql
          .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
          .toArray();
        return rows.length > 0 ? Number((rows[0] as { value: string }).value) : null;
      },
      exec: (query, ...bindings) => real.sql.exec(query, ...bindings).toArray(),
      failAfter: (pattern) => {
        failing = pattern;
      },
    };
    ctx.store.migrate();
    const out = body(ctx);
    return {
      ...out,
      counts: {
        updates: ctx.count('updates'),
        chunks: ctx.count('snapshot_chunks'),
        quarantined: ctx.count('quarantined_updates'),
      },
      through: ctx.through(),
      queries,
    };
  }) as unknown as Promise<ScenarioResult>;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

describe('persist.board_store: empty board and first write', () => {
  // TC-03 — D1 Empty / D4 0 notes / trigger load
  it('TC-03: migrate then load on a brand-new board leaves tables present, the doc empty and the schema stamped', async () => {
    const r = await scenario('tc03-new-board', (ctx) => {
      const doc = new Y.Doc();
      const res = ctx.store.load(doc);
      const rows = ctx.exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'");
      return {
        res,
        noteCount: doc.getMap('objects').size,
        schemaVersion: rows.length > 0 ? String((rows[0] as { value: string }).value) : null,
      };
    });

    // Opening a board is not a failure, and it is an empty board rather than an
    // error: every table exists (a COUNT over a missing table would have given -1).
    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.noteCount).toBe(0);
    expect(r.counts).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
    expect(r.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  // TC-25 — negative: opening a board must not create rows
  it('TC-25: a board that was never edited is opened without writing any update or snapshot row', async () => {
    const r = await scenario('tc25-untouched-board', (ctx) => {
      const doc = new Y.Doc();
      const res = ctx.store.load(doc);
      // Two more loads, as if several people opened the link and left again.
      ctx.store.load(new Y.Doc());
      ctx.store.load(new Y.Doc());
      return {
        res,
        noteCount: doc.getMap('objects').size,
        metaRows: ctx.count('storage_meta'),
      };
    });

    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.noteCount).toBe(0);
    // Only the tables and the one schema stamp exist.
    expect(r.counts).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
    expect(r.metaRows).toBe(1);
  });

  // TC-04 — D1 Empty / append / D4 1 note
  it('TC-04: appending the first note writes exactly one log row whose bytes column and data are the update', async () => {
    const board = retroBoard();
    const firstNote = board.updates[1]!; // row 0 is the schema meta write
    const r = await scenario('tc04-board', (ctx) => {
      const before = { updates: ctx.count('updates'), chunks: 0, through: ctx.through() };
      ctx.store.append(firstNote);
      const row = ctx.exec('SELECT seq, bytes, length(data) AS n, data FROM updates WHERE seq = 1')[0]!;
      const stored = new Uint8Array(row.data as ArrayBuffer);
      let identical = stored.length === firstNote.length;
      for (let i = 0; i < stored.length; i++) if (stored[i] !== firstNote[i]) identical = false;
      return {
        before,
        after: { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through: ctx.through() },
        row: {
          seq: Number(row.seq),
          bytes: Number(row.bytes),
          dataLength: Number(row.n),
        },
        rowMatches: identical,
        totals: {
          count: ctx.store.logCount,
          bytes: ctx.store.logBytes,
          lastSeq: ctx.store.lastSeq,
          through: ctx.store.snapshotThrough,
        },
      };
    });

    expect(r.before).toEqual({ updates: 0, chunks: 0, through: null });
    expect(r.after!.updates).toBe(1);
    expect(r.row!.seq).toBe(1);
    // The `bytes` column is the update's length, and the data is byte-identical.
    expect(r.row!.bytes).toBe(firstNote.length);
    expect(r.row!.dataLength).toBe(firstNote.length);
    expect(r.rowMatches).toBe(true);
    expect(r.totals).toEqual({ count: 1, bytes: firstNote.length, lastSeq: 1, through: 0 });
  });
});

describe('persist.board_store: load and reopen', () => {
  // TC-05 — D1 LogOnly / D4 25 notes
  it('TC-05: loading 25 notes into a fresh document gives the original board', async () => {
    const board = retroBoard();
    const r = await scenario('tc05-board', (ctx) => {
      for (const update of board.updates) ctx.store.append(update);
      const doc = new Y.Doc();
      const res = ctx.store.load(doc);
      return { res, notes: snapshot(doc) };
    });

    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.notes).toHaveLength(25);
    // Compared against a document assembled in the test process from the same
    // update bytes — an independent path, not the store's own.
    const original = snapshot(docFromUpdates(board.updates));
    expect(specsMatch(r.notes ?? [], specsOf(original))).toBe(true);
    expect(specsMatch(r.notes ?? [], board.expected)).toBe(true);
    expect(r.counts.updates).toBe(board.updates.length);
  });

  // TC-04/TC-05 read-back after a reopen, and append-only accounting
  it('TC-05b: a reopened store loads the same board and its counters match the database exactly', async () => {
    const board = largeBoard(500);
    const r = await scenario('tc05b-board', (ctx) => {
      for (const update of board.updates) ctx.store.append(update);
      // A brand-new store over the same storage: the room after a wake-up.
      const reopened = ctx.makeStore();
      reopened.migrate();
      const doc = new Y.Doc();
      const res = reopened.load(doc);
      return {
        res,
        notes: snapshot(doc),
        logBytes: ctx.sumLogBytes(),
        totals: {
          count: reopened.logCount,
          bytes: reopened.logBytes,
          lastSeq: reopened.lastSeq,
          through: reopened.snapshotThrough,
        },
      };
    });

    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.notes).toHaveLength(500);
    expect(specsMatch(r.notes ?? [], board.expected)).toBe(true);
    expect(r.counts.updates).toBe(501);
    // Byte-for-byte accounting after a reload: no COUNT(*) per write, and no drift.
    expect(r.totals!.count).toBe(501);
    expect(r.totals!.bytes).toBe(r.logBytes);
    expect(r.totals!.bytes).toBeGreaterThan(0);
    expect(r.totals!.lastSeq).toBe(501);
    expect(r.totals!.through).toBe(0);
    // Append-only: the log was never UPDATEd or DELETEd by the store.
    expect(r.queries.filter((q) => /^\s*(UPDATE|DELETE)\b/i.test(q))).toEqual([]);
    expect(r.queries.some((q) => /^\s*INSERT INTO updates\b/.test(q))).toBe(true);
  });
});

describe('persist.board_store: compaction', () => {
  // TC-06 — D1 LogOnly / D4 25 notes at COMPACTION_UPDATE_COUNT rows
  it('TC-06: at COMPACTION_UPDATE_COUNT rows the log folds into chunks and the reload is the same board', async () => {
    const rows = COMPACTION_UPDATE_COUNT; // 25 notes, 500 rows
    const board = retroBoardWithEdits(rows - 26);
    expect(board.updates.length).toBe(rows);

    const r = await scenario('tc06-board', (ctx) => {
      for (const update of board.updates) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const before = { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through: ctx.through() };
      const compacted = ctx.store.compactIfNeeded(doc);
      const after = { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through: ctx.through() };
      const fresh = new Y.Doc();
      const res = ctx.store.load(fresh);
      return {
        compacted,
        before,
        after,
        res,
        lastSeq: ctx.store.lastSeq,
        notes: snapshot(fresh),
        chunkSizes: ctx.exec('SELECT length(data) AS n FROM snapshot_chunks ORDER BY idx').map((row) => Number(row.n)),
        totals: {
          count: ctx.store.logCount,
          bytes: ctx.store.logBytes,
          lastSeq: ctx.store.lastSeq,
          through: ctx.store.snapshotThrough,
        },
      };
    });

    expect(r.before).toEqual({ updates: COMPACTION_UPDATE_COUNT, chunks: 0, through: null });
    expect(r.compacted).toBe(true);
    expect(r.after!.updates).toBe(0);
    expect(r.after!.chunks).toBeGreaterThanOrEqual(1);
    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    // through_seq is the highest seq that was folded in, so a later load starts
    // after the snapshot instead of replaying it.
    expect(r.after!.through).toBe(r.lastSeq);
    expect(r.after!.through).toBe(COMPACTION_UPDATE_COUNT);
    expect(specsMatch(r.notes ?? [], board.expected)).toBe(true);
    // Every chunk is within the row-size limit.
    expect(r.chunkSizes!.every((n) => n <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    // The store's own counters were reset with the fold.
    expect(r.totals).toEqual({ count: 0, bytes: 0, lastSeq: COMPACTION_UPDATE_COUNT, through: COMPACTION_UPDATE_COUNT });
  });

  // TC-06 boundary — the "compacts exactly at the threshold, not before" half
  it('TC-06b: compaction does not happen one row before the threshold and does at the threshold', async () => {
    const board = retroBoardWithEdits(COMPACTION_UPDATE_COUNT - 26);
    const r = await scenario('tc06b-board', (ctx) => {
      for (const update of board.updates.slice(0, COMPACTION_UPDATE_COUNT - 1)) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const compactedUnder = ctx.store.compactIfNeeded(doc);
      const before = {
        updates: ctx.count('updates'),
        chunks: ctx.count('snapshot_chunks'),
        through: ctx.through(),
      };
      ctx.store.append(board.updates[COMPACTION_UPDATE_COUNT - 1]!); // the 500th row
      const compacted = ctx.store.compactIfNeeded(doc);
      return {
        compacted,
        compactedUnder,
        before,
        after: { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through: ctx.through() },
      };
    });

    expect(r.compactedUnder).toBe(false);
    expect(r.before).toEqual({ updates: COMPACTION_UPDATE_COUNT - 1, chunks: 0, through: null });
    expect(r.compacted).toBe(true);
    expect(r.after!.updates).toBe(0);
    expect(r.after!.chunks).toBeGreaterThanOrEqual(1);
  });

  // TC-07 — D1 SnapshotPlusLog / D4 25 notes / trigger load
  it('TC-07: after a compaction the log continues, and only rows after through_seq are applied', async () => {
    const base = retroBoardWithEdits(COMPACTION_UPDATE_COUNT - 26);
    // Three further changes, stacked above the existing notes.
    const extraSpecs: NoteSpec[] = largeBoardSpecs(3, 4242).map((spec, i) => ({ ...spec, z: 100 + i }));
    const extraUpdates = batchedNoteUpdates(extraSpecs.map((spec) => [spec]));

    const r = await scenario('tc07-board', (ctx) => {
      for (const update of base.updates) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const compacted = ctx.store.compactIfNeeded(doc);
      const through = ctx.through();
      const afterFold = { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through };

      for (const update of extraUpdates) ctx.store.append(update);

      // Prove the through_seq cut: a damaged row filed *at* through_seq must be
      // ignored entirely, while the three rows after it are applied.
      ctx.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        through,
        randomBytesLike(extraUpdates[0]!),
        12,
      );

      const fresh = new Y.Doc();
      const res = ctx.store.load(fresh);
      return {
        compacted,
        before: afterFold,
        after: { updates: ctx.count('updates'), chunks: ctx.count('snapshot_chunks'), through: ctx.through() },
        res,
        notes: snapshot(fresh),
        lastSeq: ctx.store.lastSeq,
      };
    });

    expect(r.compacted).toBe(true);
    expect(r.before).toEqual({ updates: 0, chunks: r.before!.chunks, through: COMPACTION_UPDATE_COUNT });
    // The board comes back as the original plus exactly the three new changes.
    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.notes).toHaveLength(28);
    const expected = [...base.expected, ...extraSpecs].sort((a, b) => a.z - b.z);
    expect(specsMatch(r.notes ?? [], expected)).toBe(true);
    for (const spec of extraSpecs) expect(r.notes!.some((n) => n.text === spec.text)).toBe(true);
    // Nothing was quarantined and no row after through_seq was skipped: the
    // damaged row filed *at* through_seq was never even read.
    expect(r.counts.quarantined).toBe(0);
    expect(r.after!.updates).toBe(4);
  });

  // TC-08 — D1 Snapshotted / D4 PERSIST_TESTED_NOTES
  it('TC-08: compacting a PERSIST_TESTED_NOTES board stores several chunks and reloads identically', async () => {
    const board = largeBoard(PERSIST_TESTED_NOTES);
    const r = await scenario('tc08-board', (ctx) => {
      for (const update of board.updates) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const compacted = ctx.store.compactIfNeeded(doc);
      const chunkSizes = ctx
        .exec('SELECT length(data) AS n FROM snapshot_chunks ORDER BY idx')
        .map((row) => Number(row.n));
      const fresh = new Y.Doc();
      const started = performance.now();
      const res = ctx.store.load(fresh);
      const loadMs = performance.now() - started;
      return {
        compacted,
        res,
        loadMs,
        chunkSizes,
        notes: snapshot(fresh),
        lastSeq: ctx.store.lastSeq,
      };
    });

    expect(r.compacted).toBe(true);
    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    expect(r.notes).toHaveLength(PERSIST_TESTED_NOTES);
    expect(specsMatch(r.notes ?? [], board.expected)).toBe(true);
    const encoded = r.chunkSizes ?? [];
    // Chunked rather than one oversized row, and more than one chunk once the
    // encoded snapshot is bigger than the chunk size.
    expect(encoded.every((n) => n <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect(r.counts.chunks).toBe(Math.ceil(sum(encoded) / SNAPSHOT_CHUNK_BYTES));
    if (sum(encoded) > SNAPSHOT_CHUNK_BYTES) expect(r.counts.chunks).toBeGreaterThan(1);
    expect(r.through).toBe(r.lastSeq);
    // A board this size must open inside the PRD's budget (TC-21 is the browser
    // version of this number).
    expect(r.loadMs!).toBeLessThan(3000);
  });

  // TC-11 — D2 SQL error on write during compaction (negative scenario)
  it('TC-11: a compaction that fails after deleting the old chunks rolls back with snapshot and log intact', async () => {
    const board = retroBoardWithEdits(1000); // 25 notes over 1026 rows
    const r = await scenario('tc11-board', (ctx) => {
      // First fold: a snapshot exists from row 1..COMPACTION_UPDATE_COUNT.
      for (const update of board.updates.slice(0, COMPACTION_UPDATE_COUNT)) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const folded = ctx.store.compactIfNeeded(doc);

      // Further edits pile up in the log, so a second fold has work to do.
      for (const update of board.updates.slice(COMPACTION_UPDATE_COUNT)) ctx.store.append(update);
      ctx.store.load(doc);

      const before = {
        updates: ctx.count('updates'),
        chunks: ctx.count('snapshot_chunks'),
        through: ctx.through(),
        chunkBytes: ctx.sumDataBytes('snapshot_chunks'),
        logBytes: ctx.sumLogBytes(),
      };
      // The fold deletes the previous chunks first; make the statement right after
      // that one fail, inside the same transaction.
      ctx.failAfter(/^DELETE FROM snapshot_chunks/);
      const rolledBack = ctx.store.compactIfNeeded(doc);
      const after = {
        updates: ctx.count('updates'),
        chunks: ctx.count('snapshot_chunks'),
        through: ctx.through(),
        chunkBytes: ctx.sumDataBytes('snapshot_chunks'),
        logBytes: ctx.sumLogBytes(),
      };
      const fresh = new Y.Doc();
      const res = ctx.store.load(fresh);
      return {
        compacted: folded,
        compactedUnder: rolledBack,
        before,
        after,
        res,
        notes: snapshot(fresh),
        totals: {
          count: ctx.store.logCount,
          bytes: ctx.store.logBytes,
          lastSeq: ctx.store.lastSeq,
          through: ctx.store.snapshotThrough,
        },
      };
    });

    expect(r.compacted).toBe(true);
    // The failed fold reported false to the room instead of throwing at it.
    expect(r.compactedUnder).toBe(false);
    expect(r.res).toEqual({ ok: true, quarantined: 0 });
    // The previous snapshot and every log row are exactly as they were: the chunk
    // delete was rolled back with the rest of the transaction.
    expect(r.after!.chunks).toBe(r.before!.chunks);
    expect(r.after!.chunkBytes).toBe(r.before!.chunkBytes);
    expect(r.after!.chunkBytes).toBeGreaterThan(0);
    expect(r.after!.updates).toBe(1026 - COMPACTION_UPDATE_COUNT);
    expect(r.after!.logBytes).toBe(r.before!.logBytes);
    expect(r.after!.logBytes).toBeGreaterThan(0);
    expect(r.after!.through).toBe(COMPACTION_UPDATE_COUNT);
    // The store still knows the log it holds, and the board still loads whole.
    expect(r.totals).toEqual({
      count: 1026 - COMPACTION_UPDATE_COUNT,
      bytes: r.before!.logBytes,
      lastSeq: 1026,
      through: COMPACTION_UPDATE_COUNT,
    });
    expect(r.notes).toHaveLength(25);
    expect(specsMatch(r.notes ?? [], board.expected)).toBe(true);
  });
});

describe('persist.board_store: damaged rows', () => {
  // TC-09 — D2 one damaged log row / D4 25 notes (both damage shapes)
  for (const shape of ['truncated', 'random'] as const) {
    it(`TC-09 (${shape}): a damaged log row is quarantined with its error and every other note is present`, async () => {
      const board = retroBoard();
      const damage = shape === 'truncated' ? truncatedUpdate : randomBytesLike;
      // Row 7 is the note `expected[5]` (row 1 is the schema meta write).
      const lost = board.expected[5]!;
      const lostId = board.stickyIds[5]!;
      const damaged = damage(board.updates[6]!);
      const survivors = board.expected.filter((spec) => spec !== lost);

      const r = await scenario(`tc09-${shape}-board`, (ctx) => {
        for (const update of board.updates) ctx.store.append(update);
        const intact = { updates: ctx.count('updates'), chunks: 0, through: ctx.through() };
        // Test-only fix: overwrite row 7's data with damaged bytes of its own size.
        ctx.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = 7', damaged, damaged.length);
        const doc = new Y.Doc();
        const res = ctx.store.load(doc);
        const quarantine = ctx
          .exec('SELECT seq, length(data) AS n, error FROM quarantined_updates')
          .map((row) => ({ seq: Number(row.seq), bytes: Number(row.n), error: String(row.error) }));
        return { res, notes: snapshot(doc), before: intact, quarantine };
      });

      // The board opens and says what it lost, instead of failing or pretending.
      expect(r.res).toEqual({ ok: true, quarantined: 1 });
      expect(r.before).toEqual({ updates: 26, chunks: 0, through: null });
      expect(r.counts.quarantined).toBe(1);
      expect(r.counts.updates).toBe(25); // updates count -1
      // The damaged row is kept byte-for-byte with a real error message.
      expect(r.quarantine).toHaveLength(1);
      expect(r.quarantine![0]!.seq).toBe(7);
      expect(r.quarantine![0]!.bytes).toBe(damaged.length);
      expect(r.quarantine![0]!.error.length).toBeGreaterThan(3);
      // All 24 other notes are there, exactly as written.
      const loaded = r.notes ?? [];
      const others = loaded.filter((n) => n.id !== lostId);
      expect(others).toHaveLength(24);
      expect(specsMatch(others, survivors)).toBe(true);
      // The damaged change is never presented as if it had been fine: what came
      // back is not the board that was written. Depending on where the row's
      // decoding stopped, the note is either absent or a half-decoded object.
      expect(specsMatch(loaded, board.expected)).toBe(false);

      // Loading again is settled: the damaged row is out of the log, so nothing is
      // quarantined twice and the board stops changing.
      const again = await scenario(`tc09-${shape}-board`, (ctx) => {
        const fresh = ctx.makeStore();
        fresh.migrate();
        const doc = new Y.Doc();
        const res = fresh.load(doc);
        return { res, notes: snapshot(doc), noteCount: ctx.count('quarantined_updates') };
      });
      expect(again.res).toEqual({ ok: true, quarantined: 0 });
      expect(again.noteCount).toBe(1);
      expect(again.notes).toHaveLength(24);
      expect(specsMatch(again.notes ?? [], survivors)).toBe(true);

      // And from here on every load is identical.
      const third = await scenario(`tc09-${shape}-board`, (ctx) => {
        const fresh = ctx.makeStore();
        fresh.migrate();
        const doc = new Y.Doc();
        const res = fresh.load(doc);
        return { res, notes: snapshot(doc) };
      });
      expect(third.res).toEqual({ ok: true, quarantined: 0 });
      expect(specsMatch(third.notes ?? [], specsOf(again.notes ?? []))).toBe(true);
    });
  }

  // TC-10 — D2 damaged snapshot (negative scenario)
  it('TC-10: a corrupted snapshot chunk is a load failure that deletes and quarantines nothing', async () => {
    const board = retroBoardWithEdits(COMPACTION_UPDATE_COUNT - 26);
    const written = await scenario('tc10-board', (ctx) => {
      for (const update of board.updates) ctx.store.append(update);
      const doc = new Y.Doc();
      ctx.store.load(doc);
      const compacted = ctx.store.compactIfNeeded(doc);
      const chunk0 = ctx.exec('SELECT data FROM snapshot_chunks WHERE idx = 0')[0]!.data as ArrayBuffer;
      expectNonEmptyChunk(chunk0);
      const before = {
        updates: ctx.count('updates'),
        chunks: ctx.count('snapshot_chunks'),
        through: ctx.through(),
      };
      // Test-only fix: replace chunk 0 with random bytes of its own length.
      ctx.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        randomBytesLike(new Uint8Array(chunk0)),
      );
      return { compacted, before, noteCount: snapshot(doc).length };
    });

    expect(written.compacted).toBe(true);
    expect(written.noteCount).toBe(25); // the board was whole before it was broken
    expect(written.counts.chunks).toBeGreaterThanOrEqual(1);
    expect(written.before).toEqual({ updates: 0, chunks: written.counts.chunks, through: COMPACTION_UPDATE_COUNT });

    // Reopen: a load failure rather than an empty board.
    const reopened = await scenario('tc10-board', (ctx) => {
      const fresh = ctx.makeStore();
      fresh.migrate();
      const doc = new Y.Doc();
      const res = fresh.load(doc);
      return { res, noteCount: snapshot(doc).length };
    });
    expect(reopened.res).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    // The failure is surfaced rather than swallowed: it carries what went wrong.
    const message = (reopened.res as { error?: string }).error ?? '';
    expect(message.length).toBeGreaterThan(3);
    // The failed load hands back nothing rather than a half-board or a fake one.
    expect(reopened.noteCount).toBe(0);
    // Nothing was deleted or quarantined by the failed load.
    expect(reopened.counts).toEqual({ updates: 0, chunks: written.counts.chunks, quarantined: 0 });
  });
});

function expectNonEmptyChunk(chunk: unknown): void {
  if (!(chunk instanceof ArrayBuffer) || chunk.byteLength === 0) {
    throw new Error('expected a non-empty snapshot chunk');
  }
}
