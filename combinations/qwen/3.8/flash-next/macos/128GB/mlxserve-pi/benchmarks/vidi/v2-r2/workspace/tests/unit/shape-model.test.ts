// The shape object model (story 10): creation by drag and by click, the Shift
// constraint, the two colours and the label. Framework-free, so this is a plain
// Y.Doc over Node, no jsdom - the same level story 9 proved its model at.
// TC ids are the Acceptance Cases in
// spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md.
//
// Every case counts `update` events, because "the document did not change" is the
// only way to prove a rejection wrote nothing: a function that returns false
// after opening a transaction would leave an empty update on the wire for a peer
// to receive.

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShape,
  getShapeLabel,
  readShape,
  setShapeStyle,
  shapeSnapshot,
  shapeSnapshots,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  TYPE_CONNECTOR,
  TYPE_SHAPE,
  TYPE_TEXT,
} from '../../src/shared/config';
import { createSticky, deleteObjects, snapshotByCreation } from '../../src/shared/board-model';
import { putRawObject, rawObject } from '../helpers/yjs';

/** How many object entries the document holds, of any type. */
function objectCount(doc: Y.Doc): number {
  return doc.getMap<unknown>('objects').size;
}

/** How many `update` events one call produced. */
function updatesOf(doc: Y.Doc, write: () => unknown): number {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  write();
  doc.off('update', listener);
  return updates;
}

/** A shape drawn by dragging from `from` to `to`, the way the tool does it. */
function drag(doc: Y.Doc, from: { x: number; y: number }, to: { x: number; y: number }, square = false) {
  return createShape(
    doc,
    {
      kind: 'rect',
      at: from,
      rect: {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      },
      square,
    },
    'g_tester',
  );
}

describe("createShape (TC-01, TC-02, TC-03, TC-04, TC-06)", () => {
  // TC-01: a drag of 200 × 120 makes a shape of exactly that size and position.
  it("TC-01 draws a shape exactly covering the dragged rect, above every object, with the default colours", () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 900, y: 900 });
    putRawObject(doc, 'text_high', { type: TYPE_TEXT, z: 40, createdAt: 2 });

    const before = Date.now();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'g_dana',
    );
    expect(id).not.toBeNull();

    expect(shapeSnapshots(doc)).toHaveLength(1);
    const object = rawObject(doc, id!)!;
    expect(object.get('type')).toBe(TYPE_SHAPE);
    expect(object.get('kind')).toBe('rect');
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(100);

    const snap = shapeSnapshot(doc, id!) as ShapeSnapshot;
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(120);
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('');
    expect(snap.createdBy).toBe('g_dana');
    expect(snap.createdAt).toBeGreaterThanOrEqual(before);

    // one object, one transaction, one update
    expect(updatesOf(doc, () => {})).toBe(0);
    // above every other object, whatever type it is
    expect(Number(object.get('z'))).toBeGreaterThan(40);
    expect(Number(object.get('z'))).toBeGreaterThan(Number(rawObject(doc, note)!.get('z')));
    expect(object.get('text')).toBeUndefined(); // a label is not a note's text
    expect(object.get('label')).toBeInstanceOf(Y.Text);
  });

  it("TC-01 creates one shape per call and never rewrites the objects around it", () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const before = rawObject(doc, note)!.get('x');

    const first = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 60 }, at: { x: 0, y: 0 } }, 'g_a');
    const second = createShape(doc, { kind: 'ellipse', rect: { x: 10, y: 10, width: 100, height: 60 }, at: { x: 10, y: 10 } }, 'g_a');

    expect(first).not.toBe(second);
    expect(shapeSnapshots(doc)).toHaveLength(2);
    expect(rawObject(doc, note)!.get('x')).toBe(before);
    expect(snapshotByCreation(doc)).toHaveLength(1); // the note is still the only note
  });

  // TC-02: a click - and a drag too small to be a shape - both drop a standard size.
  it("TC-02 drops a standard-size shape centred on the point for a click and for a too-small drag", () => {
    const doc = new Y.Doc();
    const at = { x: 500, y: 300 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    const clicked = createShape(doc, { kind: 'diamond', rect: null, at }, 'g_dana');
    const tiny = createShape(
      doc,
      { kind: 'rect', rect: { x: at.x, y: at.y, width: 19, height: 200 }, at },
      'g_dana',
    );

    for (const id of [clicked, tiny] as string[]) {
      const snap = shapeSnapshot(doc, id) as ShapeSnapshot;
      expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.x).toBe(at.x - half);
      expect(snap.y).toBe(at.y - half);
    }
    // the standard size is the setting, and it is a square
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBe(160);
  });

  it("TC-02 treats a too-short drag in either direction as a click", () => {
    const doc = new Y.Doc();
    const at = { x: 40, y: 60 };
    for (const rect of [
      { x: at.x, y: at.y, width: SHAPE_MIN_SIZE_WORLD - 0.001, height: 400 },
      { x: at.x, y: at.y, width: 400, height: SHAPE_MIN_SIZE_WORLD - 0.001 },
    ]) {
      const id = createShape(doc, { kind: 'ellipse', rect, at }, 'g_dana');
      const snap = shapeSnapshot(doc, id!) as ShapeSnapshot;
      expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    }
  });

  // TC-03: the boundary itself is kept, not replaced by the standard size.
  it("TC-03 keeps a drag of exactly the minimum size", () => {
    const doc = new Y.Doc();
    const at = { x: -20, y: 70 };
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: at.x, y: at.y, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at,
      },
      'g_dana',
    );
    const snap = shapeSnapshot(doc, id!) as ShapeSnapshot;
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.x).toBe(at.x);
    expect(snap.y).toBe(at.y);
  });

  it("TC-03 keeps a backwards drag as the same shape as the forwards one", () => {
    const doc = new Y.Doc();
    const forwards = drag(doc, { x: 100, y: 100 }, { x: 300, y: 220 });
    const backwards = drag(doc, { x: 300, y: 220 }, { x: 100, y: 100 });
    const a = shapeSnapshot(doc, forwards!) as ShapeSnapshot;
    const b = shapeSnapshot(doc, backwards!) as ShapeSnapshot;
    expect([b.x, b.y, b.width, b.height]).toEqual([a.x, a.y, a.width, a.height]);
  });

  // TC-04: Shift makes the larger dragged dimension the shape's side.
  it("TC-04 makes a Shift-dragged shape square from its larger dimension, anchored at the drag origin", () => {
    const doc = new Y.Doc();
    const id = drag(doc, { x: 100, y: 100 }, { x: 300, y: 220 }, true);
    const snap = shapeSnapshot(doc, id!) as ShapeSnapshot;
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
  });

  it("TC-04 squares from the taller dimension too, and never beyond the largest size", () => {
    const doc = new Y.Doc();
    const tall = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 0, y: 0, width: 60, height: 240 }, at: { x: 0, y: 0 }, square: true },
      'g_dana',
    );
    expect(shapeSnapshot(doc, tall!) as ShapeSnapshot).toMatchObject({ width: 240, height: 240, x: 0, y: 0 });

    const huge = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: MAX_OBJECT_SIZE_WORLD * 4, height: 100 },
        at: { x: 0, y: 0 },
        square: true,
      },
      'g_dana',
    );
    const clamped = shapeSnapshot(doc, huge!) as ShapeSnapshot;
    expect(clamped.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(clamped.height).toBe(MAX_OBJECT_SIZE_WORLD);
  });

  // TC-06: the error path writes nothing at all.
  it("TC-06 refuses a kind this build does not know, without a transaction", () => {
    const doc = new Y.Doc();
    const updates = updatesOf(doc, () =>
      createShape(
        doc,
        { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'g_dana',
      ),
    );
    expect(updates).toBe(0);
    expect(objectCount(doc)).toBe(0);
  });

  it("TC-06 refuses a rect or a point that is not a place, without a transaction", () => {
    const doc = new Y.Doc();
    const bad = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      null,
      'x',
    ];
    let updates = 0;
    for (const value of bad) {
      updates += updatesOf(doc, () =>
        createShape(
          doc,
          { kind: 'rect', rect: { x: 0, y: 0, width: value as never, height: 100 }, at: { x: 0, y: 0 } },
          'g_dana',
        ),
      );
      updates += updatesOf(doc, () =>
        createShape(doc, { kind: 'rect', rect: null, at: { x: value as never, y: 0 } }, 'g_dana'),
      );
    }
    expect(updates).toBe(0);
    expect(shapeSnapshots(doc)).toHaveLength(0);
  });

  it("TC-06 refuses a request that is not a request, without a transaction", () => {
    const doc = new Y.Doc();
    expect(updatesOf(doc, () => createShape(doc, undefined as never, 'g_dana'))).toBe(0);
    expect(updatesOf(doc, () => createShape(doc, null as never, 'g_dana'))).toBe(0);
    // a rect that is there but is not a size is not a place either
    expect(
      updatesOf(doc, () =>
        createShape(doc, { kind: 'rect', rect: { x: 0, y: 0 } as never, at: { x: 0, y: 0 } }, 'g_dana'),
      ),
    ).toBe(0);
    expect(objectCount(doc)).toBe(0);
  });

  it("TC-06 leaves a shape it cannot read undrawn rather than guessing a kind", () => {
    const doc = new Y.Doc();
    putRawObject(doc, 'shape_alien', {
      type: TYPE_SHAPE,
      kind: 'hexagon',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      z: 1,
      createdAt: 1,
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: new Y.Text(''),
    });
    expect(shapeSnapshots(doc)).toHaveLength(0);
    expect(readShape('shape_alien', rawObject(doc, 'shape_alien')!)).toBeNull();
    // and a shape whose label is not a shared text is not a shape either
    const damaged = putRawObject(doc, 'shape_nolabel', {
      type: TYPE_SHAPE,
      kind: 'rect',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      z: 1,
      createdAt: 1,
      text: null,
      label: 'a plain string is not a shared text',
    });
    expect(readShape('shape_nolabel', damaged)).toBeNull();
  });

  it("TC-01 draws shapes in creation order and skips every other type", () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const first = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_a')!;
    const second = createShape(doc, { kind: 'diamond', rect: null, at: { x: 900, y: 0 } }, 'g_a')!;
    putRawObject(doc, 'connector_x', { type: TYPE_CONNECTOR, x: 0, y: 0, z: 3, createdAt: 1 });
    expect(shapeSnapshots(doc).map((s) => s.id)).toEqual([first, second]);
    expect(SHAPE_KINDS).toEqual(['rect', 'ellipse', 'diamond']);
  });
});

describe("setShapeStyle (TC-05)", () => {
  let doc = new Y.Doc();
  let id = '';

  beforeEach(() => {
    doc = new Y.Doc();
    id = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 300, y: 300 } }, 'g_dana')!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
  });

  // TC-05: the fill swatch changes one key.
  it("TC-05 applies a known fill name in one update and touches nothing else", () => {
    const before = shapeSnapshot(doc, id)!;
    const updates = updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(updates).toBe(1);
    const after = shapeSnapshot(doc, id)!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe(before.stroke);
    expect(after.label).toBe('Checkout');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.z).toBe(before.z);
    expect(after.kind).toBe(before.kind);
  });

  it("TC-05 applies a known outline name, and both at once in one update", () => {
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { stroke: 'red' }))).toBe(1);
    expect(shapeSnapshot(doc, id)!.stroke).toBe('red');
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'none', stroke: 'grey' }))).toBe(1);
    const after = shapeSnapshot(doc, id)!;
    expect(after.fill).toBe('none');
    expect(after.stroke).toBe('grey');
    // 'none' is a fill the palette names: no fill at all, drawn transparent
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
  });

  it("TC-05 refuses a colour the palette does not name, with no update at all", () => {
    const before = shapeSnapshot(doc, id)!;
    for (const colour of ['teal', '', 'NONE', 'Dark', 'blueish']) {
      expect(setShapeStyle(doc, id, { fill: colour })).toBe(false);
      expect(setShapeStyle(doc, id, { stroke: colour })).toBe(false);
    }
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'teal' }))).toBe(0);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { stroke: 'teal' }))).toBe(0);
    // one good colour and one bad one in one request: nothing is written, so a
    // swatch click never half-applies
    expect(setShapeStyle(doc, id, { fill: 'blue', stroke: 'teal' })).toBe(false);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'blue', stroke: 'teal' }))).toBe(0);
    expect(shapeSnapshot(doc, id)).toEqual(before);
  });

  it("TC-05 writes nothing when the shape already has that colour, and nothing for a stale id", () => {
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: DEFAULT_SHAPE_FILL }))).toBe(0);
    expect(setShapeStyle(doc, id, { fill: DEFAULT_SHAPE_FILL })).toBe(true);
    expect(updatesOf(doc, () => setShapeStyle(doc, 'g_one', { fill: 'blue' }))).toBe(0);
    expect(updatesOf(doc, () => setShapeStyle(doc, '', { fill: 'blue' }))).toBe(0);
    // a colour of another type's is not this shape's either
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(updatesOf(doc, () => setShapeStyle(doc, note, { fill: 'blue' }))).toBe(0);
  });

  it("TC-05 does nothing for a request naming no colour", () => {
    expect(updatesOf(doc, () => setShapeStyle(doc, id, {}))).toBe(0);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, undefined as never))).toBe(0);
    expect(shapeSnapshot(doc, id)!.fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it("TC-05 keeps a shape whose stored colour is unknown visible in the default colour", () => {
    // a newer client added a colour this build does not know: the shape is not
    // hidden, and neither is the label inside it
    putRawObject(doc, 'shape_new', {
      type: TYPE_SHAPE,
      kind: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      z: 1,
      createdAt: 5,
      fill: 'lavender',
      stroke: 'ultramarine',
      label: new Y.Text('From the future'),
    });
    const snap = shapeSnapshot(doc, 'shape_new')!;
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('From the future');
    expect(Object.keys(SHAPE_STROKE_COLORS)).toHaveLength(6);
  });

  it("TC-05 hands out the label as the shared text typing writes into", () => {
    const label = getShapeLabel(doc, id)!;
    expect(label).toBeInstanceOf(Y.Text);
    const updates = updatesOf(doc, () => label.insert(label.toString().length, ' now'));
    expect(updates).toBe(1);
    expect(shapeSnapshot(doc, id)!.label).toBe('Checkout now');
    expect(getShapeLabel(doc, 'g_one')).toBeUndefined();
  });

  it("TC-05 leaves a deleted shape alone, and a delete takes its label with it", () => {
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(updatesOf(doc, () => setShapeStyle(doc, id, { fill: 'blue' }))).toBe(0);
    expect(getShapeLabel(doc, id)).toBeUndefined();
    expect(shapeSnapshots(doc)).toHaveLength(0);
  });
});
