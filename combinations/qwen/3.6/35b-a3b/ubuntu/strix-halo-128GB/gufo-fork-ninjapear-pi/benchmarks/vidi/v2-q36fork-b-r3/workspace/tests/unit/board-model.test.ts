
import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  snapshot,
} from '@shared/board-model';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
} from '@shared/config';

// ─── Helpers ──────────────────────────────────────────────────────────────

function trackUpdates(doc: Y.Doc) {
  let count = 0;
  const unsub = (doc.on('update', () => {
    count++;
  }) as unknown) as () => void;
  return {
    get count() {
      return count;
    },
    cleanup() {
      unsub();
    },
  };
}

function makeDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// ─── TC-01: create on empty doc ──────────────────────────────────────────

describe('TC-01: createSticky on empty doc', () => {
  it('creates one sticky with default colour and z=1', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();

    const snaps = snapshot(doc);
    expect(snaps.length).toBe(1);

    const s = snaps[0];
    expect(s.type).toBe('sticky');
    expect(s.color).toBe(DEFAULT_STICKY_COLOR);
    expect(s.text).toBe('');
    expect(s.z).toBe(1);
    // Top-left centred at (0,0) → top-left is (-STICKY_SIZE/2, -STICKY_SIZE/2)
    expect(s.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(s.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);

    expect(tracker.count).toBe(1);
    tracker.cleanup();
  });

  it('centres note on click point', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 400, y: 300 });
    const snaps = snapshot(doc);
    expect(snaps[0].x).toBeCloseTo(400 - STICKY_SIZE_WORLD / 2, 6);
    expect(snaps[0].y).toBeCloseTo(300 - STICKY_SIZE_WORLD / 2, 6);
  });
});

// ─── TC-02: create with existing notes → z increments ────────────────────

describe('TC-02: createSticky increments z', () => {
  it('after two notes with z=1,z=2 the third has z=3', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const id3 = createSticky(doc, { x: 0, y: 0 });
    const snaps = snapshot(doc);
    const note3 = snaps.find((s) => s.id === id3);
    expect(note3?.z).toBe(3);
  });
});

// ─── TC-03: moveObject updates x,y ───────────────────────────────────────

describe('TC-03: moveObject', () => {
  it('updates x,y and leaves other fields unchanged', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const beforeSnap = snapshot(doc)[0];

    moveObject(doc, id, 10, -20);

    const snaps = snapshot(doc);
    const s = snaps[0];
    expect(s.x).toBe(10);
    expect(s.y).toBe(-20);
    expect(s.color).toBe(beforeSnap.color);
    expect(s.z).toBe(beforeSnap.z);
    expect(s.text).toBe(beforeSnap.text);
  });
});

// ─── TC-04: moveObject stale id → false, no update ──────────────────────

describe('TC-04: moveObject on stale id', () => {
  it('returns false and emits 0 updates', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const result = moveObject(doc, 'nonexistent-id', 1, 2);
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });
});

// ─── TC-05: setStickyColor green ─────────────────────────────────────────

describe('TC-05: setStickyColor applies change', () => {
  it('changes color to green, text/x/y/z unchanged', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];

    const result = setStickyColor(doc, id, 'green');
    expect(result).toBe(true);

    const s = snapshot(doc)[0];
    expect(s.color).toBe('green');
    expect(s.text).toBe(before.text);
    expect(s.x).toBe(before.x);
    expect(s.y).toBe(before.y);
    expect(s.z).toBe(before.z);
  });
});

// ─── TC-06: setStickyColor unknown colour → rejected ────────────────────

describe('TC-06: setStickyColor with unknown colour', () => {
  it('returns false, colour stays yellow, 0 updates', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const tracker = trackUpdates(doc);

    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);

    const s = snapshot(doc)[0];
    expect(s.color).toBe(DEFAULT_STICKY_COLOR);
    tracker.cleanup();
  });
});

// ─── TC-07: deleteObject ─────────────────────────────────────────────────

describe('TC-07: deleteObject', () => {
  it('removes the note from the document', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).length).toBe(1);

    const id = snapshot(doc)[0].id;
    deleteObject(doc, id);
    expect(snapshot(doc).length).toBe(0);
  });
});

// ─── TC-08: deleteObject stale id ────────────────────────────────────────

describe('TC-08: deleteObject on stale id', () => {
  it('returns false and 0 updates', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const result = deleteObject(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });
});

// ─── TC-09: bringToFront z increments ────────────────────────────────────

describe('TC-09: bringToFront z increment', () => {
  it('brings z=1 of 3 notes to z=4', () => {
    const doc = makeDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);
    expect(before[0].id).toBe(id1); // z=1 note is first

    bringToFront(doc, id1);

    const snaps = snapshot(doc);
    const moved = snaps.find((s) => s.id === id1);
    expect(moved?.z).toBe(4); // maxZ(3)+1
  });
});

// ─── TC-10: bringToFront on topmost → no update ──────────────────────────

describe('TC-10: bringToFront on topmost note', () => {
  it('returns false and emits no updates', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const topId = snapshot(doc)[1].id; // the second/last note (z=2)
    const tracker = trackUpdates(doc);

    const result = bringToFront(doc, topId);
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });
});

// ─── TC-11: equal z → sorted by id tie-break ─────────────────────────────

describe('TC-11: snapshot sort order with equal z', () => {
  it('two notes with same z ordered by id, stable across calls', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    // Both have different z values because they were created sequentially.
    // Manually set them to same z via direct manipulation to test tie-breaking:
    const objects = (doc as any).getMap('objects');
    const dataMapA = objects.get(a);
    const dataMapB = objects.get(b);
    dataMapA.set('z', 5);
    dataMapB.set('z', 5);

    const snap1 = snapshot(doc);
    const snap2 = snapshot(doc);
    expect(snap1.map((s) => s.id)).toEqual(snap2.map((s) => s.id));
    expect(snap1[0].id < snap1[1].id).toBe(true); // alphabetical id tie-break
  });
});

// ─── TC-12: unknown type skipped ─────────────────────────────────────────

describe('TC-12: unknown object type in doc', () => {
  it('skipped by snapshot without throw', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    // Inject an unknown-type object directly
    const objects = (doc as any).getMap('objects');
    const fakeMap = new Y.Map();
    (fakeMap as any).set('type', 'shape');
    (fakeMap as any).set('x', 0);
    (fakeMap as any).set('y', 0);
    (fakeMap as any).set('color', 'yellow');
    (fakeMap as any).set('text', new Y.Text());
    (fakeMap as any).set('z', 1);
    (fakeMap as any).set('createdAt', Date.now());
    (objects as any).set('fake-shape-id', fakeMap);

    const snaps = snapshot(doc);
    expect(snaps.length).toBe(1);
    expect(snaps[0].id !== 'fake-shape-id').toBe(true);
  });
});

// ─── TC-39: non-finite coordinates rejected ──────────────────────────────

describe('TC-39: non-finite coordinates', () => {
  it('moveObject with NaN coords returns false', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, -Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, 0, NaN)).toBe(false);
  });

  it('createSticky with NaN coords returns empty string and 0 updates', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const id = createSticky(doc, { x: NaN, y: 0 });
    expect(id).toBe('');
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });
});

// ─── Extra: initDoc sets schemaVersion once ───────────────────────────────

describe('initDoc', () => {
  it('sets meta.schemaVersion to 1 if absent', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const sv = doc.getMap('meta').get('schemaVersion');
    expect(sv).toBe(1);
  });

  it('does not overwrite existing schemaVersion', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 99);
    });
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(99);
  });
});
