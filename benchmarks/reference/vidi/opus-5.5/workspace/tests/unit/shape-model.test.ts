/**
 * shape.model (story 10) against a real Y.Doc: TC-01 to TC-06 (each asserts the update count).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, maxZ, objectSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape, getShapeLabel, isShape, setShapeStyle, type ShapeKind } from '../../src/shared/objects/shape';

const AUTHOR = 'g_test';
const HALF = 2;
const DRAG = { x: 100, y: 100, width: 200, height: 120 } as const;

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { doc, updates: () => updates };
}

function shapes(doc: Y.Doc) {
  return objectSnapshot(doc).filter(isShape);
}

describe('shape.model', () => {
  it('TC-01 createShape with a dragged 200x120 rect: one object, exactly that rect, default style, empty label, on top', () => {
    const { doc, updates } = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const topBefore = maxZ(doc);
    const before = updates();
    const id = createShape(doc, { kind: 'rect', rect: DRAG, at: { x: DRAG.x, y: DRAG.y } }, AUTHOR);
    expect(id).toBeTruthy();
    expect(updates() - before).toBe(1);
    const all = shapes(doc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      kind: 'rect',
      x: DRAG.x,
      y: DRAG.y,
      width: DRAG.width,
      height: DRAG.height,
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: '',
      z: topBefore + 1,
      createdBy: AUTHOR,
    });
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.length).toBe(0);
  });

  it('TC-02 a rect 19 wide, or no rect (click), gives the default size centred on the point', () => {
    const at = { x: 500, y: -40 };
    const expected = {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
    for (const rect of [{ x: at.x, y: at.y, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, null]) {
      const { doc, updates } = newDoc();
      const before = updates();
      createShape(doc, { kind: 'ellipse', rect, at }, AUTHOR);
      expect(updates() - before).toBe(1);
      expect(shapes(doc)[0]).toMatchObject(expected);
    }
  });

  it('TC-03 a rect of exactly the minimum size is kept (boundary)', () => {
    const { doc } = newDoc();
    const rect = { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    createShape(doc, { kind: 'diamond', rect, at: { x: 10, y: 20 } }, AUTHOR);
    expect(shapes(doc)[0]).toMatchObject(rect);
  });

  it('TC-04 square: 200x120 becomes 200x200 anchored at the drag origin', () => {
    const { doc } = newDoc();
    createShape(doc, { kind: 'rect', rect: DRAG, at: { x: DRAG.x, y: DRAG.y }, square: true }, AUTHOR);
    expect(shapes(doc)[0]).toMatchObject({ x: DRAG.x, y: DRAG.y, width: 200, height: 200 });

    // Dragged up and to the left: the origin is the bottom-right corner, which stays put.
    const { doc: other } = newDoc();
    const origin = { x: DRAG.x + DRAG.width, y: DRAG.y + DRAG.height };
    createShape(other, { kind: 'rect', rect: DRAG, at: origin, square: true }, AUTHOR);
    expect(shapes(other)[0]).toMatchObject({ x: origin.x - 200, y: origin.y - 200, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle: blue fill applied in one update, nothing else changes; teal rejected with no update', () => {
    const { doc, updates } = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: DRAG, at: { x: DRAG.x, y: DRAG.y } }, AUTHOR)!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
    const before = shapes(doc)[0]!;
    const count = updates();
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates() - count).toBe(1);
    const after = shapes(doc)[0]!;
    expect(after).toEqual({ ...before, fill: 'blue' });

    const count2 = updates();
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false); // no-op
    expect(setShapeStyle(doc, 'stale', { fill: 'green' })).toBe(false);
    expect(updates()).toBe(count2);
    expect(shapes(doc)[0]!.fill).toBe('blue');

    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(shapes(doc)[0]).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Checkout' });
  });

  it('TC-06 unknown kind or non-finite rect/point: null and no update', () => {
    const { doc, updates } = newDoc();
    const before = updates();
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: DRAG, at: { x: 0, y: 0 } }, AUTHOR)).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { ...DRAG, width: Number.NaN }, at: { x: 0, y: 0 } }, AUTHOR),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: Number.POSITIVE_INFINITY, y: 0 } }, AUTHOR),
    ).toBeNull();
    expect(updates()).toBe(before);
    expect(shapes(doc)).toHaveLength(0);
  });
});
