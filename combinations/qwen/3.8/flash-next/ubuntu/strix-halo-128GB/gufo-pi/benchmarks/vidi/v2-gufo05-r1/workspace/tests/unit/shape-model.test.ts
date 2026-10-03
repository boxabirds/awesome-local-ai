/**
 * The shape model (`shape.model`): create a rectangle, ellipse or diamond by drag or
 * click, colour it, and hold its label in a shared `Y.Text`.
 *
 * These run against a real `Y.Doc` and count its `update` events, because two rules are
 * only visible that way: a rejected creation writes nothing (and so syncs and undoes
 * nothing), and an accepted one is a single change.
 *
 * TC-01 create by drag: 200×120 kept, default colours, empty label, on top, owned
 * TC-02 a click, and a drag too small in one direction, both become the standard square
 * TC-03 a drag of exactly the minimum is kept as drawn (boundary)
 * TC-04 Shift squares the drag to its larger side, anchored at the origin
 * TC-05 a real colour is applied in one update; a nonsense one writes nothing (negative)
 * TC-06 an unknown kind, or a rectangle that is not a number, creates nothing (error path)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  initDoc,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';

/** Count the `update` events a document fires while a block runs. */
function countUpdates(doc: Y.Doc, run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    run();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** The one shape on the board, or fail with a readable message. */
function theShape(doc: Y.Doc): ShapeSnapshot {
  const shape = objectSnapshots(doc).find((object) => object.type === 'shape');
  if (!shape) throw new Error('no shape on the board');
  return shape as ShapeSnapshot;
}

function shapesOf(doc: Y.Doc): ObjectSnapshot[] {
  return objectSnapshots(doc).filter((object) => object.type === 'shape');
}

describe('shape.model create', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01
  it('TC-01 keeps a dragged rectangle, with default colours, an empty label, on top', () => {
    // Something already on the board, so "on top of everything" is a number to check.
    createSticky(doc, { x: 0, y: 0 });

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 10, y: 20 } }, 'alex') ?? '';
    });

    expect(id).not.toBe('');
    expect(shapesOf(doc)).toHaveLength(1);
    const shape = theShape(doc);
    expect(shape.id).toBe(id);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(20);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    // One sticky (z 1) was already there, so the shape lands on top of it.
    expect(shape.z).toBe(2);
    expect(shape.createdBy).toBe('alex');
    // Creating one shape is one change.
    expect(updates).toBe(1);
  });

  // TC-02
  it('TC-02 a click, and a 19-wide drag, both become the standard square centred on the point', () => {
    const at = { x: 400, y: 300 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    // rect null is a click.
    createShape(doc, { kind: 'ellipse', rect: null, at }, 'alex');
    let shape = theShape(doc);
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x).toBeCloseTo(at.x - half, 6);
    expect(shape.y).toBeCloseTo(at.y - half, 6);

    // A drag one unit narrower than the minimum in one direction is the same square.
    const second = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at },
      'alex',
    );
    expect(second).not.toBeNull();
    shape = objectSnapshots(doc).filter((o) => o.type === 'shape')[1] as ShapeSnapshot;
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x).toBeCloseTo(at.x - half, 6);
    expect(shape.y).toBeCloseTo(at.y - half, 6);
  });

  // TC-03
  it('TC-03 a drag of exactly the minimum in both directions is kept as drawn', () => {
    createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 50, y: 60 },
      },
      'alex',
    );
    const shape = theShape(doc);
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(50);
    expect(shape.y).toBe(60);
  });

  // TC-04
  it('TC-04 Shift squares the drag to its larger side, anchored at the drag origin', () => {
    createShape(
      doc,
      { kind: 'diamond', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 10, y: 20 }, square: true },
      'alex',
    );
    const shape = theShape(doc);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    // Anchored at the drag origin: the top-left corner does not move.
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(20);
  });
});

describe('shape.model style', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } },
      'alex',
    )!;
  });

  // TC-05
  it('TC-05 a real colour is applied in one update and touches nothing else', () => {
    const before = theShape(doc);
    let updates = 0;
    let applied = false;
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'blue' });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    const after = theShape(doc);
    expect(after.fill).toBe('blue');
    // The outline, size, position and label are exactly as they were.
    expect(after.stroke).toBe(before.stroke);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.label).toBe(before.label);
  });

  it('TC-05 an unknown colour name writes nothing and reports false', () => {
    let updates = 0;
    let applied = true;
    updates = countUpdates(doc, () => {
      applied = setShapeStyle(doc, id, { fill: 'teal' });
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(theShape(doc).fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it('a stale id is false, and a shape keeps both colours when asked for them', () => {
    expect(setShapeStyle(doc, 'never-existed', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'green', stroke: 'red' })).toBe(true);
    const shape = theShape(doc);
    expect(shape.fill).toBe('green');
    expect(shape.stroke).toBe('red');
  });
});

describe('shape.model errors', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-06
  it('TC-06 an unknown kind and a non-finite rectangle create nothing and write nothing', () => {
    let updates = 0;
    let kindResult: string | null = 'x';
    let rectResult: string | null = 'x';
    updates = countUpdates(doc, () => {
      // `kind` is typed; a hostile document or a wrong caller can still hand us a string.
      kindResult = createShape(
        doc,
        { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'alex',
      );
      rectResult = createShape(
        doc,
        { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'alex',
      );
    });
    expect(kindResult).toBeNull();
    expect(rectResult).toBeNull();
    expect(updates).toBe(0);
    expect(shapesOf(doc)).toHaveLength(0);
  });

  it('a non-finite click point is rejected too', () => {
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } }, 'alex'),
    ).toBeNull();
    expect(shapesOf(doc)).toHaveLength(0);
  });
});

describe('shape.model label', () => {
  it('getShapeLabel hands back the Y.Text, so two people share it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'alex',
    )!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    doc.transact(() => label?.insert(0, 'hello'));
    expect(theShape(doc).label).toBe('hello');
    expect(getShapeLabel(doc, 'no-such-shape')).toBeUndefined();
  });
});
