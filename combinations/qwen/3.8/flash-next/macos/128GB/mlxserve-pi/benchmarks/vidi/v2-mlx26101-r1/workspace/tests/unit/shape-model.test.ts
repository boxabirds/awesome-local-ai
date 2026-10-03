// shape.model unit tests (story 10, TC-01 to TC-06).
//
// Every case runs against a real Y.Doc, because the contract of this module *is* how
// it writes the document: one LOCAL_ORIGIN transaction per intent, a rejection that
// happens *before* any transaction (so nothing goes on the wire and undo has nothing
// to rewind), and a label stored as a Y.Text so two people can type into one shape.
//
// `updatesDuring` is the assertion that a rejected call wrote nothing: Yjs emits an
// `update` event for every committed transaction, so zero updates means no
// transaction was opened.

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  getShapeLabel,
  isFillColor,
  isShapeKind,
  isStrokeColor,
  setShapeStyle,
  shapeRect,
  shapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  createSticky,
  deleteObjects,
  LOCAL_ORIGIN,
  objectBounds,
  objectSnapshots,
  resizeObjects,
} from '../../src/shared/board-model';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  STICKY_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config';

/** The objects map of a doc, typed loosely for raw schema assertions. */
function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** How many `update` events (committed transactions) `fn` produces. */
function updatesDuring(doc: Y.Doc, fn: () => unknown): number {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

/** The raw stored map of one object; throws when it is not there. */
function raw(doc: Y.Doc, id: string): Y.Map<unknown> {
  const map = objectsMap(doc).get(id);
  if (!map) throw new Error(`object ${id} is not in the document`);
  return map;
}

/** The box the model reports for a shape; throws when the shape is not there. */
function storedBox(doc: Y.Doc, id: string) {
  const snap = shapeSnapshot(doc, id);
  if (!snap) throw new Error(`shape ${id} is not in the document`);
  return objectBounds(snap);
}

describe('shape.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01 creates a shape with the dragged box, default style, on top and authored', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(raw(doc, sticky).get('z')).toBe(1);

    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'dana');

    expect(id).toBeTruthy();
    expect(objectsMap(doc).size).toBe(2);
    const shape = raw(doc, id!);
    expect(shape.get('type')).toBe('shape');
    expect(shape.get('kind')).toBe('rect');
    expect(shape.get('x')).toBe(100);
    expect(shape.get('y')).toBe(100);
    expect(shape.get('width')).toBe(200);
    expect(shape.get('height')).toBe(120);
    // The palette's defaults, by name: what a client renders is a lookup, not a
    // number baked into the object.
    expect(shape.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    // One layer above the sticky note that was already there.
    expect(shape.get('z')).toBe(2);
    expect(shape.get('createdBy')).toBe('dana');
    expect(typeof shape.get('createdAt')).toBe('number');
    // The label is a Y.Text, so two people typing into it merge (shape.label).
    expect(shape.get('label')).toBeInstanceOf(Y.Text);
    expect((shape.get('label') as Y.Text).toString()).toBe('');

    // The model reads it back as a shape with the box it was given.
    const snap = shapeSnapshot(doc, id!);
    expect(snap?.type).toBe('shape');
    expect(snap?.width).toBe(200);
    expect(snap?.height).toBe(120);
    expect(objectBounds(snap!)).toEqual({ x: 100, y: 100, width: 200, height: 120 });
  });

  it('TC-01b a created shape is one transaction, and it is a local one', () => {
    let origin: unknown = 'nothing';
    doc.on('update', (_update: Uint8Array, o: unknown) => {
      origin = o;
    });
    const id = createShape(doc, { at: { x: 0, y: 0 } }, 'dana');
    expect(id).toBeTruthy();
    expect(origin).toBe(LOCAL_ORIGIN);
  });

  it('TC-02 a drag below the minimum size, in either direction, is a click', () => {
    const thin = createShape(
      doc,
      { rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at: { x: 0, y: 0 } },
      'dana',
    );
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    expect(storedBox(doc, thin!)).toEqual({
      x: -half,
      y: -half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });

    // A null rect — a pointer that went down and up without travelling — is the same
    // request, and gets the same box centred on the point.
    const click = createShape(doc, { at: { x: 500, y: -50 } }, 'dana');
    expect(storedBox(doc, click!)).toEqual({
      x: 500 - half,
      y: -50 - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('TC-03 a drag of exactly the minimum size is kept as drawn', () => {
    const rect = { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: 300 };
    const id = createShape(doc, { rect, at: { x: 10, y: 20 } }, 'dana');
    // The boundary belongs to "it was a drag": the shape's own minimum resize size is
    // the same number, so the next resize cannot make it any smaller either.
    expect(storedBox(doc, id!)).toEqual(rect);
    expect(isShapeKind('diamond')).toBe(true);
  });

  it('TC-04 shift squares the drag on the longer side, anchored at its origin', () => {
    const id = createShape(
      doc,
      { rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'dana',
    );
    // 200x200 with the corner the pointer went down at left where it is, so the shape
    // does not slide out from under the drag.
    expect(storedBox(doc, id!)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });

    // The taller drag squares on its height.
    const taller = createShape(
      doc,
      { rect: { x: -40, y: 5, width: 60, height: 90 }, at: { x: -40, y: 5 }, square: true },
      'dana',
    );
    expect(storedBox(doc, taller!)).toEqual({
      x: -40,
      y: 5,
      width: 90,
      height: 90,
    });

    // shapeRect is the same rule the tool calls before it writes, so a preview and
    // the stored object cannot disagree.
    expect(shapeRect({ x: 0, y: 0, width: 200, height: 120 }, { x: 0, y: 0 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
  });

  it('TC-05 a style change touches only its own colour, and an unknown one is refused', () => {
    const id = createShape(doc, { rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'dana');
    const label = getShapeLabel(doc, id!);
    label?.insert(0, 'start');

    const before = raw(doc, id!);
    expect(before.get('fill')).toBe(DEFAULT_SHAPE_FILL);

    const updates = updatesDuring(doc, () =>
      setShapeStyle(doc, id!, { fill: 'blue' }),
    );
    // One intent, one transaction: fill and stroke would be written together if both
    // were given, so nobody sees half an applied style.
    expect(updates).toBe(1);
    expect(raw(doc, id!).get('fill')).toBe('blue');
    expect(raw(doc, id!).get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    // The shape's words, its size, its place and its layer are none of a colour's
    // business.
    expect(raw(doc, id!).get('width')).toBe(200);
    expect(raw(doc, id!).get('height')).toBe(120);
    expect(raw(doc, id!).get('x')).toBe(0);
    expect(raw(doc, id!).get('z')).toBe(1);
    expect(getShapeLabel(doc, id!)?.toString()).toBe('start');

    // A colour that is not in the palette is refused before any transaction, so
    // nothing is written and nothing is sent.
    const rejected = updatesDuring(doc, () => setShapeStyle(doc, id!, { fill: 'teal' }));
    expect(rejected).toBe(0);
    expect(raw(doc, id!).get('fill')).toBe('blue');

    // Both at once is still one transaction.
    expect(updatesDuring(doc, () => setShapeStyle(doc, id!, { fill: 'none', stroke: 'red' }))).toBe(1);
    expect(raw(doc, id!).get('fill')).toBe('none');
    expect(raw(doc, id!).get('stroke')).toBe('red');

    // A shape someone else deleted: false, no write, no update. The toolbar simply
    // goes away.
    expect(deleteObjects(doc, [id!])).toBe(1);
    expect(updatesDuring(doc, () => setShapeStyle(doc, id!, { fill: 'blue' }))).toBe(0);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(false);

    // The palette is the only accepted vocabulary.
    expect(isFillColor('blue')).toBe(true);
    expect(isFillColor('teal')).toBe(false);
    expect(isFillColor(undefined)).toBe(false);
    expect(isStrokeColor('dark')).toBe(true);
    expect(isStrokeColor('white')).toBe(false);
    expect(Object.keys(SHAPE_FILL_COLORS)).toContain('none');
    expect(Object.keys(SHAPE_STROKE_COLORS)).toHaveLength(6);
  });

  it('TC-06 an unknown kind or a non-finite number writes nothing at all', () => {
    const updates = updatesDuring(doc, () => {
      expect(createShape(doc, { kind: 'triangle', at: { x: 0, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { at: { x: Number.NaN, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { at: { x: 0, y: Number.POSITIVE_INFINITY } }, 'dana')).toBeNull();
      expect(
        createShape(doc, { at: { x: 0, y: 0 }, rect: { x: 0, y: 0, width: Number.NaN, height: 100 } }, 'dana'),
      ).toBeNull();
      expect(
        createShape(doc, { at: { x: 0, y: 0 }, rect: { x: 0, y: Number.NaN, width: 100, height: 100 } }, 'dana'),
      ).toBeNull();
      // An author we cannot name is not a shape either: an anonymous object is an
      // accident nobody can explain.
      expect(createShape(doc, { at: { x: 0, y: 0 } }, '')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(0);

    // A drag is refused rather than quietly replaced by a default box: a box with a
    // NaN in it came from a pointer that lost its head, and a shape nobody meant to
    // draw — appearing at a size nobody asked for — is worse than no shape. A *click*
    // (rect absent or below the minimum) is the opposite case, and does get the
    // default box (TC-02).
    expect(
      shapeRect({ x: 0, y: 0, width: Number.NaN, height: 100 }, { x: 0, y: 0 }, false),
    ).toEqual({
      x: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('keeps every kind the Shape menu offers, and reads a kind a peer invented safely', () => {
    for (const kind of SHAPE_KINDS as readonly ShapeKind[]) {
      const doc2 = new Y.Doc();
      const id = createShape(doc2, { kind, at: { x: 0, y: 0 } }, 'dana');
      expect(shapeSnapshot(doc2, id!)?.kind).toBe(kind);
    }
    // A board written by a client that has a kind we do not know: the shape still
    // renders, as the default kind, rather than vanishing.
    const alien = new Y.Doc();
    const map = new Y.Map<unknown>();
    map.set('type', 'shape');
    map.set('kind', 'hexagon');
    map.set('x', 0);
    map.set('y', 0);
    objectsMap(alien).set('alien', map);
    expect(shapeSnapshot(alien, 'alien')?.kind).toBe('rect');

    // A label longer than the limit is clamped on the way out, the same rule the text
    // editor applies while typing.
    const long = new Y.Doc();
    const id = createShape(long, { at: { x: 0, y: 0 } }, 'dana');
    const label = getShapeLabel(long, id!);
    label?.insert(0, 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 50));
    const snap = shapeSnapshot(long, id!);
    expect(snap?.label.length).toBe(clampToLimit('x'.repeat(SHAPE_LABEL_MAX_CHARS + 50), SHAPE_LABEL_MAX_CHARS).length);
  });

  it('resizes and moves like every other object, and disappears on delete', () => {
    const id = createShape(doc, { rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'dana');
    // story 7's generic operations, untouched, are what a shape's size and place are
    // written with (shape.drag).
    expect(resizeObjects(doc, new Map([[id!, { x: 0, y: 0, width: 300, height: 300 }]]))).toBe(1);
    expect(shapeSnapshot(doc, id!)?.width).toBe(300);
    expect(deleteObjects(doc, [id!])).toBe(1);
    expect(shapeSnapshot(doc, id!)).toBeUndefined();
  });

  it('a shape created on a board of sticky notes leaves the notes alone', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    createShape(doc, { at: { x: 0, y: 0 } }, 'dana');
    const stickies = objectSnapshots(doc).filter((s) => s.type === 'sticky');
    expect(stickies).toHaveLength(2);
    expect(stickies.map((s) => s.id).sort()).toEqual([a, b].sort());
    // A sticky note that carries no size still renders at its default square next to
    // the new type (TC-33's rule).
    expect(objectBounds(objectSnapshots(doc).find((s) => s.id === a)!)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });
});
