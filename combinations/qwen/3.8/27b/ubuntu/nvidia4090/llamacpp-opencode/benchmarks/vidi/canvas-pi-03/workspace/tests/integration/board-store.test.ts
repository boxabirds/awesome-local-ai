import { describe, it, expect } from 'vitest';
import { newBoardId } from '@/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  type StickyColor,
} from '@/shared/config';
import type { StickySnapshot } from '@/shared/board-model';
import { snapshotsEqual } from './random-ops';
import {
  appendUpdates,
  compact,
  corruptSnapshot,
  corruptUpdateRow,
  initialize,
  loadFresh,
  repair,
  setFailure,
  storageInfo,
} from './hooks';
import {
  bigBoardSpecs,
  buildBoard,
  buildBoardUpdates,
  buildMultiClientBoard,
  retroBoardSpecs,
} from '../fixtures/boards';

const notesOf = (lf: Awaited<ReturnType<typeof loadFresh>>) => lf.notes as unknown as StickySnapshot[];

/** `n` notes with empty text (light updates, for threshold tests). */
function simpleSpecs(n: number): Array<{ x: number; y: number; color: StickyColor; text: string }> {
  return Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, color: 'yellow' as StickyColor, text: '' }));
}

describe('persist.board_store against real Durable Object SQLite', () => {
  it('TC-03: empty board -> tables exist, doc empty, schema version recorded', async () => {
    const boardId = newBoardId();
    // Story 5: migrate no longer runs at construct; initialize creates the board.
    await initialize(boardId);
    const info = await storageInfo(boardId);
    expect(info.tables).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
    );
    expect(info.storageSchemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(info.updates).toBe(0);
    expect(info.chunks).toBe(0);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(lf.notes).toHaveLength(0);
  }, 30_000);

  it('TC-25: migrate on a never-edited board writes no updates/snapshot rows', async () => {
    const boardId = newBoardId();
    await initialize(boardId); // story 5: creates the board (migrate)
    const info = await storageInfo(boardId);
    expect(info.tables).toContain('updates');
    expect(info.tables).toContain('snapshot_chunks');
    expect(info.updates).toBe(0);
    expect(info.updateBytes).toBe(0);
    expect(info.chunks).toBe(0);
    expect(info.snapshotBytes).toBe(0);
  }, 30_000);

  it('TC-04: append one update -> 1 row, bytes column = encoded length', async () => {
    const boardId = newBoardId();
    const { updates, notes } = buildBoardUpdates(retroBoardSpecs().slice(0, 1));
    expect(updates).toHaveLength(1);
    expect(notes).toHaveLength(1);
    const res = await appendUpdates(boardId, updates);
    expect(res.appended).toBe(1);
    const info = await storageInfo(boardId);
    expect(info.updates).toBe(1);
    expect(info.updateBytes).toBe(Buffer.from(updates[0], 'base64').length);
  }, 30_000);

  it('TC-05: LogOnly 25 notes -> fresh load equals the original snapshot', async () => {
    const boardId = newBoardId();
    const { updates, notes } = buildBoardUpdates(retroBoardSpecs()); // 25 notes
    expect(updates).toHaveLength(25);
    const res = await appendUpdates(boardId, updates);
    expect(res.appended).toBe(25);
    expect(res.compacted).toBe(0); // 25 < COMPACTION_UPDATE_COUNT
    const info = await storageInfo(boardId);
    expect(info.updates).toBe(25);
    expect(info.chunks).toBe(0);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(notesOf(lf)).toHaveLength(25);
    expect(snapshotsEqual(notesOf(lf), notes)).toBe(true);
  }, 30_000);

  it('TC-06: at COMPACTION_UPDATE_COUNT rows -> compact (updates 0, chunks>=1, through=max seq), reload equal', async () => {
    const boardId = newBoardId();
    const { updates, notes } = buildBoardUpdates(simpleSpecs(COMPACTION_UPDATE_COUNT)); // 500 notes
    // First 499: below threshold, no compaction.
    await appendUpdates(boardId, updates.slice(0, COMPACTION_UPDATE_COUNT - 1));
    let info = await storageInfo(boardId);
    expect(info.updates).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(info.chunks).toBe(0);
    // The 500th crosses the threshold -> compaction folds the log into a snapshot.
    const res = await appendUpdates(boardId, updates.slice(COMPACTION_UPDATE_COUNT - 1));
    expect(res.compacted).toBe(1);
    info = await storageInfo(boardId);
    expect(info.updates).toBe(0);
    expect(info.chunks).toBeGreaterThanOrEqual(1);
    expect(Number(info.snapshotThroughSeq)).toBe(COMPACTION_UPDATE_COUNT);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(notesOf(lf)).toHaveLength(COMPACTION_UPDATE_COUNT);
    expect(snapshotsEqual(notesOf(lf), notes)).toBe(true);
  }, 60_000);

  it('TC-07: snapshot + log -> reload has all notes; only seq > through_seq are log rows', async () => {
    const boardId = newBoardId();
    const base = buildBoardUpdates(retroBoardSpecs()); // 25 notes
    await appendUpdates(boardId, base.updates);
    // Force-compact the 25 notes into a snapshot.
    const c = await compact(boardId, true);
    expect(c.compacted).toBe(true);
    const through = Number((await storageInfo(boardId)).snapshotThroughSeq);
    expect(through).toBe(25);
    // Add 3 more notes (log rows after the snapshot).
    const more = buildBoardUpdates(simpleSpecs(3));
    await appendUpdates(boardId, more.updates);
    const info = await storageInfo(boardId);
    expect(info.updates).toBe(3);
    expect(info.chunks).toBeGreaterThanOrEqual(1);
    expect(Number(info.snapshotThroughSeq)).toBe(through);
    // Reload: snapshot (25) + 3 log rows = 28, equal to base + more.
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    const combined = [...base.notes, ...more.notes];
    expect(notesOf(lf)).toHaveLength(28);
    expect(snapshotsEqual(notesOf(lf), combined)).toBe(true);
  }, 60_000);

  it('TC-08: PERSIST_TESTED_NOTES board compaction -> multi-chunk snapshot, reload equal', async () => {
    const boardId = newBoardId();
    // Build once so `notes` and `fullState` share ids.
    const { notes, fullState } = buildBoard(bigBoardSpecs(PERSIST_TESTED_NOTES)); // 2000 notes
    // Seed the 2000-note board as one full-state row, then compact it.
    await appendUpdates(boardId, [fullState]);
    const before = await storageInfo(boardId);
    expect(before.updates).toBe(1);
    const c = await compact(boardId, true);
    expect(c.compacted).toBe(true);
    const info = await storageInfo(boardId);
    expect(info.updates).toBe(0);
    // The fixture is sized so the snapshot exceeds one chunk row.
    expect(info.snapshotBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(info.chunks).toBeGreaterThanOrEqual(2);
    expect(info.chunks).toBe(Math.ceil(info.snapshotBytes / SNAPSHOT_CHUNK_BYTES));
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(notesOf(lf)).toHaveLength(PERSIST_TESTED_NOTES);
    expect(snapshotsEqual(notesOf(lf), notes)).toBe(true);
  }, 120_000);

  it('TC-09: damaged log row -> LoadResult ok with 1 quarantined; row moved with error; rest present', async () => {
    const boardId = newBoardId();
    // Multi-client board: base 3 + 3 clients x 3 notes = 12 notes, 4 rows.
    // Each row is one client's change (distinct clientIDs) so a damaged row
    // loses only its own notes (same-client deltas would chain and no-op).
    const { updates, notes, lostIfRowK } = buildMultiClientBoard({ baseNotes: 3, clients: 3, notesPerClient: 3 });
    expect(notes).toHaveLength(12);
    await appendUpdates(boardId, updates);
    // Damage log row 3 (1-based seq) = the second client's change.
    const corrupt = await corruptUpdateRow(boardId, 3, 'truncate');
    expect(corrupt.status).toBe(200);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(lf.result.quarantined).toBe(1);
    // All other notes are present; only the damaged client's notes are lost.
    expect(notesOf(lf)).toHaveLength(12 - lostIfRowK); // 12 - 3 = 9
    const info = await storageInfo(boardId);
    expect(info.quarantined).toHaveLength(1);
    expect(info.quarantined[0].seq).toBe(3);
    expect(info.quarantined[0].error.length).toBeGreaterThan(0);
    expect(info.updates).toBe(3); // row 3 moved out of the log
  }, 30_000);

  it('TC-10: corrupted snapshot chunk -> snapshot-unreadable; nothing deleted or quarantined', async () => {
    const boardId = newBoardId();
    const { updates } = buildBoardUpdates(retroBoardSpecs());
    await appendUpdates(boardId, updates);
    await compact(boardId, true);
    const before = await storageInfo(boardId);
    expect(before.chunks).toBeGreaterThanOrEqual(1);
    const corrupt = await corruptSnapshot(boardId, 0);
    expect(corrupt.status).toBe(200);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(false);
    expect(lf.result.reason).toBe('snapshot-unreadable');
    // Nothing was deleted or quarantined.
    const after = await storageInfo(boardId);
    expect(after.chunks).toBe(before.chunks);
    expect(after.updates).toBe(before.updates);
    expect(after.quarantined).toHaveLength(0);
  }, 30_000);

  it('TC-11: compaction failure after chunk delete -> rollback (prior chunks + log intact)', async () => {
    const boardId = newBoardId();
    const { updates: baseUpdates } = buildBoardUpdates(retroBoardSpecs()); // 25 notes
    await appendUpdates(boardId, baseUpdates);
    await compact(boardId, true);
    const before = await storageInfo(boardId);
    expect(before.chunks).toBeGreaterThanOrEqual(1);
    const throughBefore = Number(before.snapshotThroughSeq);
    expect(before.updates).toBe(0);
    // Add one note (a new log row), then attempt a compact that is injected to fail.
    const one = buildBoardUpdates(simpleSpecs(1));
    await appendUpdates(boardId, one.updates);
    expect((await storageInfo(boardId)).updates).toBe(1);
    await setFailure(boardId, 'compaction-after-chunk-delete');
    const c = await compact(boardId, true);
    expect(c.compacted).toBe(false); // rolled back
    const after = await storageInfo(boardId);
    // The previous snapshot and the log are unchanged.
    expect(after.chunks).toBe(before.chunks);
    expect(Number(after.snapshotThroughSeq)).toBe(throughBefore);
    expect(after.updates).toBe(1); // the new note is still in the log
    // The board is still fully loadable (snapshot + the 1 log row).
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(notesOf(lf)).toHaveLength(26);
    // Repair clears any test scaffolding; the board remains consistent.
    await repair(boardId);
    const lf2 = await loadFresh(boardId);
    expect(lf2.result.ok).toBe(true);
    expect(notesOf(lf2)).toHaveLength(26);
  }, 60_000);

  it('repair restores a corrupted snapshot chunk (support for TC-24-style recovery)', async () => {
    const boardId = newBoardId();
    const { updates, notes } = buildBoardUpdates(retroBoardSpecs());
    await appendUpdates(boardId, updates);
    await compact(boardId, true);
    await corruptSnapshot(boardId, 0);
    let lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(false);
    const rep = await repair(boardId);
    expect(rep.repairedSnapshot).toBe(1);
    lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(snapshotsEqual(notesOf(lf), notes)).toBe(true);
  }, 30_000);
});
