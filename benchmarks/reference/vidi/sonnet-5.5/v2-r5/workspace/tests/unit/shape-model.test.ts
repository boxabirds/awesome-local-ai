import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { snapshotObjects } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle, squareRect, type ShapeKind, type ShapeSnap } from '../../src/shared/objects/shape';
import { newBoardDoc } from './helpers/peer';

function countUpdates(doc: Y.Doc): { n: number } {
  const c = { n: 0 };
  doc.on('update', () => { c.n += 1; });
  return c;
}
const shapes = (doc: Y.Doc) => snapshotObjects(doc).filter((o): o is ShapeSnap => o.type === 'shape');
const AT = { x: 0, y: 0 };

describe('shape model', () => {
  it('TC-01 createShape rect 200x120 stores size, default style and an empty label on top', () => {
    const doc = newBoardDoc();
    const updates = countUpdates(doc);
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: AT }, 'g_a') as string;
    const [s] = shapes(doc);
    expect(shapes(doc)).toHaveLength(1);
    expect(updates.n).toBe(1);
    expect(s).toMatchObject({ id, x: 100, y: 100, width: 200, height: 120, kind: 'rect', label: '' });
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('createdBy')).toBe('g_a');
    const second = createShape(doc, { kind: 'ellipse', rect: null, at: AT }, 'g_a') as string;
    expect(shapes(doc).find((x) => x.id === second)!.z).toBe(s.z + 1);
  });

  it('TC-02 a small drag and a click create the standard size centred on the point', () => {
    for (const rect of [{ x: 0, y: 0, width: 19, height: 200 }, null]) {
      const doc = newBoardDoc();
      createShape(doc, { kind: 'diamond', rect, at: { x: 50, y: 70 } }, 'g');
      const [s] = shapes(doc);
      expect(s).toMatchObject({
        width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD,
        x: 50 - SHAPE_DEFAULT_SIZE_WORLD / 2, y: 70 - SHAPE_DEFAULT_SIZE_WORLD / 2, kind: 'diamond',
      });
    }
  });

  it('TC-03 a drag of exactly the minimum size is kept', () => {
    const doc = newBoardDoc();
    const m = SHAPE_MIN_SIZE_WORLD;
    createShape(doc, { kind: 'rect', rect: { x: 5, y: 6, width: m, height: m }, at: AT }, 'g');
    expect(shapes(doc)[0]).toMatchObject({ x: 5, y: 6, width: m, height: m });
  });

  it('TC-04 square makes both sides the larger dimension, anchored at the drag origin', () => {
    const doc = newBoardDoc();
    createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: AT, square: true }, 'g');
    expect(shapes(doc)[0]).toMatchObject({ x: 10, y: 20, width: 200, height: 200 });
    expect(squareRect({ x: 100, y: 100 }, { x: 40, y: 90 })).toEqual({ x: 40, y: 40, width: 60, height: 60 });
  });

  it('TC-05 setShapeStyle applies a valid colour in one update and rejects unknown ones', () => {
    const doc = newBoardDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: AT }, 'g') as string;
    getShapeLabel(doc, id)!.insert(0, 'Hi');
    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates.n).toBe(1);
    expect(shapes(doc)[0]).toMatchObject({ fill: 'blue', stroke: 'dark', label: 'Hi', width: 100, height: 100 });
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(updates.n).toBe(1);
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(shapes(doc)[0]).toMatchObject({ fill: 'blue', stroke: 'red' });
  });

  it('TC-06 an unknown kind or a non-finite rect writes nothing', () => {
    const doc = newBoardDoc();
    const updates = countUpdates(doc);
    expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at: AT }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 50, height: 50 }, at: AT }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 50 }, at: AT }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 } }, 'g')).toBeNull();
    expect(updates.n).toBe(0);
    expect(shapes(doc)).toHaveLength(0);
  });
});
