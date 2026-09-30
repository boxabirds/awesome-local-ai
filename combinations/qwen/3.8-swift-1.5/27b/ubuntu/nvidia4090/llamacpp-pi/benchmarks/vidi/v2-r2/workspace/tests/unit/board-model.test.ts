import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Runs fn with the Y.Doc `update` event counted. 1 on success, 0 on rejection. */
function withUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: T;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

describe('board.model: initDoc', () => {
  it('sets meta.schemaVersion once (idempotent)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});

describe('board.model: create (TC-01, TC-02, TC-39)', () => {
  it('TC-01: create on empty doc → 1 object, sticky, default colour, empty text, z 1, centred; 1 update', () => {
    const doc = makeDoc();
    const { result: id, updates } = withUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(typeof id).toBe('string');

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // creation is centred: top-left = point − STICKY_SIZE_WORLD/2
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-02: create with existing z 1,2 → new z 3; 1 update', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 50, y: 50 });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();

    const { result: c, updates } = withUpdates(doc, () => createSticky(doc, { x: 90, y: 90 }));
    expect(updates).toBe(1);
    const noteC = snapshot(doc).find((n) => n.id === c);
    expect(noteC).toBeDefined();
    expect(noteC!.z).toBe(3);
  });

  it('TC-39: createSticky with NaN / Infinity coordinates → false, 0 updates', () => {
    const doc = makeDoc();
    for (const bad of [
      { x: NaN, y: 0 },
      { x: 0, y: NaN },
      { x: Infinity, y: 0 },
      { x: 0, y: -Infinity },
    ]) {
      const { result, updates } = withUpdates(doc, () => createSticky(doc, bad));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model: move (TC-03, TC-04, TC-39)', () => {
  it('TC-03: moveObject updates x,y; other fields unchanged; 1 update', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = snapshot(doc)[0];

    const { result, updates } = withUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04: moveObject on a stale id → false, 0 updates (negative)', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdates(doc, () => moveObject(doc, 'does-not-exist', 1, 2));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-39: moveObject with NaN / Infinity coordinates → false, 0 updates (negative)', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    for (const [x, y] of [
      [NaN, 0],
      [0, NaN],
      [Infinity, 0],
      [0, -Infinity],
    ] as const) {
      const { result, updates } = withUpdates(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    const note = snapshot(doc)[0];
    // createSticky centres on (0,0): top-left is at -STICKY_SIZE_WORLD/2
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
  });
});

describe('board.model: colour (TC-05, TC-06)', () => {
  it('TC-05: setStickyColor green → applied; text, x, y, z unchanged; 1 update', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 3, y: 4 }) as string;
    const before = snapshot(doc)[0];

    const { result, updates } = withUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06: setStickyColor with unknown colour → false, unchanged, 0 updates (negative)', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const { result, updates } = withUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });
});

describe('board.model: delete (TC-07, TC-08)', () => {
  it('TC-07: deleteObject removes the note; 1 update', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(snapshot(doc)).toHaveLength(1);

    const { result, updates } = withUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: deleteObject on a stale id → false, 0 updates (negative)', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdates(doc, () => deleteObject(doc, 'does-not-exist'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model: stacking (TC-09, TC-10, TC-11)', () => {
  it('TC-09: bringToFront on z 1 of 3 → z 4; 1 update', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 10, y: 10 });
    createSticky(doc, { x: 20, y: 20 });
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(1);

    const { result, updates } = withUpdates(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  it('TC-10: bringToFront on the topmost note → false, 0 updates (negative)', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 10, y: 10 }) as string;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // b is topmost (z 2)
    const { result, updates } = withUpdates(doc, () => bringToFront(doc, b));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11: equal z → snapshot ordered by id tie-break, stable across calls', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 10, y: 10 }) as string;
    // force equal z values (possible once story 3 syncs concurrent creates)
    doc.transact(() => {
      objects(doc).get(a)!.set('z', 5);
      objects(doc).get(b)!.set('z', 5);
    });

    const s1 = snapshot(doc);
    const s2 = snapshot(doc);
    expect(s1).toHaveLength(2);
    // ordered by id as tie-break
    expect(s1[0].id < s1[1].id).toBe(true);
    // stable across calls
    expect(s1.map((n) => n.id)).toEqual(s2.map((n) => n.id));
  });
});

describe('board.model: snapshot (TC-12)', () => {
  it('TC-12: unknown object type in doc → skipped by snapshot, no throw', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 1);
      shape.set('y', 2);
      shape.set('z', 99);
      objects(doc).set('shape-1', shape);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(a);
  });
});

describe('board.model: getStickyText', () => {
  it('returns the Y.Text of a note and undefined for a stale id', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(doc, 'does-not-exist')).toBeUndefined();
  });
});
