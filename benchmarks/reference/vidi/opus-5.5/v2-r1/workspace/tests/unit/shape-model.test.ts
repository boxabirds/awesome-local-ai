// shape.model (TC-01 to TC-06): the shape schema against a real Y.Doc.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  type ShapeKind,
  type ShapeSnap,
  createShape,
  getShapeLabel,
  setShapeStyle,
} from '../../src/shared/objects/shape';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { n: 0 };
  doc.on('update', () => counter.n++);
  return counter;
}

const shapeOf = (doc: Y.Doc, id: string) =>
  objectsSnapshot(doc).find((o) => o.id === id) as ShapeSnap | undefined;
const rawOf = (doc: Y.Doc, id: string) => doc.getMap('objects').get(id) as Y.Map<unknown>;

describe('shape.model createShape', () => {
  it('TC-01 a dragged 200x120 rect creates a white, dark-outlined shape with an empty label on top', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const updates = countUpdates(doc);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'g_test',
    )!;
    expect(id).toEqual(expect.any(String));
    expect(updates.n).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objectsSnapshot(doc)).toHaveLength(3);
    expect(shapeOf(doc, id)).toMatchObject({
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
    expect(rawOf(doc, id).get('createdBy')).toBe('g_test');
    expect(rawOf(doc, id).get('createdAt')).toEqual(expect.any(Number));
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, id)!.length).toBe(0);
  });

  it('TC-02 a click (null rect) or a 19-unit-wide drag drops a standard shape centred on the point', () => {
    const doc = freshDoc();
    const at = { x: 50, y: -30 };
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    const expected = { x: at.x - s / 2, y: at.y - s / 2, width: s, height: s };
    const click = createShape(doc, { kind: 'ellipse', rect: null, at }, 'g')!;
    expect(shapeOf(doc, click)).toMatchObject({ kind: 'ellipse', ...expected });
    const tiny = createShape(
      doc,
      { kind: 'diamond', rect: { x: 50, y: -30, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at },
      'g',
    )!;
    expect(shapeOf(doc, tiny)).toMatchObject({ kind: 'diamond', ...expected });
  });

  it('TC-03 a drag of exactly the minimum size is kept as drawn', () => {
    const doc = freshDoc();
    const rect = { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 10, y: 20 } }, 'g')!;
    expect(shapeOf(doc, id)).toMatchObject(rect);
  });

  it('TC-04 Shift (square) makes 200x120 into 200x200 anchored at the drag origin', () => {
    const doc = freshDoc();
    const rect = { x: 100, y: 100, width: 200, height: 120 };
    const down = createShape(doc, { kind: 'ellipse', rect, at: { x: 100, y: 100 }, square: true }, 'g')!;
    expect(shapeOf(doc, down)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
    // Dragged up and to the left from (300, 220): the square grows from that corner.
    const up = createShape(doc, { kind: 'rect', rect, at: { x: 300, y: 220 }, square: true }, 'g')!;
    expect(shapeOf(doc, up)).toMatchObject({ x: 100, y: 20, width: 200, height: 200 });
  });

  it('TC-06 an unknown kind or a non-finite rect or point creates nothing', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { ...rect, width: Number.NaN }, at: { x: 0, y: 0 } }, 'g'),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { ...rect, x: Infinity }, at: { x: 0, y: 0 } }, 'g'),
    ).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 0 } }, 'g')).toBeNull();
    expect(updates.n).toBe(0);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });
});

describe('shape.model setShapeStyle', () => {
  it('TC-05 a palette colour is applied in one update; an unknown colour writes nothing', () => {
    const doc = freshDoc();
    const rect = { x: 0, y: 0, width: 200, height: 120 };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'g')!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates.n).toBe(1);
    expect(shapeOf(doc, id)).toMatchObject({ ...rect, fill: 'blue', stroke: 'dark', label: 'Checkout' });

    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'pink' })).toBe(false);
    // One invalid key rejects the whole call.
    expect(setShapeStyle(doc, id, { fill: 'green', stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'green' })).toBe(false);
    expect(updates.n).toBe(1);

    expect(setShapeStyle(doc, id, { fill: 'none', stroke: 'red' })).toBe(true);
    expect(shapeOf(doc, id)).toMatchObject({ ...rect, fill: 'none', stroke: 'red', label: 'Checkout' });
    expect(updates.n).toBe(2);
  });

  it('setShapeStyle and getShapeLabel ignore objects that are not shapes', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(setShapeStyle(doc, note, { fill: 'blue' })).toBe(false);
    expect(getShapeLabel(doc, note)).toBeUndefined();
  });
});
