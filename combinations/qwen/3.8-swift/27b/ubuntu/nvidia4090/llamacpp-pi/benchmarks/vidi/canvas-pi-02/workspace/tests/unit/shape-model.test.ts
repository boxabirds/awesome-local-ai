// Unit tests for the shape object model (story 10, shape.model, TC-01 to
// TC-06). Uses a real Y.Doc (no mocks); each mutation also counts `update`
// events: exactly 1 for a successful mutation, 0 for a rejection.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeSnapshot,
  type ShapeKind,
} from '../../src/shared/objects/shape';

interface UpdateSpy {
  count: number;
  off: () => void;
}

/** Counts Yjs update events on the doc (one per transaction). */
function spyUpdates(doc: Y.Doc): UpdateSpy {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('shape.model (real Y.Doc)', () => {
  it('TC-01: createShape rect 200x120 → 1 shape, default colours, empty label, z above all', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 10, y: 20 } }, 'me');

    expect(updates.count).toBe(1);
    expect(id).not.toBeNull();
    const snap = shapeSnapshot(doc, id!);
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('shape');
    expect(snap!.x).toBe(10);
    expect(snap!.y).toBe(20);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(120);
    expect(snap!.kind).toBe('rect');
    expect(snap!.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap!.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap!.label).toBe('');
    expect(snap!.z).toBe(1);
    // The label is a real Y.Text with zero characters.
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.length).toBe(0);
    updates.off();
  });

  it('TC-01 (z): created above every existing object', () => {
    const doc = newDoc();
    createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'me');
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'me');
    expect(shapeSnapshot(doc, id!)!.z).toBe(2);
  });

  it('TC-02: tiny rect (19x200) and null rect → default 160x160 centred on the point', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 100, y: 0, width: 19, height: 200 }, at: { x: 100, y: 0 } }, 'me');
    const b = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 50, y: 70 } }, 'me');

    for (const id of [a, b]) {
      const snap = shapeSnapshot(doc, id!);
      expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    }
    // Centred on the click point.
    expect(shapeSnapshot(doc, a!)!.x).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shapeSnapshot(doc, a!)!.y).toBe(0 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shapeSnapshot(doc, b!)!.x).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shapeSnapshot(doc, b!)!.y).toBe(70 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly the minimum size (20x20) → kept (boundary)', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'diamond', rect: { x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 5, y: 6 } }, 'me');
    const snap = shapeSnapshot(doc, id!);
    expect(snap!.x).toBe(5);
    expect(snap!.y).toBe(6);
    expect(snap!.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap!.kind).toBe('diamond');
  });

  it('TC-04: square (Shift) on 200x120 → 200x200 anchored at the drag origin', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true }, 'me');
    const snap = shapeSnapshot(doc, id!);
    expect(snap!.x).toBe(100);
    expect(snap!.y).toBe(50);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(200);
  });

  it('TC-05: setShapeStyle fill blue → applied, 1 update, label/size unchanged; fill teal → false, 0 updates', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 120, height: 90 }, at: { x: 0, y: 0 } }, 'me');
    // Give the label text so we can assert it is untouched.
    getShapeLabel(doc, id!)!.insert(0, 'Cart');
    const before = shapeSnapshot(doc, id!)!;

    const updates = spyUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(updates.count).toBe(1);
    const after = shapeSnapshot(doc, id!);
    expect(after!.fill).toBe('blue');
    expect(after!.stroke).toBe(before.stroke);
    expect(after!.label).toBe('Cart');
    expect(after!.x).toBe(before.x);
    expect(after!.y).toBe(before.y);
    expect(after!.width).toBe(before.width);
    expect(after!.height).toBe(before.height);
    updates.off();

    // Unknown colour: rejected before any transaction.
    const updates2 = spyUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
    expect(updates2.count).toBe(0);
    expect(shapeSnapshot(doc, id!)!.fill).toBe('blue');
    updates2.off();
  });

  it('TC-06: unknown kind and non-finite rect → null, 0 updates (error path)', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'me')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'me')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } }, 'me')).toBeNull();
    expect(updates.count).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
    updates.off();
  });

  it('label Y.Text clamps at SHAPE_LABEL_MAX_CHARS characters (shape.label)', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 160, height: 160 }, at: { x: 0, y: 0 } }, 'me');
    const label = getShapeLabel(doc, id!)!;
    // The editor clamps to SHAPE_LABEL_MAX_CHARS; the doc must be able to
    // hold exactly the limit.
    label.insert(0, 'x'.repeat(SHAPE_LABEL_MAX_CHARS));
    expect(label.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });
});
