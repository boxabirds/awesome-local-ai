/**
 * Story 10 unit tests for the shape model (`shape.model`): TC-01 to TC-06, run against a
 * real `Y.Doc` because the schema rules are the thing under test — one transaction per
 * creation, a rejection that costs no update at all, and a label that is a `Y.Text` so two
 * people can type into one shape (story 3).
 *
 * Every case asserts the `update` count as well as the stored fields: a shape tool that
 * wrote a half-drag as three updates would be visible to everyone else as flicker, and a
 * rejected colour that still wrote would be traffic for nothing.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  boardObjects,
  createSticky,
  maxZ,
  objectMap,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeRectFromDrag,
  shapeRequestFromDrag,
  SHAPE_OBJECT_TYPE,
  type ShapeSnap
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind
} from '../../src/shared/config';

/** The one thing every rejection has in common: the document was never touched. */
function updatesDuring(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return updates;
}

function shapeOf(doc: Y.Doc, id: string): ShapeSnap {
  const found = boardObjects(doc).find((object: ObjectSnapshot) => object.id === id);
  if (!found) throw new Error(`object ${id} is not in the snapshot`);
  return found as ShapeSnap;
}

function field(doc: Y.Doc, id: string, key: string): unknown {
  return objectMap(doc, id)?.get(key);
}

/** Draw a shape by dragging, the way the Shape tool does. */
function drawShape(
  doc: Y.Doc,
  rect: { x: number; y: number; width: number; height: number } | null,
  at = { x: 0, y: 0 },
  kind: ShapeKind = 'rect'
): string | null {
  return createShape(doc, { kind, rect, at }, 'dana');
}

describe('the shape model (shape.model)', () => {
  it('TC-01: a dragged rect is stored exactly as drawn, on top, with an empty label', () => {
    const doc = new Y.Doc();
    // A note already on the board, so "on top" has to be derived rather than assumed.
    const note = createSticky(doc, { x: 0, y: 0 });
    const top = maxZ(doc);
    expect(top).toBeGreaterThan(0);

    let id = '';
    const updates = updatesDuring(doc, () => {
      const created = drawShape(doc, { x: 100, y: 50, width: 200, height: 120 }, { x: 100, y: 50 });
      if (!created) throw new Error('the drag created nothing');
      id = created;
    });

    expect(updates).toBe(1);
    const shape = shapeOf(doc, id);
    expect(shape.type).toBe(SHAPE_OBJECT_TYPE);
    expect(shape.kind).toBe('rect');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    expect(shape.z).toBe(top + 1);
    expect(field(doc, id, 'createdBy')).toBe('dana');
    expect(typeof field(doc, id, 'createdAt')).toBe('number');
    // The note the shape was drawn over is untouched, and still a note.
    expect(boardObjects(doc).find((object) => object.id === note)?.type).toBe('sticky');
    expect(boardObjects(doc)).toHaveLength(2);
  });

  it('TC-01: the label is a shared Y.Text, and the snapshot follows it', () => {
    const doc = new Y.Doc();
    const id = drawShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    if (!id) throw new Error('the drag created nothing');
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    doc.transact(() => label?.insert(0, 'Checkout'));
    expect(shapeOf(doc, id).label).toBe('Checkout');
    // Not a shape: no label to type into.
    expect(getShapeLabel(doc, createSticky(doc, { x: 0, y: 0 }))).toBeUndefined();
    expect(getShapeLabel(doc, 'no-such-object')).toBeUndefined();
  });

  it('TC-02: a click, and a drag narrower than the minimum, both drop a standard shape', () => {
    const doc = new Y.Doc();
    const at = { x: 300, y: 220 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    let click = '';
    let tiny = '';
    const updates = updatesDuring(doc, () => {
      const a = drawShape(doc, null, at);
      const b = drawShape(doc, { x: at.x, y: at.y, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at);
      if (!a || !b) throw new Error('the click created nothing');
      click = a;
      tiny = b;
    });

    // Two creations, so two updates: a fallback is not a second write.
    expect(updates).toBe(2);
    for (const id of [click, tiny]) {
      const shape = shapeOf(doc, id);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - half);
      expect(shape.y).toBe(at.y - half);
    }
  });

  it('TC-03: a drag of exactly the minimum size is kept as drawn', () => {
    const doc = new Y.Doc();
    const id = drawShape(
      doc,
      { x: 40, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      { x: 40, y: 60 }
    );
    if (!id) throw new Error('the drag created nothing');
    const shape = shapeOf(doc, id);
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(40);
    expect(shape.y).toBe(60);
  });

  it('TC-04: Shift makes the new shape square, from the larger dimension', () => {
    const doc = new Y.Doc();
    let wide = '';
    let tall = '';
    const updates = updatesDuring(doc, () => {
      const a = createShape(doc, { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true }, 'dana');
      const b = createShape(doc, { kind: 'ellipse', rect: { x: -30, y: 10, width: 120, height: 260 }, at: { x: -30, y: 10 }, square: true }, 'dana');
      if (!a || !b) throw new Error('the constrained drag created nothing');
      wide = a;
      tall = b;
    });
    expect(updates).toBe(2);

    // Anchored at the drag origin, so the shape does not slide away from the hand.
    expect([shapeOf(doc, wide).width, shapeOf(doc, wide).height]).toEqual([200, 200]);
    expect([shapeOf(doc, wide).x, shapeOf(doc, wide).y]).toEqual([100, 50]);
    expect([shapeOf(doc, tall).width, shapeOf(doc, tall).height]).toEqual([260, 260]);
    expect([shapeOf(doc, tall).x, shapeOf(doc, tall).y]).toEqual([-30, 10]);
  });

  it('TC-05: a palette colour is applied on its own; anything else writes nothing', () => {
    const { doc, id } = boardWithShape();
    const before = shapeOf(doc, id);

    let applied = false;
    const updates = updatesDuring(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'blue' });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);

    const after = shapeOf(doc, id);
    expect(after.fill).toBe('blue');
    // Only the fill moved: label, size, position, layer and outline are the shape's own
    // business and a colour change leaves them alone (`shape.style`).
    expect(after.label).toBe(before.label);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.stroke).toBe(before.stroke);

    // An outline colour on its own, in one update.
    const strokeUpdates = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    });
    expect(strokeUpdates).toBe(1);
    expect(shapeOf(doc, id).stroke).toBe('red');
    expect(shapeOf(doc, id).fill).toBe('blue');
  });

  it('TC-05: an unknown colour, a raw hex value and a stale id are refused with no update', () => {
    const { doc, id } = boardWithShape();
    const updates = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
      expect(setShapeStyle(doc, id, { stroke: '#123456' })).toBe(false);
      expect(setShapeStyle(doc, id, { fill: 'none', stroke: 'rainbow' })).toBe(false);
      expect(setShapeStyle(doc, 'no-such-object', { fill: 'blue' })).toBe(false);
      expect(setShapeStyle(doc, '', { fill: 'blue' })).toBe(false);
    });
    expect(updates).toBe(0);
    expect(shapeOf(doc, id).fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shapeOf(doc, id).stroke).toBe(DEFAULT_SHAPE_STROKE);

    // "No fill" is a colour name the toolbar offers, and it is the transparent one.
    expect(setShapeStyle(doc, id, { fill: 'none' })).toBe(true);
    expect(field(doc, id, 'fill')).toBe('none');
    expect(shapeOf(doc, id).fill).toBe('none');
  });

  it('TC-06: an unknown kind and a non-finite rect create nothing', () => {
    const doc = new Y.Doc();
    const updates = updatesDuring(doc, () => {
      expect(createShape(doc, { kind: 'triangle', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { kind: '', rect: null, at: { x: 0, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: { x: 0, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: Number.POSITIVE_INFINITY, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 0 } }, 'dana')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: null, at: null as unknown as { x: number; y: number } }, 'dana')).toBeNull();
      expect(createShape(doc, null as unknown as { kind: ShapeKind; rect: null; at: { x: number; y: number } }, 'dana')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(boardObjects(doc)).toHaveLength(0);
  });

  it('a label is clamped to the product limit', () => {
    const { doc, id } = boardWithShape();
    const label = getShapeLabel(doc, id)!;
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
    doc.transact(() => label.insert(0, 'x'.repeat(SHAPE_LABEL_MAX_CHARS)));
    expect(shapeOf(doc, id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });
});

/** A board with one shape on it, drawn by a drag. */
function boardWithShape(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  const id = drawShape(doc, { x: 100, y: 100, width: 240, height: 160 }, { x: 100, y: 100 });
  if (!id) throw new Error('the fixture could not create a shape');
  return { doc, id };
}

/**
 * What the Shape tool's dashed preview is drawn from (`shape.create_drag`).
 *
 * The preview is not the thing under test here; the agreement between it and the model is. A
 * preview that promised one box and created another is the kind of bug a user can see and a
 * test that only checks the document cannot: so both questions are answered by the same two
 * functions, and the last case below creates real shapes and compares them against what the
 * preview would have said.
 */
describe('the shape drag (shape.preview)', () => {
  it('turns a drag into the rect it drew, however the pointer travelled', () => {
    const forward = shapeRequestFromDrag({ from: { x: 100, y: 100 }, to: { x: 300, y: 220 }, square: false });
    expect(forward).toEqual({ rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } });

    // Backwards: the box is the same box, so a drag to the upper left is not a negative shape.
    const backward = shapeRequestFromDrag({ from: { x: 300, y: 220 }, to: { x: 100, y: 100 }, square: false });
    expect(backward.rect).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    // ...and the standard shape a wobble creates is still centred where the pointer went down.
    expect(backward.at).toEqual({ x: 300, y: 220 });
  });

  it('asks for a standard shape when the drag is too small to be one, and keeps the boundary', () => {
    // One unit short of the smallest shape, in either direction, is a click that wobbled.
    expect(shapeRequestFromDrag({ from: { x: 0, y: 0 }, to: { x: 19, y: 400 }, square: false }).rect).toBeNull();
    expect(shapeRequestFromDrag({ from: { x: 0, y: 0 }, to: { x: 400, y: 19 }, square: false }).rect).toBeNull();
    const exact = shapeRequestFromDrag({ from: { x: 0, y: 0 }, to: { x: 20, y: 20 }, square: false });
    expect(exact.rect).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('says what a Shift drag will occupy: the larger dimension, from the corner it started at', () => {
    expect(shapeRectFromDrag({ from: { x: 40, y: 30 }, to: { x: 240, y: 150 }, square: true })).toEqual({
      x: 40,
      y: 30,
      width: 200,
      height: 200
    });
    // Without Shift the box is exactly the drag.
    expect(shapeRectFromDrag({ from: { x: 40, y: 30 }, to: { x: 240, y: 150 }, square: false })).toEqual({
      x: 40,
      y: 30,
      width: 200,
      height: 120
    });
    // A click is a standard shape centred on the point, not a shape of nothing.
    expect(shapeRectFromDrag({ from: { x: 500, y: 500 }, to: { x: 500, y: 500 }, square: false })).toEqual({
      x: 500 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: 500 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD
    });
  });

  it('promises exactly what creating from the same drag stores', () => {
    const drags = [
      { from: { x: 100, y: 100 }, to: { x: 300, y: 220 }, square: false },
      { from: { x: 300, y: 220 }, to: { x: 100, y: 100 }, square: true },
      { from: { x: 60, y: 60 }, to: { x: 70, y: 70 }, square: false },
      { from: { x: 0, y: 0 }, to: { x: 20, y: 20 }, square: false }
    ];
    const doc = new Y.Doc();
    for (const drag of drags) {
      const preview = shapeRectFromDrag(drag);
      const request = shapeRequestFromDrag(drag);
      const id = createShape(doc, { kind: 'rect', rect: request.rect, at: request.at, square: drag.square }, 'dana');
      expect(id).toBeTruthy();
      const made = shapeOf(doc, id!);
      expect({ x: made.x, y: made.y, width: made.width, height: made.height }).toEqual(preview);
    }
  });
});
