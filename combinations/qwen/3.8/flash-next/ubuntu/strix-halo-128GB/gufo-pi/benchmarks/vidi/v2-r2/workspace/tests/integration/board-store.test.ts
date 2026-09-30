/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store';
import { snapshot, createSticky } from '@shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '@shared/config';
import {
  generateRetroBoard,
  generateLargeBoard,
  padUpdates,
  damagedBytes,
} from '../fixtures/boards';
import { newBoardId } from '@shared/board-id';

// The runInDurableObject callback executes in the same isolate as the test, so
// imported bindings (BoardStore, Y, snapshot) and captured values are live there.
function stubFor(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 25 notes, each created in its OWN doc (distinct Yjs client) so every log row is
// self-contained; a damaged row cannot create a clock gap that blocks the others.
function twentyFiveSelfContainedNotes(): Uint8Array[] {
  const creation: Uint8Array[] = [];
  for (let i = 0; i < 25; i++) {
    const d = new Y.Doc();
    createSticky(d, { x: i * 100, y: 0 }, 'yellow');
    creation.push(Y.encodeStateAsUpdate(d));
  }
  return creation;
}

describe('BoardStore', () => {
  it('TC-03: migrate then load on a fresh board does not throw', async () => {
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      const loadRes = store.load(doc);
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const chunkRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const ver = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")
        .one().value;
      return {
        ok: loadRes.ok,
        quarantined: loadRes.ok ? loadRes.quarantined : -1,
        notes: snapshot(doc).length,
        upRows,
        chunkRows,
        ver,
      };
    });
    expect(res.ok).toBe(true);
    expect(res.quarantined).toBe(0);
    expect(res.notes).toBe(0);
    expect(res.upRows).toBe(0);
    expect(res.chunkRows).toBe(0);
    expect(res.ver).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-04: append one update -> row 0->1, bytes column equals length', async () => {
    const { updates } = generateRetroBoard();
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const before = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      store.append(updates[0]);
      const after = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const bytesCol = state.storage.sql.exec('SELECT bytes AS b FROM updates').one().b;
      return { before, after, bytesCol, expected: updates[0].length };
    });
    expect(res.before).toBe(0);
    expect(res.after).toBe(1);
    expect(res.bytesCol).toBe(res.expected);
  });

  it('TC-05: LogOnly with 25 notes -> load equals original snapshot', async () => {
    const { doc, updates } = generateRetroBoard();
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const sameVec = eqBytes(Y.encodeStateVector(doc), Y.encodeStateVector(fresh));
      const chunkRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      return {
        ok: loadRes.ok,
        count: snapshot(fresh).length,
        sameVec,
        chunkRows,
        expected: snapshot(doc).length,
      };
    });
    expect(res.ok).toBe(true);
    expect(res.expected).toBe(25);
    expect(res.count).toBe(25);
    expect(res.sameVec).toBe(true);
    expect(res.chunkRows).toBe(0);
  });

  it('TC-06: 25 notes at COMPACTION_UPDATE_COUNT rows -> compact -> reload equals original', async () => {
    const { doc, updates } = generateRetroBoard();
    const rowsToPad = COMPACTION_UPDATE_COUNT - updates.length;
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      for (const u of padUpdates(doc, rowsToPad)) store.append(u);
      const before = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const maxSeqBefore = state.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m;

      const didCompact = store.compactIfNeeded(doc);

      const after = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const chunkRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const through = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .one().value;

      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const sameVec = eqBytes(Y.encodeStateVector(doc), Y.encodeStateVector(fresh));
      return {
        before,
        didCompact,
        after,
        chunkRows,
        through: Number(through),
        maxSeqBefore,
        ok: loadRes.ok,
        count: snapshot(fresh).length,
        sameVec,
      };
    });
    expect(res.before).toBe(COMPACTION_UPDATE_COUNT); // 500
    expect(res.didCompact).toBe(true);
    expect(res.after).toBe(0); // 500 -> 0
    expect(res.chunkRows).toBeGreaterThanOrEqual(1);
    expect(res.through).toBe(res.maxSeqBefore); // watermark == max seq
    expect(res.ok).toBe(true);
    expect(res.count).toBe(25);
    expect(res.sameVec).toBe(true);
  });

  it('TC-07: SnapshotPlusLog - 3 updates after compaction load, only seq > through applied', async () => {
    const { doc, updates } = generateRetroBoard();
    const rowsToPad = COMPACTION_UPDATE_COUNT - updates.length;
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      for (const u of padUpdates(doc, rowsToPad)) store.append(u);
      store.compactIfNeeded(doc); // through_seq == COMPACTION_UPDATE_COUNT

      // 3 more note creations applied to the doc AND appended to the log after compaction.
      const extra: Uint8Array[] = [];
      const listener = (u: Uint8Array) => extra.push(u.slice());
      doc.on('update', listener);
      createSticky(doc, { x: 5000, y: 5000 }, 'red');
      createSticky(doc, { x: 5010, y: 5010 }, 'pink');
      createSticky(doc, { x: 5020, y: 5020 }, 'grey');
      doc.off('update', listener);
      for (const u of extra) store.append(u);

      const through = Number(
        state.storage.sql
          .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
          .one().value,
      );
      const logRows = state.storage.sql
        .exec('SELECT seq FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();

      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const sameVec = eqBytes(Y.encodeStateVector(doc), Y.encodeStateVector(fresh));
      return {
        ok: loadRes.ok,
        through,
        logApplied: logRows.length,
        count: snapshot(fresh).length,
        sameVec,
      };
    });
    expect(res.ok).toBe(true);
    expect(res.logApplied).toBe(3); // exactly the 3 post-compaction rows are replayed
    expect(res.count).toBe(28); // 25 from the snapshot + 3 from the log
    expect(res.sameVec).toBe(true);
  });

  it('TC-08: large board compacts into multiple chunks and reloads fully', async () => {
    const { doc, updates } = generateLargeBoard();
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      const encodedLen = Y.encodeStateAsUpdate(doc).length;
      const didCompact = store.compactIfNeeded(doc);
      const chunkRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const sameVec = eqBytes(Y.encodeStateVector(doc), Y.encodeStateVector(fresh));
      return {
        didCompact,
        encodedLen,
        chunkRows,
        upRows,
        ok: loadRes.ok,
        count: snapshot(fresh).length,
        sameVec,
        expected: snapshot(doc).length,
      };
    });
    expect(res.didCompact).toBe(true);
    expect(res.expected).toBeGreaterThan(1000);
    if (res.encodedLen > SNAPSHOT_CHUNK_BYTES) expect(res.chunkRows).toBeGreaterThan(1);
    else expect(res.chunkRows).toBeGreaterThanOrEqual(1);
    expect(res.upRows).toBe(0);
    expect(res.ok).toBe(true);
    expect(res.count).toBe(res.expected);
    expect(res.sameVec).toBe(true);
  });

  it('TC-09: one damaged log row is quarantined; all other notes present', async () => {
    const creation = twentyFiveSelfContainedNotes();
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of creation) store.append(u); // seq 1..25

      // Overwrite row 7's data with a truncated version of itself.
      const row7 = state.storage.sql.exec('SELECT data FROM updates WHERE seq = 7').one().data as ArrayBuffer;
      const truncated = damagedBytes.truncate(new Uint8Array(row7));
      state.storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 7', truncated.buffer.slice(0)).toArray();

      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const quar = state.storage.sql.exec('SELECT error, data FROM quarantined_updates').toArray();
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      return {
        ok: loadRes.ok,
        quarantined: loadRes.ok ? loadRes.quarantined : -1,
        quarRows: quar.length,
        quarHasError: quar.length > 0 && typeof quar[0].error === 'string' && quar[0].error.length > 0,
        notes: snapshot(fresh).length,
        upRows,
      };
    });
    expect(res.ok).toBe(true); // loads without reporting failure
    expect(res.quarantined).toBe(1);
    expect(res.quarRows).toBe(1); // damaged row moved to quarantine
    expect(res.quarHasError).toBe(true); // with error text
    expect(res.notes).toBe(24); // all other notes present
    expect(res.upRows).toBe(24); // updates count decremented by one
  });

  it('TC-10: damaged snapshot -> snapshot-unreadable, nothing deleted or quarantined', async () => {
    const { doc, updates } = generateRetroBoard();
    const rowsToPad = COMPACTION_UPDATE_COUNT - updates.length;
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      for (const u of padUpdates(doc, rowsToPad)) store.append(u);
      store.compactIfNeeded(doc);

      // Corrupt chunk 0 with random bytes.
      const corrupt = new Uint8Array(64);
      for (let i = 0; i < corrupt.length; i++) corrupt[i] = (Math.random() * 256) | 0;
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', corrupt.buffer.slice(0)).toArray();

      const fresh = new Y.Doc();
      const loadRes = store.load(fresh);
      const chunks = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const quar = state.storage.sql.exec('SELECT COUNT(*) AS c FROM quarantined_updates').one().c;
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      return {
        ok: loadRes.ok,
        reason: loadRes.ok ? '' : loadRes.reason,
        chunks,
        quar,
        upRows,
      };
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('snapshot-unreadable');
    expect(res.chunks).toBeGreaterThanOrEqual(1); // snapshot NOT deleted
    expect(res.quar).toBe(0); // nothing quarantined
    expect(res.upRows).toBe(0); // log rows not deleted
  });

  it('TC-11: failed compaction rolls back; previous chunks and log unchanged; returns false', async () => {
    const { doc, updates } = generateRetroBoard();
    const rowsToPad = COMPACTION_UPDATE_COUNT - updates.length;
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      // First compaction succeeds -> "previous" snapshot + truncated log.
      for (const u of updates) store.append(u);
      for (const u of padUpdates(doc, rowsToPad)) store.append(u);
      store.compactIfNeeded(doc);
      const chunkRowsV1 = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const throughV1 = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .one().value;

      // Grow the log again (SnapshotPlusLog) to trigger a second compaction.
      for (const u of padUpdates(doc, COMPACTION_UPDATE_COUNT)) store.append(u);
      const logRowsBefore = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;

      // Inject a failing statement AFTER DELETE snapshot_chunks inside the transaction.
      store.__failDuringCompaction = () => {
        throw new Error('injected SQL failure during compaction');
      };
      const didCompact = store.compactIfNeeded(doc);
      store.__failDuringCompaction = undefined;

      const chunkRowsAfter = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      const logRowsAfter = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const throughAfter = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .one().value;
      return { didCompact, chunkRowsV1, chunkRowsAfter, logRowsBefore, logRowsAfter, throughV1, throughAfter };
    });
    expect(res.didCompact).toBe(false); // returns false, does not throw
    expect(res.chunkRowsAfter).toBe(res.chunkRowsV1); // previous chunks unchanged
    expect(res.logRowsAfter).toBe(res.logRowsBefore); // log rows unchanged
    expect(res.throughAfter).toBe(res.throughV1); // watermark unchanged
  });

  it('TC-25: opening a never-edited board creates only tables, no rows', async () => {
    const stub = stubFor(newBoardId());
    const res = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      store.migrate(); // idempotent
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      const chunkRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
      return { upRows, chunkRows };
    });
    expect(res.upRows).toBe(0);
    expect(res.chunkRows).toBe(0);
  });
});
