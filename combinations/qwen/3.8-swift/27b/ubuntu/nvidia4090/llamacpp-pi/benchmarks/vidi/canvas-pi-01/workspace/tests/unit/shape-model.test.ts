// shape.model unit tests (story 10, TC-01 to TC-06) against a real Y.Doc.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_FILL_COLORS,
} from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnap,
} from '../../src/shared/objects/shape';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The shape snapshot with its typed fields, by id. */
function shapeById(doc: Y.Doc, id: string): ShapeSnap {
  const found = snapshot(doc).find((o) => o.id === id);
  expect(found, `shape ${id} missing from snapshot`).toBeDefined();
  return found as ShapeSnap;
}

/** Number of doc transactions that happen while `fn` runs. */
function withDocTransactions(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('afterTransaction', listener);
  try {
    fn();
  } finally {
    doc.off('afterTransaction', listener);
  }
  return count;
}

describe('shape.model', () => {
  it('TC-01 createShape rect 200x120 → 1 object, exact size, default style, empty label, z above existing, createdBy set', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = withDocTransactions(doc, () => {
      const id = createShape(
        doc,
        {
          kind: 'rect',
          rect: { x: 100, y: 100, width: 200, height: 120 },
          at: { x: 200, y: 160 },
        },
        'g_test',
      );
      expect(id).not.toBeNull();

      const snap = shapeById(doc, id!);
      expect(snap.type).toBe('shape');
      expect(snap.x).toBe(100);
      expect(snap.y).toBe(100);
      expect(snap.width).toBe(200);
      expect(snap.height).toBe(120);
      expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(snap.label).toBe('');
      expect(snap.kind).toBe('rect');

      // z above every existing object; createdBy stored.
      const sticky = snapshot(doc).find((o) => o.type === 'sticky')!;
      expect(snap.z).toBe(sticky.z + 1);
      const object = objects(doc).get(id!);
      expect(object?.get('createdBy')).toBe('g_test');

      // The label is a real Y.Text.
      const label = getShapeLabel(doc, id!);
      expect(label).toBeInstanceOf(Y.Text);
      expect(label?.toString()).toBe('');
    });
    expect(updates).toBe(1);
  });

  it('TC-02 rect 19x200 and rect null → default-size square centred at `at` (click behaviour)', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      {
        kind: 'ellipse',
        rect: { x: 0, y: 0, width: 19, height: 200 },
        at: { x: 40, y: 50 },
      },
      'g_test',
    );
    expect(id).not.toBeNull();
    let snap = shapeById(doc, id!);
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(40 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    const id2 = createShape(
      doc,
      { kind: 'diamond', rect: null, at: { x: -10, y: 30 } },
      'g_test',
    );
    expect(id2).not.toBeNull();
    snap = shapeById(doc, id2!);
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(-10 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(30 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: {
          x: 5,
          y: 5,
          width: SHAPE_MIN_SIZE_WORLD,
          height: SHAPE_MIN_SIZE_WORLD,
        },
        at: { x: 15, y: 15 },
      },
      'g_test',
    );
    expect(id).not.toBeNull();
    const snap = shapeById(doc, id!);
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.x).toBe(5);
    expect(snap.y).toBe(5);
  });

  it('TC-04 square: true on a 200x120 drag → 200x200 anchored at the drag origin', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: { x: 200, y: 160 },
        square: true,
      },
      'g_test',
    );
    expect(id).not.toBeNull();
    const snap = shapeById(doc, id!);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
  });

  it('TC-05 setShapeStyle fill blue → applied with one update and label/size unchanged; fill teal → false, zero updates (negative)', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 50, y: 40 } },
      'g_test',
    )!;

    let updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    });
    expect(updates).toBe(1);
    let snap = shapeById(doc, id);
    expect(snap.fill).toBe('blue');
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('');
    expect(snap.width).toBe(100);
    expect(snap.height).toBe(80);

    updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    });
    expect(updates).toBe(0);
    snap = shapeById(doc, id);
    expect(snap.fill).toBe('blue');

    // Stale id → false, zero updates.
    updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, 'nope', { fill: 'blue' })).toBe(false);
    });
    expect(updates).toBe(0);

    // Unknown stroke key → false, zero updates.
    updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, id, { stroke: 'purple' })).toBe(false);
    });
    expect(updates).toBe(0);

    // A valid stroke-only change touches only the stroke key.
    updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    });
    expect(updates).toBe(1);
    snap = shapeById(doc, id);
    expect(snap.stroke).toBe('red');
    expect(snap.fill).toBe('blue');

    // Both keys in one call is one update.
    updates = withDocTransactions(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'green', stroke: 'orange' })).toBe(true);
    });
    expect(updates).toBe(1);
    expect(Object.keys(SHAPE_FILL_COLORS).length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(SHAPE_STROKE_COLORS).length).toBeGreaterThanOrEqual(6);
  });

  it('TC-06 unknown kind and non-finite rect → null, zero updates (error paths)', () => {
    const doc = freshDoc();
    let updates = withDocTransactions(doc, () => {
      const id = createShape(
        doc,
        {
          kind: 'triangle' as never,
          rect: { x: 0, y: 0, width: 100, height: 100 },
          at: { x: 50, y: 50 },
        },
        'g_test',
      );
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);

    updates = withDocTransactions(doc, () => {
      const id = createShape(
        doc,
        {
          kind: 'rect',
          rect: { x: Number.NaN, y: 0, width: 100, height: 100 },
          at: { x: 50, y: 50 },
        },
        'g_test',
      );
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);

    updates = withDocTransactions(doc, () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: null, at: { x: Number.POSITIVE_INFINITY, y: 50 } },
        'g_test',
      );
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);

    expect(snapshot(doc)).toHaveLength(0);
  });
});
