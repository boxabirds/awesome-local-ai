/**
 * Story 10: the shape object in the document — what it stores, and the calls that
 * make and restyle one.
 *
 * A shape is a box, a kind and a style, so the tests are mostly about the two places
 * a box comes from (a dragged box, or the default box a click means) and about the
 * palette being a closed set: a document must never hold a colour the board cannot
 * draw. As in story 7, "exactly one update" is counted on the doc itself, because a
 * mutation that arrives as several updates is several undo steps to somebody else.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { initDoc, objectSnapshot, objectSnapshots } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import {
  clampShapeLabel,
  createShape,
  getShapeLabel,
  isFillColor,
  isStrokeColor,
  readShape,
  readShapes,
  shapeLabelDisplay,
  setShapeStyle,
  shapeBoxOf,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';

/** Run `fn`, counting how many `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

function create(doc: Y.Doc, input: Parameters<typeof createShape>[1]): string | null {
  return createShape(doc, input, 'g_a');
}

const click = { x: 500, y: 300 };

describe('shape.model — createShape', () => {
  it('TC-01: stores the dragged box, with the common fields', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { result: id, updates } = withUpdateCount(doc, () =>
      create(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: false }),
    );
    expect(updates).toBe(1);
    const shape = readShape(doc, id!);
    expect(shape).toMatchObject({
      type: 'shape',
      kind: 'rect',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      z: 1,
      createdBy: 'g_a',
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: '',
    });
  });

  it('TC-03: keeps a drag of exactly the minimum size as drawn', () => {
    const doc = new Y.Doc();
    const exact = create(doc, { kind: 'rect', rect: { x: 40, y: 40, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 40, y: 40 }, square: false })!;
    expect(readShape(doc, exact)).toMatchObject({
      x: 40,
      y: 40,
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });
  });

  it('normalises a drag drawn backwards', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: { x: 300, y: 300, width: -200, height: -120 }, at: { x: 300, y: 300 }, square: false })!;
    expect(readShape(doc, id)).toMatchObject({ x: 100, y: 180, width: 200, height: 120 });
  });

  it('TC-02: uses the default box, centred on the press point, for a click', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'ellipse', rect: null, at: click, square: false })!;
    expect(readShape(doc, id)).toMatchObject({
      kind: 'ellipse',
      x: click.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: click.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('TC-02: uses the default box for a drag one unit under the threshold', () => {
    const doc = new Y.Doc();
    const id = create(doc, {
      kind: 'rect',
      rect: { x: click.x, y: click.y, width: SHAPE_MIN_SIZE_WORLD - 1, height: 400 },
      at: click,
      square: false,
    })!;
    expect(readShape(doc, id)).toMatchObject({
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('TC-04: takes the larger dragged dimension for a square, held at the corner it started from', () => {
    const doc = new Y.Doc();
    const dragged = create(doc, { kind: 'diamond', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true })!;
    expect(readShape(doc, dragged)).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });

    // The same box dragged up-left keeps the corner the pointer left from.
    const backwards = create(doc, { kind: 'diamond', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 300, y: 220 }, square: true })!;
    expect(readShape(doc, backwards)).toMatchObject({ x: 100, y: 20, width: 200, height: 200 });
  });

  it('stacks a new shape on top of everything already there', () => {
    const doc = new Y.Doc();
    create(doc, { kind: 'rect', rect: null, at: click, square: false });
    create(doc, { kind: 'rect', rect: null, at: click, square: false });
    const third = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    const shapes = readShapes(doc);
    expect(shapes.map((shape) => shape.z)).toEqual([1, 2, 3]);
    expect(readShape(doc, third)!.z).toBe(3);
  });

  it('TC-06: refuses a kind that is not one, and a press point that is not a place', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      create(doc, { kind: 'hexagon', rect: null, at: click, square: false }),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(
      create(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 }, square: false }),
    ).toBeNull();
    expect(
      create(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 10 }, at: click, square: false }),
    ).toBeNull();
    expect(readShapes(doc)).toHaveLength(0);
  });

  it('shapes every kind, and only the kinds, the settings list', () => {
    const doc = new Y.Doc();
    for (const kind of SHAPE_KINDS) {
      expect(create(doc, { kind, rect: null, at: click, square: false })).toBeTruthy();
    }
    expect(readShapes(doc)).toHaveLength(SHAPE_KINDS.length);
  });
});

describe('shape.model — style', () => {
  it('TC-05: applies a fill and an outline from the palettes, one update each', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    const { result, updates } = withUpdateCount(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(readShape(doc, id)).toMatchObject({ fill: 'blue', stroke: DEFAULT_SHAPE_STROKE });

    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(readShape(doc, id)).toMatchObject({ fill: 'blue', stroke: 'red' });
  });

  it('applies both at once in one update', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    const { result, updates } = withUpdateCount(doc, () =>
      setShapeStyle(doc, id, { fill: 'none', stroke: 'blue' }),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(readShape(doc, id)).toMatchObject({ fill: 'none', stroke: 'blue' });
  });

  it('refuses a colour that is not on the palette, a missing object and a non-shape', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    const textId = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    doc.getMap<Y.Map<unknown>>('objects').get(textId)!.set('type', 'text');

    const { result, updates } = withUpdateCount(doc, () =>
      setShapeStyle(doc, id, { fill: 'magenta' }),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(setShapeStyle(doc, id, { stroke: 'purple' })).toBe(false);
    expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, textId, { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, {})).toBe(false);
    expect(readShape(doc, id)).toMatchObject({ fill: DEFAULT_SHAPE_FILL });
  });

  it('knows its palettes, including "no fill"', () => {
    expect(isFillColor('none')).toBe(true);
    expect(isFillColor('dark')).toBe(false);
    expect(isStrokeColor('dark')).toBe(true);
    expect(isStrokeColor('none')).toBe(false);
    expect(Object.keys(SHAPE_FILL_COLORS)).toHaveLength(7);
    expect(Object.keys(SHAPE_STROKE_COLORS)).toHaveLength(6);
  });
});

describe('shape.model — label', () => {
  it('keeps its label in a shared text of its own', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    const text = getShapeLabel(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    doc.transact(() => text!.applyDelta([{ insert: 'Checkout' }]), 'g_other');
    expect(readShape(doc, id)!.label).toBe('Checkout');
    expect(getShapeLabel(doc, 'gone')).toBeUndefined();
  });

  it('TC-06: holds 500 characters and cuts anything longer', () => {
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
    const long = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    expect(clampShapeLabel(long)).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(clampShapeLabel('short')).toBe('short');
    expect(clampShapeLabel('x'.repeat(SHAPE_LABEL_MAX_CHARS))).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('cuts an over-long label written by somebody else when reading it back', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'rect', rect: null, at: click, square: false })!;
    doc.transact(() => {
      getShapeLabel(doc, id)!.applyDelta([{ insert: 'y'.repeat(900) }]);
    }, 'g_other');
    // The document holds every character somebody wrote; what is drawn is cut short.
    expect(readShape(doc, id)!.label).toHaveLength(900);
    expect(shapeLabelDisplay(readShape(doc, id)!.label)).toHaveLength(
      SHAPE_LABEL_MAX_CHARS + 1,
    );
    expect(shapeLabelDisplay('Checkout')).toBe('Checkout');
  });
});

describe('shape.model — snapshot', () => {
  it('carries kind, fill, stroke and label, defaulting anything missing', () => {
    const doc = new Y.Doc();
    const id = create(doc, { kind: 'ellipse', rect: null, at: click, square: false })!;
    const snap = objectSnapshot(doc, id) as ShapeSnapshot | null;
    expect(snap).toMatchObject({ type: 'shape', kind: 'ellipse', fill: 'white', stroke: 'dark', label: '' });
    expect(snap!.width).toBeGreaterThan(0);

    // A shape entry written without a style reads as the default style.
    const entry = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    entry.delete('fill');
    entry.delete('stroke');
    entry.set('kind', 'blob');
    expect(objectSnapshot(doc, id)).toMatchObject({
      kind: 'rect',
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
    });
  });

  it('appears in the board snapshots alongside the other objects', () => {
    const doc = new Y.Doc();
    create(doc, { kind: 'rect', rect: null, at: click, square: false });
    const shapes = objectSnapshots(doc).filter((object) => object.type === 'shape');
    expect(shapes).toHaveLength(1);
  });

  it('writes exactly one update per mutation', () => {
    const doc = new Y.Doc();
    const created = withUpdateCount(doc, () => create(doc, { kind: 'rect', rect: null, at: click, square: false }));
    expect(created.updates).toBe(1);
    const styled = withUpdateCount(doc, () => setShapeStyle(doc, created.result!, { fill: 'pink' }));
    expect(styled.updates).toBe(1);
  });
});

describe('shape.model — the box a request means', () => {
  it('is the dragged box when it is big enough', () => {
    expect(shapeBoxOf({ x: 0, y: 0, width: 300, height: 40 }, { x: 0, y: 0 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 40,
    });
  });

  it('is the default box centred on the press point otherwise', () => {
    expect(shapeBoxOf({ x: 100, y: 100, width: 3, height: 3 }, { x: 101, y: 101 }, false)).toEqual(
      shapeBoxOf(null, { x: 101, y: 101 }, false),
    );
  });
});
