/** Story 10 shape.model unit tests (TC-01 to TC-06) on a real Y.Doc. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import { createShape, getShapeLabel, isShapeSnap, setShapeStyle, type ShapeSnap } from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function shapes(doc: Y.Doc): ShapeSnap[] {
  return snapshotObjects(doc).filter(isShapeSnap);
}

function shape(doc: Y.Doc, id: string): ShapeSnap {
  const s = shapes(doc).find((o) => o.id === id);
  if (s === undefined) throw new Error('not a shape');
  return s;
}

describe('shape.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01 createShape by drag: exact rect, default colours, empty label, z on top, createdBy', () => {
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'g_dana');
    expect(id).not.toBeNull();
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    expect(shapes(doc)).toHaveLength(1);
    const s = shape(doc, id!);
    expect(s).toMatchObject({ type: 'shape', kind: 'rect', x: 100, y: 100, width: 200, height: 120, label: '' });
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(DEFAULT_SHAPE_FILL).toBe('white');
    expect(DEFAULT_SHAPE_STROKE).toBe('dark');
    expect(getShapeLabel(doc, id!)).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, id!)!.length).toBe(0);
    const others = snapshotObjects(doc).filter((o) => o.id !== id);
    expect(s.z).toBe(Math.max(...others.map((o) => o.z)) + 1);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id!)!.get('createdBy')).toBe('g_dana');
  });

  it('TC-02 click or a drag below the minimum: default size centred on the point', () => {
    const at = { x: 50, y: -30 };
    const tiny = createShape(doc, { kind: 'diamond', rect: { x: 50, y: -30, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at }, 'g');
    const click = createShape(doc, { kind: 'ellipse', rect: null, at }, 'g');
    for (const id of [tiny!, click!]) {
      const s = shape(doc, id);
      expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(s.x + s.width / 2).toBe(at.x);
      expect(s.y + s.height / 2).toBe(at.y);
    }
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBe(160);
    expect(shape(doc, tiny!).kind).toBe('diamond');
    expect(shape(doc, click!).kind).toBe('ellipse');
  });

  it('TC-03 a drag of exactly the minimum size is kept', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 10, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 10, y: 10 } }, 'g');
    expect(shape(doc, id!)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('TC-04 Shift: 200x120 becomes 200x200 anchored at the drag origin', () => {
    const down = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true }, 'g');
    expect(shape(doc, down!)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
    // Dragged up and to the left from (300, 220): the square grows up and left from there.
    const up = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 300, y: 220 }, square: true }, 'g');
    expect(shape(doc, up!)).toMatchObject({ x: 100, y: 20, width: 200, height: 200 });
  });

  it('TC-05 setShapeStyle: known colour applied in one update; unknown colour writes nothing', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
    const before = shape(doc, id);
    let updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates.count).toBe(1);
    const after = shape(doc, id);
    expect(after.fill).toBe('blue');
    expect(after).toMatchObject({ label: 'Checkout', x: before.x, y: before.y, width: before.width, height: before.height, stroke: before.stroke });

    updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'blue', fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'white' })).toBe(false); // not an outline colour
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false); // unchanged
    expect(updates.count).toBe(0);
    expect(shape(doc, id).fill).toBe('blue');
  });

  it('TC-06 unknown kind or non-finite input: null, nothing written', () => {
    const updates = countUpdates(doc);
    expect(createShape(doc, { kind: 'triangle' as never, rect: null, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Number.NaN, height: 10 }, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: Infinity, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } }, 'g')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.NaN } }, 'g')).toBeNull();
    expect(updates.count).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });
});
