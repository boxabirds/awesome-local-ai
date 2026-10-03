/**
 * Unit tests for the shape object model (shape.model contract).
 * TC-01 to TC-06, against a real Y.Doc.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, objects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
} from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count doc updates fired between the start and end of a mutation. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

describe('shape.model', () => {
  // TC-01: createShape rect 200x120 → 1 object, width 200, height 120,
  // fill/stroke defaults, empty label Y.Text, z = maxZ+1, createdBy set.
  it('TC-01: createShape with a drag rect creates the shape at that rect', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });

    const updates = withUpdateCount(doc, () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
        'g_dana',
      );
      expect(id).not.toBeNull();
    });
    expect(updates).toBe(1);

    const all = objects(doc);
    expect(all).toHaveLength(2);
    const shape = all.find((o) => o.type === 'shape')!;
    const sticky = all.find((o) => o.id === stickyId)!;
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.z).toBe(sticky.z + 1);

    const objMap = doc.getMap('objects').get(shape.id) as Y.Map<unknown>;
    expect(objMap.get('kind')).toBe('rect');
    expect(objMap.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(objMap.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(objMap.get('createdBy')).toBe('g_dana');
    const label = objMap.get('label') as Y.Text;
    expect(label).toBeInstanceOf(Y.Text);
    expect(label.toString()).toBe('');
  });

  // TC-02: rect 19x200 (below the minimum in one dimension) and rect null
  // both create the standard default-size square centred on `at`.
  it('TC-02: tiny drags and clicks create the standard size centred on the point', () => {
    const doc = makeDoc();

    // 19 wide is below SHAPE_MIN_SIZE_WORLD → standard size.
    const id1 = createShape(
      doc,
      {
        kind: 'ellipse',
        rect: { x: 50, y: 50, width: 19, height: 200 },
        at: { x: 50, y: 50 },
      },
      'g_dana',
    )!;
    const o1 = objects(doc).find((o) => o.id === id1)!;
    expect(o1.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(o1.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred on the click point.
    expect(o1.x).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(o1.y).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null → standard size centred on `at`.
    const id2 = createShape(
      doc,
      { kind: 'diamond', rect: null, at: { x: 300, y: 200 } },
      'g_dana',
    )!;
    const o2 = objects(doc).find((o) => o.id === id2)!;
    expect(o2.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(o2.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(o2.x).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(o2.y).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: a drag of exactly SHAPE_MIN_SIZE_WORLD square is kept as drawn
  // (boundary).
  it('TC-03: a drag of exactly the minimum size is kept', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 0, y: 0 },
      },
      'g_dana',
    )!;
    const o = objects(doc).find((o) => o.id === id)!;
    expect(o.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(o.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at the drag origin.
  it('TC-04: Shift (square) makes the shape the larger dimension, anchored at the origin', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 10, y: 20, width: 200, height: 120 },
        at: { x: 10, y: 20 },
        square: true,
      },
      'g_dana',
    )!;
    const o = objects(doc).find((o) => o.id === id)!;
    expect(o.width).toBe(200);
    expect(o.height).toBe(200);
    expect(o.x).toBe(10);
    expect(o.y).toBe(20);
  });

  // TC-05: setShapeStyle fill 'blue' → applied, 1 update, label/size
  // unchanged; fill 'teal' → false, 0 updates (negative).
  it('TC-05: setShapeStyle applies known colours and rejects unknown ones', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } },
      'g_dana',
    )!;
    getShapeLabel(doc, id)!.insert(0, 'Hello');

    const updates = withUpdateCount(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    });
    expect(updates).toBe(1);
    const o = objects(doc).find((o) => o.id === id)!;
    expect((o as { fill?: string }).fill).toBe('blue');
    // Label, size and position unchanged.
    expect((o as { label?: string }).label).toBe('Hello');
    expect(o.width).toBe(100);
    expect(o.height).toBe(80);
    expect(o.x).toBe(0);

    const updates2 = withUpdateCount(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
      expect(setShapeStyle(doc, id, { stroke: 'purple' })).toBe(false);
    });
    expect(updates2).toBe(0);
    const objMap = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(objMap.get('fill')).toBe('blue');
    expect(objMap.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);

    // Stale id → false, no update.
    const updates3 = withUpdateCount(doc, () => {
      expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    });
    expect(updates3).toBe(0);
  });

  // TC-06: unknown kind and non-finite rect → null, 0 updates (error path).
  it('TC-06: unknown kind and non-finite rect are rejected without a transaction', () => {
    const doc = makeDoc();
    const updates = withUpdateCount(doc, () => {
      expect(
        createShape(
          doc,
          { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
          'g_dana',
        ),
      ).toBeNull();
      expect(
        createShape(
          doc,
          { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
          'g_dana',
        ),
      ).toBeNull();
      expect(
        createShape(
          doc,
          { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } },
          'g_dana',
        ),
      ).toBeNull();
    });
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  // getShapeLabel returns the Y.Text for a live shape and undefined for a
  // stale id.
  it('getShapeLabel returns the label Y.Text', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'g_dana',
    )!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    label!.insert(0, 'Checkout');
    const o = objects(doc).find((o) => o.id === id)!;
    expect((o as { label?: string }).label).toBe('Checkout');
    expect(getShapeLabel(doc, 'missing')).toBeUndefined();
  });

  // LOCAL_ORIGIN transactions: createShape and setShapeStyle use the local
  // origin so per-user undo captures them (story 8).
  it('mutations use LOCAL_ORIGIN so undo tracks them', () => {
    const doc = makeDoc();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'g_dana',
    )!;
    setShapeStyle(doc, id, { fill: 'blue' });
    expect(origins).toHaveLength(2);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });
});
