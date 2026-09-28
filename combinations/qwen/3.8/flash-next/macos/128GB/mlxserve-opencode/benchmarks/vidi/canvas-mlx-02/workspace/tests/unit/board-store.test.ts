// Pure parts of the durable board store, testable without a Durable Object:
// TC-01 chunkBytes/joinChunks, TC-02 shouldCompact, plus the exact schema
// statement list and the "migrate() writes no update rows" property against a
// recording fake. The real-SQLite behaviour (load order, quarantine, rollback,
// BLOB round-trip) is tests/integration/board-store.test.ts (TC-03..TC-11, TC-25),
// which drives this same BoardStore against an actual DO's SQLite.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  BoardStore,
  LOAD_ORIGIN,
  META_SCHEMA_VERSION,
  META_SNAPSHOT_THROUGH_SEQ,
  SCHEMA_STATEMENTS,
  STORAGE_SCHEMA_VERSION,
  chunkBytes,
  joinChunks,
  shouldCompact,
  type BoardStorage,
  type SqlBinding,
} from '../../src/worker/board-store.ts';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config.ts';
import { createSticky } from '../../src/shared/board-model.ts';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('TC-01 chunkBytes / joinChunks', () => {
  it('splits a payload larger than SNAPSHOT_CHUNK_BYTES and joins it back byte-for-byte', () => {
    const size = SNAPSHOT_CHUNK_BYTES * 2 + 74_176;
    const data = new Uint8Array(size);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 8)) % 251;
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES,
      74_176,
    ]);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    const joined = joinChunks(chunks);
    expect(joined.length).toBe(data.length);
    expect(bytesEq(joined, data)).toBe(true);
  });

  it('a payload exactly one chunk long stays one chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    expect(chunkBytes(data).map((c) => c.length)).toEqual([SNAPSHOT_CHUNK_BYTES]);
    const justOver = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    expect(chunkBytes(justOver).map((c) => c.length)).toEqual([SNAPSHOT_CHUNK_BYTES, 1]);
  });

  it('honours an explicit chunk size and never returns an empty trailing chunk', () => {
    expect(chunkBytes(bytes(1, 2, 3, 4, 5, 6), 3).map((c) => c.length)).toEqual([3, 3]);
    expect(chunkBytes(bytes(1, 2, 3, 4, 5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
    for (const size of [1, 2, 3, 4, 5, 6]) {
      const data = bytes(9, 8, 7, 6, 5, 4);
      expect(bytesEq(joinChunks(chunkBytes(data, size)), data)).toBe(true);
    }
  });

  it('empty input produces no chunks and joins to an empty payload', () => {
    expect(chunkBytes(bytes())).toEqual([]);
    expect(joinChunks([]).length).toBe(0);
    expect(joinChunks(chunkBytes(bytes()))).toEqual(bytes());
  });

  it('a non-positive or non-integer chunk size is a programming error', () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => chunkBytes(bytes(1, 2, 3), size)).toThrow(RangeError);
    }
  });
});

describe('TC-02 shouldCompact thresholds', () => {
  it('fires at the configured row count, not before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('fires at the configured byte count, not before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('the thresholds are OR-ed', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 1)).toBe(true);
    expect(shouldCompact(1, COMPACTION_BYTES + 1)).toBe(true);
    expect(shouldCompact(0, 0)).toBe(false);
  });

  it('the store reaches the threshold after appending and clears it after compacting', () => {
    const fake = new FakeStorage();
    const store = new BoardStore(fake, 64);
    const doc = new Y.Doc();
    let pending: Uint8Array = new Uint8Array(0);
    doc.on('update', (update) => {
      pending = update;
    });
    expect(store.shouldCompact()).toBe(false);
    for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
      createSticky(doc, { x: i, y: 0 });
      store.append(pending);
    }
    expect(store.updateCount).toBe(COMPACTION_UPDATE_COUNT);
    expect(store.updateBytes).toBeGreaterThan(0);
    expect(store.shouldCompact()).toBe(true);
    expect(store.compactIfNeeded(doc)).toBe(true);
    expect(store.updateCount).toBe(0);
    expect(store.updateBytes).toBe(0);
    expect(store.snapshotThroughSeq).toBe(COMPACTION_UPDATE_COUNT);
    expect(store.shouldCompact()).toBe(false);

    // A second threshold is reached only by appending again, and the snapshot
    // is then rewritten (INSERT OR REPLACE semantics are the store's business).
    // Appending again starts a fresh log that must cross the threshold again
    // before anything is written.
    store.append(new Uint8Array(10));
    expect(store.updateCount).toBe(1);
    expect(store.compactIfNeeded(doc)).toBe(false);
  });
});

describe('schema statement list', () => {
  it('creates exactly the four contracted tables, idempotently', () => {
    const tables = SCHEMA_STATEMENTS.map((sql) => {
      const m = /^CREATE TABLE IF NOT EXISTS (\w+) \(/.exec(sql.trim());
      if (!m) throw new Error(`statement is not idempotent DDL: ${sql}`);
      return m[1];
    });
    expect(tables).toEqual([
      'storage_meta',
      'updates',
      'snapshot_chunks',
      'quarantined_updates',
    ]);
  });

  it('migrate() runs the DDL plus one storage_meta row and writes no update rows', () => {
    const fake = new FakeStorage();
    const store = new BoardStore(fake);
    store.migrate();
    store.migrate();

    const inserts = fake.writes.filter((w) => /\bINSERT\b/i.test(w.sql) && !/^\s*CREATE/i.test(w.sql));
    // Two migrates: one idempotent version row each, nothing else written.
    expect(inserts.length).toBe(2);
    for (const insert of inserts) {
      expect(insert.sql).toMatch(/^INSERT OR IGNORE INTO storage_meta/);
      expect(insert.bindings[0]).toBe(META_SCHEMA_VERSION);
      expect(insert.bindings[1]).toBe(String(STORAGE_SCHEMA_VERSION));
    }
    expect(fake.writes.some((w) => /INTO updates\b/.test(w.sql))).toBe(false);
    expect(fake.writes.some((w) => /INTO snapshot_chunks\b/.test(w.sql))).toBe(false);
    expect(fake.writes.some((w) => /INTO quarantined_updates\b/.test(w.sql))).toBe(false);
  });

  it('append() writes the row and its byte count, and does not compact', () => {
    const fake = new FakeStorage();
    const store = new BoardStore(fake);
    store.migrate();
    fake.writes.length = 0;
    store.append(bytes(1, 2, 3, 4, 5));
    expect(fake.writes.length).toBe(1);
    expect(fake.writes[0].sql).toMatch(/^INSERT INTO updates \(bytes, data\)/);
    expect(fake.writes[0].bindings[0]).toBe(5);
    expect(store.updateCount).toBe(1);
    expect(store.updateBytes).toBe(5);
  });

  it('LOAD_ORIGIN is a private symbol, so no other origin can collide with it', () => {
    expect(typeof LOAD_ORIGIN).toBe('symbol');
    expect(String(LOAD_ORIGIN)).toContain('board-store-load');
  });

  it('the meta keys are the contracted names', () => {
    expect(META_SCHEMA_VERSION).toBe('storage_schema_version');
    expect(META_SNAPSHOT_THROUGH_SEQ).toBe('snapshot_through_seq');
  });
});

/**
 * A recording fake that satisfies the store's structural storage contract. It
 * understands just enough SQL for the compaction bookkeeping (it counts rows and
 * tracks the two meta keys) so the threshold test can run without SQLite; every
 * statement it receives is recorded verbatim for assertions.
 */
class FakeStorage implements BoardStorage {
  readonly writes: { sql: string; bindings: SqlBinding[] }[] = [];
  private readonly meta = new Map<string, string>();
  private logRows = 0;
  private logBytes = 0;
  private seq = 0;
  // Which tables this fake holds, the way SQLite's own schema table reports them:
  // `CREATE TABLE` puts a name here and the store's `sqlite_master` read gets back
  // exactly the names it has caused to be there.
  private tables = new Set<string>();

  readonly sql = {
    exec: (sql: string, ...bindings: SqlBinding[]): Iterable<Record<string, unknown>> => {
      this.writes.push({ sql, bindings });
      const trimmed = sql.replace(/\s+/g, ' ').trim();
      if (/^INSERT INTO updates /.test(trimmed)) {
        this.logRows += 1;
        this.logBytes += Number(bindings[0]);
        this.seq += 1;
        return [];
      }
      if (/^DELETE FROM updates WHERE seq <= /.test(trimmed)) {
        this.logRows = 0;
        this.logBytes = 0;
        return [];
      }
      if (/^SELECT COALESCE\(MAX\(seq\), 0\) AS m FROM updates/.test(trimmed)) {
        return [{ m: this.seq }];
      }
      if (/^SELECT name FROM sqlite_master WHERE type = 'table' AND name IN \(\?/.test(trimmed)) {
        return bindings
          .map((binding) => String(binding))
          .filter((name) => this.tables.has(name))
          .map((name) => ({ name }));
      }
      if (/^SELECT value FROM storage_meta WHERE key = /.test(trimmed)) {
        const v = this.meta.get(String(bindings[0]));
        return v === undefined ? [] : [{ value: v }];
      }
      if (/^INSERT OR REPLACE INTO storage_meta /.test(trimmed)) {
        this.meta.set(String(bindings[0]), String(bindings[1]));
        return [];
      }
      if (/^INSERT OR IGNORE INTO storage_meta /.test(trimmed)) {
        if (!this.meta.has(String(bindings[0]))) this.meta.set(String(bindings[0]), String(bindings[1]));
        return [];
      }
      const created = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(trimmed);
      if (created) this.tables.add(created[1]);
      // Everything else (snapshot chunk writes and the rest of the DDL) is accepted
      // and recorded.
      return [];
    },
  };

  transactionSync<T>(fn: () => T): T {
    return fn();
  }
}
