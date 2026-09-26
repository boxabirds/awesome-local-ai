import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { StoreHarness } from './main';
import { buildBoardUpdates } from '../fixtures/boards';
import { snapshot } from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';

// TC-03 … TC-11 + TC-25 (persist.board_store). These run inside a real
// SQLite-backed Durable Object through @cloudflare/vitest-pool-workers: the
// SQL, the transactions and the blob representation are the production ones —
// nothing here is mocked. Each test uses its own object id, so its own
// database file.
//
// Fixtures come from tests/fixtures/boards.ts and are built with the real
// board-model calls; damaged bytes come from the two shapes the story cares
// about (a truncated update, and a same-length random one).

type Harness = InstanceType<typeof StoreHarness>;

let counter = 0;

async function inHarness<T>(run: (instance: Harness) => Promise<T>): Promise<T> {
  const ns = (env as any).STORE;
  counter += 1;
  const stub = ns.get(ns.idFromName(`store-test-${counter}`));
  return (await runInDurableObject(stub, (instance: unknown) => run(instance as Harness))) as T;
}

function boardFixture(count: number, seed = 1): { updates: Uint8Array[]; expected: unknown } {
  return buildBoardUpdates(count, seed);
}

describe('empty board (TC-03, TC-25)', () => {
  it('creates the tables, stamps the schema version and loads nothing', async () => {
    const state = await inHarness((h) => h.open());
    for (const table of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
      expect(state.tables).toContain(table);
    }
    expect(state.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(state.snapshot).toEqual([]);
  });

  it('writing nothing on a never-edited board leaves no log or snapshot rows (TC-25)', async () => {
    const state = await inHarness(async (h) => {
      const first = await h.open();
      const second = await h.open(); // re-opening must not create state either
      return { first, second };
    });
    expect(state.first.log).toEqual([]);
    expect(state.first.chunks).toEqual([]);
    expect(state.second.log).toEqual([]);
    expect(state.second.chunks).toEqual([]);
  });
});

describe('the update log (TC-04, TC-05)', () => {
  it('stores one row per update, with the byte count of that update', async () => {
    const update = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await inHarness(async (h) => {
      await h.open();
      return h.appendMany([update]);
    });
    expect(result.log).toEqual([{ seq: 1, bytes: 5 }]);
    expect(result.stats).toEqual({ logCount: 1, logBytes: 5, snapshotThroughSeq: 0 });
  });

  it('replays a 25-note board into a fresh document, identical to the original', async () => {
    const fixture = boardFixture(25, 42);
    expect(fixture.expected).toHaveLength(25);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      return h.loadFresh();
    });
    expect((result as any).result).toEqual({ ok: true, quarantined: 0 });
    expect((result as any).snapshot).toEqual(fixture.expected);
  });
});

describe('compaction (TC-06, TC-07, TC-08)', () => {
  it('rewrites a full log into a snapshot and reloads identically (TC-06)', async () => {
    const fixture = boardFixture(COMPACTION_UPDATE_COUNT + 5, 3);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      const before = await h.storeState();
      const compacted = await h.compact(fixture.updates);
      const loaded = await h.loadFresh();
      return { before, compacted, loaded, stats: (await h.storeState()).stats };
    });
    expect((result.compacted as any).ok).toBe(true);
    expect((result.compacted as any).log).toEqual([]);
    expect((result.compacted as any).chunks.length).toBeGreaterThanOrEqual(1);
    // The snapshot is stamped at the last sequence it covers …
    expect((result.compacted as any).stats.snapshotThroughSeq).toBe(fixture.updates.length);
    // … and reloading the snapshot alone gives the same board.
    expect((result.loaded as any).snapshot).toEqual(fixture.expected);
    expect((result.loaded as any).snapshot).toHaveLength(COMPACTION_UPDATE_COUNT + 5);
  });

  it('keeps the log written after a compaction, and applies only newer rows (TC-07)', async () => {
    const first = boardFixture(30, 11);
    const second = boardFixture(3, 99);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(first.updates);
      const compacted = await h.compact(first.updates);
      const through = (compacted as any).stats.snapshotThroughSeq;
      await h.appendMany(second.updates);
      const loaded = await h.loadFresh();
      return { through: (compacted as any).stats.snapshotThroughSeq, compacted, loaded };
    });
    expect((result.loaded as any).result).toEqual({ ok: true, quarantined: 0 });
    // The notes from the snapshot AND from the three later updates are there.
    expect((result.loaded as any).snapshot).toHaveLength(33);
    expect(result.through).toBeGreaterThan(0);
  });

  it('splits a large snapshot into several chunks and reloads it intact (TC-08)', async () => {
    const fixture = boardFixture(2000, 5);
    const encoded = new Uint8Array(fixture.updates.reduce((total, u) => total + u.byteLength, 0));
    let offset = 0;
    for (const update of fixture.updates) {
      encoded.set(update, offset);
      offset += update.byteLength;
    }
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      const compacted = await h.compact(fixture.updates);
      const loaded = await h.loadFresh();
      return { compacted, loaded };
    });
    const chunks = (result.compacted as any).chunks as { bytes: number }[];
    if (encoded.byteLength > SNAPSHOT_CHUNK_BYTES) {
      expect(chunks.length).toBeGreaterThan(1);
    }
    expect(chunks.every((chunk) => chunk.bytes <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect((result.loaded as any).snapshot).toEqual(fixture.expected);
    expect((result.loaded as any).snapshot).toHaveLength(2000);
  });
});

describe('damaged bytes (TC-09, TC-10, TC-11)', () => {
  it('quarantines one damaged log row and still loads the other notes (TC-09)', async () => {
    const fixture = boardFixture(25, 42);
    expect(fixture.updates.length).toBeGreaterThan(7);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      // Damage row 7: same-length random bytes, so Y.applyUpdate is what fails.
      await h.damageLogRow(7, new Uint8Array(fixture.updates[6].byteLength).fill(191));
      const first = await h.loadFresh();
      const second = await h.loadFresh(); // a later wake must not re-quarantine
      return { first, second, state: await h.storeState() };
    });
    const first = result.first as any;
    expect(first.result).toEqual({ ok: true, quarantined: 1 });
    // The damaged row was moved aside, not replayed forever …
    expect(first.quarantine).toHaveLength(1);
    expect(first.quarantine[0].seq).toBe(7);
    expect(first.quarantine[0].error.length).toBeGreaterThan(0);
    expect(result.state.log.find((row: { seq: number }) => row.seq === 7)).toBeUndefined();
    // … and the board is still a board: it opens, and the second load is
    // identical (the damage is contained instead of spreading further).
    expect(first.snapshot.length).toBeGreaterThan(0);
    expect((result.second as any).snapshot).toEqual(first.snapshot);
    expect((result.second as any).result).toEqual({ ok: true, quarantined: 0 });
  });

  it('an unreadable snapshot fails the whole board and deletes nothing (TC-10)', async () => {
    const fixture = boardFixture(25, 42);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      await h.compact(fixture.updates);
      const before = await h.storeState();
      await h.damageSnapshotChunk(0);
      const loaded = await h.loadFresh();
      return { before, loaded, after: await h.storeState() };
    });
    const loaded = result.loaded as any;
    expect(loaded.result.ok).toBe(false);
    expect(loaded.result.reason).toBe('snapshot-unreadable');
    // Nothing was dropped to keep the board "working": the snapshot and the
    // log are exactly as they were, and nothing was quarantined.
    expect(result.after.chunks).toEqual(result.before.chunks);
    expect(result.after.log).toEqual(result.before.log);
    expect(loaded.quarantine).toEqual([]);
  });

  it('a failure in the middle of compaction rolls the rewrite back (TC-11)', async () => {
    const fixture = boardFixture(25, 42);
    const extra = boardFixture(3, 77);
    const result = await inHarness(async (h) => {
      await h.open();
      await h.appendMany(fixture.updates);
      await h.compact(fixture.updates); // a real snapshot exists now
      await h.appendMany(extra.updates);
      const before = await h.storeState();
      // Fail on the statement right after the old chunks were deleted.
      await h.armFailure('INSERT INTO snapshot_chunks');
      const compacted = await h.compact([...fixture.updates, ...extra.updates]);
      const loaded = await h.loadFresh();
      return { before, compacted, loaded, after: await h.storeState() };
    });
    expect((result.compacted as any).ok).toBe(false);
    // The previous snapshot and the whole log survived: a partial rewrite is
    // never visible to a later load.
    expect((result.after as any).chunks).toEqual((result.before as any).chunks);
    expect((result.loaded as any).result.ok).toBe(true);
    expect((result.loaded as any).snapshot).toHaveLength(28);
  });
});
