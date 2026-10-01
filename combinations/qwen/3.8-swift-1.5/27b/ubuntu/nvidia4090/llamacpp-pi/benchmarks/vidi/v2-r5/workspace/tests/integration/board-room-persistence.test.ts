// tests/integration/board-room-persistence.test.ts
// Integration tests for persistent BoardRoom: durability, failures, hibernation (TC-12 to TC-18, TC-26)

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { TestPersistentRoom } from './helpers/test-persistent-room';
import { MockDurableObjectStorage } from './helpers/mock-storage';
import { snapshot, createSticky } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { COMPACTION_UPDATE_COUNT } from '../../src/shared/config';

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

describe('persist.room: integration tests', () => {
  // TC-12: A creates note; by the time B observes it, updates row exists
  it('TC-12: append-before-broadcast - row exists when B receives update', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    const b = room.acceptConnection('b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // A creates a note
    createSticky(a.doc, { x: 100, y: 100 });

    // Wait for B to receive it
    await new Promise(r => setTimeout(r, 50));

    // B should see the note
    expect(b.snapshot().length).toBe(1);

    // The updates row should exist in storage
    const store = room.boardStore!;
    const counters = store.getCounters();
    expect(counters.rowCount).toBeGreaterThanOrEqual(1);

    // A fresh doc loaded from storage should contain the note
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);
    expect(result.ok).toBe(true);
    expect(snapshot(freshDoc).length).toBe(1);

    a.close(); b.close(); room.destroy();
  });

  // TC-13: All clients leave; new client on fresh room → snapshot equals original
  it('TC-13: reopen after everyone leaves - fresh room loads same state', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    const b = room.acceptConnection('b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // Create some notes
    for (let i = 0; i < 5; i++) {
      createSticky(a.doc, { x: i * 100, y: 0 });
    }
    await new Promise(r => setTimeout(r, 50));

    const originalSnap = a.snapshot();
    expect(originalSnap.length).toBe(5);

    // All clients disconnect
    a.close(); b.close();
    room.destroy();

    // New room instance over same storage
    const room2 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room2.currentState).toBe('ready');

    // New client connects
    const c = room2.acceptConnection('c');
    await c.waitForSync();
    await new Promise(r => setTimeout(r, 20));

    // Should see the same notes
    expect(deepEqualSnapshots(originalSnap, c.snapshot())).toBe(true);
    expect(c.snapshot().length).toBe(5);

    c.close(); room2.destroy();
  });

  // TC-14: Storage failure - A and B closed 1011, B never received update
  it('TC-14: storage failure closes all sockets 1011, change saved after reconnect', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    const b = room.acceptConnection('b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // Inject storage failure on next append
    room.failNextAppend();

    // A creates a note (this will trigger the storage failure)
    createSticky(a.doc, { x: 200, y: 200 });

    await new Promise(r => setTimeout(r, 20));

    // Both A and B should be closed with 1011
    expect(a.socket.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.socket.closeCode).toBe(CLOSE_STORAGE_FAILURE);

    // B should NOT have received the update (it was never broadcast)
    // B's snapshot should still be empty
    expect(b.snapshot().length).toBe(0);

    // Now reconstruct the room (simulating reconnect after storage is fixed)
    const room2 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room2.currentState).toBe('ready');

    // A reconnects (still holding the change in its doc)
    const a2 = room2.acceptConnection('a2', a.doc);
    await a2.waitForSync();
    await new Promise(r => setTimeout(r, 50));

    // B reconnects
    const b2 = room2.acceptConnection('b2');
    await b2.waitForSync();
    await new Promise(r => setTimeout(r, 50));

    // B should now see the note (A's doc had it, and it was synced)
    expect(b2.snapshot().length).toBe(1);

    // Storage should contain the note
    const store = room2.boardStore!;
    const freshDoc = new Y.Doc();
    const result = store.load(freshDoc);
    expect(result.ok).toBe(true);
    expect(snapshot(freshDoc).length).toBe(1);

    a2.close(); b2.close(); room2.destroy();
  });

  // TC-15: Corrupt snapshot → client closed 4500
  it('TC-15: damaged snapshot → client closed with 4500', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    await a.waitForSync();

    // Create some notes and compact
    for (let i = 0; i < 5; i++) {
      createSticky(a.doc, { x: i * 100, y: 0 });
    }
    await new Promise(r => setTimeout(r, 50));

    // Force compaction
    const store = room.boardStore!;
    const doc = room.document!;
    const state = Y.encodeStateAsUpdate(doc);
    store.append(state);
    const dummy = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummy);
    }
    store.compactIfNeeded(doc);

    a.close();
    room.destroy();

    // Corrupt the snapshot
    room.mockStorage.sql.snapshotChunks.set(0, new Uint8Array([0xFF, 0xFF, 0xFF]));

    // New room instance - should fail to load
    const room2 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room2.currentState).toBe('load-failed');

    // Client connects → should be closed with 4500
    const c = room2.acceptConnection('c');
    await new Promise(r => setTimeout(r, 20));

    expect(c.socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    c.close(); room2.destroy();
  });

  // TC-16: Load retry - before interval closed 4500, after interval loads
  it('TC-16: load retry after interval - repair then reconnect succeeds', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    await a.waitForSync();

    // Create notes and compact
    for (let i = 0; i < 5; i++) {
      createSticky(a.doc, { x: i * 100, y: 0 });
    }
    await new Promise(r => setTimeout(r, 50));

    const store = room.boardStore!;
    const doc = room.document!;
    const state = Y.encodeStateAsUpdate(doc);
    store.append(state);
    const dummy = new Uint8Array([1, 2, 3]);
    for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
      store.append(dummy);
    }
    store.compactIfNeeded(doc);

    a.close();
    room.destroy();

    // Save the valid snapshot for repair
    const validChunks = new Map(room.mockStorage.sql.snapshotChunks);

    // Corrupt the snapshot
    room.mockStorage.sql.snapshotChunks.set(0, new Uint8Array([0xFF, 0xFF, 0xFF]));

    // New room instance - load fails
    const room2 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room2.currentState).toBe('load-failed');

    // Client connects immediately → closed 4500
    const c1 = room2.acceptConnection('c1');
    await new Promise(r => setTimeout(r, 20));
    expect(c1.socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    c1.close();

    // Repair the snapshot
    room.mockStorage.sql.snapshotChunks.clear();
    for (const [k, v] of validChunks) {
      room.mockStorage.sql.snapshotChunks.set(k, v);
    }

    // Simulate time passing (LOAD_RETRY_MIN_INTERVAL_MS)
    // In the real implementation, the room checks Date.now() - loadFailedAt
    // For the test, we reconstruct the room (which is what happens on a new connection
    // after the interval has passed in the real Durable Object)
    const room3 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room3.currentState).toBe('ready');

    // Client connects → should succeed
    const c2 = room3.acceptConnection('c2');
    await c2.waitForSync();
    await new Promise(r => setTimeout(r, 20));

    expect(c2.socket.closeCode).toBeNull();
    expect(c2.snapshot().length).toBe(5);

    c2.close(); room3.destroy();
  });

  // TC-17: Garbage update → closed 1003, row count unchanged
  it('TC-17: garbage update → closed 1003, not stored', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    await a.waitForSync();

    const rowCountBefore = room.boardStore!.getCounters().rowCount;

    // Send a garbage sync message (invalid Yjs update)
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 0); // MESSAGE_SYNC
    encoding.writeVarUint(frame, 4);
    encoding.writeUint8Array(frame, new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]));
    room.sendRawToSocket(a.socket, encoding.toUint8Array(frame).buffer as ArrayBuffer);

    await new Promise(r => setTimeout(r, 20));

    expect(a.socket.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    // Row count unchanged
    const rowCountAfter = room.boardStore!.getCounters().rowCount;
    expect(rowCountAfter).toBe(rowCountBefore);

    a.close(); room.destroy();
  });

  // TC-18: Hibernation path - after reconstruct, messages delivered via getWebSockets
  it('TC-18: hibernation - broadcast reaches sockets after reconstruct', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    const b = room.acceptConnection('b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // Create a note
    createSticky(a.doc, { x: 50, y: 50 });
    await new Promise(r => setTimeout(r, 50));

    expect(b.snapshot().length).toBe(1);

    // All disconnect (hibernation)
    a.close(); b.close();
    room.destroy();

    // Reconstruct (wake from hibernation)
    const room2 = TestPersistentRoom.reconstruct(room.mockStorage);
    expect(room2.currentState).toBe('ready');

    // New clients connect and should see the note
    const c = room2.acceptConnection('c');
    const d = room2.acceptConnection('d');
    await Promise.all([c.waitForSync(), d.waitForSync()]);
    await new Promise(r => setTimeout(r, 20));

    expect(c.snapshot().length).toBe(1);
    expect(d.snapshot().length).toBe(1);

    // Create another note - should broadcast to both
    createSticky(c.doc, { x: 150, y: 50 });
    await new Promise(r => setTimeout(r, 50));

    expect(d.snapshot().length).toBe(2);

    c.close(); d.close(); room2.destroy();
  });

  // TC-26: SQL error on read → room closes clients with 4500
  it('TC-26: SQL read error → load-failed, clients closed 4500', async () => {
    const room = new TestPersistentRoom();
    const a = room.acceptConnection('a');
    await a.waitForSync();

    // Create some notes
    for (let i = 0; i < 3; i++) {
      createSticky(a.doc, { x: i * 100, y: 0 });
    }
    await new Promise(r => setTimeout(r, 50));

    a.close();
    room.destroy();

    // Create a new room with a storage that fails on read
    const failingStorage = new MockDurableObjectStorage();
    // Copy data from the original storage
    for (const [k, v] of room.mockStorage.sql.storageMeta) {
      failingStorage.sql.storageMeta.set(k, v);
    }
    for (const [k, v] of room.mockStorage.sql.updates) {
      failingStorage.sql.updates.set(k, { data: new Uint8Array(v.data), bytes: v.bytes });
    }
    
    // Make the specific SELECT that loads update data throw (not COUNT or MAX)
    const origExecute = failingStorage.sql.execute.bind(failingStorage.sql);
    (failingStorage.sql as any).execute = (query: string, _mode: 'all' | 'run', params: any[]) => {
      // Only fail on the data-loading query: SELECT seq, data FROM updates WHERE seq > ...
      if (query.startsWith('SELECT seq, data FROM updates')) {
        throw new Error('Simulated SQL read error');
      }
      return origExecute(query, _mode, params);
    };

    const room2 = TestPersistentRoom.reconstruct(failingStorage);
    expect(room2.currentState).toBe('load-failed');

    // Client connects → closed 4500
    const c = room2.acceptConnection('c');
    await new Promise(r => setTimeout(r, 20));
    expect(c.socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    c.close(); room2.destroy();
  });
});
