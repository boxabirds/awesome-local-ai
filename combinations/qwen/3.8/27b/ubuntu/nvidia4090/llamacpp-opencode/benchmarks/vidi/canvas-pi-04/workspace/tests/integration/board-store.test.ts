// Story 4, task 3: BoardStore against REAL Durable Object SQLite (workerd
// pool), isolated per test (a fresh board id per test).
//
// TC-03 migrate + load on an empty board
// TC-04 append: updates rows 0 -> 1, bytes column = length
// TC-05 load a 25-note log: fresh doc equals the original
// TC-06 compaction at exactly COMPACTION_UPDATE_COUNT rows
// TC-07 snapshot + 3 log rows after compaction: only seq > through applied
// TC-08 PERSIST_TESTED_NOTES board compacts into >1 chunk and reloads equal
// TC-09 damaged log row: quarantined, rest loads
// TC-10 damaged snapshot: LoadFailed, nothing deleted or quarantined
// TC-11 compaction SQL failure: transaction rolled back, previous state intact
// TC-25 migrate writes no board data

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  moveObject,
  setStickyColor,
  createStickyAt,
  snapshot as boardSnapshot,
} from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { chunkUpdate } from '../../src/worker/board-store';
import { generateLargeBoard, generateRetroBoard } from '../fixtures/boards';
import { bytesEqual, ids, room, sameBoard, stateToNotes } from './persist-helpers';

/** Append the fixture's incremental updates to the room's store, batched. */
async function appendUpdates(boardId: string, updates: Uint8Array[], batch = 500): Promise<void> {
  const stub = room(boardId);
  for (let i = 0; i < updates.length; i += batch) {
    await stub.testStoreAppendBatch(updates.slice(i, i + batch));
  }
}

describe('BoardStore on Durable Object SQLite (task 3)', () => {
  it('TC-03: migrate + load on an empty board', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const inspect = await stub.testInspectStorage();
    expect(inspect.meta['storage_schema_version']).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(inspect.updatesRows).toEqual([]);
    expect(inspect.snapshotChunkCount).toBe(0);
    expect(inspect.quarantined).toEqual([]);

    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(load.quarantined).toBe(0);
    expect(load.state).not.toBeNull();
    expect(stateToNotes(load.state!)).toEqual([]); // doc empty
  });

  it('TC-04: append one update -> one row, bytes column equals length', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const [first] = generateRetroBoard().updates;
    expect(first).toBeDefined();
    await stub.testStoreAppendBatch([first!]);
    const inspect = await stub.testInspectStorage();
    expect(inspect.updatesRows).toEqual([{ seq: 1, bytes: first!.byteLength }]);
    expect(inspect.snapshotChunkCount).toBe(0);
  });

  it('TC-05: load a 25-note log into a fresh doc: snapshot(doc) equals original', async () => {
    const boardId = newBoardId();
    const board = generateRetroBoard();
    expect(board.noteCount).toBe(25);
    await appendUpdates(boardId, board.updates);
    const load = await room(boardId).testStoreLoad();
    expect(load.ok).toBe(true);
    expect(load.quarantined).toBe(0);
    // Byte-identical state (the loader applies the same updates in order).
    expect(bytesEqual(new Uint8Array(load.state!), board.snapshot)).toBe(true);
    // And semantically: 25 notes, same content.
    expect(sameBoard(stateToNotes(load.state!), boardSnapshot(board.doc))).toBe(true);
  });

  it('TC-06: compaction at exactly COMPACTION_UPDATE_COUNT rows', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    // 250 notes x (create + text) = exactly 500 updates.
    const board = generateLargeBoard(COMPACTION_UPDATE_COUNT / 2);
    expect(board.updates.length).toBe(COMPACTION_UPDATE_COUNT);
    await appendUpdates(boardId, board.updates);

    const before = await stub.testInspectStorage();
    expect(before.updatesRows.length).toBe(COMPACTION_UPDATE_COUNT);

    const compact = await stub.testStoreCompact();
    expect(compact.committed).toBe(true);

    const after = await stub.testInspectStorage();
    expect(after.updatesRows.length).toBe(0);
    expect(after.snapshotChunkCount).toBeGreaterThanOrEqual(1);
    // through_seq = the max seq of the compacted log.
    expect(after.meta['snapshot_through_seq']).toBe(String(COMPACTION_UPDATE_COUNT));

    // Reload equals the original.
    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(bytesEqual(new Uint8Array(load.state!), board.snapshot)).toBe(true);
  });

  it('TC-07: snapshot + 3 log rows: only rows with seq > through_seq applied', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const board = generateRetroBoard();
    await appendUpdates(boardId, board.updates);
    expect((await stub.testStoreCompact(true)).committed).toBe(true);
    const through = Number((await stub.testInspectStorage()).meta['snapshot_through_seq']);

    // Three more changes on the fixture doc, captured as updates.
    const doc = board.doc;
    const captured: Uint8Array[] = [];
    const handler = (update: Uint8Array): void => {
      captured.push(new Uint8Array(update));
    };
    doc.on('update', handler);
    const off = (): void => {
      doc.off('update', handler);
    };
    const noteId = createStickyAt(doc, 42, 43, 'green');
    moveObject(doc, boardSnapshot(doc)[0]!.id, 10, 11);
    setStickyColor(doc, noteId, 'orange');
    off();
    expect(captured.length).toBe(3);

    await appendUpdates(boardId, captured);
    const inspect = await stub.testInspectStorage();
    expect(inspect.updatesRows.length).toBe(3);
    for (const row of inspect.updatesRows) {
      expect(row.seq).toBeGreaterThan(through);
    }

    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(bytesEqual(new Uint8Array(load.state!), Y.encodeStateAsUpdate(doc))).toBe(true);
    const notes = stateToNotes(load.state!);
    expect(notes.length).toBe(26);
    expect(notes.find((n) => n.id === noteId)?.color).toBe('orange');
  });

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into >1 chunk and reloads equal', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const board = generateLargeBoard(PERSIST_TESTED_NOTES);
    const encoded = board.snapshot;
    expect(chunkUpdate(encoded, SNAPSHOT_CHUNK_BYTES).length).toBeGreaterThan(1);

    await appendUpdates(boardId, board.updates);
    const compact = await stub.testStoreCompact();
    expect(compact.committed).toBe(true);
    expect(compact.chunks).toBeGreaterThan(1);
    expect(compact.updatesRows).toBe(0);

    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(bytesEqual(new Uint8Array(load.state!), encoded)).toBe(true);
    expect(stateToNotes(load.state!).length).toBe(PERSIST_TESTED_NOTES);
  }, 60_000);

  it('TC-09: a damaged log row is quarantined; the rest loads', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const board = generateRetroBoard();
    expect(board.updates.length).toBe(56);
    await appendUpdates(boardId, board.updates);
    const before = await stub.testInspectStorage();
    expect(before.updatesRows.length).toBe(56);

    // Row 7 is ana's move of note 1 - her LAST update (see the fixture's
    // header): quarantining it loses only the move, nothing after it.
    expect(await stub.testCorruptUpdateRow(7, 'truncate')).toEqual({ ok: true });

    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(load.quarantined).toBe(1);

    const after = await stub.testInspectStorage();
    expect(after.updatesRows.length).toBe(before.updatesRows.length - 1);
    expect(after.quarantined.length).toBe(1);
    expect(after.quarantined[0]!.seq).toBe(7);
    expect(after.quarantined[0]!.error).not.toBeNull();
    expect(after.quarantined[0]!.error!.length).toBeGreaterThan(0);

    // All other notes present: the loaded state is byte-identical to the
    // state produced by applying the log minus row 7, and every original
    // note id is there (note 1 simply keeps its pre-move position).
    const ref = new Y.Doc();
    board.updates.forEach((update, i) => {
      if (i !== 6) Y.applyUpdate(ref, update, 'tc09');
    });
    expect(bytesEqual(new Uint8Array(load.state!), Y.encodeStateAsUpdate(ref))).toBe(true);
    const loaded = stateToNotes(load.state!);
    const original = boardSnapshot(board.doc);
    expect(loaded.length).toBe(25);
    expect(loaded.every((n) => original.some((o) => o.id === n.id))).toBe(true);
    expect(ids(loaded).sort()).toEqual(ids(original).sort());
  });

  it('TC-10: a damaged snapshot fails the load; nothing is deleted or quarantined', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    const board = generateRetroBoard();
    await appendUpdates(boardId, board.updates);
    expect((await stub.testStoreCompact(true)).committed).toBe(true);
    const before = await stub.testInspectStorage();
    expect(before.snapshotChunkCount).toBe(1);

    expect(await stub.testCorruptSnapshotChunk0()).toEqual({ ok: true });

    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(false);
    expect(load.reason).toBe('snapshot-unreadable');
    expect(load.state).toBeNull();

    // The log rows and the (still present, still corrupt) chunk are intact.
    const after = await stub.testInspectStorage();
    expect(after.updatesRows).toEqual([]); // compacted away, unchanged
    expect(after.quarantined).toEqual([]);
    expect(after.snapshotChunkCount).toBe(1);
    expect(after.meta['snapshot_through_seq']).toBe(before.meta['snapshot_through_seq']);
  });

  it('TC-11: a failing compaction rolls back; previous chunks and log intact', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    // 500 notes x (create + text) = 1000 updates; compact the first half,
    // then let the log regrow to the threshold with the second half.
    const board = generateLargeBoard(COMPACTION_UPDATE_COUNT);
    expect(board.updates.length).toBe(COMPACTION_UPDATE_COUNT * 2);

    // Baseline: compact the first 500 updates.
    await appendUpdates(boardId, board.updates.slice(0, COMPACTION_UPDATE_COUNT));
    const baselineCompact = await stub.testStoreCompact(true);
    expect(baselineCompact.committed).toBe(true);
    const baseline = await stub.testInspectStorage();
    expect(baseline.updatesRows.length).toBe(0);
    expect(baseline.snapshotChunkCount).toBeGreaterThanOrEqual(1);
    const baselineThrough = baseline.meta['snapshot_through_seq'];

    // Regrow the log to exactly the threshold.
    await appendUpdates(boardId, board.updates.slice(COMPACTION_UPDATE_COUNT));
    const before = await stub.testInspectStorage();
    expect(before.updatesRows.length).toBe(COMPACTION_UPDATE_COUNT);

    // Inject the failure after the chunk delete, then compact.
    await stub.testFailCompactionAfterChunkDelete();
    const compact = await stub.testStoreCompact(true);
    expect(compact.committed).toBe(false);

    // Rolled back: the previous snapshot chunks and the log are unchanged.
    const after = await stub.testInspectStorage();
    expect(after.snapshotChunkCount).toBe(baseline.snapshotChunkCount);
    expect(after.updatesRows).toEqual(before.updatesRows);
    expect(after.meta['snapshot_through_seq']).toBe(baselineThrough);
    expect(after.quarantined).toEqual([]);

    // The fault is one-shot: the next compaction succeeds (clean rollback).
    const retry = await stub.testStoreCompact(true);
    expect(retry.committed).toBe(true);
    const load = await stub.testStoreLoad();
    expect(load.ok).toBe(true);
    expect(bytesEqual(new Uint8Array(load.state!), board.snapshot)).toBe(true);
  }, 60_000);

  it('TC-25: migrate writes no board data', async () => {
    const boardId = newBoardId();
    const stub = room(boardId);
    // First RPC constructs the object (migrate + load run).
    const inspect = await stub.testInspectStorage();
    expect(Object.keys(inspect.meta).sort()).toEqual(['storage_schema_version']);
    expect(inspect.updatesRows).toEqual([]);
    expect(inspect.snapshotChunkCount).toBe(0);
    expect(inspect.quarantined).toEqual([]);
  });
});
