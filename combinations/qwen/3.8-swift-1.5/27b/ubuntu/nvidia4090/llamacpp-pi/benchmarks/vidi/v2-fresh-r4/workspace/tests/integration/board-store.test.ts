/**
 * persist.board_store integration tests against real Durable Object SQLite.
 *
 * Every test runs its work inside the BoardRoom Durable Object via
 * runInDurableObject so the real storage engine (transactions, blobs,
 * ordering) is exercised. Tests are isolated by using a fresh board id
 * (a fresh DO instance with its own database) per test.
 *
 * Note creation rows are self-contained updates (see tests/fixtures/boards.ts)
 * so a quarantined middle row loses only that row's note. Top-up text edits
 * are ordinary diffs — they are always compacted into the snapshot before any
 * load in the tests that use them.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store';
import { newBoardId } from '../../src/shared/board-id';
import {
  initDoc,
  getStickyText,
  createSticky,
  snapshot,
} from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import {
  createRetroBoardFixture,
  createLargeBoardFixture,
  createStickyWithText,
  damagedUpdate,
} from '../fixtures/boards';

type DO = { ctx: DurableObjectState };

async function inBoard<T>(boardId: string, fn: (obj: DO) => T): Promise<T> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id) as DurableObjectStub;
  return runInDurableObject(stub, (obj) => fn(obj as unknown as DO)) as Promise<T>;
}

function rowCount(obj: DO, table: string): number {
  return (obj.ctx.storage.sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).one() as { c: number }).c;
}

function metaValue(obj: DO, key: string): string | null {
  const row = obj.ctx.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).next();
  return row.done ? null : (row.value.value as string);
}

/**
 * Mutate an in-memory doc and append each resulting (diff) update as one row.
 * Used only for top-up edits that get compacted before load.
 */
function appendDiffs(store: BoardStore, doc: Y.Doc, mutate: () => void): number {
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  try {
    mutate();
  } finally {
    doc.off('update', handler);
  }
  for (const u of updates) store.append(u);
  return updates.length;
}

/** Append a fixture's self-contained updates, one row each. */
function appendFixture(store: BoardStore, updates: Uint8Array[]): void {
  for (const u of updates) store.append(u);
}

// --- TC-03 ------------------------------------------------------------------

describe('TC-03: empty board', () => {
  it('migrate then load → tables exist, doc empty, schema version = STORAGE_SCHEMA_VERSION', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      const tables = (
        obj.ctx.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .toArray() as Array<{ name: string }>
      ).map((t) => t.name);
      const version = metaValue(obj, 'storage_schema_version');
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      return { tables, version, loadResult, noteCount: snapshot(doc).length };
    });
    expect(result.tables).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
    );
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(result.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(result.noteCount).toBe(0);
  });
});

// --- TC-25 ------------------------------------------------------------------

describe('TC-25: never-edited board', () => {
  it('opening (migrate) a never-edited board writes no updates or snapshot rows', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      return {
        updates: rowCount(obj, 'updates'),
        chunks: rowCount(obj, 'snapshot_chunks'),
        quarantined: rowCount(obj, 'quarantined_updates'),
      };
    });
    expect(result).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
  });
});

// --- TC-04 ------------------------------------------------------------------

describe('TC-04: append', () => {
  it('append one update → 1 row, bytes column equals length', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      createStickyWithText(doc, { x: 100, y: 100 }, 'yellow', 'hello world');
      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);
      const row = obj.ctx.storage.sql.exec('SELECT seq, bytes FROM updates').one() as {
        seq: number;
        bytes: number;
      };
      return { count: rowCount(obj, 'updates'), seq: row.seq, bytes: row.bytes, updateLength: update.length };
    });
    expect(result.count).toBe(1);
    expect(result.seq).toBe(1);
    expect(result.bytes).toBe(result.updateLength);
  });
});

// --- TC-05 ------------------------------------------------------------------

describe('TC-05: LogOnly load', () => {
  it('25 self-contained note rows → load into fresh doc equals original', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates);
      const rows = rowCount(obj, 'updates');
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const original = board.build();
      const equal = JSON.stringify(snapshot(original)) === JSON.stringify(snapshot(fresh));
      return {
        rows,
        loadResult,
        equal,
        originalCount: snapshot(original).length,
        loadedCount: snapshot(fresh).length,
      };
    });
    expect(result.rows).toBe(26); // baseline + 25 notes
    expect(result.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(result.originalCount).toBe(25);
    expect(result.loadedCount).toBe(25);
    expect(result.equal).toBe(true);
  });
});

// --- TC-06 ------------------------------------------------------------------

describe('TC-06: compaction at COMPACTION_UPDATE_COUNT', () => {
  it('500 log rows → compact: rows 500 → 0, chunks ≥ 1, through_seq = max seq, reload equal', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates); // 26 rows
      const doc = board.build();
      // Top up to exactly COMPACTION_UPDATE_COUNT rows with 1-char inserts
      const firstNote = snapshot(doc)[0].id;
      const text = getStickyText(doc, firstNote)!;
      const needed = COMPACTION_UPDATE_COUNT - 26;
      appendDiffs(store, doc, () => {
        for (let i = 0; i < needed; i++) text.insert(text.length, 'x');
      });
      const before = rowCount(obj, 'updates');
      const compacted = store.compactIfNeeded(doc);
      const after = rowCount(obj, 'updates');
      const chunks = rowCount(obj, 'snapshot_chunks');
      const through = metaValue(obj, 'snapshot_through_seq');

      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const equal = JSON.stringify(snapshot(doc)) === JSON.stringify(snapshot(fresh));
      return { before, compacted, after, chunks, through, loadResult, equal };
    });
    expect(result.before).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.compacted).toBe(true);
    expect(result.after).toBe(0);
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.through).toBe(String(result.before));
    expect(result.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(result.equal).toBe(true);
  });
});

// --- TC-07 ------------------------------------------------------------------

describe('TC-07: SnapshotPlusLog load', () => {
  it('3 updates after compaction → reload has all; only rows with seq > through_seq applied', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates); // 26 rows
      const doc = board.build();
      const firstNote = snapshot(doc)[0].id;
      const text = getStickyText(doc, firstNote)!;
      const needed = COMPACTION_UPDATE_COUNT - 26;
      appendDiffs(store, doc, () => {
        for (let i = 0; i < needed; i++) text.insert(text.length, 'x');
      });
      expect(store.compactIfNeeded(doc)).toBe(true);
      const through = Number(metaValue(obj, 'snapshot_through_seq')!);

      // 3 more updates after compaction
      const original = snapshot(doc);
      const newIds: string[] = [];
      appendDiffs(store, doc, () => {
        for (let i = 0; i < 3; i++) {
          newIds.push(createSticky(doc, { x: 5000 + i * 50, y: 5000 }));
        }
      });
      const seqs = obj.ctx.storage.sql
        .exec('SELECT seq FROM updates ORDER BY seq')
        .toArray() as Array<{ seq: number }>;
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const loaded = snapshot(fresh);
      const loadedIds = loaded.map((n) => n.id);
      return {
        through,
        newIds,
        rows: seqs.map((r) => r.seq),
        loadResult,
        allOriginalPresent: original.every((n) => loadedIds.includes(n.id)),
        allNewPresent: newIds.every((id) => loadedIds.includes(id)),
        countMatches: loadedIds.length === original.length + 3,
      };
    });
    expect(result.rows).toHaveLength(3);
    for (const seq of result.rows) expect(seq).toBeGreaterThan(result.through);
    expect(result.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(result.allOriginalPresent).toBe(true);
    expect(result.allNewPresent).toBe(true);
    expect(result.countMatches).toBe(true);
  });
});

// --- TC-08 ------------------------------------------------------------------

describe('TC-08: large board compaction', () => {
  it(`PERSIST_TESTED_NOTES notes → multiple chunks when encoded > SNAPSHOT_CHUNK_BYTES; reload equal`, async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createLargeBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates); // baseline + 2000 notes
      const doc = board.build();
      const encoded = Y.encodeStateAsUpdate(doc);
      const compacted = store.compactIfNeeded(doc);
      const chunks = rowCount(obj, 'snapshot_chunks');
      const after = rowCount(obj, 'updates');
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const equal = JSON.stringify(snapshot(doc)) === JSON.stringify(snapshot(fresh));
      return {
        encodedLength: encoded.length,
        compacted,
        chunks,
        after,
        loadResult,
        equal,
        noteCount: snapshot(doc).length,
      };
    });
    expect(result.noteCount).toBe(PERSIST_TESTED_NOTES);
    expect(result.encodedLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(result.compacted).toBe(true);
    expect(result.chunks).toBeGreaterThan(1);
    expect(result.after).toBe(0);
    expect(result.loadResult).toEqual({ ok: true, quarantined: 0 });
    expect(result.equal).toBe(true);
  });
});

// --- TC-09 ------------------------------------------------------------------

describe('TC-09: one damaged log row', () => {
  it('row 7 truncated → quarantined with error; updates -1; all other notes present', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates); // 26 rows: row 1 baseline, rows 2..26 notes 1..25
      // Row 7 is the 6th note (index 5)
      const missingId = board.noteIds[5];
      const row7 = obj.ctx.storage.sql.exec('SELECT data FROM updates WHERE seq = 7').one() as {
        data: ArrayBuffer;
      };
      obj.ctx.storage.sql.exec(
        'UPDATE updates SET data = ? WHERE seq = 7',
        damagedUpdate(new Uint8Array(row7.data), 'truncated'),
      );

      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      const quarantined = obj.ctx.storage.sql
        .exec('SELECT seq, error FROM quarantined_updates ORDER BY seq')
        .toArray() as Array<{ seq: number; error: string }>;
      const loaded = snapshot(fresh);
      const loadedIds = loaded.map((n) => n.id);
      const othersPresent = board.noteIds
        .filter((id) => id !== missingId)
        .every((id) => loadedIds.includes(id));
      return {
        loadResult,
        updates: rowCount(obj, 'updates'),
        quarantined,
        loadedIds,
        missingPresent: loadedIds.includes(missingId),
        othersPresent,
      };
    });
    expect(result.loadResult).toEqual({ ok: true, quarantined: 1 });
    expect(result.updates).toBe(25);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].seq).toBe(7);
    expect(result.quarantined[0].error.length).toBeGreaterThan(0);
    expect(result.loadedIds).toHaveLength(24);
    expect(result.missingPresent).toBe(false);
    expect(result.othersPresent).toBe(true);
  });
});

// --- TC-10 ------------------------------------------------------------------

describe('TC-10: damaged snapshot', () => {
  it('chunk 0 corrupted → ok:false snapshot-unreadable; nothing deleted or quarantined', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates);
      const doc = board.build();
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      // A few log rows after compaction (so "nothing deleted" is observable)
      const firstNote = snapshot(doc)[0].id;
      const text = getStickyText(doc, firstNote)!;
      appendDiffs(store, doc, () => {
        text.insert(0, 'a');
        text.insert(0, 'b');
        text.insert(0, 'c');
      });
      const updatesBefore = rowCount(obj, 'updates');
      const chunkCountBefore = rowCount(obj, 'snapshot_chunks');

      // Corrupt chunk 0 (truncated bytes)
      const chunk0 = obj.ctx.storage.sql
        .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
        .one() as { data: ArrayBuffer };
      obj.ctx.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        damagedUpdate(new Uint8Array(chunk0.data), 'truncated'),
      );

      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);
      return {
        loadResult,
        updatesAfter: rowCount(obj, 'updates'),
        chunkCountAfter: rowCount(obj, 'snapshot_chunks'),
        quarantined: rowCount(obj, 'quarantined_updates'),
        updatesBefore,
        chunkCountBefore,
      };
    });
    expect(result.loadResult.ok).toBe(false);
    if (!result.loadResult.ok) {
      expect(result.loadResult.reason).toBe('snapshot-unreadable');
      expect(result.loadResult.error.length).toBeGreaterThan(0);
    }
    expect(result.updatesAfter).toBe(result.updatesBefore);
    expect(result.chunkCountAfter).toBe(result.chunkCountBefore);
    expect(result.quarantined).toBe(0);
  });
});

// --- TC-11 ------------------------------------------------------------------

describe('TC-11: compaction SQL failure rolls back', () => {
  it('throw after DELETE snapshot_chunks → previous chunks and log rows unchanged; returns false', async () => {
    const bid = newBoardId();
    const result = await inBoard(bid, (obj) => {
      const board = createRetroBoardFixture();
      const store = new BoardStore(obj.ctx.storage);
      store.migrate();
      appendFixture(store, board.updates);
      const doc = board.build();
      expect(store.compactIfNeeded(doc, true)).toBe(true);
      const firstNote = snapshot(doc)[0].id;
      const text = getStickyText(doc, firstNote)!;
      appendDiffs(store, doc, () => {
        text.insert(0, 'a');
        text.insert(0, 'b');
        text.insert(0, 'c');
      });

      const chunkSignatures = () =>
        (obj.ctx.storage.sql
          .exec('SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx')
          .toArray() as Array<{ idx: number; len: number }>)
          .map((r) => `${r.idx}:${r.len}`)
          .join(',');
      const logSequences = () =>
        (obj.ctx.storage.sql
          .exec('SELECT seq FROM updates ORDER BY seq')
          .toArray() as Array<{ seq: number }>)
          .map((r) => r.seq)
          .join(',');

      const chunksBefore = chunkSignatures();
      const logBefore = logSequences();

      // Faulty store: throws after the chunk delete, inside the transaction
      const faulty = new BoardStore(obj.ctx.storage, {
        fault: (point) => {
          if (point === 'compaction:after-delete-chunks') {
            throw new Error('injected compaction failure (test)');
          }
        },
      });
      const compacted = faulty.compactIfNeeded(doc, true);

      return {
        compacted,
        chunksAfter: chunkSignatures(),
        logAfter: logSequences(),
        chunksBefore,
        logBefore,
        logCount: rowCount(obj, 'updates'),
      };
    });
    expect(result.compacted).toBe(false);
    expect(result.chunksAfter).toBe(result.chunksBefore);
    expect(result.logAfter).toBe(result.logBefore);
    expect(result.logCount).toBe(3);
  });
});
