/**
 * Unit tests for the shape object model (story 10, `shape.model`, TC-01 to TC-06).
 *
 * A real `Y.Doc`, as the story 2 and story 9 model tests use one: the document is the thing under test,
 * and the two questions it has to answer are "what is stored" and "how many transactions did that cost".
 * The second is not a detail — a write that changes nothing puts a sync message on the wire and an empty
 * step in five people's undo histories, which is why almost every assertion here is paired with a count
 * of updates.
 *
 * What a shape *looks like* is deliberately absent: this file checks that the document holds the key
 * `"diamond"` and never that a diamond has four points, because the picture is the registry's and a test
 * of the picture belongs to the component suite.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_FILL_COLORS,
  type ShapeKind,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  SHAPE_OBJECT_TYPE,
  createShape,
  defaultShapeRect,
  getShapeLabel,
  getShapeText,
  isShapeSnapshot,
  readShape,
  setShapeStyle,
  shapeFillPaint,
  shapeRectFor,
  shapeSnapshots,
  shapeStrokePaint,
} from '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The shape under test, as the model reports it. Throws when the shape is not there. */
function shapeOf(doc: Y.Doc, id: string) {
  const shape = readShape(doc, id);
  if (shape === null) throw new Error(`no shape "${id}" on the board`);
  return shape;
}

/** A shape read through the board's own snapshot, so the board is what is being asserted. */
function shapeFromBoard(doc: Y.Doc, id: string) {
  const found = snapshot(doc).find((object) => object.id === id);
  if (found === undefined) throw new Error(`the board does not report shape "${id}"`);
  return found;
}

/** A shape written without the model, to reach states the model cannot create. */
function seedShape(
  doc: Y.Doc,
  id: string,
  fields: {
    x?: number;
    y?: number;
    z?: number;
    width?: number;
    height?: number;
    kind?: string;
    fill?: string;
    stroke?: string;
    label?: string;
  } = {},
): Y.Map<unknown> {
  const objects = objectsOf(doc);
  const shape = new Y.Map<unknown>();
  doc.transact(() => {
    shape.set('type', SHAPE_OBJECT_TYPE);
    shape.set('x', fields.x ?? 0);
    shape.set('y', fields.y ?? 0);
    if (fields.width !== undefined) shape.set('width', fields.width);
    if (fields.height !== undefined) shape.set('height', fields.height);
    shape.set('z', fields.z ?? 1);
    shape.set('createdAt', 1_700_000_000_000);
    shape.set('kind', fields.kind ?? 'rect');
    shape.set('fill', fields.fill ?? DEFAULT_SHAPE_FILL);
    shape.set('stroke', fields.stroke ?? DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text(fields.label ?? ''));
    objects.set(id, shape);
  });
  return shape;
}

const AT: Point = { x: 1_000, y: 500 };
const BOX: Rect = { x: 100, y: 100, width: 200, height: 120 };

describe('shape.model createShape', () => {
  it('TC-01: creates a rect at the dragged rect with the default colours, an empty label and z on top', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    createSticky(doc, { x: 0, y: 0 });

    const id = createShape(doc, { kind: 'rect', rect: BOX, at: { x: 200, y: 220 }, createdBy: 'dana' });
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(2); // one for the note above, one for the shape — and nothing else

    const shape = shapeOf(doc, id!);
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect({ x: shape.x, y: shape.y, width: shape.width, height: shape.height }).toEqual(BOX);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    expect(shape.createdBy).toBe('dana');
    expect(shape.z).toBe(2); // above the sticky note that was already there

    // The board itself reports the object, with the box it was given.
    const reported = shapeFromBoard(doc, id!);
    expect(reported.type).toBe(SHAPE_OBJECT_TYPE);
    expect(reported.width).toBe(200);
    expect(reported.height).toBe(120);
  });

  it('TC-01: stores the label as a shared text, and the kind as the key it was given', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'diamond', rect: BOX, at: { x: 200, y: 220 } });
    const shape = shapeOf(doc, id!);
    expect(shape.kind).toBe('diamond');

    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');

    // Typing into it is one transaction of the document's own.
    const updates = countUpdates(doc);
    doc.transact(() => label!.insert(0, 'hi'), LOCAL_ORIGIN);
    expect(updates()).toBe(1);
    expect(shapeOf(doc, id!).label).toBe('hi');
  });

  it('TC-02: a drag too small on either axis becomes the standard size centred on the point', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    const id = createShape(doc, { kind: 'rect', rect: { x: 40, y: 40, width: 19, height: 200 }, at: AT });
    expect(updates()).toBe(1);
    const shape = shapeOf(doc, id!);
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect({ x: shape.x, y: shape.y }).toEqual({
      x: AT.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: AT.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    });

    // The same for a shape that was only too short.
    const other = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 300, height: 4 }, at: AT });
    expect(shapeOf(doc, other!).width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-02: a click — no rect at all — is a standard shape at the point', () => {
    const rect = shapeRectFor({ rect: null, at: AT });
    expect(rect).toEqual(defaultShapeRect(AT));
    expect(shapeRectFor({ at: { x: 0, y: 0 } })).toEqual({
      x: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: -SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('TC-03: exactly the minimum size is kept', () => {
    const rect = shapeRectFor({
      rect: { x: 5, y: 7, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: AT,
    });
    expect(rect).toEqual({ x: 5, y: 7, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD });

    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 5, y: 7, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: AT,
    });
    expect({ x: shapeOf(doc, id!).x, width: shapeOf(doc, id!).width }).toEqual({
      x: 5,
      width: SHAPE_MIN_SIZE_WORLD,
    });
  });

  it('TC-04: square makes the longer side both sides, held at the corner it was dragged from', () => {
    const rect = shapeRectFor({ rect: { x: 30, y: 20, width: 200, height: 120 }, at: { x: 230, y: 140 }, square: true });
    expect(rect).toEqual({ x: 30, y: 20, width: 200, height: 200 });

    // A drag upwards and to the left still owns a box, and its square is held at the box's corner.
    const back = shapeRectFor({ rect: { x: 0, y: 0, width: -80, height: -240 }, at: { x: -80, y: -240 }, square: true });
    expect(back).toEqual({ x: -80, y: -240, width: 240, height: 240 });
  });

  it('TC-04: a square click is still the standard size', () => {
    expect(shapeRectFor({ rect: null, at: AT, square: true })).toEqual(defaultShapeRect(AT));
  });

  it('TC-06: a kind the board cannot draw creates nothing and opens no transaction', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    expect(createShape(doc, { kind: 'triangle', rect: BOX, at: AT })).toBeNull();
    expect(createShape(doc, { kind: '', rect: BOX, at: AT })).toBeNull();
    expect(createShape(doc, { kind: 7 as unknown as string, rect: BOX, at: AT })).toBeNull();
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-06: a point that is not a place creates nothing and opens no transaction', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    expect(createShape(doc, { kind: 'rect', rect: BOX, at: { x: Number.NaN, y: 10 } })).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: BOX, at: { x: 0, y: Number.POSITIVE_INFINITY } })).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: AT })).toBeNull();
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('a box swept the other way round is the same box', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 300, y: 220, width: -200, height: -120 }, at: { x: 100, y: 100 } });
    expect({ x: shapeOf(doc, id!).x, y: shapeOf(doc, id!).y }).toEqual({ x: 100, y: 100 });
  });

  it('a box bigger than the board allows is the biggest box there is', () => {
    const rect = shapeRectFor({
      rect: { x: 0, y: 0, width: MAX_OBJECT_SIZE_WORLD * 3, height: 400 },
      at: AT,
    });
    expect(rect!.width).toBe(MAX_OBJECT_SIZE_WORLD);
  });

  it('every kind the settings list can be created', () => {
    const doc = newDoc();
    for (const kind of SHAPE_KINDS) {
      const id = createShape(doc, { kind, rect: BOX, at: AT });
      expect(shapeOf(doc, id!).kind).toBe(kind);
    }
    expect(shapeSnapshots(doc)).toHaveLength(SHAPE_KINDS.length);
  });
});

describe('shape.model setShapeStyle', () => {
  it('TC-05: choosing a fill changes the fill, costs one transaction and leaves everything else', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: BOX, at: AT });
    doc.transact(() => getShapeLabel(doc, id!)!.insert(0, 'label'), LOCAL_ORIGIN);

    const updates = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(updates()).toBe(1);

    const before = shapeOf(doc, id!);
    expect(before.fill).toBe('blue');
    expect(before.kind).toBe('ellipse');
    expect(before.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(before.label).toBe('label');
    expect({ x: before.x, y: before.y, width: before.width, height: before.height }).toEqual(BOX);
  });

  it('TC-05: a colour the board does not have is refused with false and no transaction', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id!, { stroke: 'ultraviolet' })).toBe(false);
    expect(setShapeStyle(doc, 'no-such-shape', { fill: 'blue' })).toBe(false);
    expect(updates()).toBe(0);
    expect(shapeOf(doc, id!).fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it('a colour already worn is not written again', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id!, { fill: DEFAULT_SHAPE_FILL })).toBe(false);
    expect(updates()).toBe(0);
  });

  it('both colours changed together are one transaction', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id!, { fill: 'pink', stroke: 'red' })).toBe(true);
    expect(updates()).toBe(1);
    const shape = shapeOf(doc, id!);
    expect(shape.fill).toBe('pink');
    expect(shape.stroke).toBe('red');
  });

  it('an empty request and a request of unknown fields change nothing', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id!, {})).toBe(false);
    expect(setShapeStyle(doc, id!, { fill: undefined, stroke: undefined })).toBe(false);
    expect(updates()).toBe(0);
  });

  it('every colour name the settings list is accepted, including no fill at all', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const updates = countUpdates(doc);

    // Walking a whole palette never repeats a write: the only colour already worn when it is asked for is
    // the outline the shape was born wearing, because the walk has moved on from every other one by the
    // time it comes round again.
    for (const fill of Object.keys(SHAPE_FILL_COLORS)) {
      const worn = shapeOf(doc, id!).fill === fill;
      expect(setShapeStyle(doc, id!, { fill })).toBe(!worn);
      expect(shapeOf(doc, id!).fill).toBe(fill);
    }
    for (const stroke of Object.keys(SHAPE_STROKE_COLORS)) {
      const worn = shapeOf(doc, id!).stroke === stroke;
      expect(setShapeStyle(doc, id!, { stroke })).toBe(!worn);
      expect(shapeOf(doc, id!).stroke).toBe(stroke);
    }
    expect(updates()).toBe(Object.keys(SHAPE_FILL_COLORS).length + Object.keys(SHAPE_STROKE_COLORS).length - 1);
  });
});

describe('shape.model readShape', () => {
  it('reports an unknown kind as the default and keeps the colours as they were written', () => {
    const doc = newDoc();
    seedShape(doc, 'from-a-later-story', { kind: 'hexagon', fill: 'teal', stroke: 'plasma', label: 'kept' });

    const shape = shapeOf(doc, 'from-a-later-story');
    expect(shape.kind).toBe<ShapeKind>('rect');
    // A colour this build cannot paint is still the colour somebody chose: it is kept as written and
    // painted with the default, so a story that adds "teal" finds the choice it was waiting for.
    expect(shape.fill).toBe('teal');
    expect(shape.stroke).toBe('plasma');
    expect(shape.label).toBe('kept');
    expect(isShapeSnapshot(shape)).toBe(true);

    expect(shapeFillPaint(shape.fill)).toBe(SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL]);
    expect(shapeStrokePaint(shape.stroke)).toBe(SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]);
  });

  it('paints a known colour name as the colour it names, and no fill as nothing', () => {
    expect(shapeFillPaint('blue')).toBe(SHAPE_FILL_COLORS.blue);
    expect(shapeFillPaint('none')).toBe('transparent');
    expect(shapeStrokePaint('red')).toBe(SHAPE_STROKE_COLORS.red);
  });

  it('gives a shape with no stored box the size a shape is born with', () => {
    const doc = newDoc();
    seedShape(doc, 'sizeless', {});
    const shape = shapeOf(doc, 'sizeless');
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('returns null for an id that is not a shape, and for an object with no place', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    seedShape(doc, 'nowhere', { x: Number.NaN });

    expect(readShape(doc, note!)).toBeNull();
    expect(readShape(doc, 'no-such-id')).toBeNull();
    expect(readShape(doc, 'nowhere')).toBeNull();
    expect(readShape(doc, '')).toBeNull();
  });

  it('a shape whose label field is missing is repaired when the editor asks for it', () => {
    const doc = newDoc();
    const shape = seedShape(doc, 'broken-label', {}) as Y.Map<unknown>;
    doc.transact(() => shape.set('label', 'not a shared text'), LOCAL_ORIGIN);

    expect(getShapeText(doc, 'broken-label')).toBe('');
    const label = getShapeLabel(doc, 'broken-label');
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  it('reports shapes in stacking order, and nothing else', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const first = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    const second = createShape(doc, { kind: 'ellipse', rect: BOX, at: { x: 0, y: 0 } });

    expect(shapeSnapshots(doc).map((shape) => shape.id)).toEqual([first, second]);
    expect(snapshot(doc).map((object) => object.type)).toEqual(['sticky', 'shape', 'shape']);
  });

  it('isShapeSnapshot recognises the board’s own snapshot of a shape', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: BOX, at: AT });
    // Selection, hit-testing and the object registry all read the *generic* snapshot, so a shape that was a
    // shape only to `shapeSnapshots` would be drawn and then refused by every pointer that touched it. The
    // type registers its own fields with the board model for exactly this reason: one read of the document,
    // and every reader of it agrees about what the object is.
    const generic = snapshot(doc).find((object) => object.id === id)!;
    expect(isShapeSnapshot(generic)).toBe(true);
    expect(generic).toMatchObject({ kind: 'rect', fill: 'white', stroke: 'dark', label: '' });
    expect(isShapeSnapshot(shapeOf(doc, id!))).toBe(true);
    expect(isShapeSnapshot(undefined)).toBe(false);
    expect(isShapeSnapshot(null)).toBe(false);
  });
});
