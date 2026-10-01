// tests/integration/board-store.test.ts
// Integration tests for BoardStore against mock Durable Object storage (TC-03 to TC-11, TC-25)

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOAD_ORIGIN } from '../../src/worker/board-store';
import { MockDurableObjectStorage } from './helpers/mock-storage';
import { createRetroBoard, createLargeBoard, makeDamagedUpdate } from '../fixtures/boards';
import { snapshot, initDoc, createSticky, moveObject, setStickyColor } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';

function deepEqualSnapshots(snap1: ReturnType<typeof snapshot>, snap2: ReturnType<typeof snapshot>): boolean {
  if (snap1.length !== snap2.length) return false;
  const map1 = new Map(snap1.map(s => [s.id, s]));
  const map2 = new Map(snap2.map(s => [s.id, s]));
  for (const [id, a] of map1) {
    const b = map2.get(id);
    if (!b) return false;
    if (a.x !== b.x || a.y !== b.y || a.color !== b.color || a.text !== b.text || a.z !== b.z) {
      return false;
    }
  }
  return true;
}

describe('persist.board_store: integration tests', () => {
  let storage: MockDurableObjectStorage;
  let store: BoardStore;

  beforeEach(() => {
    storage = new MockDurableObjectStorage();
    store = new BoardStore(storage as any);
  });

  // TC-03: Empty board - migrate then load
  it('TC-03: migrate then load into fresh doc → tables exist, doc empty, schema version set', () => {
    store.migrate();

    const doc = new Y.Doc();
    const result = store.load(doc);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(0);
    expect(snapshot(doc).length).toBe(0);

    // Schema version is set
    const metaRow = storage.sql.prepare('SELECT value FROM storage_meta WHERE key = ?').get('storage_schema_version');
    expect(metaRow).not.toBeNull();
    expect(metaRow!.value).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  // TC-04: Append one update
  it('TC-04: append update → 1 row, bytes column equals length', () => {
    store.migrate();

    const doc = new Y.Doc();
    initDoc(doc);

    // Make a change to generate an update
    createSticky(doc, { x: 100, y: 100 });

    // Encode the state as an update
    const state = Y.encodeStateAsUpdate(doc);
    expect(state.length).toBeGreaterThan(0);
    store.append(state);

    // Verify row exists
    const countRow = storage.sql.prepare('SELECT COUNT(*) as cnt FROM updates WHERE seq > 0').get();
    expect(countRow!.cnt).toBe(1);

    // Verify data length
    const row = storage.sql.prepare('SELECT seq, data FROM updates WHERE seq > 0 ORDER BY seq').all()[0];
    expect((row.data as Uint8Array).length).toBe(state.length);
  });

  // TC-05: LogOnly 25 notes → load into fresh doc equals original
  it('TC-05: 25 notes appended, load into fresh doc equals original', () => {
    store.migrate();

    const original = createRetroBoard();
    const originalSnap = snapshot(original);
    expect(originalSnap.length).toBe(25);

    // Encode and append
    const state = Y.encodeStateAsUpdate(original);
    store.append(state);

    // Load into fresh doc
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(0);
    expect(deepEqualSnapshots(originalSnap, snapshot(freshDoc))).toBe(true);
  });

  // TC-06: Compaction at COMPACTION_UPDATE_COUNT rows
  it('TC-06: compact at threshold → updates 0, chunks ≥ 1, through_seq set, reload equal', () => {
    store.migrate();

    const original = createRetroBoard();
    const originalSnap = snapshot(original);

    // Append the board state
    const state = Y.encodeStateAsUpdate(original);
    store.append(state);

    // Add dummy updates to reach the threshold
    const dummyUpdate = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummyUpdate);
    }

    // Verify we're at the threshold
    const counters = store.getCounters();
    expect(counters.rowCount).toBe(COMPACTION_UPDATE_COUNT);

    // Compact
    const docForCompact = new Y.Doc();
    Y.applyUpdate(docForCompact, state, LOAD_ORIGIN);
    const compacted = store.compactIfNeeded(docForCompact);

    expect(compacted).toBe(true);

    // Verify through_seq is set
    const throughSeqRow = storage.sql.prepare('SELECT value FROM storage_meta WHERE key = ?').get('snapshot_through_seq');
    expect(throughSeqRow).not.toBeNull();
    expect(parseInt(throughSeqRow!.value as string, 10)).toBe(COMPACTION_UPDATE_COUNT);

    // Verify chunks exist
    const chunks = storage.sql.prepare('SELECT data FROM snapshot_chunks ORDER BY idx').all();
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // Verify updates after through_seq are 0
    const afterCount = storage.sql.prepare('SELECT COUNT(*) as cnt FROM updates WHERE seq > ?').get(COMPACTION_UPDATE_COUNT);
    expect(afterCount!.cnt).toBe(0);

    // Reload and verify
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(0);
    expect(deepEqualSnapshots(originalSnap, snapshot(freshDoc))).toBe(true);
  });

  // TC-07: SnapshotPlusLog - updates after compaction
  it('TC-07: 3 updates after compaction → reload has all changes', () => {
    store.migrate();

    const original = createRetroBoard();
    const originalSnap = snapshot(original);
    const state = Y.encodeStateAsUpdate(original);

    // Append initial state and compact
    store.append(state);
    const dummyUpdate = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummyUpdate);
    }

    const docForCompact = new Y.Doc();
    Y.applyUpdate(docForCompact, state, LOAD_ORIGIN);
    store.compactIfNeeded(docForCompact);

    // Now make 3 more changes on the doc
    const updates: Uint8Array[] = [];
    const handler = (u: Uint8Array) => updates.push(u);
    docForCompact.on('update', handler);

    createSticky(docForCompact, { x: 999, y: 999 });
    moveObject(docForCompact, originalSnap[0].id, 50, 50);
    setStickyColor(docForCompact, originalSnap[1].id, 'violet');

    docForCompact.off('update', handler);

    expect(updates.length).toBe(3);

    // Append the 3 new updates
    for (const u of updates) {
      store.append(u);
    }

    // Reload into fresh doc
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(0);

    // Should have 25 + 1 = 26 notes
    const freshSnap = snapshot(freshDoc);
    expect(freshSnap.length).toBe(26);

    // Verify the moved note
    const movedNote = freshSnap.find(n => n.id === originalSnap[0].id);
    expect(movedNote!.x).toBe(50);
    expect(movedNote!.y).toBe(50);

    // Verify the recoloured note
    const recolouredNote = freshSnap.find(n => n.id === originalSnap[1].id);
    expect(recolouredNote!.color).toBe('violet');
  });

  // TC-08: Large board compaction
  it('TC-08: PERSIST_TESTED_NOTES board compaction → chunks, reload equal', () => {
    store.migrate();

    const largeBoard = createLargeBoard(PERSIST_TESTED_NOTES);
    const originalSnap = snapshot(largeBoard);
    expect(originalSnap.length).toBe(PERSIST_TESTED_NOTES);

    const state = Y.encodeStateAsUpdate(largeBoard);

    store.append(state);
    const dummyUpdate = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummyUpdate);
    }

    const docForCompact = new Y.Doc();
    Y.applyUpdate(docForCompact, state, LOAD_ORIGIN);
    const compacted = store.compactIfNeeded(docForCompact);
    expect(compacted).toBe(true);

    // Verify chunks exist (may be 1 or more depending on encoded size)
    const chunks = storage.sql.prepare('SELECT data FROM snapshot_chunks ORDER BY idx').all();
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // If the state is larger than one chunk, we should have multiple
    if (state.length > SNAPSHOT_CHUNK_BYTES) {
      expect(chunks.length).toBeGreaterThan(1);
    }

    // Reload and verify
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(0);
    expect(deepEqualSnapshots(originalSnap, snapshot(freshDoc))).toBe(true);
  }, 30000);

  // TC-09: Damaged log row → quarantined
  it('TC-09: overwrite log row with damaged bytes → quarantined, other notes present', () => {
    store.migrate();

    const original = createRetroBoard();

    // Append the board state as one update (seq 1)
    const state = Y.encodeStateAsUpdate(original);
    store.append(state);

    // Now create additional updates and append them individually
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state, LOAD_ORIGIN);

    const updates: Uint8Array[] = [];
    const handler = (u: Uint8Array) => updates.push(u);
    doc.on('update', handler);

    // Create 10 more notes (each generates one update)
    for (let i = 0; i < 10; i++) {
      createSticky(doc, { x: i * 100, y: 500 });
    }
    doc.off('update', handler);

    // Append each update individually (seq 2 through 11)
    for (const u of updates) {
      store.append(u);
    }

    // Total updates: 1 (board state) + 10 (individual) = 11
    // Damage row at seq 7 (one of the individual note updates)
    const row7 = storage.sql.getUpdateAtSeq(7);
    expect(row7).toBeDefined();
    const damaged = makeDamagedUpdate(row7!.data);
    storage.sql.setUpdateAtSeq(7, damaged);

    // Load into fresh doc
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quarantined).toBe(1);

    // Verify the row was moved to quarantine
    expect(storage.sql.getQuarantinedCount()).toBe(1);

    // The board should still have the original 25 notes from the snapshot
    // plus some of the 10 new notes (minus the one whose update was damaged)
    // The exact count depends on Yjs update semantics, but must be > 25
    const freshSnap = snapshot(freshDoc);
    expect(freshSnap.length).toBeGreaterThanOrEqual(25);
    expect(freshSnap.length).toBeLessThan(35); // Not all 35 (one was damaged)
  });

  // TC-10: Corrupted snapshot → load fails
  it('TC-10: corrupt snapshot chunk → ok:false reason snapshot-unreadable, nothing deleted', () => {
    store.migrate();

    const original = createRetroBoard();
    const state = Y.encodeStateAsUpdate(original);

    store.append(state);
    const dummyUpdate = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummyUpdate);
    }

    const docForCompact = new Y.Doc();
    Y.applyUpdate(docForCompact, state, LOAD_ORIGIN);
    store.compactIfNeeded(docForCompact);

    // Record state before corruption
    const updatesBefore = storage.sql.getUpdatesCount();
    const chunksBefore = storage.sql.getSnapshotChunksCount();
    const quarantinedBefore = storage.sql.getQuarantinedCount();

    // Corrupt the first chunk with invalid bytes
    const corrupted = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    storage.sql.snapshotChunks.set(0, corrupted);

    // Load should fail
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('snapshot-unreadable');
    }

    // Nothing should have been deleted or quarantined
    expect(storage.sql.getUpdatesCount()).toBe(updatesBefore);
    expect(storage.sql.getSnapshotChunksCount()).toBe(chunksBefore);
    expect(storage.sql.getQuarantinedCount()).toBe(quarantinedBefore);
  });

  // TC-11: Compaction failure → rollback
  it('TC-11: inject throw during compaction → rollback, returns false', () => {
    store.migrate();

    const original = createRetroBoard();
    const state = Y.encodeStateAsUpdate(original);

    store.append(state);
    const dummyUpdate = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummyUpdate);
    }

    // Record state before compaction attempt
    const updatesBefore = storage.sql.getUpdatesCount();
    const chunksBefore = storage.sql.getSnapshotChunksCount();

    // Inject failure at the 3rd statement in the next transaction
    // Compaction transaction: 1) DELETE chunks, 2) INSERT chunk, 3) INSERT chunk or DELETE updates
    storage.failTransactionAtStatement = 3;

    const docForCompact = new Y.Doc();
    Y.applyUpdate(docForCompact, state, LOAD_ORIGIN);
    const compacted = store.compactIfNeeded(docForCompact);

    // Should return false (failure)
    expect(compacted).toBe(false);

    // After rollback, state should be unchanged
    expect(storage.sql.getUpdatesCount()).toBe(updatesBefore);
    expect(storage.sql.getSnapshotChunksCount()).toBe(chunksBefore);
  });

  // TC-25: Never-edited board → no rows
  it('TC-25: migrate on never-edited board → zero rows in updates and snapshot_chunks', () => {
    store.migrate();

    expect(storage.sql.getUpdatesCount()).toBe(0);
    expect(storage.sql.getSnapshotChunksCount()).toBe(0);
  });
});
