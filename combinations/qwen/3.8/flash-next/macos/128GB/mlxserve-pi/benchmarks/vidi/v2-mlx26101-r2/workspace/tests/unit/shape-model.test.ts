/**
 * The shape model - `tests/unit/shape-model.test.ts`.
 *
 * Everything the Shape tool does to the shared document goes through
 * `src/shared/objects/shape.ts`, and the behaviour a later story depends on is
 * all here: a drag makes a shape of exactly the rectangle dragged, a click (or a
 * drag too small to mean anything) makes a standard-size one, Shift squares it
 * off, an unknown kind or a non-finite rectangle writes nothing, a colour change
 * touches one field, and an unknown colour or a stale id writes nothing at all.
 *
 * Every case counts the `update` events the document emits, because "no
 * transaction was opened" is not observable any other way - and a rejected action
 * that still produced an update would be a sync message and an undo step for
 * something the user never got.
 *
 * These are Y.Doc-only tests: no component, no SVG, no layout. The centring and
 * wrapping of a label is `shape.ui` and belongs to the component and e2e suites.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createSticky,
  DOC_OBJECTS_MAP,
  initDoc,
  objectBounds,
  objectSnapshot,
  snapshot,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_FILL_COLORS,
  type ShapeKind,
} from '../../src/shared/config.js';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnap,
} from '../../src/shared/objects/shape.js';

const newDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

const mapOf = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => objectsMap(doc).get(id);

/** Count the transactions a call actually puts on the document. */
const countUpdates = (doc: Y.Doc, run: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    run();
  } finally {
    doc.off('update', observer);
  }
  return updates;
};

/** The one shape in the document, as the board sees it. */
const shapeOf = (doc: Y.Doc, id: string): ShapeSnap => {
  const shape = objectSnapshot(doc).find((object) => object.id === id) as ShapeSnap | undefined;
  if (shape === undefined) throw new Error(`no shape in the snapshot at ${id}`);
  return shape;
};

/** Create a shape by dragging a rectangle, and hand back its id. */
const dragShape = (
  doc: Y.Doc,
  rect: { x: number; y: number; width: number; height: number } | null,
  kind: ShapeKind = 'rect',
  at: { x: number; y: number } = { x: 200, y: 160 },
  square = false,
): string => {
  const id = createShape(doc, { kind, rect, at, square }, 'g_local');
  if (typeof id !== 'string') throw new Error('the shape was not created');
  return id;
};

describe('shape.model: creating a shape', () => {
  it('TC-01 creates a shape exactly covering the dragged rectangle', () => {
    const doc = newDoc();
    // A note first, so "z = maxZ + 1" is a comparison and not a guess.
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(typeof note).toBe('string');

    let created = '';
    const updates = countUpdates(doc, () => {
      created = dragShape(doc, { x: 100, y: 100, width: 200, height: 120 });
    });

    expect(updates).toBe(1);
    const shape = shapeOf(doc, created);
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 100, 200, 120]);
    expect(objectBounds(shape)).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    expect(shape.z).toBe((mapOf(doc, note as string)!.get('z') as number) + 1);
    expect(shape.createdBy).toBe('g_local');
    expect(mapOf(doc, created)!.get('label')).toBeInstanceOf(Y.Text);
    expect(snapshot(doc)).toHaveLength(1); // the sticky reader still sees only notes
    expect(objectSnapshot(doc)).toHaveLength(2);
  });

  it('TC-02 drops a standard-size shape for a click and for a tiny drag', () => {
    const doc = newDoc();
    const at = { x: 500, y: 300 };

    // A drag 19 units wide is under the minimum in one direction, so it is a click.
    let tiny = '';
    let updates = countUpdates(doc, () => {
      tiny = dragShape(doc, { x: 490, y: 200, width: 19, height: 200 }, 'rect', at);
    });
    expect(updates).toBe(1);
    expect(objectBounds(shapeOf(doc, tiny))).toEqual({
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });

    // And the same for a click, which arrives as no rectangle at all.
    let click = '';
    updates = countUpdates(doc, () => {
      click = dragShape(doc, null, 'diamond', at);
    });
    expect(updates).toBe(1);
    expect(objectBounds(shapeOf(doc, click))).toEqual({
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
    expect(shapeOf(doc, click).kind).toBe('diamond');
  });

  it('TC-03 keeps a drag of exactly the minimum size as drawn', () => {
    const doc = newDoc();
    const rect = { x: 40, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    let id = '';
    const updates = countUpdates(doc, () => {
      id = dragShape(doc, rect, 'ellipse', { x: 50, y: 70 });
    });
    expect(updates).toBe(1);
    expect(objectBounds(shapeOf(doc, id))).toEqual(rect);
  });

  it('TC-04 makes Shift square the shape off at the drag origin', () => {
    const doc = newDoc();
    const rect = { x: 50, y: 40, width: 200, height: 120 };
    let id = '';
    const updates = countUpdates(doc, () => {
      id = dragShape(doc, rect, 'rect', { x: 50, y: 40 }, true);
    });
    expect(updates).toBe(1);
    // Both sides are the larger of the two dragged dimensions, anchored where the
    // drag began - the corner the pointer started at does not move.
    expect(objectBounds(shapeOf(doc, id))).toEqual({ x: 50, y: 40, width: 200, height: 200 });
  });
});

describe('shape.model: colouring a shape', () => {
  it('TC-05 applies a known colour and refuses an unknown one without writing', () => {
    const doc = newDoc();
    const id = dragShape(doc, { x: 100, y: 100, width: 200, height: 120 });
    const before = shapeOf(doc, id);
    getShapeLabel(doc, id)!.insert(0, 'Checkout');

    let applied = false;
    let updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'blue' });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    const after = shapeOf(doc, id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe(before.stroke);
    expect(after.label).toBe('Checkout');
    expect(objectBounds(after)).toEqual(objectBounds(before));

    // An unknown colour name is not a colour: false, and no update at all.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'teal' });
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);

    // The same for an outline colour, which is its own palette.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { stroke: 'red' });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    expect(shapeOf(doc, id).stroke).toBe('red');
    expect(shapeOf(doc, id).fill).toBe('blue');

    // A stale id changes nothing either.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, 'g_missing', { fill: 'blue' });
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);

    // "No fill" is a colour as far as the document is concerned.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'none' });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    expect(shapeOf(doc, id).fill).toBe('none');
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
    expect(SHAPE_STROKE_COLORS.dark).toBe('#263238');

    // A style call that changes nothing writes nothing.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'none' });
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);

    // And a two-key call whose *outline* is invalid writes neither key.
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'green', stroke: 'teal' });
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(shapeOf(doc, id).fill).toBe('none');
  });

  it('getShapeLabel hands the editor the shape text and nothing for a stranger', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    const id = dragShape(doc, null);
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, note as string)).toBeUndefined();
    expect(getShapeLabel(doc, 'g_missing')).toBeUndefined();
  });
});

describe('shape.model: errors write nothing', () => {
  it('TC-06 refuses an unknown kind and a non-finite rectangle', () => {
    const doc = newDoc();

    let updates = countUpdates(doc, () => {
      expect(createShape(doc, { kind: 'triangle' as ShapeKind, rect: null, at: { x: 0, y: 0 } }, 'g'))
        .toBeNull();
    });
    expect(updates).toBe(0);

    updates = countUpdates(doc, () => {
      expect(
        createShape(
          doc,
          { kind: 'rect', rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: { x: 0, y: 0 } },
          'g',
        ),
      ).toBeNull();
      expect(
        createShape(
          doc,
          {
            kind: 'rect',
            rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 },
            at: { x: 0, y: 0 },
          },
          'g',
        ),
      ).toBeNull();
      expect(
        createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 10 } }, 'g'),
      ).toBeNull();
    });
    expect(updates).toBe(0);

    // Nothing was written, in any direction.
    expect(objectsMap(doc).size).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});
