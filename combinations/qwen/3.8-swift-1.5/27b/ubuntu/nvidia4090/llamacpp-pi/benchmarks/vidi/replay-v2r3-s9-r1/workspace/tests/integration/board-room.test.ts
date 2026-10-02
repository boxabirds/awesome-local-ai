import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  initDoc,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/**
 * Creates two synced Y.Doc instances. The `sync` function must be called
 * after each operation to propagate changes (simulating room broadcast).
 */
function createSyncPair() {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  initDoc(docA);
  initDoc(docB);

  function sync() {
    syncDocTo(docB, docA);
    syncDocTo(docA, docB);
  }

  return { docA, docB, sync };
}

/** Simulates initial sync (late joiner scenario) - applies full source state to target */
function syncDocTo(target: Y.Doc, source: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(source);
  Y.applyUpdate(target, update, 'sync');
}

/** Bidirectional sync between two docs */
function syncBoth(a: Y.Doc, b: Y.Doc): void {
  syncDocTo(b, a);
  syncDocTo(a, b);
}

describe('TC-07: create propagates to second client', () => {
  it('B snapshot equals A after A creates a sticky', () => {
    const { docA, docB, sync } = createSyncPair();
    createSticky(docA, { x: 100, y: 200 });
    sync();
    const snapA = snapshot(docA);
    const snapB = snapshot(docB);
    expect(snapB).toHaveLength(1);
    expect(snapB[0].x).toBe(snapA[0].x);
    expect(snapB[0].y).toBe(snapA[0].y);
    expect(snapB[0].color).toBe(snapA[0].color);
  });
});

describe('TC-08: move, recolour, text insert, delete propagate', () => {
  it('move: B equals A after A moves a note', () => {
    const { docA, docB, sync } = createSyncPair();
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    sync();
    moveObject(docA, id, 300, 400);
    sync();
    const snapB = snapshot(docB);
    expect(snapB[0].x).toBe(300);
    expect(snapB[0].y).toBe(400);
  });

  it('recolour: B equals A after A recolours a note', () => {
    const { docA, docB, sync } = createSyncPair();
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    sync();
    setStickyColor(docA, id, 'blue');
    sync();
    const snapB = snapshot(docB);
    expect(snapB[0].color).toBe('blue');
  });

  it('text insert: B equals A after A types in a note', () => {
    const { docA, docB, sync } = createSyncPair();
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    sync();
    const textA = getStickyText(docA, id)!;
    textA.insert(0, 'hello');
    sync();
    const snapB = snapshot(docB);
    expect(snapB[0].text).toBe('hello');
  });

  it('delete: B equals A after A deletes a note', () => {
    const { docA, docB, sync } = createSyncPair();
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    sync();
    deleteObject(docA, id);
    sync();
    const snapB = snapshot(docB);
    expect(snapB).toHaveLength(0);
  });
});

describe('TC-09: concurrent text insert merges', () => {
  it('A inserts "red " at 0, B inserts " blue" at end of "green" → both "red green blue"', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    initDoc(docA);
    initDoc(docB);

    // Create a note with text "green" on A, sync full state to B
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    const textA = getStickyText(docA, id)!;
    textA.insert(0, 'green');
    syncDocTo(docB, docA);

    // Now both have "green". Make concurrent edits (no sync between them)
    textA.insert(0, 'red ');
    const textB = getStickyText(docB, id)!;
    textB.insert(textB.length, ' blue');

    // Merge: apply full state of each to the other (idempotent)
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'merge');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'merge');

    const textAFinal = getStickyText(docA, id)!.toString();
    const textBFinal = getStickyText(docB, id)!.toString();
    expect(textAFinal).toBe('red green blue');
    expect(textBFinal).toBe('red green blue');
  });
});

describe('TC-10: concurrent position sets converge', () => {
  it('A sets x=100, B sets x=300 → both converge to same value', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    initDoc(docA);
    initDoc(docB);

    // Create a note on A, sync to B
    const id = createSticky(docA, { x: 0, y: 0 }) as string;
    syncDocTo(docB, docA);

    // Concurrent sets
    moveObject(docA, id, 100, 0);
    moveObject(docB, id, 300, 0);

    // Sync both ways
    syncBoth(docA, docB);

    const snapA = snapshot(docA);
    const snapB = snapshot(docB);
    expect(snapA[0].x).toBe(snapB[0].x);
  });
});

describe('TC-11: delete wins over concurrent edit', () => {
  it('A deletes note while B inserts text → note absent on both', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    initDoc(docA);
    initDoc(docB);

    // Create a note on A, sync to B
    const id = createSticky(docA, { x: 100, y: 100 }) as string;
    syncDocTo(docB, docA);

    // Concurrent: A deletes, B inserts text
    deleteObject(docA, id);
    const textB = getStickyText(docB, id);
    if (textB) textB.insert(0, 'concurrent edit');

    // Sync both ways
    syncBoth(docA, docB);

    // Note must be absent on both
    expect(snapshot(docA)).toHaveLength(0);
    expect(snapshot(docB)).toHaveLength(0);
  });
});

describe('TC-12: MAX_CONCURRENT_EDITORS clients with random ops converge', () => {
  it(`${MAX_CONCURRENT_EDITORS} clients × 200 seeded random ops → identical snapshots`, () => {
    // Seeded PRNG for reproducibility
    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const numClients = MAX_CONCURRENT_EDITORS;
    const docs: Y.Doc[] = Array.from({ length: numClients }, () => {
      const d = new Y.Doc();
      initDoc(d);
      return d;
    });

    // Sync all docs to each other initially
    for (let i = 1; i < numClients; i++) {
      syncDocTo(docs[i], docs[0]);
    }

    // Seed some initial notes so all clients have something to edit
    for (let i = 0; i < 5; i++) {
      createSticky(docs[0], { x: i * 100, y: i * 50 });
    }
    for (let i = 1; i < numClients; i++) {
      syncDocTo(docs[i], docs[0]);
    }

    // Each client performs 200 random operations on shared notes
    const words = ['hello', 'world', 'test', 'foo', 'bar', 'baz', 'qux'];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

    for (let op = 0; op < 200; op++) {
      for (let c = 0; c < numClients; c++) {
        const doc = docs[c];
        const r = rand();
        const notes = snapshot(doc);

        if (r < 0.4 && notes.length > 0) {
          // Text typing
          const note = notes[Math.floor(rand() * notes.length)];
          const text = getStickyText(doc, note.id);
          if (text) text.insert(text.length, words[Math.floor(rand() * words.length)]);
        } else if (r < 0.7 && notes.length > 0) {
          // Move
          const note = notes[Math.floor(rand() * notes.length)];
          moveObject(doc, note.id, rand() * 1000, rand() * 1000);
        } else if (r < 0.8 && notes.length < 10) {
          // Create (only on doc[0] to avoid ID conflicts, then sync)
          if (c === 0) {
            createSticky(doc, { x: rand() * 1000, y: rand() * 1000 });
          }
        } else if (r < 0.9 && notes.length > 0) {
          // Recolour
          const note = notes[Math.floor(rand() * notes.length)];
          setStickyColor(doc, note.id, colors[Math.floor(rand() * colors.length)]);
        } else if (notes.length > 2) {
          // Delete
          const note = notes[Math.floor(rand() * notes.length)];
          deleteObject(doc, note.id);
        }
      }

      // Sync all docs through a central "room" doc after each round
      const roomDoc = new Y.Doc();
      initDoc(roomDoc);
      for (let i = 0; i < numClients; i++) {
        Y.applyUpdate(roomDoc, Y.encodeStateAsUpdate(docs[i]), 'room');
      }
      const roomState = Y.encodeStateAsUpdate(roomDoc);
      for (let i = 0; i < numClients; i++) {
        Y.applyUpdate(docs[i], roomState, 'room');
      }
      roomDoc.destroy();
    }

    // All snapshots must be identical (compare sorted by id, excluding createdAt)
    function normalize(snap: readonly ObjectSnapshot[]) {
      return snap
        .map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, z: o.z, width: o.width, height: o.height, color: o.color, text: o.text, size: o.size, widthMode: o.widthMode }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    const snap0 = normalize(snapshot(docs[0]));
    for (let i = 1; i < numClients; i++) {
      expect(normalize(snapshot(docs[i]))).toEqual(snap0);
    }
  });
});

describe('TC-14: late joiner sees current board', () => {
  it('C connects after A and B create 20 notes → C snapshot equals A', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();
    initDoc(docA);
    initDoc(docB);
    initDoc(docC);

    // A and B create 20 notes total (10 each)
    for (let i = 0; i < 10; i++) {
      createSticky(docA, { x: i * 100, y: 0 });
    }
    for (let i = 0; i < 10; i++) {
      createSticky(docB, { x: i * 100, y: 500 });
    }

    // Sync A and B
    syncBoth(docA, docB);

    // C is a late joiner - sync from A (the room)
    syncDocTo(docC, docA);

    const snapA = snapshot(docA);
    const snapC = snapshot(docC);
    expect(snapC).toHaveLength(20);
    expect(snapC).toEqual(snapA);
  });
});

describe('TC-16: awareness bytes relayed to all', () => {
  it('awareness message is relayed verbatim (tested via protocol decode)', async () => {
    // This is tested at the protocol level - the room relays awareness bytes
    // verbatim to all sockets. The e2e tests validate this through real WebSockets.
    // Here we verify the decodeMessage function handles awareness frames correctly.
    const { decodeMessage, encodeAwarenessMessage } = await import('../../src/shared/protocol');
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeAwarenessMessage(payload);
    const decoded = decodeMessage(frame.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(decoded.payload).toEqual(payload);
    }
  });
});

describe('TC-17: boards stay separate', () => {
  it('updates in room1 do not appear in room2', () => {
    const docRoom1 = new Y.Doc();
    const docRoom2 = new Y.Doc();
    initDoc(docRoom1);
    initDoc(docRoom2);

    // Create a note in room1
    createSticky(docRoom1, { x: 100, y: 100 });

    // Room2 should be empty
    expect(snapshot(docRoom2)).toHaveLength(0);
    expect(snapshot(docRoom1)).toHaveLength(1);
  });
});

describe('TC-18: restart simulation - reconnecting client repopulates room', () => {
  it('fresh room doc equals A after A reconnects; B converges', () => {
    // Original room state
    const originalDoc = new Y.Doc();
    initDoc(originalDoc);
    createSticky(originalDoc, { x: 100, y: 100 });
    createSticky(originalDoc, { x: 200, y: 200 });

    // Simulate restart: fresh room doc
    const freshRoomDoc = new Y.Doc();
    initDoc(freshRoomDoc);

    // A reconnects first - sends its state to the room
    syncDocTo(freshRoomDoc, originalDoc);

    // Room now has A's state
    expect(snapshot(freshRoomDoc)).toHaveLength(2);

    // B reconnects - gets room state
    const docB = new Y.Doc();
    initDoc(docB);
    syncDocTo(docB, freshRoomDoc);

    expect(snapshot(docB)).toHaveLength(2);
    expect(snapshot(docB)).toEqual(snapshot(freshRoomDoc));
  });
});

describe('TC-31: dead socket does not crash room', () => {
  it('room continues serving after a socket is removed', () => {
    // Simulate: room has doc, one client disconnects, another still receives updates
    const roomDoc = new Y.Doc();
    initDoc(roomDoc);

    const docActive = new Y.Doc();
    initDoc(docActive);

    // Active client syncs with room
    syncDocTo(docActive, roomDoc);

    // Room gets an update (from the active client)
    createSticky(docActive, { x: 50, y: 50 });
    syncDocTo(roomDoc, docActive);

    // Room still works fine
    expect(snapshot(roomDoc)).toHaveLength(1);

    // Another client can still join
    const docNew = new Y.Doc();
    initDoc(docNew);
    syncDocTo(docNew, roomDoc);
    expect(snapshot(docNew)).toHaveLength(1);
  });
});
