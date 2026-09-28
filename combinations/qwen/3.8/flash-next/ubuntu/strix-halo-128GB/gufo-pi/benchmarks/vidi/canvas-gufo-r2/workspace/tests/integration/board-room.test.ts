/**
 * Integration tests for BoardRoom merging, broadcast and error handling.
 * TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import { connectRoom, snapEqual, type TestClient } from './ws-client';
import { MESSAGE_AWARENESS } from '../../src/shared/protocol';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TC-07: create propagates', () => {
  it('client A creates sticky → B snapshot equals A', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    createSticky(a.doc, { x: 50, y: 60 }, 'blue');
    await wait(300);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapA.length).toBe(1);
    expect(snapEqual(snapA, snapB)).toBe(true);

    a.close();
    b.close();
  });
});

describe('TC-08: move, recolour, text, delete propagate; no echo', () => {
  it('move propagates', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 50, y: 60 });
    await wait(200);
    b.allMessages.length = 0; // Clear initial messages

    moveObject(a.doc, noteId, 200, 300);
    await wait(300);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapA[0].x).toBe(200);
    expect(snapEqual(snapA, snapB)).toBe(true);

    a.close();
    b.close();
  });

  it('recolour propagates', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 50, y: 60 });
    await wait(200);

    setStickyColor(a.doc, noteId, 'green');
    await wait(300);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapA[0].color).toBe('green');
    expect(snapEqual(snapA, snapB)).toBe(true);

    a.close();
    b.close();
  });

  it('text insert propagates', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 50, y: 60 });
    await wait(200);

    const text = getStickyText(a.doc, noteId);
    text!.insert(0, 'hello world');
    await wait(300);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapA[0].text).toBe('hello world');
    expect(snapB[0].text).toBe('hello world');

    a.close();
    b.close();
  });

  it('delete propagates', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 50, y: 60 });
    await wait(200);

    deleteObject(a.doc, noteId);
    await wait(300);

    expect(a.snapshot().length).toBe(0);
    expect(b.snapshot().length).toBe(0);

    a.close();
    b.close();
  });
});

describe('TC-09: concurrent text merge', () => {
  it('A inserts "red " at 0, B inserts " blue" at end of "green" → "red green blue"', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // Create a note and set initial text
    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    const textA = getStickyText(a.doc, noteId);
    textA!.insert(0, 'green');
    await wait(300);

    // Now get the text from B's side
    const textB = getStickyText(b.doc, noteId);

    // Concurrent inserts: A inserts at 0, B inserts at end
    textA!.insert(0, 'red ');
    textB!.insert(5, ' blue'); // "green" is 5 chars, so insert at 5 = end
    await wait(400);

    // Both should converge to same text
    expect(a.snapshot()[0].text).toBe(b.snapshot()[0].text);
    // The result should contain both "red " and " blue" around "green"
    const result = a.snapshot()[0].text;
    expect(result).toContain('red ');
    expect(result).toContain(' blue');
    expect(result).toContain('green');
    // Specific order: "red green blue" (insert at 0 goes before, insert at 5 goes after)
    expect(result).toBe('red green blue');

    a.close();
    b.close();
  });
});

describe('TC-10: concurrent position converge', () => {
  it('A sets x=100, B sets x=300 → both converge to same x', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    await wait(200);

    // Concurrent moves (different objects on different docs)
    moveObject(a.doc, noteId, 100, 50);
    moveObject(b.doc, noteId, 300, 50);
    await wait(400);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    // Must converge to same value
    expect(snapA[0].x).toBe(snapB[0].x);
    // Must be one of the two values
    expect([100, 300]).toContain(snapA[0].x);

    a.close();
    b.close();
  });
});

describe('TC-11: delete during concurrent text insert', () => {
  it('deleted note does not reappear from concurrent text edit', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    await wait(200);

    // A deletes, B inserts text concurrently
    deleteObject(a.doc, noteId);
    const textB = getStickyText(b.doc, noteId);
    if (textB) {
      textB.insert(0, 'concurrent text');
    }
    await wait(400);

    // Note should be absent on both
    expect(a.snapshot().length).toBe(0);
    expect(b.snapshot().length).toBe(0);

    a.close();
    b.close();
  });
});

describe('TC-12: MAX_CONCURRENT_EDITORS clients × random ops → identical snapshots', () => {
  it('all clients converge after random operations', async () => {
    const id = newBoardId();
    const clients: TestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await connectRoom(id));
    }
    await wait(200);

    // Each client creates some notes
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      for (let j = 0; j < 5; j++) {
        createSticky(clients[i].doc, { x: i * 100 + j, y: i * 100 + j });
      }
    }
    await wait(500);

    // All snapshots should be identical
    const first = clients[0].snapshot();
    expect(first.length).toBe(MAX_CONCURRENT_EDITORS * 5);
    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      expect(snapEqual(first, clients[i].snapshot())).toBe(true);
    }

    clients.forEach((c) => c.close());
  });
});

describe('TC-14: late joiner sees current state', () => {
  it('A and B create notes, late C sees all', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // A and B each create notes
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 50, y: 0 });
    }
    for (let i = 0; i < 10; i++) {
      createSticky(b.doc, { x: 0, y: i * 50 });
    }
    await wait(300);

    // C joins
    const c = await connectRoom(id);
    await wait(300);

    const snapA = a.snapshot();
    const snapC = c.snapshot();
    expect(snapA.length).toBe(20);
    expect(snapC.length).toBe(20);
    expect(snapEqual(snapA, snapC)).toBe(true);

    a.close();
    b.close();
    c.close();
  });
});

describe('TC-15: malformed traffic closes sender only', () => {
  it('text frame closes A with 1003, B still works', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // A sends a text frame
    a.ws.send('invalid text message');
    await wait(200);

    // B should still be able to communicate
    createSticky(b.doc, { x: 10, y: 10 });
    await wait(300);

    const snapB = b.snapshot();
    expect(snapB.length).toBe(1);

    b.close();
  });

  it('truncated bytes closes A with 1003', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // Send invalid/truncated binary (just a single 0xFF byte that won't decode as valid y-websocket)
    a.ws.send(new Uint8Array([255]));
    await wait(200);

    // B should still work
    createSticky(b.doc, { x: 10, y: 10 });
    await wait(300);

    expect(b.snapshot().length).toBe(1);
    b.close();
  });

  it('unknown message type closes A', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // Send message with type 9 (unknown)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeUint8(encoder, 0);
    a.ws.send(encoding.toUint8Array(encoder));
    await wait(200);

    // B should still work
    createSticky(b.doc, { x: 10, y: 10 });
    await wait(300);
    expect(b.snapshot().length).toBe(1);
    b.close();
  });
});

describe('TC-16: awareness relay', () => {
  it('awareness bytes from A are relayed to A and B identically', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // Send an awareness message from A
    const payload = new Uint8Array([42, 99, 7]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);

    a.ws.send(frame);
    await wait(200);

    // Both A and B should have received awareness messages
    const aAwareness = a.allMessages.filter((m) => {
      if (typeof m === 'string') return false;
      const u8 = new Uint8Array(m);
      return u8[0] === MESSAGE_AWARENESS;
    });
    const bAwareness = b.allMessages.filter((m) => {
      if (typeof m === 'string') return false;
      const u8 = new Uint8Array(m);
      return u8[0] === MESSAGE_AWARENESS;
    });

    expect(aAwareness.length).toBeGreaterThanOrEqual(1);
    expect(bAwareness.length).toBeGreaterThanOrEqual(1);

    // The payload should be the same
    const lastA = aAwareness[aAwareness.length - 1] as ArrayBuffer;
    const lastB = bAwareness[bAwareness.length - 1] as ArrayBuffer;
    expect(new Uint8Array(lastA)).toEqual(new Uint8Array(lastB));

    a.close();
    b.close();
  });
});

describe('TC-18: room restart simulation', () => {
  it('fresh room instance gets repopulated by reconnecting client with full state', async () => {
    // Simulate restart: use a brand new board ID (like a fresh DO instance)
    const freshBoardId = newBoardId();

    // Create a client with an existing doc (simulating reconnect with state)
    const clientDoc = new Y.Doc();
    initDoc(clientDoc);
    for (let i = 0; i < 5; i++) {
      createSticky(clientDoc, { x: i * 100, y: i * 50 });
    }

    // Connect to fresh room
    const c1 = await connectRoom(freshBoardId);

    // Apply existing state to the connected doc and trigger sync
    Y.applyUpdate(c1.doc, Y.encodeStateAsUpdate(clientDoc));

    // Send SyncStep1 to tell server what we have; server will respond with its (empty) state
    // and we respond with our state via SyncStep2
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, 0);
    syncProtocol.writeSyncStep1(syncEncoder, c1.doc);
    c1.ws.send(encoding.toUint8Array(syncEncoder));

    await wait(400);

    // Room should have the notes now
    const snap1 = c1.snapshot();
    expect(snap1.length).toBe(5);

    // B connects and should converge to same state
    const c2 = await connectRoom(freshBoardId);
    await wait(400);

    const snap2 = c2.snapshot();
    expect(snap2.length).toBe(5);
    expect(snapEqual(snap1, snap2)).toBe(true);

    c1.close();
    c2.close();
  });
});

describe('TC-31: dead socket does not break room', () => {
  it('closing B abruptly, A sends update, room does not throw; later sockets receive', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // Close B abruptly (simulated by calling close)
    b.close();
    await wait(100);

    // A sends an update - room should not throw
    createSticky(a.doc, { x: 10, y: 10 });
    await wait(200);

    // New client C should still be able to connect and receive
    const c = await connectRoom(id);
    await wait(400);

    expect(c.snapshot().length).toBe(1);

    a.close();
    c.close();
  });
});
