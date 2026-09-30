import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, initDoc, maxZ, objectsSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle, type ShapeKind, type ShapeSnap } from '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', handler);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', handler);
  }
}

function shapeSnap(doc: Y.Doc, id: string): ShapeSnap {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found) throw new Error('not found');
  return found as ShapeSnap;
}

describe('shape.model', () => {
  it('TC-01 createShape with a dragged 200x120 rect creates exactly that shape, white with a dark outline, empty label, on top', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const zBefore = maxZ(doc);
    const { result: id, updates, origins } = countUpdates(doc, () =>
      createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'c_1'),
    );
    expect(id).toEqual(expect.any(String));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const shapes = objectsSnapshot(doc).filter((o) => o.type === 'shape');
    expect(shapes).toHaveLength(1);
    expect(shapeSnap(doc, id!)).toMatchObject({
      type: 'shape',
      kind: 'rect',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: '',
      z: zBefore + 1,
      createdBy: 'c_1',
    });
    expect(DEFAULT_SHAPE_FILL).toBe('white');
    expect(DEFAULT_SHAPE_STROKE).toBe('dark');
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.length).toBe(0);
  });

  it('TC-02 a drag below the minimum (19x200) and a click (rect null) both give a default square centred on the point', () => {
    const doc = newDoc();
    const at = { x: 400, y: 300 };
    const tiny = createShape(doc, { kind: 'ellipse', rect: { x: 400, y: 300, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at }, 'c_1');
    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'c_1');
    for (const id of [tiny!, click!]) {
      expect(shapeSnap(doc, id)).toMatchObject({
        x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
        y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
        width: SHAPE_DEFAULT_SIZE_WORLD,
        height: SHAPE_DEFAULT_SIZE_WORLD,
      });
    }
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBe(160);
    expect(shapeSnap(doc, tiny!).kind).toBe('ellipse');
    expect(shapeSnap(doc, click!).kind).toBe('diamond');
  });

  it('TC-03 a drag of exactly the minimum size (20x20) is kept as drawn', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 10, width: 20, height: 20 }, at: { x: 10, y: 10 } }, 'c_1');
    expect(SHAPE_MIN_SIZE_WORLD).toBe(20);
    expect(shapeSnap(doc, id!)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('TC-04 square: a 200x120 drag becomes 200x200 anchored at the drag origin', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'c_1',
    );
    expect(shapeSnap(doc, id!)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
    // Dragged up-left from (300, 220): the square grows away from that origin.
    const up = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 300, y: 220 }, square: true },
      'c_1',
    );
    expect(shapeSnap(doc, up!)).toMatchObject({ x: 100, y: 20, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle applies a palette colour in one update and rejects unknown colours without writing', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'c_1')!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
    const blue = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(blue.result).toBe(true);
    expect(blue.updates).toBe(1);
    expect(blue.origins).toEqual([LOCAL_ORIGIN]);
    expect(shapeSnap(doc, id)).toMatchObject({ fill: 'blue', stroke: 'dark', label: 'Checkout', x: 0, y: 0, width: 200, height: 120 });
    const teal = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'teal' }));
    expect(teal.result).toBe(false);
    expect(teal.updates).toBe(0);
    const badStroke = countUpdates(doc, () => setShapeStyle(doc, id, { stroke: 'white' }));
    expect(badStroke).toMatchObject({ result: false, updates: 0 });
    const red = countUpdates(doc, () => setShapeStyle(doc, id, { stroke: 'red' }));
    expect(red).toMatchObject({ result: true, updates: 1 });
    expect(shapeSnap(doc, id).fill).toBe('blue');
    expect(countUpdates(doc, () => setShapeStyle(doc, 'missing', { fill: 'blue' }))).toMatchObject({ result: false, updates: 0 });
    // No fill is a palette entry.
    expect(setShapeStyle(doc, id, { fill: 'none' })).toBe(true);
  });

  it('TC-06 an unknown kind or a non-finite rect/point creates nothing', () => {
    const doc = newDoc();
    const cases = [
      () => createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at: { x: 0, y: 0 } }, 'c_1'),
      () => createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 100 }, at: { x: 0, y: 0 } }, 'c_1'),
      () => createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'c_1'),
      () => createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: NaN } }, 'c_1'),
    ];
    for (const fn of cases) {
      const { result, updates } = countUpdates(doc, fn);
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });
});
