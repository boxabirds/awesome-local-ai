// Story 10, shape.model (unit): the shape object model against a real Y.Doc.
//
// What is argued here is what the model promises: a dragged rect is used as-is,
// a click (or anything smaller than SHAPE_MIN_SIZE_WORLD) lands the default size
// centred on the pressed point, Shift squares the area, colours are validated
// against the product palette - and every refusal happens WITHOUT a transaction,
// so the doc's update count does not move and story 8's undo sees nothing.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape.ts';
import { initDoc, objectsMapOf, objectsSnapshot, objectBounds } from '../../src/shared/board-model.ts';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config.ts';

const BY = 'g_test';

function setup(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts the doc's own update events: a refused write must not bump it. */
function updateCounter(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

function shapeOf(doc: Y.Doc, id: string): ShapeSnapshot {
  const o = objectsSnapshot(doc).find((s) => s.id === id);
  if (!o || o.type !== 'shape') throw new Error(`no shape ${id}`);
  return o as ShapeSnapshot;
}

function mapOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = objectsMapOf(doc).get(id);
  if (!m) throw new Error(`no object ${id}`);
  return m;
}

describe('shape.model createShape', () => {
  // TC-01: a 200x120 drag creates exactly that shape - white fill, dark outline,
  // empty label - and it is the only new object.
  it('TC-01 creates the dragged rect with the default style', () => {
    const doc = setup();
    const updates = updateCounter(doc);

    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 } }, BY);

    expect(id).toBeTypeOf('string');
    expect(objectsSnapshot(doc)).toHaveLength(1);
    const shape = shapeOf(doc, id!);
    expect(shape.type).toBe('shape');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe('white');
    expect(shape.stroke).toBe('dark');
    expect(shape.label).toBe('');
    expect(shape.kind).toBe('rect');
    // createdBy and z are written like every other object's.
    expect(mapOf(doc, id!).get('createdBy')).toBe(BY);
    expect(Number(mapOf(doc, id!).get('z'))).toBeGreaterThan(0);
    expect(updates()).toBe(1);
  });

  // TC-02: a rect of 19x200 counts as a click, exactly like rect: null - both
  // land the default square centred on the pressed point.
  it('TC-02 lands the default 160x160 square centred on the point for a click and for a sliver', () => {
    const doc = setup();
    const at = { x: 400, y: 300 };

    const sliver = createShape(doc, { kind: 'ellipse', rect: { x: 390, y: 200, width: 19, height: 200 }, at }, BY);
    const click = createShape(doc, { kind: 'ellipse', rect: null, at }, BY);

    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    for (const id of [sliver, click]) {
      const shape = shapeOf(doc, id!);
      expect(shape.x).toBe(at.x - half);
      expect(shape.y).toBe(at.y - half);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    }
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBe(160);
  });

  // TC-03: the minimum is inclusive - exactly 20x20 is a shape, not a click.
  it('TC-03 keeps a rect of exactly the minimum size', () => {
    const doc = setup();
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 10, y: 10, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 500, y: 500 } },
      BY,
    );
    const shape = shapeOf(doc, id!);
    expect(shape.width).toBe(20);
    expect(shape.height).toBe(20);
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(10);
  });

  // TC-04: Shift squares the dragged area on its LONGER side, anchored at the
  // same corner, so the direction of the drag is kept.
  it('TC-04 squares a 200x120 drag to 200x200', () => {
    const doc = setup();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true },
      BY,
    );
    const shape = shapeOf(doc, id!);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
  });

  // TC-06: bad input is refused with null and NO transaction at all.
  it('TC-06 refuses an unknown kind and a non-finite rect without a transaction', () => {
    const doc = setup();
    const updates = updateCounter(doc);
    const before = objectsSnapshot(doc).length;

    expect(createShape(doc, { kind: 'triangle' as never, rect: null, at: { x: 0, y: 0 } }, BY)).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Number.NaN, height: 10 }, at: { x: 0, y: 0 } }, BY)).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 }, at: { x: 0, y: 0 } }, BY)).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 1 } }, BY)).toBeNull();

    expect(objectsSnapshot(doc)).toHaveLength(before);
    expect(updates()).toBe(0);
  });

  // A shape is a member of the same map as everything else: it is readable, it
  // has bounds, and it lands above the objects that were already there.
  it('creates a shape on top of existing objects and reads it back through objectBounds', () => {
    const doc = setup();
    const sticky = objectsSnapshot(doc);
    expect(sticky).toHaveLength(0);
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 300, height: 100 }, at: { x: 0, y: 0 } }, BY);
    const b = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 0, y: 0 } }, BY);

    const items = objectsSnapshot(doc);
    expect(items.map((o) => o.id)).toEqual([a, b]); // painted in (z, id) order
    expect(objectBounds(items[0])).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  });
});

describe('shape.model setShapeStyle', () => {
  // TC-05: a palette colour is applied in one update and touches nothing else;
  // a colour that is not in the palette is refused without a transaction.
  it('TC-05 applies a palette fill in one update and refuses an off-palette one', () => {
    const doc = setup();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, BY)!;
    const label = getShapeLabel(doc, id);
    label?.insert(0, 'hello');
    const updates = updateCounter(doc);

    expect(setShapeStyle(doc, id, { fill: 'blue' }, BY)).toBe(true);
    expect(updates()).toBe(1);
    const shape = shapeOf(doc, id);
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('hello'); // label untouched
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD); // and so is the box

    expect(setShapeStyle(doc, id, { fill: 'teal' as never }, BY)).toBe(false);
    expect(updates()).toBe(1); // zero further updates
    expect(shapeOf(doc, id).fill).toBe('blue');
  });

  // The outline has its own six colours; 'none' fills are not outlines and
  // 'grey' exists in both palettes.
  it('sets the outline, refuses an outline that is only a fill, and writes nothing when nothing changes', () => {
    const doc = setup();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, BY)!;
    const updates = updateCounter(doc);

    expect(setShapeStyle(doc, id, { stroke: 'red' }, BY)).toBe(true);
    expect(updates()).toBe(1);
    expect(shapeOf(doc, id).stroke).toBe('red');

    expect(setShapeStyle(doc, id, { stroke: 'none' as never }, BY)).toBe(false); // 'none' is a fill, not an outline
    expect(setShapeStyle(doc, id, { stroke: 'red' }, BY)).toBe(false); // already red
    expect(setShapeStyle(doc, id, {}, BY)).toBe(false); // nothing asked for
    expect(updates()).toBe(1);

    // Both keys at once are ONE transaction - one undo step for one toolbar click.
    expect(setShapeStyle(doc, id, { fill: 'pink', stroke: 'blue' }, BY)).toBe(true);
    expect(updates()).toBe(2);
    expect(shapeOf(doc, id)).toMatchObject({ fill: 'pink', stroke: 'blue' });
  });

  // A stale id and a foreign object are refused; the palettes are the product's.
  it('refuses a stale id, a non-shape object and an unknown colour', () => {
    const doc = setup();
    const updates = updateCounter(doc);
    expect(setShapeStyle(doc, 'nope', { fill: 'blue' }, BY)).toBe(false);

    const shape = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, BY)!;
    expect(setShapeStyle(doc, shape, { stroke: 'chartreuse' as never }, BY)).toBe(false);
    expect(updates()).toBe(1); // only the creation
    expect(Object.keys(SHAPE_FILL_COLORS)).toEqual(['none', 'white', 'blue', 'green', 'yellow', 'pink', 'grey']);
    expect(Object.keys(SHAPE_STROKE_COLORS)).toEqual(['dark', 'blue', 'green', 'orange', 'red', 'grey']);
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
    expect(DEFAULT_SHAPE_FILL).toBe('white');
    expect(SHAPE_MIN_SIZE_WORLD).toBe(20);
  });

  // The label is a Y.Text, so it syncs and merges like every other text on the
  // board, and it is reachable only through the shape that owns it.
  it('gives the shape a shared Y.Text label and none to a foreign object', () => {
    const doc = setup();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, BY)!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    label!.insert(0, 'A');
    expect(shapeOf(doc, id).label).toBe('A');

    const sticky = new Y.Map<unknown>();
    sticky.set('type', 'sticky');
    sticky.set('x', 0);
    sticky.set('y', 0);
    sticky.set('z', 1);
    objectsMapOf(doc).set('g_sticky', sticky);
    expect(getShapeLabel(doc, 'g_sticky')).toBeUndefined();
  });
});
