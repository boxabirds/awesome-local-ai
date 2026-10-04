/**
 * Story 10 — shape.model unit tests (TC-01 to TC-06).
 * Pure model on a real Y.Doc; each case asserts the `update` event count.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  isShapeSnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
} from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * Count subsequent `update` events on the doc. (No unsubscribe: in yjs 13.6
 * the function returned by `doc.on('update')` emits a phantom update with an
 * undefined origin when called, which would pollute the count. Test docs are
 * short-lived, so the listener is simply dropped with the doc.)
 */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates++;
  });
  return () => updates;
}

function shapeSnap(doc: Y.Doc, id: string): ObjectSnapshot {
  const snap = snapshot(doc).find((s) => s.id === id);
  if (!snap) throw new Error(`shape ${id} missing from snapshot`);
  return snap;
}

// --- TC-01: createShape rect 200x120 → 1 object at that rect, defaults ---
describe('TC-01: create by drag', () => {
  it('creates a 200x120 shape with default fill/stroke, empty label, top z', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);

    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'local',
    );

    expect(id).toBeTruthy();
    expect(snapshot(doc)).toHaveLength(1);
    const snap = shapeSnap(doc, id!);
    expect(snap.type).toBe('shape');
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(120);
    if (!isShapeSnapshot(snap)) throw new Error('expected a shape snapshot');
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('');

    // z = maxZ + 1 (first object → 1); createdBy set
    expect(snap.z).toBe(1);
    const raw = doc.getMap('objects').get(id!) as Y.Map<unknown> | undefined;
    expect(raw?.get('createdBy')).toBe('local');

    // The label is a Y.Text
    expect(getShapeLabel(doc, id!)).toBeInstanceOf(Y.Text);

    expect(stop()).toBe(1);
  });
});

// --- TC-02: tiny rect and null rect → standard size centred at `at` ---
describe('TC-02: click / tiny drag creates standard size', () => {
  it('rect 19x200 (below minimum width) → 160x160 centred at the point', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const at = { x: 300, y: 200 };
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 19, height: 200 }, at },
      'local',
    );
    const snap = shapeSnap(doc, id!);
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(stop()).toBe(1);
  });

  it('rect null (click) → 160x160 centred at the point', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const at = { x: 50, y: 60 };
    const id = createShape(doc, { kind: 'diamond', rect: null, at }, 'local');
    const snap = shapeSnap(doc, id!);
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(stop()).toBe(1);
  });
});

// --- TC-03: exactly the minimum size is kept as drawn ---
describe('TC-03: minimum-size boundary', () => {
  it('rect exactly 20x20 is kept', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      {
        kind: 'ellipse',
        rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 10, y: 20 },
      },
      'local',
    );
    const snap = shapeSnap(doc, id!);
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.x).toBe(10);
    expect(snap.y).toBe(20);
    expect(stop()).toBe(1);
  });
});

// --- TC-04: Shift → square using the larger dimension, anchored at origin ---
describe('TC-04: Shift constrains to a square', () => {
  it('200x120 with square → 200x200 anchored at the drag origin', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true },
      'local',
    );
    const snap = shapeSnap(doc, id!);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(stop()).toBe(1);
  });
});

// --- TC-05: setShapeStyle validates and touches only colour keys ---
describe('TC-05: style validation', () => {
  it('fill blue applied in one update; label and size unchanged', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 100 }, at: { x: 0, y: 0 } },
      'local',
    )!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');

    const stop = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    const snapRaw = shapeSnap(doc, id);
    if (!isShapeSnapshot(snapRaw)) throw new Error('expected a shape snapshot');
    expect(snapRaw.fill).toBe('blue');
    const snap = snapRaw as { fill: string; label: string; width: number };
    expect(snap.label).toBe('Checkout');
    expect(snap.width).toBe(200);
    expect(stop()).toBe(1);
  });

  it('unknown colour → false, zero updates (negative)', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'local',
    )!;
    const stop = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(stop()).toBe(0);
  });
});

// --- TC-06: unknown kind / non-finite rect → null, no transaction ---
describe('TC-06: invalid input', () => {
  it('unknown kind → null, zero updates', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'local',
    );
    expect(id).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    expect(stop()).toBe(0);
  });

  it('non-finite rect → null, zero updates', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'local',
    );
    expect(id).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    expect(stop()).toBe(0);
  });
});

// Label limit is a product setting the editor enforces (shape.label).
describe('label limit setting', () => {
  it('SHAPE_LABEL_MAX_CHARS is 500', () => {
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
  });
});
