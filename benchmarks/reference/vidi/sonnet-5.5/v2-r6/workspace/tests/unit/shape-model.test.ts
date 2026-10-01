import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot, type ShapeKind } from '../../src/shared/board-model';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  const state = { updates: 0 };
  doc.on('update', () => { state.updates += 1; });
  return { doc, state };
}
const obj = (doc: Y.Doc, id: string) => doc.getMap('objects').get(id) as Y.Map<unknown>;
const at = { x: 500, y: 400 };

describe('shape model', () => {
  it('TC-01 createShape by drag stores the rect with default colours and an empty label', () => {
    const { doc, state } = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    state.updates = 0;
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at }, 'g_a') as string;
    const m = obj(doc, id);
    expect(state.updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(2);
    expect([m.get('x'), m.get('y'), m.get('width'), m.get('height')]).toEqual([100, 100, 200, 120]);
    expect(m.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(m.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(m.get('z')).toBe(2);
    expect(m.get('createdBy')).toBe('g_a');
    expect(getShapeLabel(doc, id)?.toString()).toBe('');
    const s = snapshot(doc).find((o) => o.id === id);
    expect(s).toMatchObject({ type: 'shape', kind: 'rect', width: 200, height: 120, label: '' });
  });

  it('TC-02 a click (null rect) or a drag under the minimum makes a standard shape centred on the point', () => {
    const { doc } = newDoc();
    for (const rect of [null, { x: 10, y: 10, width: 19, height: 200 }]) {
      const id = createShape(doc, { kind: 'diamond', rect, at }, 'g') as string;
      const m = obj(doc, id);
      expect([m.get('width'), m.get('height')]).toEqual([SHAPE_DEFAULT_SIZE_WORLD, SHAPE_DEFAULT_SIZE_WORLD]);
      expect([m.get('x'), m.get('y')]).toEqual([at.x - 80, at.y - 80]);
    }
  });

  it('TC-03 a drag of exactly the minimum size is kept', () => {
    const { doc } = newDoc();
    const id = createShape(doc, {
      kind: 'ellipse', rect: { x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at,
    }, 'g') as string;
    expect([obj(doc, id).get('width'), obj(doc, id).get('height')]).toEqual([20, 20]);
  });

  it('TC-04 square makes both sides the larger dimension from the origin', () => {
    const { doc } = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at, square: true }, 'g') as string;
    const m = obj(doc, id);
    expect([m.get('x'), m.get('y'), m.get('width'), m.get('height')]).toEqual([10, 20, 200, 200]);
  });

  it('TC-05 setShapeStyle applies a valid colour in one update and rejects an unknown one', () => {
    const { doc, state } = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at }, 'g') as string;
    getShapeLabel(doc, id)?.insert(0, 'Hi');
    state.updates = 0;
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(state.updates).toBe(1);
    expect(obj(doc, id).get('fill')).toBe('blue');
    expect(getShapeLabel(doc, id)?.toString()).toBe('Hi');
    expect(obj(doc, id).get('width')).toBe(100);
    state.updates = 0;
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(state.updates).toBe(0);
    expect(obj(doc, id).get('fill')).toBe('blue');
  });

  it('TC-06 an unknown kind or non-finite numbers create nothing', () => {
    const { doc, state } = newDoc();
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 50, height: 50 }, at }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 50 }, at }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 } }, 'g')).toBeNull();
    expect(state.updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });
});
