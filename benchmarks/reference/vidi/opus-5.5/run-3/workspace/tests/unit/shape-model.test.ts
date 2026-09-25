import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, objectSnapshot, registerModelObjectType } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle, type ShapeKind, type ShapeSnap } from '../../src/shared/objects/shape';

// The client registry makes 'shape' a known type; the model tests do the same without React.
registerModelObjectType('shape');

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const on = () => n++;
  doc.on('update', on);
  try {
    fn();
  } finally {
    doc.off('update', on);
  }
  return n;
}

function raw(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

function shape(doc: Y.Doc, id: string): ShapeSnap {
  return objectSnapshot(doc).find((o) => o.id === id) as ShapeSnap;
}

describe('shape model (shape.model)', () => {
  it('TC-01 createShape with a 200x120 rect makes exactly that shape, default colours, empty label, on top', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    let id: string | null = null;
    const updates = countUpdates(doc, () => {
      id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'g_test');
    });
    expect(updates).toBe(1);
    expect(id).toBeTruthy();
    expect(objectSnapshot(doc)).toHaveLength(3);
    const s = shape(doc, id!);
    expect(s).toMatchObject({
      type: 'shape',
      kind: 'rect',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: '',
      z: 3,
    });
    expect(raw(doc, id!).get('createdBy')).toBe('g_test');
    expect(raw(doc, id!).get('label')).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, id!)!.length).toBe(0);
  });

  it('TC-02 a rect below the minimum in one direction, or no rect (a click), gives a default-size shape centred on the point', () => {
    const doc = freshDoc();
    const at = { x: 50, y: -30 };
    const a = createShape(doc, { kind: 'ellipse', rect: { x: 50, y: -30, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at }, 'g')!;
    const b = createShape(doc, { kind: 'diamond', rect: null, at }, 'g')!;
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    for (const id of [a, b]) {
      expect(shape(doc, id)).toMatchObject({ x: at.x - s / 2, y: at.y - s / 2, width: s, height: s });
    }
    expect(shape(doc, a).kind).toBe('ellipse');
    expect(shape(doc, b).kind).toBe('diamond');
  });

  it('TC-03 a rect of exactly the minimum size is kept', () => {
    const doc = freshDoc();
    const m = SHAPE_MIN_SIZE_WORLD;
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: m, height: m }, at: { x: 10, y: 20 } }, 'g')!;
    expect(shape(doc, id)).toMatchObject({ x: 10, y: 20, width: m, height: m });
  });

  it('TC-04 square: true makes both sides the larger dimension, anchored at the drag origin', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'g',
    )!;
    expect(shape(doc, id)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle applies a known colour in one update without touching anything else; an unknown one writes nothing', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    doc.transact(() => getShapeLabel(doc, id)!.insert(0, 'Checkout'));
    const before = shape(doc, id);
    let ok = false;
    expect(countUpdates(doc, () => (ok = setShapeStyle(doc, id, { fill: 'blue' })))).toBe(1);
    expect(ok).toBe(true);
    const after = shape(doc, id);
    expect(after.fill).toBe('blue');
    expect({ ...after, fill: before.fill }).toEqual(before);

    expect(countUpdates(doc, () => (ok = setShapeStyle(doc, id, { fill: 'teal' })))).toBe(0);
    expect(ok).toBe(false);
    expect(countUpdates(doc, () => (ok = setShapeStyle(doc, id, { stroke: 'pink' })))).toBe(0);
    expect(ok).toBe(false);
    // Same colour again, and a stale id: no write either.
    expect(countUpdates(doc, () => (ok = setShapeStyle(doc, id, { fill: 'blue' })))).toBe(0);
    expect(countUpdates(doc, () => (ok = setShapeStyle(doc, 'gone', { fill: 'green' })))).toBe(0);
    expect(ok).toBe(false);
    expect(shape(doc, id).fill).toBe('blue');
  });

  it('TC-06 an unknown kind or a non-finite rect creates nothing', () => {
    const doc = freshDoc();
    const at = { x: 0, y: 0 };
    let results: Array<string | null> = [];
    const updates = countUpdates(doc, () => {
      results = [
        createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at }, 'g'),
        createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 100 }, at }, 'g'),
        createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at }, 'g'),
        createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Infinity } }, 'g'),
      ];
    });
    expect(results).toEqual([null, null, null, null]);
    expect(updates).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});
