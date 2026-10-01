import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc, snapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';
import type { ShapeKind, ShapeSnap } from '../../src/shared/objects/shape';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function updates(doc: Y.Doc) {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

const shapes = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'shape') as ShapeSnap[];
const AT = { x: 500, y: 400 };

describe('shape model', () => {
  it('TC-01 createShape rect 200x120 makes a white, dark-outlined, unlabelled shape on top', () => {
    const doc = newDoc();
    const count = updates(doc);
    const first = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: AT }, 'u1') as string;
    const second = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 50, height: 50 }, at: AT }, 'u1') as string;
    expect(count()).toBe(2);
    const [a, b] = shapes(doc);
    expect(a).toMatchObject({ id: first, x: 10, y: 20, width: 200, height: 120, kind: 'rect', label: '' });
    expect(a.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(a.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(getShapeLabel(doc, first)?.length).toBe(0);
    expect(b.id).toBe(second);
    expect(b.z).toBe(a.z + 1);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(first)?.get('createdBy')).toBe('u1');
  });

  it('TC-02 a click (rect null) or a drag under the minimum makes a standard shape centred on the point', () => {
    const doc = newDoc();
    createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 19, height: 200 }, at: AT }, 'u');
    createShape(doc, { kind: 'diamond', rect: null, at: AT }, 'u');
    for (const s of shapes(doc)) {
      expect(s).toMatchObject({
        x: AT.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
        y: AT.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
        width: SHAPE_DEFAULT_SIZE_WORLD,
        height: SHAPE_DEFAULT_SIZE_WORLD,
      });
    }
  });

  it('TC-03 a drag of exactly the minimum size is kept', () => {
    const doc = newDoc();
    createShape(doc, { kind: 'rect', rect: { x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: AT }, 'u');
    expect(shapes(doc)[0]).toMatchObject({ x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD });
  });

  it('TC-04 square makes both sides the larger dimension, anchored at the origin', () => {
    const doc = newDoc();
    createShape(doc, { kind: 'rect', rect: { x: 30, y: 40, width: 200, height: 120 }, at: AT, square: true }, 'u');
    expect(shapes(doc)[0]).toMatchObject({ x: 30, y: 40, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle applies a palette colour in one update and rejects unknown colours', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: AT }, 'u') as string;
    getShapeLabel(doc, id)?.insert(0, 'Checkout');
    const count = updates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(count()).toBe(1);
    expect(shapes(doc)[0]).toMatchObject({ fill: 'blue', stroke: DEFAULT_SHAPE_STROKE, label: 'Checkout', width: 100, height: 80 });
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'blue', fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(count()).toBe(1);
    expect(setShapeStyle(doc, id, { fill: 'none', stroke: 'red' })).toBe(true);
    expect(shapes(doc)[0]).toMatchObject({ fill: 'none', stroke: 'red' });
  });

  it('TC-06 an unknown kind or a non-finite rect creates nothing', () => {
    const doc = newDoc();
    const count = updates(doc);
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at: AT }, 'u')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 50, height: 50 }, at: AT }, 'u')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 50 }, at: AT }, 'u')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 } }, 'u')).toBeNull();
    expect(count()).toBe(0);
    expect(shapes(doc)).toHaveLength(0);
  });
});
