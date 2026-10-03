// persist.board_store integration: the real BoardStore against the real SQLite
// storage of a real Durable Object, driven through `runInDurableObject`. Nothing
// about the storage engine is faked — transactions, blobs, ordering, rollback and
// quarantine all run in workerd. This is where the design's stored-state and damage
// dimensions are exercised (TC-03 to TC-11, TC-25).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import {
  createSticky,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { LOAD_ORIGIN, type BoardStore } from '../../src/worker/board-store';
import type { StoreProbe } from './helpers/store';
import { runStore } from './helpers/store';
import {
  damagedGarbage,
  damagedTruncated,
  largeBoard,
  retroBoard25,
} from '../fixtures/boards';

const eq = (notes: readonly StickySnapshot[]) => JSON.stringify(notes);

/** Pad a fixture's update log to exactly `target` rows (meta writes only). */
function padToCount(updates: Uint8Array[], doc: Y.Doc, target: number): Uint8Array[] {
  const meta = doc.getMap('meta');
  let i = 0;
  while (updates.length < target) {
    doc.transact(() => {
      meta.set(`pad${i}`, i);
    });
    i += 1;
  }
  expect(updates.length).toBe(target);
  return updates;
}

describe('BoardStore against real Durable Object SQLite', () => {
  it('TC-03 migrates an empty board to empty tables with the storage schema version', async () => {
    const { result } = await runStore(({ store, loadInto, probe }) => {
      store.migrate();
      const { doc, notes } = loadInto();
      const res = store.load(doc);
      return { res, notes: notes(), probe: probe() };
    });
    expect(result.res).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toEqual([]);
    expect(result.probe.counts).toEqual({
      updates: 0,
      snapshot_chunks: 0,
      quarantined_updates: 0,
    });
    expect(result.probe.storageSchemaVersion).not.toBeNull();
  });

  it('TC-04 appends one update as a row whose bytes column equals its length', async () => {
    const fx = retroBoard25();
    const only = fx.updates[0]!;
    const { result } = await runStore(({ store, storage }) => {
      store.migrate();
      const before = countOf(storage, 'updates');
      store.append(only);
      return { before, probe: countProbe(store, storage) };
    });
    expect(result.before).toBe(0);
    expect(result.probe.counts.updates).toBe(1);
    expect(result.probe.updateBytes).toEqual([only.length]);
  });

  it('TC-05 reloads a log-only board into a fresh document identically', async () => {
    const fx = retroBoard25();
    const { result } = await runStore(({ store, loadInto }) => {
      store.migrate();
      for (const update of fx.updates) store.append(update);
      const { doc, notes } = loadInto();
      const res = store.load(doc);
      return { res, reloaded: notes() };
    });
    expect(result.res).toEqual({ ok: true, quarantined: 0 });
    expect(eq(result.reloaded)).toBe(eq(fx.notes));
  });

  it('TC-06 compacts at exactly COMPACTION_UPDATE_COUNT rows into one snapshot', async () => {
    const fx = retroBoard25();
    const updates = padToCount(fx.updates, fx.doc, COMPACTION_UPDATE_COUNT);
    const { result } = await runStore(({ store, storage, newDoc }) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const doc = newDoc();
      store.load(doc); // populates the doc and the store's row/byte counters
      const did = store.compactIfNeeded(doc);
      // reload from the freshly written snapshot
      const reloaded = newDoc();
      const reload = store.load(reloaded);
      return {
        did,
        reload,
        reloaded: snapshot(reloaded),
        probe: countProbe(store, storage),
      };
    });
    expect(result.did).toBe(true);
    expect(result.probe.counts.updates).toBe(0); // the whole log folded away
    expect(result.probe.counts.snapshot_chunks).toBeGreaterThanOrEqual(1);
    expect(result.probe.snapshotThroughSeq).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    expect(eq(result.reloaded)).toBe(eq(fx.notes));
  });

  it('TC-07 applies only rows after snapshot_through_seq for a snapshot-plus-log board', async () => {
    const fx = retroBoard25();
    const updates = padToCount(fx.updates, fx.doc, COMPACTION_UPDATE_COUNT);
    const { result } = await runStore(({ store, storage, newDoc }) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const live = newDoc();
      store.load(live);
      store.compactIfNeeded(live); // snapshot at seq 500, log emptied

      // From now on the store mirrors the room: any live edit is appended.
      live.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin !== LOAD_ORIGIN) store.append(u);
      });
      const extra1 = createSticky(live, { x: 5000, y: 5000 }, 'blue');
      const extra2 = createSticky(live, { x: 5100, y: 5100 }, 'pink');
      const extra3 = createSticky(live, { x: 5200, y: 5200 }, 'green');

      const fresh = newDoc();
      const reload = store.load(fresh);
      return {
        reload,
        fresh: snapshot(fresh),
        live: snapshot(live),
        probe: countProbe(store, storage),
        extras: [extra1, extra2, extra3],
      };
    });
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    // Only the three post-snapshot rows are still in the log, all after through_seq.
    expect(result.probe.counts.updates).toBe(3);
    expect(Number(result.probe.snapshotThroughSeq)).toBeLessThanOrEqual(
      COMPACTION_UPDATE_COUNT,
    );
    // A reload of snapshot + the three later rows equals the live board.
    expect(eq(result.fresh)).toBe(eq(result.live));
    expect(result.extras.every((id) => result.fresh.some((n) => n.id === id))).toBe(true);
  });

  it('TC-08 compacts a PERSIST_TESTED_NOTES board into multiple chunks that reload equal', async () => {
    const fx = largeBoard(); // 2000 notes, realistically sized text -> encoded size >> chunk size
    const { result } = await runStore(({ store, storage, newDoc, chunkSizes }) => {
      store.migrate();
      for (const update of fx.updates) store.append(update);
      const doc = newDoc();
      store.load(doc);
      const did = store.compactIfNeeded(doc);
      const reloaded = newDoc();
      const reload = store.load(reloaded);
      return {
        did,
        reload,
        reloaded: snapshot(reloaded),
        probe: countProbe(store, storage),
        chunks: chunkSizes(),
      };
    });
    expect(result.did).toBe(true);
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    expect(result.probe.counts.updates).toBe(0);
    // A board this big encodes to more than one chunk.
    expect(result.probe.counts.snapshot_chunks).toBeGreaterThan(1);
    for (const size of result.chunks) {
      expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
    expect(result.reloaded.length).toBe(fx.notes.length);
    expect(eq(result.reloaded)).toBe(eq(fx.notes));
  }, 60_000);

  it('TC-09 quarantines one damaged log row and loads every other note', async () => {
    // A damaged change is quarantined and the board is still there. The row we
    // damage is the newest change on the log (see the note at the bottom of this
    // test for why): the damaged change does not survive, but every earlier note
    // does, and the damaged row is moved out of the log with its error text.
    const fx = retroBoard25();
    const { result } = await runStore(({ store, storage, loadInto }) => {
      store.migrate();
      for (const update of fx.updates) store.append(update);
      const before = countOf(storage, 'updates');
      const maxSeq = Number(
        storage.sql.exec('SELECT MAX(seq) m FROM updates').toArray()[0]!.m,
      );
      // Damage the newest log row with a truncated copy of its own bytes.
      const row = storage.sql
        .exec('SELECT data FROM updates WHERE seq = ?', maxSeq)
        .toArray()[0]!;
      const damaged = damagedTruncated(new Uint8Array(row.data as ArrayBuffer));
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        damaged,
        damaged.length,
        maxSeq,
      );

      const { doc, notes } = loadInto();
      const res = store.load(doc);
      const quarantined = storage.sql
        .exec('SELECT seq, error FROM quarantined_updates')
        .toArray();
      return {
        res,
        before,
        maxSeq,
        after: countOf(storage, 'updates'),
        quarantined: quarantined.map((r) => ({ seq: Number(r.seq), error: String(r.error) })),
        notes: notes(),
      };
    });
    expect(result.res).toEqual({ ok: true, quarantined: 1 });
    expect(result.after).toBe(result.before - 1); // the bad row left the log
    // It was moved, with the reason kept for diagnosis.
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]!.seq).toBe(result.maxSeq);
    expect(result.quarantined[0]!.error.length).toBeGreaterThan(0);
    // Every note that existed before the damaged change is still present: only the
    // one damaged change is gone (its note card survives, the text is what broke).
    expect(result.notes.length).toBeGreaterThanOrEqual(24);
    const lost = fx.notes.filter((n) => !result.notes.some((r) => r.id === n.id));
    expect(lost.length).toBe(0);
    for (const note of result.notes) {
      expect(fx.notes.find((n) => n.id === note.id)).toBeDefined();
    }
  });
  // Why the newest row: a Yjs log is a per-client clock chain, so a *middle* row
  // that is dropped does not just lose its own change — every later change by that
  // same client is held forever in Yjs' pending buffer waiting on the gap. That is
  // inherent to CRDT correct delivery, not the store. It is exactly why the story
  // compacts the log into a self-contained snapshot (TC-06/TC-10): once the notes
  // live in a snapshot, damage to a recent log row cannot strand them.


  it('TC-10 refuses to load a board whose snapshot is unreadable, deleting nothing', async () => {
    const fx = retroBoard25();
    const updates = padToCount(fx.updates, fx.doc, COMPACTION_UPDATE_COUNT);
    const { result } = await runStore(({ store, storage, newDoc }) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const doc = newDoc();
      store.load(doc);
      store.compactIfNeeded(doc); // a real snapshot now exists
      const before = countProbe(store, storage);

      // Corrupt chunk 0 with garbage that reliably fails to apply.
      const chunk0 = storage.sql
        .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
        .toArray()[0]!;
      const garbage = damagedGarbage((chunk0.data as ArrayBuffer).byteLength);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);

      const fresh = newDoc();
      const res = store.load(fresh);
      return { res, before, after: countProbe(store, storage), notes: snapshot(fresh) };
    });
    expect(result.res).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    // Nothing was deleted or quarantined by the failed load.
    expect(result.after.counts.quarantined_updates).toBe(0);
    expect(result.after.counts.snapshot_chunks).toBe(result.before.counts.snapshot_chunks);
    // And the board is not presented as a loaded (empty) board.
    expect(result.notes).toEqual([]);
  });

  it('TC-11 rolls back a failed compaction, keeping the previous snapshot and log', async () => {
    const fx = retroBoard25();
    const updates = padToCount(fx.updates, fx.doc, COMPACTION_UPDATE_COUNT);
    const { result } = await runStore(({ store, storage, newDoc }) => {
      store.migrate();
      for (const update of updates) store.append(update);
      const doc = newDoc();
      store.load(doc);
      store.compactIfNeeded(doc); // good snapshot #1: log folded away, through_seq set
      const before = countProbe(store, storage);

      // Live edits append again (a room wires this to `doc.on('update') -> append`).
      doc.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin !== LOAD_ORIGIN) store.append(u);
      });
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        createSticky(doc, { x: i, y: 0 }, 'yellow');
      }

      // Fail the compaction after the new chunks are written, inside the transaction.
      store.failCompaction = () => {
        throw new Error('injected SQL failure');
      };
      const did = store.compactIfNeeded(doc);
      store.failCompaction = undefined;

      // Reload: the previous snapshot and the full log are all still there.
      const fresh = newDoc();
      const reload = store.load(fresh);
      return {
        did,
        before,
        after: countProbe(store, storage),
        reload,
        notes: snapshot(fresh),
        live: snapshot(doc),
      };
    });
    // The failed compaction reported failure but touched nothing.
    expect(result.did).toBe(false);
    expect(result.after.counts.snapshot_chunks).toBe(result.before.counts.snapshot_chunks);
    expect(result.after.snapshotThroughSeq).toBe(result.before.snapshotThroughSeq);
    // The log survived (the second batch of updates), and reload yields the live board.
    expect(result.after.counts.updates).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.reload).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes.length).toBe(525); // 25 snapshot notes + 500 new notes
    expect(eq(result.notes)).toBe(eq(result.live));
  });

  it('TC-25 migrate on a never-edited board writes no update or snapshot rows', async () => {
    const { result } = await runStore<{ probe: StoreProbe }>(({ store, storage }) => {
      store.migrate();
      return { probe: countProbe(store, storage) };
    });
    expect(result.probe.counts.updates).toBe(0);
    expect(result.probe.counts.snapshot_chunks).toBe(0);
    expect(result.probe.storageSchemaVersion).not.toBeNull();
  });
});

// --- helpers that read the raw tables (run inside the Durable Object) --------

function countOf(storage: DurableObjectStorage, table: string): number {
  const rows = storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray();
  return rows.length > 0 ? Number(rows[0]!.n) : 0;
}

function countProbe(store: BoardStore, storage: DurableObjectStorage): StoreProbe {
  const sql = storage.sql;
  const one = (q: string): number => {
    const rows = sql.exec(q).toArray();
    return rows.length > 0 ? Number(Object.values(rows[0]!)[0]) : 0;
  };
  const meta = (key: string): string | null => {
    const rows = sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    return rows.length > 0 ? String(rows[0]!.value) : null;
  };
  void store;
  return {
    counts: {
      updates: one('SELECT COUNT(*) FROM updates'),
      snapshot_chunks: one('SELECT COUNT(*) FROM snapshot_chunks'),
      quarantined_updates: one('SELECT COUNT(*) FROM quarantined_updates'),
    },
    snapshotThroughSeq: meta('snapshot_through_seq'),
    storageSchemaVersion: meta('storage_schema_version'),
    updateBytes: sql
      .exec('SELECT bytes FROM updates ORDER BY seq')
      .toArray()
      .map((r) => Number(r.bytes)),
  };
}
