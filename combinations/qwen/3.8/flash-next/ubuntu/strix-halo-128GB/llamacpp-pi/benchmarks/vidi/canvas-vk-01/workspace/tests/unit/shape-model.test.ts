import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  initDoc,
  createSticky,
  registerBoardObjectType,
  objectSnapshots,
} from '../../src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';

/**
 * Story 10 shape.model — the shape schema against a real Y.Doc.
 * Every case also asserts the number of document updates it produced: a
 * rejected call must write nothing at all.
 */

// The model only serialises types the client registered; in the browser the
// object registry does this, in a node unit test we say it out loud.
registerBoardObjectType('shape');

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/** Watch for any document update (a rejected call must not produce one). */
function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

function shapeSnapshot(doc: Y.Doc, id: string): ShapeSnapshot {
  const found = objectSnapshots(doc).find((obj) => obj.id === id);
  if (found === undefined || found.type !== 'shape') {
    throw new Error(`shape ${id} is missing from the snapshot`);
  }
  return found;
}

describe('shape model (TC-01 to TC-06)', () => {
  it('TC-01: createShape with a 200x120 rect → one object, defaults, label, z on top', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 10, y: 10 });
    const stickyZ = objectMap(doc).get(stickyId)!.get('z') as number;

    const updates = countUpdates(doc);
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'g_test');
    expect(id).toBeTypeOf('string');
    expect(objectMap(doc).size).toBe(2);

    const shape = shapeSnapshot(doc, id!);
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    expect(shape.z).toBe(stickyZ + 1);
    expect(objectMap(doc).get(id!)!.get('createdBy')).toBe('g_test');
    expect(objectMap(doc).get(id!)!.get('createdAt')).toBeTypeOf('number');
    expect(updates()).toBe(1);
  });

  it('TC-01: the label is a shared Y.Text with the shape label limit', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 0, y: 0 } }, 'g_test');
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
    label!.insert(0, 'Checkout');
    expect(shapeSnapshot(doc, id!).label).toBe('Checkout');
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
  });

  it('TC-02: a 19x200 drag and a click (rect null) both drop a standard shape centred on the point', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    const at = { x: 500, y: 400 };

    const dragged = createShape(doc, { kind: 'rect', rect: { x: 490, y: 300, width: 19, height: 200 }, at }, 'g_test');
    const clicked = createShape(doc, { kind: 'diamond', rect: null, at }, 'g_test');

    for (const id of [dragged, clicked]) {
      expect(id).toBeTypeOf('string');
      const shape = shapeSnapshot(doc, id!);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    }
    expect(updates()).toBe(2);
  });

  it('TC-03: a drag of exactly SHAPE_MIN_SIZE_WORLD is kept as drawn', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 0, y: 0 },
      },
      'g_test',
    );
    const shape = shapeSnapshot(doc, id!);
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(updates()).toBe(1);
  });

  it('TC-04: square (Shift) makes 200x120 into 200x200 anchored at the drag origin', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'g_test',
    );
    const shape = shapeSnapshot(doc, id!);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(updates()).toBe(1);
  });

  it('TC-04: the square keeps the corner nearest the drag origin', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 300, y: 220 }, square: true },
      'g_test',
    );
    const shape = shapeSnapshot(doc, id!);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(20);
  });

  it('TC-05: setShapeStyle applies a known colour in one update and changes nothing else', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 10, width: 200, height: 100 }, at: { x: 10, y: 10 } },
      'g_test',
    );
    getShapeLabel(doc, id!)!.insert(0, 'Checkout');

    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(updates()).toBe(1);

    const shape = shapeSnapshot(doc, id!);
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('Checkout');
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(10);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(100);
  });

  it('TC-05: an unknown colour is rejected without a transaction', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_test');
    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id!, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id!, {})).toBe(false);
    expect(updates()).toBe(0);
    expect(shapeSnapshot(doc, id!).fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it('TC-05: a stale id or a non-shape id is rejected without a transaction', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, 'missing-id', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, stickyId, { fill: 'blue' })).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-06: an unknown kind is rejected without a transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(createShape(doc, { kind: 'triangle' as never, rect: null, at: { x: 0, y: 0 } }, 'g_test')).toBeNull();
    expect(objectMap(doc).size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('TC-06: a non-finite rect or point is rejected without a transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(
      createShape(doc, { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test'),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 100 }, at: { x: 0, y: 0 } }, 'g_test'),
    ).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.NaN } }, 'g_test')).toBeNull();
    expect(objectMap(doc).size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('palettes and defaults are consistent with the design', () => {
    expect(Object.keys(SHAPE_FILL_COLORS)).toHaveLength(7); // six colours + none
    expect(Object.keys(SHAPE_STROKE_COLORS)).toHaveLength(6);
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
    expect(SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL]).toBeDefined();
    expect(SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]).toBeDefined();
  });
});
