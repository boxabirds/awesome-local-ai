// Story 10 `shape.model` unit cases (TC-01 to TC-06): the shape object schema and
// its mutations, against a real Y.Doc. Creation sizing (drag / click / Shift), the
// colour validation and the label all live here; a rejected call must write nothing
// at all, which is what the update counter proves.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  shapeSnapshot,
  shapesOf,
} from '../../src/shared/objects/shape.ts';
import {
  initDoc,
  createSticky,
  objectSnapshots,
  objectBounds,
  moveObject,
  resizeObjects,
} from '../../src/shared/board-model.ts';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit.ts';
import { LOCAL_ORIGIN } from '../../src/shared/board-model.ts';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';

/** How many `doc` updates (transactions) `fn` wrote. */
function updatesOf(doc: Y.Doc, fn: () => unknown): number {
  let updates = 0;
  const h = () => updates++;
  doc.on('update', h);
  fn();
  doc.off('update', h);
  return updates;
}

function drag(doc: Y.Doc, kind: 'rect' | 'ellipse' | 'diamond', x0: number, y0: number, x1: number, y1: number, square = false): string | null {
  return createShape(doc, { kind, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, at: { x: x0, y: y0 }, square }, 'me');
}

describe('shape.model', () => {
  it('TC-01 creates a shape from a drag with default colours and an empty label', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    let id!: string;
    const updates = updatesOf(doc, () => {
      id = drag(doc, 'rect', 100, 100, 300, 220)!;
    });
    expect(updates).toBe(1);
    const snap = shapeSnapshot(doc, id)!;
    expect(snap.type).toBe('shape');
    expect(snap.kind).toBe('rect');
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(120);
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('');
    expect(snap.createdBy).toBe('me');
    // Above every existing object, like every other type.
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    expect(snap.z).toBeGreaterThan(sticky.z);
    // The generic selection machinery sees the same box.
    expect(objectBounds(snap)).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    expect(shapesOf(objectSnapshots(doc)).map((s) => s.id)).toEqual([id]);
  });

  it('TC-02 a too-small drag and a click both drop the standard size, centred', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    const dragged = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 10, y: 10, width: 19, height: 200 }, at: { x: 10, y: 10 } },
      'me',
    )!;
    const clicked = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 500, y: 300 } }, 'me')!;
    for (const [id, at] of [
      [dragged, { x: 10, y: 10 }],
      [clicked, { x: 500, y: 300 }],
    ] as [string, { x: number; y: number }][]) {
      const snap = shapeSnapshot(doc, id)!;
      expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.x).toBe(at.x - half);
      expect(snap.y).toBe(at.y - half);
    }
    expect(SHAPE_MIN_SIZE_WORLD).toBe(20);
  });

  it('TC-03 a drag of exactly the minimum size is kept as drawn', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = drag(doc, 'diamond', 0, 0, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD)!;
    const snap = shapeSnapshot(doc, id)!;
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04 Shift squares the shape on its larger side, anchored at the drag start', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = drag(doc, 'rect', 100, 100, 300, 220, true)!;
    const snap = shapeSnapshot(doc, id)!;
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
    // ...and the shorter side being the larger one squares the other way.
    const tall = drag(doc, 'rect', 0, 0, 60, 240, true)!;
    expect(shapeSnapshot(doc, tall)!).toMatchObject({ width: 240, height: 240, x: 0, y: 0 });
  });

  it('TC-05 paints with known colour names only, and writes nothing otherwise', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = drag(doc, 'rect', 0, 0, 200, 120)!;
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'blue' }))).toBe(1);
    expect(shapeSnapshot(doc, id)).toMatchObject({ fill: 'blue', stroke: DEFAULT_SHAPE_STROKE });
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'teal' }))).toBe(0);
    expect(shapeSnapshot(doc, id)!.fill).toBe('blue');
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { stroke: 'red' }))).toBe(1);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { stroke: 'magenta' }))).toBe(0);
    expect(shapeSnapshot(doc, id)).toMatchObject({ fill: 'blue', stroke: 'red' });
    // Both at once is one undo step, and size / position / label stay put.
    const before = shapeSnapshot(doc, id)!;
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'none', stroke: 'grey' }))).toBe(1);
    const after = shapeSnapshot(doc, id)!;
    expect(after).toMatchObject({ fill: 'none', stroke: 'grey', x: before.x, y: before.y, width: 200, height: 120 });
    // A stale id and an empty style write nothing.
    expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, {}))).toBe(0);
  });

  it('TC-06 rejects an unknown kind and a non-finite drag or point without writing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(updatesOf(doc, () => createShape(doc, { kind: 'triangle' as 'rect', rect: null, at: { x: 0, y: 0 } }, 'me'))).toBe(0);
    expect(updatesOf(doc, () => drag(doc, 'rect', 0, 0, Number.NaN, 100))).toBe(0);
    expect(updatesOf(doc, () => createShape(doc, { kind: 'rect', rect: null, at: { x: Number.POSITIVE_INFINITY, y: 0 } }, 'me'))).toBe(0);
    expect(objects.size).toBe(0);
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
  });

  it('TC-05b the label is a Y.Text capped at the setting and shows in snapshots', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = drag(doc, 'rect', 0, 0, 200, 120)!;
    const label = getShapeLabel(doc, id)!;
    expect(label).toBeInstanceOf(Y.Text);
    applyTextDiff(label, clampToLimit('x'.repeat(600), SHAPE_LABEL_MAX_CHARS), LOCAL_ORIGIN);
    expect(label.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(shapeSnapshot(doc, id)!.label.length).toBe(SHAPE_LABEL_MAX_CHARS);
    // A shape's own fields never leak into another type's snapshot.
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const sticky = objectSnapshots(doc).find((o) => o.id === stickyId)!;
    expect(sticky.kind).toBeUndefined();
    expect(sticky.fill).toBeUndefined();
    // and moving / resizing a shape is the generic operation, as for every type
    moveObject(doc, id, 20, 30);
    resizeObjects(doc, new Map([[id, { x: 20, y: 30, width: 90, height: 60 }]]));
    expect(shapeSnapshot(doc, id)).toMatchObject({ x: 20, y: 30, width: 90, height: 60 });
  });
});
