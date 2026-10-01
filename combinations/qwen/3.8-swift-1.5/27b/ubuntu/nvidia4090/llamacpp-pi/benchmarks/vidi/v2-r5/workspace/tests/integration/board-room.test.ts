// tests/integration/board-room.test.ts
// Integration tests for BoardRoom merging, broadcast and error handling (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31)
// Uses TestRoom harness with real Y.Doc instances and y-protocols framing.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createSticky, moveObject, setStickyColor, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { TestRoom, type TestClient } from './helpers/test-room';
import { MESSAGE_SYNC, CLOSE_UNSUPPORTED_DATA as CLOSE_CODE } from '../../src/shared/protocol';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

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

async function createTwoClients(room: TestRoom) {
  const a = room.acceptConnection('client-a');
  const b = room.acceptConnection('client-b');
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return { a, b };
}

describe('sync.room: BoardRoom merging, broadcast and error handling (integration)', () => {
  // TC-07: A creates sticky → B snapshot equals A
  it('TC-07: create propagates to B; B received exactly one update', async () => {
    const room = new TestRoom();
    const { a, b } = await createTwoClients(room);

    const bSyncBefore = b.socket.receivedFromServer.filter(m => m.type === MESSAGE_SYNC).length;
    createSticky(a.doc, { x: 100, y: 100 });

    await new Promise(r => setTimeout(r, 50));

    expect(deepEqualSnapshots(a.snapshot(), b.snapshot())).toBe(true);
    expect(b.snapshot().length).toBe(1);
    const bSyncAfter = b.socket.receivedFromServer.filter(m => m.type === MESSAGE_SYNC).length;
    expect(bSyncAfter - bSyncBefore).toBe(1);

    a.close(); b.close(); room.destroy();
  });

  // TC-08: move, recolour, text insert, delete
  describe('TC-08: each mutation kind propagates; A receives no echo', () => {
    it('move propagates; A receives no echo', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await new Promise(r => setTimeout(r, 50));

      const aSyncBefore = a.socket.receivedFromServer.filter(m => m.type === MESSAGE_SYNC).length;
      moveObject(a.doc, id, 200, 300);
      await new Promise(r => setTimeout(r, 50));

      expect(deepEqualSnapshots(a.snapshot(), b.snapshot())).toBe(true);
      const aSyncAfter = a.socket.receivedFromServer.filter(m => m.type === MESSAGE_SYNC).length;
      expect(aSyncAfter).toBe(aSyncBefore); // No echo

      a.close(); b.close(); room.destroy();
    });

    it('recolour propagates', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await new Promise(r => setTimeout(r, 50));

      setStickyColor(a.doc, id, 'green');
      await new Promise(r => setTimeout(r, 50));

      expect(deepEqualSnapshots(a.snapshot(), b.snapshot())).toBe(true);
      expect(b.snapshot()[0].color).toBe('green');

      a.close(); b.close(); room.destroy();
    });

    it('text insert propagates', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await new Promise(r => setTimeout(r, 50));

      const textA = getStickyText(a.doc, id)!;
      textA.insert(0, 'hello');
      await new Promise(r => setTimeout(r, 50));

      expect(deepEqualSnapshots(a.snapshot(), b.snapshot())).toBe(true);
      expect(b.snapshot()[0].text).toBe('hello');

      a.close(); b.close(); room.destroy();
    });

    it('delete propagates', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await new Promise(r => setTimeout(r, 50));
      expect(b.snapshot().length).toBe(1);

      deleteObject(a.doc, id);
      await new Promise(r => setTimeout(r, 50));

      expect(a.snapshot().length).toBe(0);
      expect(b.snapshot().length).toBe(0);

      a.close(); b.close(); room.destroy();
    });
  });

  // TC-09: concurrent text merge
  it('TC-09: concurrent text inserts merge to "red green blue"', async () => {
    const room = new TestRoom();
    const { a, b } = await createTwoClients(room);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 50));

    const textA = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;

    // Set initial text "green"
    textA.insert(0, 'green');
    await new Promise(r => setTimeout(r, 50));

    expect(textA.toString()).toBe('green');
    expect(textB.toString()).toBe('green');

    // Freeze both to make inserts truly concurrent
    a.freeze();
    b.freeze();

    // Concurrent inserts (neither sees the other's change)
    textA.insert(0, 'red ');
    textB.insert(5, ' blue');

    // Unfreeze - this flushes updates to server
    a.unfreeze();
    b.unfreeze();

    await new Promise(r => setTimeout(r, 100));

    expect(textA.toString()).toBe('red green blue');
    expect(textB.toString()).toBe('red green blue');

    a.close(); b.close(); room.destroy();
  });

  // TC-10: concurrent position sets converge
  it('TC-10: concurrent x sets converge to same value', async () => {
    const room = new TestRoom();
    const { a, b } = await createTwoClients(room);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 50));

    a.freeze();
    b.freeze();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.unfreeze();
    b.unfreeze();

    await new Promise(r => setTimeout(r, 100));

    const snapA = a.snapshot()[0];
    const snapB = b.snapshot()[0];
    expect(snapA.x).toBe(snapB.x);
    expect([100, 300]).toContain(snapA.x);

    a.close(); b.close(); room.destroy();
  });

  // TC-11: delete wins over concurrent text insert
  it('TC-11: delete wins over concurrent text insert (no resurrection)', async () => {
    const room = new TestRoom();
    const { a, b } = await createTwoClients(room);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 50));

    a.freeze();
    b.freeze();

    deleteObject(a.doc, id);
    const textB = getStickyText(b.doc, id);
    if (textB) {
      textB.insert(0, 'concurrent edit');
    }

    a.unfreeze();
    b.unfreeze();

    await new Promise(r => setTimeout(r, 100));

    expect(a.snapshot().length).toBe(0);
    expect(b.snapshot().length).toBe(0);

    a.close(); b.close(); room.destroy();
  });

  // TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops
  it('TC-12: full capacity convergence with seeded random ops', async () => {
    const room = new TestRoom();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(room.acceptConnection(`client-${i}`));
    }
    await Promise.all(clients.map(c => c.waitForSync()));

    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const words = ['hello', 'world', 'test', 'foo', 'bar'];

    for (let op = 0; op < 200; op++) {
      for (const client of clients) {
        const r = rand();
        const snap = client.snapshot();

        if (r < 0.4 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          const text = getStickyText(client.doc, note.id);
          if (text) text.insert(text.length, words[Math.floor(rand() * words.length)] + ' ');
        } else if (r < 0.7 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          moveObject(client.doc, note.id, rand() * 500, rand() * 500);
        } else if (r < 0.8) {
          createSticky(client.doc, { x: rand() * 500, y: rand() * 500 });
        } else if (r < 0.9 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          setStickyColor(client.doc, note.id, colors[Math.floor(rand() * colors.length)]);
        } else if (snap.length > 1) {
          const note = snap[Math.floor(rand() * snap.length)];
          deleteObject(client.doc, note.id);
        }
      }
    }

    await new Promise(r => setTimeout(r, 200));

    const refSnap = clients[0].snapshot();
    for (let i = 1; i < clients.length; i++) {
      expect(deepEqualSnapshots(refSnap, clients[i].snapshot())).toBe(true);
    }

    for (const c of clients) c.close();
    room.destroy();
  }, 30000);

  // TC-14: late joiner sees current board
  it('TC-14: late joiner C sees all notes from A and B', async () => {
    const room = new TestRoom();
    const a = room.acceptConnection('client-a');
    const b = room.acceptConnection('client-b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i * 30, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i * 30, y: 100 });
    await new Promise(r => setTimeout(r, 100));

    expect(a.snapshot().length).toBe(20);

    const c = room.acceptConnection('client-c');
    await c.waitForSync();
    await new Promise(r => setTimeout(r, 50));

    expect(deepEqualSnapshots(a.snapshot(), c.snapshot())).toBe(true);
    expect(c.snapshot().length).toBe(20);

    a.close(); b.close(); c.close(); room.destroy();
  });

  // TC-15: malformed traffic
  describe('TC-15: malformed traffic handling', () => {
    it('text frame → sender closed with 1003, B still open', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);

      room.sendTextToSocket(a.socket, 'hello');
      await new Promise(r => setTimeout(r, 10));

      expect(a.socket.closeCode).toBe(CLOSE_CODE);
      expect(a.socket.isClosed).toBe(true);
      expect(b.socket.isClosed).toBe(false);

      b.close(); room.destroy();
    });

    it('truncated bytes → sender closed with 1003', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      encoding.writeVarUint(encoder, 100);
      encoding.writeUint8(encoder, 1);
      room.sendRawToSocket(a.socket, encoding.toUint8Array(encoder).buffer as ArrayBuffer);
      await new Promise(r => setTimeout(r, 10));

      expect(a.socket.closeCode).toBe(CLOSE_CODE);
      expect(b.socket.isClosed).toBe(false);

      b.close(); room.destroy();
    });

    it('unknown type → sender closed with 1003', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 9);
      encoding.writeVarUint(encoder, 0);
      room.sendRawToSocket(a.socket, encoding.toUint8Array(encoder).buffer as ArrayBuffer);
      await new Promise(r => setTimeout(r, 10));

      expect(a.socket.closeCode).toBe(CLOSE_CODE);
      expect(b.socket.isClosed).toBe(false);

      b.close(); room.destroy();
    });

    it('invalid Yjs update → sender closed with 1003', async () => {
      const room = new TestRoom();
      const { a, b } = await createTwoClients(room);

      // Craft a sync message with an invalid update payload
      // Single 0xFF byte causes Yjs applyUpdate to throw
      const inner = encoding.createEncoder();
      syncProtocol.writeUpdate(inner, new Uint8Array([0xFF]));
      const innerBytes = encoding.toUint8Array(inner);

      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      encoding.writeVarUint(frame, innerBytes.length);
      encoding.writeUint8Array(frame, innerBytes);
      room.sendRawToSocket(a.socket, encoding.toUint8Array(frame).buffer as ArrayBuffer);
      await new Promise(r => setTimeout(r, 10));

      expect(a.socket.closeCode).toBe(CLOSE_CODE);
      expect(b.socket.isClosed).toBe(false);

      b.close(); room.destroy();
    });
  });

  // TC-16: awareness relay
  it('TC-16: awareness bytes relayed to all including sender', async () => {
    const room = new TestRoom();
    const { a, b } = await createTwoClients(room);

    const aAwarenessBefore = a.socket.receivedFromServer.filter(m => m.type === 1).length;
    const bAwarenessBefore = b.socket.receivedFromServer.filter(m => m.type === 1).length;

    // Send awareness from A
    const awarenessPayload = new Uint8Array([1, 2, 3, 4, 5]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // MESSAGE_AWARENESS
    encoding.writeVarUint(encoder, awarenessPayload.length);
    encoding.writeUint8Array(encoder, awarenessPayload);
    room.sendRawToSocket(a.socket, encoding.toUint8Array(encoder).buffer as ArrayBuffer);

    await new Promise(r => setTimeout(r, 20));

    const aAwarenessAfter = a.socket.receivedFromServer.filter(m => m.type === 1).length;
    const bAwarenessAfter = b.socket.receivedFromServer.filter(m => m.type === 1).length;

    expect(aAwarenessAfter).toBeGreaterThan(aAwarenessBefore);
    expect(bAwarenessAfter).toBeGreaterThan(bAwarenessBefore);

    a.close(); b.close(); room.destroy();
  });

  // TC-18: restart simulation
  it('TC-18: room restart - reconnecting client repopulates', async () => {
    // Phase 1: Create a room with some data
    const room1 = new TestRoom();
    const a1 = room1.acceptConnection('client-a');
    const b1 = room1.acceptConnection('client-b');
    await Promise.all([a1.waitForSync(), b1.waitForSync()]);

    createSticky(a1.doc, { x: 10, y: 10 });
    createSticky(b1.doc, { x: 20, y: 20 });
    await new Promise(r => setTimeout(r, 50));

    const expectedCount = a1.snapshot().length;
    expect(expectedCount).toBe(2);

    // Save A's doc state for reconnection
    const aDocState = Y.encodeStateAsUpdate(a1.doc);

    // Close all (simulates restart)
    a1.close(); b1.close();
    room1.destroy();

    // Phase 2: Fresh room - A reconnects with its existing state
    const room2 = new TestRoom();
    
    // Create A's reconnection - we need to apply the saved state to a new doc
    const a2Doc = new Y.Doc();
    Y.applyUpdate(a2Doc, aDocState);
    
    // Use acceptConnection but we need to inject the existing doc
    // For now, we'll create the connection and then apply the state
    const a2 = room2.acceptConnection('client-a');
    await a2.waitForSync();
    
    // Apply A's saved state to its doc (simulating browser restoring state)
    // This will trigger the update handler which sends to server
    Y.applyUpdate(a2.doc, aDocState);
    await new Promise(r => setTimeout(r, 50));

    // B reconnects fresh
    const b2 = room2.acceptConnection('client-b');
    await b2.waitForSync();
    await new Promise(r => setTimeout(r, 50));

    // Both should converge - B gets A's notes via the server
    expect(b2.snapshot().length).toBe(2);
    expect(deepEqualSnapshots(a2.snapshot(), b2.snapshot())).toBe(true);

    a2.close(); b2.close(); room2.destroy();
  });

  // TC-31: dead socket error path
  it('TC-31: send to dead socket does not throw, later sockets still receive', async () => {
    const room = new TestRoom();
    const a = room.acceptConnection('client-a');
    const b = room.acceptConnection('client-b');
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // Abruptly close B
    b.close();
    await new Promise(r => setTimeout(r, 10));

    // A sends an update - room should not throw
    createSticky(a.doc, { x: 50, y: 50 });
    await new Promise(r => setTimeout(r, 50));

    expect(a.snapshot().length).toBe(1);

    // New client C should still receive updates
    const c = room.acceptConnection('client-c');
    await c.waitForSync();
    await new Promise(r => setTimeout(r, 50));

    expect(c.snapshot().length).toBe(1);

    a.close(); c.close(); room.destroy();
  });
});
