import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  createSticky,
  deleteObjects,
  initDoc,
  objectBounds,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
  isShapeKind,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  SHAPE_TYPE,
  type ShapeSnapshot,
  asShapeSnapshot,
  createShape,
  getShapeLabel,
  setShapeRect,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import { proseOfLength } from '../fixtures/texts';

/**
 * shape.model unit tests (TC-01 to TC-06) against a **real** `Y.Doc`, in the idiom story 2 and
 * story 9 established for a model test: the document is the thing under test, so nothing about it
 * is mocked.
 *
 * Every case counts the doc's `update` events as well as its answer - one per write that was
 * accepted, none for a rejection - because story 3 turns each one into sync traffic: a shape model
 * that writes what the document already holds, or that "fixes up" a value it was handed that it
 * does not recognise, is a bug nobody can see on their own screen.
 */

interface Counted<T> {
  result: T;
  updates: number;
  origins: unknown[];
}

/** Run `run` while counting the doc's `update` events and the origins that caused them. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const observer = (_update: Uint8Array, origin: unknown): void => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates, origins };
  } finally {
    doc.off('update', observer);
  }
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsOf(doc).get(id);
}

/** One shape on the board, as the board reads it; throws when there is not exactly one. */
function onlyShape(doc: Y.Doc): ShapeSnapshot {
  const shapes = snapshot(doc).filter((object) => object.type === SHAPE_TYPE);
  if (shapes.length !== 1) {
    throw new Error(`expected exactly one shape on the board, found ${shapes.length}`);
  }
  const shape = asShapeSnapshot(shapes[0]);
  if (shape === null) {
    throw new Error('the shape on the board does not read as a shape');
  }
  return shape;
}

/** The shape with this id, as the board reads it. */
function shapeOf(doc: Y.Doc, id: string): ShapeSnapshot {
  const found = snapshot(doc).find((object) => object.id === id);
  if (found === undefined) {
    throw new Error(`no shape ${id} on the board`);
  }
  const shape = asShapeSnapshot(found);
  if (shape === null) {
    throw new Error(`object ${id} does not read as a shape`);
  }
  return shape;
}

/** The box a click at `at` makes: the standard size, centred on the point. */
function clicked(at: { x: number; y: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

describe('shape.model: createShape', () => {
  it('TC-01: a drag of 200x120 makes a 200x120 white shape with a dark outline, in one update', () => {
    const doc = newDoc();
    const { result: id, updates, origins } = countUpdates(doc, () =>
      createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
        'g_test',
      ),
    );

    expect(id).toBeTruthy();
    expect(updates, 'one shape is one change to the board').toBe(1);
    expect(origins[0], 'the board writes as itself, which is what undo reads').toBe(LOCAL_ORIGIN);

    const shape = onlyShape(doc);
    expect(shape.id).toBe(id);
    expect(shape.type).toBe(SHAPE_TYPE);
    expect(shape.kind).toBe('rect');
    // The drag's own box, corner for corner: 100% zoom, screen pixels are world units.
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.fill).toBe('white');
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.stroke).toBe('dark');
    expect(shape.label).toBe('');
    expect(shape.createdBy).toBe('g_test');

    const raw = rawObject(doc, id as string);
    expect(typeof raw?.get('createdAt')).toBe('number');
    expect(raw?.get('z')).toBe(1);
    // The label is a `Y.Text` from the beginning, even empty: two people typing into one shape
    // merge letter by letter the way they do in a note or a piece of free text (story 3).
    expect(raw?.get('label'), 'the label is a Y.Text, so peers merge into it').toBeInstanceOf(Y.Text);
    expect((raw?.get('label') as Y.Text).length).toBe(0);
  });

  it('TC-02: a drag of 19x200 and a click with no rect both give the standard size, centred on the point', () => {
    const doc = newDoc();

    // A drag too narrow in one direction to be a shape anybody drew.
    const narrow = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 300, y: 200, width: 19, height: 200 }, at: { x: 300, y: 200 } },
      'me',
    ) as string;
    expect(shapeOf(doc, narrow)).toMatchObject(clicked({ x: 300, y: 200 }));

    // A click: nothing but a point, and no rect at all.
    const click = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 300, y: 200 } }, 'me');
    expect(click).toBeTruthy();
    expect(shapeOf(doc, click as string)).toMatchObject(clicked({ x: 300, y: 200 }));

    // The other direction, and a drag of no width at all (a line).
    const flat = createShape(
      doc,
      { kind: 'diamond', rect: { x: 40, y: 60, width: 200, height: 3 }, at: { x: 40, y: 60 } },
      'me',
    ) as string;
    expect(shapeOf(doc, flat)).toMatchObject(clicked({ x: 40, y: 60 }));
    const line = createShape(
      doc,
      { kind: 'rect', rect: { x: 500, y: 400, width: 0, height: 120 }, at: { x: 500, y: 400 } },
      'me',
    ) as string;
    expect(shapeOf(doc, line)).toMatchObject(clicked({ x: 500, y: 400 }));

    // Centred means the point is in the middle of the box, not at its corner: a shape dropped at a
    // point sits around it, which is where the pointer still is.
    expect(shapeOf(doc, narrow).x + shapeOf(doc, narrow).width / 2).toBe(300);
    expect(shapeOf(doc, narrow).y + shapeOf(doc, narrow).height / 2).toBe(200);
  });

  it('TC-03: a drag of exactly the minimum size is kept as it was drawn', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 50, y: 50 },
      },
      'me',
    ) as string;
    expect(shapeOf(doc, id)).toMatchObject({
      x: 50,
      y: 50,
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });

    // One unit less on either side is below the minimum, and so is a click.
    const less = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD - 1, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 50, y: 50 },
      },
      'me',
    ) as string;
    expect(shapeOf(doc, less).width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-04: Shift takes the longer dragged dimension for both sides, anchored at the drag origin', () => {
    const doc = newDoc();
    const wide = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: 200, height: 120 },
        at: { x: 0, y: 0 },
        square: true,
      },
      'me',
    ) as string;
    expect(shapeOf(doc, wide)).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });

    // The taller drag grows its width, not its height: the side is the larger of the two.
    const tall = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 10, y: 20, width: 40, height: 260 },
        at: { x: 10, y: 20 },
        square: true,
      },
      'me',
    ) as string;
    expect(shapeOf(doc, tall)).toMatchObject({ x: 10, y: 20, width: 260, height: 260 });

    // The same drag without Shift is the rectangle somebody drew.
    const plain = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } },
      'me',
    ) as string;
    expect(shapeOf(doc, plain).height).toBe(120);

    // A square drag is unaffected, and a square click is still the standard size.
    const square = createShape(
      doc,
      {
        kind: 'diamond',
        rect: { x: 5, y: 5, width: 120, height: 120 },
        at: { x: 5, y: 5 },
        square: true,
      },
      'me',
    ) as string;
    expect(shapeOf(doc, square)).toMatchObject({ width: 120, height: 120 });
    const click = createShape(
      doc,
      { kind: 'rect', rect: null, at: { x: 300, y: 300 }, square: true },
      'me',
    ) as string;
    expect(shapeOf(doc, click)).toMatchObject(clicked({ x: 300, y: 300 }));
  });

  it('makes every kind the product offers, and reads each one back', () => {
    const doc = newDoc();
    expect(SHAPE_KINDS).toEqual(['rect', 'ellipse', 'diamond']);

    for (const kind of SHAPE_KINDS) {
      const id = createShape(
        doc,
        { kind, rect: { x: 20, y: 20, width: 100, height: 60 }, at: { x: 20, y: 20 } },
        'me',
      );
      expect(id, `${kind} is a shape the product offers`).toBeTruthy();
      expect(shapeOf(doc, id as string).kind).toBe(kind);
    }

    for (const kind of ['triangle', 'RECT', 'circle', '', 'square', 42, null, undefined]) {
      expect(isShapeKind(kind), `${String(kind)} is not a shape kind`).toBe(false);
    }
  });

  it('TC-06: rejects a kind it does not know and a box that is not a box, without a transaction', () => {
    const doc = newDoc();

    for (const kind of ['triangle', 'RECT', 'square', ''] as unknown as ShapeKind[]) {
      const { result, updates } = countUpdates(doc, () =>
        createShape(doc, { kind, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'me'),
      );
      expect(result, `${kind} is not a shape`).toBeNull();
      expect(updates, 'a rejected shape costs no sync traffic').toBe(0);
    }

    // Not-a-number and infinity are not places, and a shape drawn at one could not be selected,
    // hit or undone from (story 9 made the same rule for a text object's box).
    const boxes = [
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: Number.NaN, width: 100, height: 100 },
      { x: 0, y: 0, width: Number.NaN, height: 100 },
      { x: 0, y: 0, width: 100, height: Number.NaN },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
      { x: 0, y: 0, width: 100, height: Number.NEGATIVE_INFINITY },
    ];
    for (const rect of boxes) {
      const { result, updates } = countUpdates(doc, () =>
        createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'me'),
      );
      expect(result, `${JSON.stringify(rect)} is not a box`).toBeNull();
      expect(updates).toBe(0);
    }

    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 4 },
      { x: 3, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = countUpdates(doc, () =>
        createShape(doc, { kind: 'rect', rect: null, at }, 'me'),
      );
      expect(result, `${JSON.stringify(at)} is not a point`).toBeNull();
      expect(updates).toBe(0);
    }

    // A point is only needed when there is no box to draw: a box that is not a box is a mistake
    // wherever it came from, and is not quietly replaced by a standard shape at another point.
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('rejects an empty author name rather than storing a shape nobody made', () => {
    const doc = newDoc();
    const { result, updates } = countUpdates(doc, () =>
      createShape(doc, { kind: 'rect', rect: null, at: { x: 1, y: 1 } }, ''),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('stacks each new shape above everything already on the board', () => {
    const doc = newDoc();
    const first = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;
    const second = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 10, y: 0 } }, 'me') as string;
    const note = createSticky(doc, { x: 0, y: 300 }) as string;
    const third = createShape(doc, { kind: 'diamond', rect: null, at: { x: 20, y: 0 } }, 'me') as string;

    const zOf = (id: string): number => snapshot(doc).find((object) => object.id === id)?.z ?? -1;
    expect(zOf(second)).toBeGreaterThan(zOf(first));
    expect(zOf(third)).toBeGreaterThan(zOf(note));
    expect(zOf(third)).toBeGreaterThan(zOf(second));
  });
});

describe('shape.model: setShapeStyle', () => {
  it('TC-05: takes a colour from the palette and refuses one that is not in it', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;
    getShapeLabel(doc, id)?.insert(0, 'a label');

    const applied = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(applied.result).toBe(true);
    expect(applied.updates, 'a colour the shape does not already have is one change').toBe(1);
    expect(shapeOf(doc, id).fill).toBe('blue');

    // A colour the product does not have is an error, not a colour to round to the nearest one.
    for (const fill of ['teal', '#FF00FF', '', 'White', 42] as unknown as string[]) {
      const { result, updates } = countUpdates(doc, () => setShapeStyle(doc, id, { fill }));
      expect(result, `${String(fill)} is not a fill the product has`).toBe(false);
      expect(updates, 'a rejected write must cost no sync traffic').toBe(0);
    }
    for (const stroke of ['teal', '#FF00FF', ''] as unknown as string[]) {
      const { result, updates } = countUpdates(doc, () => setShapeStyle(doc, id, { stroke }));
      expect(result, `${String(stroke)} is not an outline colour`).toBe(false);
      expect(updates).toBe(0);
    }
    expect(shapeOf(doc, id).fill, 'a rejected colour left the one it had in place').toBe('blue');

    // The colour it already has is not a change, so it is not a message to anybody else either.
    expect(countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'blue' })).updates).toBe(0);

    // Nothing else about the shape moved.
    const shape = shapeOf(doc, id);
    expect(shape.label).toBe('a label');
    expect(shape).toMatchObject({ x: -80, y: -80, width: 160, height: 160, kind: 'rect' });

    // Every colour the toolbar offers is a colour the document can hold - `none` included, which is
    // a shape with no fill rather than a shape with no colour.
    for (const fill of Object.keys(SHAPE_FILL_COLORS) as FillColor[]) {
      expect(setShapeStyle(doc, id, { fill }), `${fill} is a fill the toolbar offers`).toBe(true);
      expect(shapeOf(doc, id).fill).toBe(fill);
    }
    for (const stroke of Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]) {
      // The first of them is the colour the shape already has, and the rule that a colour it does not
      // have costs one update has an obvious other half: the colour it has costs none.
      const had = shapeOf(doc, id).stroke === stroke;
      const { result, updates } = countUpdates(doc, () => setShapeStyle(doc, id, { stroke }));
      expect(result, `${stroke} is an outline colour`).toBe(!had);
      expect(updates, 'a colour the shape already has is not a change').toBe(had ? 0 : 1);
      expect(shapeOf(doc, id).stroke).toBe(stroke);
    }

    // A shape that is not there has no style to change, and an empty request changes nothing.
    expect(setShapeStyle(doc, 'missing', { fill: 'white' })).toBe(false);
    expect(countUpdates(doc, () => setShapeStyle(doc, id, {})).updates).toBe(0);

    // Both at once is still one change to one object.
    const both = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'pink', stroke: 'red' }));
    expect(both.result).toBe(true);
    expect(both.updates).toBe(1);
    expect(shapeOf(doc, id)).toMatchObject({ fill: 'pink', stroke: 'red' });

    expect(SHAPE_STROKE_WIDTH_WORLD, 'an outline is drawn at a set thickness').toBeGreaterThan(0);
  });

  it('leaves the label text alone when it changes the colours, and the colours alone when it moves the shape', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 0, y: 0 } }, 'me') as string;
    const label = getShapeLabel(doc, id);
    label?.insert(0, 'Pay');

    const raw = rawObject(doc, id);
    const beforeKind = raw?.get('kind');
    const beforeZ = raw?.get('z');
    const beforeAuthor = raw?.get('createdBy');

    setShapeStyle(doc, id, { fill: 'green', stroke: 'blue' });
    expect(raw?.get('kind'), 'a shape is not changed into another shape by painting it').toBe(beforeKind);
    expect(raw?.get('z'), 'a colour is not a reason to reorder the board').toBe(beforeZ);
    expect(raw?.get('createdBy')).toBe(beforeAuthor);
    expect(label?.toString()).toBe('Pay');

    setShapeRect(doc, id, { x: 10, y: 10, width: 90, height: 70 });
    expect(shapeOf(doc, id)).toMatchObject({ fill: 'green', stroke: 'blue', kind: 'ellipse' });
    expect(label?.toString(), 'moving a shape does not lose what is written in it').toBe('Pay');
  });
});

describe('shape.model: getShapeLabel', () => {
  it('TC-05b: gives the editor a Y.Text, and the limit is what typing is held to', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;

    const label = getShapeLabel(doc, id);
    expect(label, 'a shape is born with somewhere to type its label').toBeInstanceOf(Y.Text);

    const long = proseOfLength(600);
    expect(long.length).toBeGreaterThan(SHAPE_LABEL_MAX_CHARS);
    // What the shape's own editor keeps is the first 500 characters and nothing else - the same
    // rule a note's text follows, at the shape's own limit (see `ShapeObject`).
    const kept = clampToLimit(long, SHAPE_LABEL_MAX_CHARS);
    expect(kept).toBe(long.slice(0, SHAPE_LABEL_MAX_CHARS));

    const { updates } = countUpdates(doc, () => {
      label?.insert(0, kept);
    });
    expect(updates).toBe(1);
    expect(shapeOf(doc, id).label).toBe(kept);

    // A label is a merge: what a second person typed into the same shape is still there.
    countUpdates(doc, () => {
      label?.insert(kept.length, ' peer');
    });
    expect(shapeOf(doc, id).label).toBe(`${kept} peer`);

    // There is no label to be had on an object that is not a shape, or on one that is gone.
    expect(getShapeLabel(doc, 'missing')).toBeUndefined();
    const note = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(getShapeLabel(doc, note), 'a note has a text, not a label').toBeUndefined();
    deleteObjects(doc, [id]);
    expect(getShapeLabel(doc, id)).toBeUndefined();
  });
});

describe('shape.model: setShapeRect', () => {
  it('TC-06b: takes a box, holds a dragged resize to the minimum, and refuses nonsense', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;

    const applied = countUpdates(doc, () =>
      setShapeRect(doc, id, { x: 5, y: 6, width: 300, height: 200 }),
    );
    expect(applied.result).toBe(true);
    expect(applied.updates, 'a box the shape does not have is one change').toBe(1);
    expect(shapeOf(doc, id)).toMatchObject({ x: 5, y: 6, width: 300, height: 200 });

    // The same box again is not a change.
    expect(
      countUpdates(doc, () => setShapeRect(doc, id, { x: 5, y: 6, width: 300, height: 200 })).updates,
    ).toBe(0);

    // A resize dragged smaller than the smallest shape the product draws stops at the minimum, and
    // still does what the drag was doing.
    expect(setShapeRect(doc, id, { x: 5, y: 6, width: 3, height: 3 })).toBe(true);
    expect(shapeOf(doc, id)).toMatchObject({
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });

    for (const box of [
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: Number.NaN, width: 100, height: 100 },
      { x: 0, y: 0, width: Number.NaN, height: 100 },
      { x: 0, y: 0, width: 100, height: Number.POSITIVE_INFINITY },
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: -20 },
    ]) {
      const { result, updates } = countUpdates(doc, () => setShapeRect(doc, id, box));
      expect(result, `${JSON.stringify(box)} is not a box`).toBe(false);
      expect(updates).toBe(0);
    }

    // A shape that is not there cannot be resized - including one that has just been deleted.
    expect(setShapeRect(doc, 'missing', { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
    deleteObjects(doc, [id]);
    expect(setShapeRect(doc, id, { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
  });

  it('does not bring a shape to the front when it is resized', () => {
    const doc = newDoc();
    const first = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;
    createShape(doc, { kind: 'ellipse', rect: null, at: { x: 400, y: 0 } }, 'me');

    const raw = rawObject(doc, first);
    const beforeZ = raw?.get('z');
    setShapeRect(doc, first, { x: 10, y: 10, width: 120, height: 120 });
    expect(raw?.get('z')).toBe(beforeZ);
  });
});

describe('shape objects as the board reads them', () => {
  it('TC-06c: a shape whose kind or colours were not written by this product reads as the defaults', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') as string;

    // Not the model writing garbage, but a document that arrived with it in - an older client, a
    // hand-written import, a field corrupted in storage. The shape is still drawn, at the defaults,
    // in the one place the default is decided (`asShapeSnapshot`, like a text object's size).
    countUpdates(doc, () => {
      rawObject(doc, id)?.set('fill', '#FF00FF');
      rawObject(doc, id)?.set('stroke', 'magenta');
      rawObject(doc, id)?.set('kind', 'hexagon');
    });

    const shape = onlyShape(doc);
    expect(shape.fill, 'a colour the product does not have is drawn as the default').toBe('white');
    expect(shape.stroke).toBe('dark');
    expect(shape.kind, 'a kind the product does not have is drawn as a rectangle').toBe('rect');
  });

  it('takes its box from the board, so selection, handles and arrows all aim at the same rectangle', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 } },
      'me',
    ) as string;
    const object = snapshot(doc).find((candidate) => candidate.id === id);
    expect(object).toBeDefined();
    // `objectBounds` is what story 7's selection outline and resize handles are drawn from, and
    // what an arrow's side anchor is computed from. A diamond's bounds are its drawing box - the
    // box it is drawn inside, not the eight-sided outline of the shape itself - which is what lets
    // an arrow attach to a diamond at the midpoint of a side.
    expect(objectBounds(object!)).toEqual({ x: 100, y: 50, width: 200, height: 120 });
  });
});
