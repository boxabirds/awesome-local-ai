import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

/** Insert a raw object straight into the document. */
const putRaw = (doc: Y.Doc, id: string, fields: Record<string, unknown>): void => {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'text') {
        map.set(key, new Y.Text(String(value ?? '')));
      } else {
        map.set(key, value);
      }
    }
    objectsMap(doc).set(id, map);
  });
};

/** Count the `update` events a call emits on the document. */
const withUpdateCount = <T>(doc: Y.Doc, run: () => T): { result: T; updates: number } => {
  let updates = 0;
  const observer = () => { updates += 1; };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
};

describe('board-model group: objectBounds', () => {
  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD', () => {
    const obj: ObjectSnapshot = { id: 'a', type: 'sticky', x: 10, y: 20, z: 1 };
    const bounds = objectBounds(obj);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
  });

  it('uses explicit width/height when present', () => {
    const obj: ObjectSnapshot = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 300, height: 150 };
    const bounds = objectBounds(obj);
    expect(bounds.width).toBe(300);
    expect(bounds.height).toBe(150);
  });
});

describe('board-model group: objectsInRect', () => {
  it('TC-07: A fully inside, B partly, C outside → [A]', () => {
    // A at (50, 50) size 200×200 → fully inside rect(0, 0, 1000, 1000)
    // B at (900, 900) size 200×200 → partly (bottom-right is at 1100, outside)
    // C at (1500, 1500) size 200×200 → outside
    const snapA: ObjectSnapshot = { id: 'A', type: 'sticky', x: 50, y: 50, z: 1 };
    const snapB: ObjectSnapshot = { id: 'B', type: 'sticky', x: 900, y: 900, z: 2 };
    const snapC: ObjectSnapshot = { id: 'C', type: 'sticky', x: 1500, y: 1500, z: 3 };

    const result = objectsInRect([snapA, snapB, snapC], { x: 0, y: 0, width: 1000, height: 1000 });
    expect(result).toEqual(['A']);
  });
});

describe('board-model group: allObjectIds', () => {
  it('TC-08: excludes unknown types (snapshot skips them)', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    putRaw(doc, 'unknown-1', { type: 'mystery', x: 0, y: 0, z: 5 });

    // snapshot only returns sticky notes (unknown types skipped)
    const snap = snapshot(doc);
    const ids = allObjectIds(snap);
    expect(ids).toContain(id);
    expect(ids).not.toContain('unknown-1');
  });
});

describe('board-model group: moveObjects', () => {
  it('TC-05: moves 3 ids with 1 deleted → returns 2, exactly 1 update event', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });
    // Delete b
    doc.transact(() => { objectsMap(doc).delete(b); });

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 20 }],
      [b, { x: 30, y: 40 }],
      [c, { x: 50, y: 60 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);
  });

  it('TC-09: NaN/Infinity positions → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: NaN, y: 0 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(0);
    expect(updates).toBe(0);

    const posInf = new Map<string, { x: number; y: number }>([
      [a, { x: 0, y: Infinity }],
    ]);
    const r2 = withUpdateCount(doc, () => moveObjects(doc, posInf));
    expect(r2.result).toBe(0);
    expect(r2.updates).toBe(0);
  });

  it('empty id list returns 0 with no transaction', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, new Map()));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('board-model group: resizeObjects', () => {
  it('TC-10b: first resize writes both width and height fields', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    // Before resize, no width/height fields
    const map = objectsMap(doc).get(a)!;
    expect(map.get('width')).toBeUndefined();
    expect(map.get('height')).toBeUndefined();

    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      [a, { x: 0, y: 0, width: 300, height: 300 }],
    ]);
    const result = resizeObjects(doc, rects);
    expect(result).toBe(1);

    // Now width and height are written
    const map2 = objectsMap(doc).get(a)!;
    expect(map2.get('width')).toBe(300);
    expect(map2.get('height')).toBe(300);
  });
});

describe('board-model group: bringObjectsToFront', () => {
  it('TC-06: 3 overlapping selected above 2 unselected, relative order kept', () => {
    const doc = new Y.Doc();
    // Create 5 objects: 2 unselected (z=1,2) and 3 selected (z=3,4,5)
    // But let's put selected ones at bottom so they need raising
    putRaw(doc, 'u1', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 10, createdAt: 1 });
    putRaw(doc, 'u2', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 11, createdAt: 2 });
    putRaw(doc, 's1', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 1, createdAt: 3 });
    putRaw(doc, 's2', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 2, createdAt: 4 });
    putRaw(doc, 's3', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 3, createdAt: 5 });

    const result = bringObjectsToFront(doc, ['s1', 's2', 's3']);
    expect(result).toBe(3);

    // All selected should be above unselected (z > 11)
    const s1z = numberField(objectsMap(doc).get('s1')!, 'z');
    const s2z = numberField(objectsMap(doc).get('s2')!, 'z');
    const s3z = numberField(objectsMap(doc).get('s3')!, 'z');
    expect(s1z).toBeGreaterThan(11);
    expect(s2z).toBeGreaterThan(11);
    expect(s3z).toBeGreaterThan(11);
    // Relative order preserved
    expect(s1z).toBeLessThan(s2z);
    expect(s2z).toBeLessThan(s3z);
  });

  it('returns 0 when all selected are already above unselected', () => {
    const doc = new Y.Doc();
    putRaw(doc, 'u1', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 1, createdAt: 1 });
    putRaw(doc, 's1', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 5, createdAt: 2 });

    const result = bringObjectsToFront(doc, ['s1']);
    expect(result).toBe(0);
  });
});

describe('board-model group: deleteObjects', () => {
  it('deletes multiple objects, skips missing ids', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });

    const result = deleteObjects(doc, [a, 'missing-id', b]);
    expect(result).toBe(2);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('empty id list returns 0', () => {
    const doc = new Y.Doc();
    expect(deleteObjects(doc, [])).toBe(0);
  });
});

// Helper
function numberField(map: Y.Map<unknown>, key: string, fallback = 0): number {
  const value = map.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
