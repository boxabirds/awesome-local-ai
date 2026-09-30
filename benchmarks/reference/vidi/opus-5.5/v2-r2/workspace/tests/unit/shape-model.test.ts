import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { type ShapeKind, createShape, getShapeLabel, isShape, setShapeStyle } from '../../src/shared/objects/shape';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function shapeSnap(doc: Y.Doc, id: string) {
  const s = objectsSnapshot(doc).find((o) => o.id === id);
  if (!s || !isShape(s)) throw new Error('no shape');
  return s;
}

describe('shape.model', () => {
  it('TC-01 createShape rect 200x120 → one shape, default colours, empty label, on top, createdBy', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const before = objectsMap(doc).size;
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'g_dana');
    expect(id).toEqual(expect.any(String));
    expect(updates.count).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objectsMap(doc).size).toBe(before + 1);
    const s = shapeSnap(doc, id!);
    expect(s).toMatchObject({ type: 'shape', kind: 'rect', x: 100, y: 100, width: 200, height: 120, label: '' });
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(s.z).toBe(2);
    expect(objectsMap(doc).get(id!)!.get('createdBy')).toBe('g_dana');
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.length).toBe(0);
  });

  it('TC-02 a rect below the minimum (19x200) or no rect → default size centred on the click point', () => {
    const doc = newDoc();
    const at = { x: 500, y: -40 };
    const small = createShape(doc, { kind: 'ellipse', rect: { x: 500, y: -40, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at }, 'g');
    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'g');
    for (const id of [small!, click!]) {
      const s = shapeSnap(doc, id);
      expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(s.x + s.width / 2).toBe(at.x);
      expect(s.y + s.height / 2).toBe(at.y);
    }
    expect(shapeSnap(doc, click!).kind).toBe('diamond');
  });

  it('TC-03 a rect of exactly the minimum size is kept', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 10, y: 20 } },
      'g',
    );
    expect(shapeSnap(doc, id!)).toMatchObject({ x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD });
  });

  it('TC-04 square: true makes 200x120 into 200x200 anchored at the drag origin', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true }, 'g');
    expect(shapeSnap(doc, id!)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle applies palette colours only; unknown colours write nothing', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    doc.transact(() => getShapeLabel(doc, id)!.insert(0, 'Checkout'), LOCAL_ORIGIN);
    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates.count).toBe(1);
    expect(shapeSnap(doc, id)).toMatchObject({ fill: 'blue', stroke: DEFAULT_SHAPE_STROKE, label: 'Checkout', width: 200, height: 120, x: 0, y: 0 });
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'blue', fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'white' })).toBe(false);
    expect(setShapeStyle(doc, 'stale', { fill: 'green' })).toBe(false);
    expect(updates.count).toBe(1);
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(shapeSnap(doc, id)).toMatchObject({ fill: 'blue', stroke: 'red' });
    expect(setShapeStyle(doc, id, { fill: 'none' })).toBe(true);
    expect(shapeSnap(doc, id).fill).toBe('none');
  });

  it('TC-06 unknown kind or non-finite rect/point → null, nothing written', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: NaN, height: 50 }, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: Infinity, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: NaN } }, 'g')).toBeNull();
    expect(updates.count).toBe(0);
    expect(objectsMap(doc).size).toBe(0);
  });
});
