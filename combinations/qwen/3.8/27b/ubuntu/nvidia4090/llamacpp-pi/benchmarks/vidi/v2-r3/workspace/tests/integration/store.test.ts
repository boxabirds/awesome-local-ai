import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { buildRetroBoard, buildLargeBoard } from '../fixtures/boards';
import { hooks } from './hooks';
import { sameNotes } from './ws-client';

/** Each integration test uses its own board so storage never crosses over. */
let counter = 0;
function boardId(): string {
  counter += 1;
  return `store-${counter}-${Date.now() % 100000}`;
}

/**
 * Creates `count` further notes on a copy of `base` and returns the
 * resulting Yjs updates (valid against any doc holding `base`'s state)
 * plus the copy with the new notes (for expected snapshots).
 */
function moreNotes(base: Y.Doc, count: number): { updates: Uint8Array[]; doc: Y.Doc } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(base), 'seed');
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array, origin: unknown) => {
    if (origin !== 'seed') updates.push(u);
  };
  doc.on('update', handler);
  try {
    for (let i = 0; i < count; i++) {
      doc.transact(() => {
        createSticky(doc, { x: 500 + i * 10, y: 500 + i * 10 }, 'yellow');
      }, 't');
    }
  } finally {
    doc.off('update', handler);
  }
  return { updates, doc };
}

describe('BoardStore over real Durable Object storage (TC-03..TC-11, TC-25)', () => {
  it('TC-03: migrate creates the schema; loading an untouched board is empty', async () => {
    const id = boardId();
    await hooks.migrate(id);
    const status = await hooks.status(id);
    expect(status.schemaVersion).toBe('1');
    const { result, notes } = await hooks.load(id);
    expect(result).toEqual({ ok: true, quarantined: 0 });
    expect(notes).toHaveLength(0);
  });

  it('TC-04: appending one update creates one row with its byte count', async () => {
    const id = boardId();
    const fixture = buildRetroBoard();
    const update = fixture.perNoteUpdates[0];
    await hooks.append(id, update);
    const status = await hooks.status(id);
    expect(status.updates.count).toBe(1);
    expect(status.updates.bytes).toBe(update.byteLength);
    expect(status.throughSeq).toBe(0);
  });

  it('TC-05: loading a 25-note log into a fresh doc equals the original', async () => {
    const id = boardId();
    const fixture = buildRetroBoard();
    await hooks.appendMany(id, fixture.perNoteUpdates);
    const { result, notes } = await hooks.load(id);
    expect(result).toEqual({ ok: true, quarantined: 0 });
    expect(notes.length).toBe(25);
    expect(sameNotes(notes, fixture.notes)).toBe(true);
  });

  it('TC-06: at the compaction threshold the log is replaced by a snapshot', async () => {
    const id = boardId();
    const fixture = buildLargeBoard(500);
    const all = fixture.perNoteUpdates;
    await hooks.appendMany(id, all);
    expect((await hooks.status(id)).updates.count).toBe(all.length);

    const compacted = await hooks.compact(id);
    expect(compacted.compacted).toBe(true);

    const status = await hooks.status(id);
    expect(status.updates.count).toBe(0);
    expect(status.chunks).toBeGreaterThanOrEqual(1);
    expect(status.throughSeq).toBe(all.length);
    const { result, notes } = await hooks.load(id);
    expect(result.ok).toBe(true);
    expect(sameNotes(notes, fixture.notes)).toBe(true);
  });

  it('TC-07: updates after compaction load on top of the snapshot', async () => {
    const id = boardId();
    const fixture = buildRetroBoard();
    await hooks.appendMany(id, fixture.perNoteUpdates);
    const compacted = await hooks.compact(id, { force: true });
    expect(compacted.compacted).toBe(true);
    let status = await hooks.status(id);
    expect(status.updates.count).toBe(0);
    const throughSeq = status.throughSeq;
    expect(throughSeq).toBeGreaterThan(0);

    const extra = moreNotes(fixture.doc, 3);
    await hooks.appendMany(id, extra.updates);
    status = await hooks.status(id);
    expect(status.updates.count).toBe(3);
    expect(status.throughSeq).toBe(throughSeq);

    const { result, notes } = await hooks.load(id);
    expect(result.ok).toBe(true);
    // the snapshot covers rows up to through_seq; only seq > through_seq
    // (the 3 new notes) came from the log
    expect(sameNotes(notes, snapshot(extra.doc))).toBe(true);
  });

  it(`TC-08: a ${PERSIST_TESTED_NOTES}-note board compacts into multiple chunks`, async () => {
    const id = boardId();
    const fixture = buildLargeBoard(PERSIST_TESTED_NOTES);
    await hooks.appendMany(id, fixture.perNoteUpdates);
    const compacted = await hooks.compact(id);
    expect(compacted.compacted).toBe(true);
    const status = await hooks.status(id);
    // contiguous 512 KiB slices: the chunk count is the exact ceiling of
    // the stored size; the standard board encodes above one chunk
    expect(status.chunks).toBe(Math.ceil(status.snapshotBytes / SNAPSHOT_CHUNK_BYTES));
    expect(status.chunks).toBeGreaterThan(1);
    expect(status.snapshotBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    const { result, notes } = await hooks.load(id);
    expect(result.ok).toBe(true);
    expect(notes.length).toBe(PERSIST_TESTED_NOTES);
    expect(sameNotes(notes, fixture.notes)).toBe(true);
  });

  it('TC-09: a truncated log row is quarantined with its error; the rest load', async () => {
    const id = boardId();
    const fixture = buildRetroBoard();
    const all = fixture.perNoteUpdates;
    await hooks.appendMany(id, all);
    // row 7 is a pure note update (rows 1..25 are notes)
    await hooks.corruptLogRow(id, 7, 'truncated');
    const { result, notes } = await hooks.load(id);
    expect(result).toEqual({ ok: true, quarantined: 1 });
    const status = await hooks.status(id);
    // the damaged row was moved, not lost: it sits in quarantined_updates
    // with its error text, and the log is one row shorter
    expect(status.quarantined).toHaveLength(1);
    expect(status.quarantined[0].seq).toBe(7);
    expect(status.quarantined[0].error.length).toBeGreaterThan(0);
    expect(status.updates.count).toBe(all.length - 1);
    // every other note is present
    expect(notes.length).toBe(24);
    expect(notes.some((n) => n.id === fixture.ids[6])).toBe(false);
  });

  it('TC-10: a corrupted snapshot chunk is unreadable; nothing is deleted or quarantined', async () => {
    const id = boardId();
    const fixture = buildRetroBoard();
    await hooks.appendMany(id, fixture.perNoteUpdates);
    const compacted = await hooks.compact(id, { force: true });
    expect(compacted.compacted).toBe(true);
    const before = await hooks.status(id);
    expect(before.updates.count).toBe(0);

    await hooks.corruptSnapshotChunk(id, 0, 'random');
    const { result, notes } = await hooks.load(id);
    expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(notes).toHaveLength(0);

    const after = await hooks.status(id);
    expect(after.updates.count).toBe(0); // no log rows were deleted
    expect(after.quarantined).toHaveLength(0); // nothing was quarantined
    expect(after.chunks).toBe(before.chunks); // the chunks were left in place
    // a second load is still unreadable: nothing was silently repaired
    const again = await hooks.load(id);
    expect(again.result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
  });

  it('TC-11: a failure during compaction rolls the whole transaction back', async () => {
    const id = boardId();
    const fixture = buildLargeBoard(500);
    const all = fixture.perNoteUpdates;
    await hooks.appendMany(id, all);
    const failed = await hooks.compact(id, { failAfterChunkDelete: true });
    expect(failed.compacted).toBe(false);
    const status = await hooks.status(id);
    // nothing was committed: no chunks, every log row intact
    expect(status.chunks).toBe(0);
    expect(status.snapshotBytes).toBe(0);
    expect(status.throughSeq).toBe(0);
    expect(status.updates.count).toBe(all.length);
    const { result, notes } = await hooks.load(id);
    expect(result.ok).toBe(true);
    expect(notes.length).toBe(500);

    // and a healthy compaction still succeeds afterwards
    const ok = await hooks.compact(id, { force: true });
    expect(ok.compacted).toBe(true);
    expect((await hooks.status(id)).chunks).toBeGreaterThan(0);
  });

  it('TC-25: migrating a never-edited board writes no data rows', async () => {
    const id = boardId();
    await hooks.migrate(id);
    const status = await hooks.status(id);
    expect(status.updates.count).toBe(0);
    expect(status.chunks).toBe(0);
    expect(status.snapshotBytes).toBe(0);
    expect(status.schemaVersion).toBe('1');
  });
});
