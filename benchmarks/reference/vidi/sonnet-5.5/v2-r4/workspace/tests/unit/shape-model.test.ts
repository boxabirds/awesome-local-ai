import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle, type ShapeKind, type ShapeSnap } from '../../src/shared/objects/shape';

const updates = (doc: Y.Doc) => {
  const fn = vi.fn();
  doc.on('update', fn);
  return fn;
};
const shapeOf = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as ShapeSnap;

describe('shape.model', () => {
  it('TC-01 createShape rect 200x120: defaults, empty label, z on top, createdBy', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const fn = updates(doc);
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'g_test')!;
    expect(fn).toHaveBeenCalledTimes(1);
    const s = shapeOf(doc, id);
    expect(s).toMatchObject({ type: 'shape', kind: 'rect', x: 100, y: 100, width: 200, height: 120, fill: DEFAULT_SHAPE_FILL, stroke: DEFAULT_SHAPE_STROKE, label: '' });
    expect(snapshot(doc)).toHaveLength(2);
    expect(s.z).toBe(2);
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    expect((doc.getMap('objects').get(id) as Y.Map<unknown>).get('createdBy')).toBe('g_test');
  });

  it('TC-02 a drag below the minimum in one direction, and a click, give the standard size centred on the point', () => {
    const doc = new Y.Doc();
    const at = { x: 500, y: 300 };
    const small = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at }, 'g')!;
    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'g')!;
    for (const id of [small, click]) {
      expect(shapeOf(doc, id)).toMatchObject({ x: 500 - 80, y: 300 - 80, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD });
    }
  });

  it('TC-03 exactly the minimum size is kept', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 10, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 10, y: 10 } }, 'g')!;
    expect(shapeOf(doc, id)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('TC-04 square makes both sides the larger one, anchored at the drag origin', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true }, 'g')!;
    expect(shapeOf(doc, id)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle applies a known colour in one update; an unknown colour writes nothing', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 60 }, at: { x: 0, y: 0 } }, 'g')!;
    Y.Text.prototype.insert.call(getShapeLabel(doc, id)!, 0, 'Hi');
    const fn = updates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shapeOf(doc, id)).toMatchObject({ fill: 'blue', stroke: 'dark', label: 'Hi', width: 100, height: 60 });
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('TC-06 an unknown kind or non-finite numbers create nothing', () => {
    const doc = new Y.Doc();
    const fn = updates(doc);
    const at = { x: 0, y: 0 };
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: NaN, height: 50 }, at }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } }, 'g')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
