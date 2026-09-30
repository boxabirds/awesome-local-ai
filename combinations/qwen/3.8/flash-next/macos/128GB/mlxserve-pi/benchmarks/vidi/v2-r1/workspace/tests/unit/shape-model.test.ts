// `shape.model` — the shape object's document contract, tested against a real Y.Doc
// (design: Mock vs real boundaries — "Y.Doc: Real").
//
// TC-01 to TC-06. The document is real because the thing under test *is* the
// document: which fields a shape carries, which rectangle a drag becomes, and which
// writes are refused without a transaction.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
//       (shape.model)
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config';
import { createSticky, initDoc, snapshotObjects } from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  isShapeSnapshot,
  readShapeSnapshot,
  setShapeStyle,
  type CreateShapeOptions,
} from '../../src/shared/objects/shape';

const CREATED_BY = 'g_test';

/** A board document with the schema in place, as the client leaves it. */
const seed = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const raw = (doc: Y.Doc, id: string): Y.Map<unknown> => {
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(object instanceof Y.Map)) throw new Error(`"${id}" is not in the document`);
  return object;
};

/** Count the transactions that touched the document while `body` ran. */
const updatesDuring = (doc: Y.Doc, body: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  body();
  doc.off('update', observer);
  return updates;
};

/** Create a shape and fail loudly rather than quietly testing nothing. */
const make = (doc: Y.Doc, options: CreateShapeOptions): string => {
  const id = createShape(doc, options, CREATED_BY);
  if (id === null) throw new Error('createShape refused a shape it should have drawn');
  return id;
};

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('shape object model (shape.model)', () => {
  // TC-01: a drag draws exactly the rectangle it covered, in the default colours,
  // with an empty label of its own, above everything else.
  it('TC-01 creates a shape covering the dragged rectangle', () => {
    const doc = seed();
    const note = createSticky(doc, { x: 10, y: 10 });
    const noteZ = raw(doc, note).get('z') as number;

    let id = '';
    const updates = updatesDuring(doc, () => {
      id = make(doc, { kind: 'rect', rect: rect(100, 100, 200, 120) });
    });

    expect(updates).toBe(1);
    const object = raw(doc, id);
    expect(object.get('type')).toBe('shape');
    expect(object.get('kind')).toBe('rect');
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(100);
    expect(object.get('width')).toBe(200);
    expect(object.get('height')).toBe(120);
    expect(object.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(object.get('fill')).toBe('white');
    expect(object.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(object.get('stroke')).toBe('dark');
    expect(object.get('createdBy')).toBe(CREATED_BY);
    expect((object.get('z') as number) > noteZ).toBe(true);
    const label = object.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect((label as Y.Text).toString()).toBe('');

    // And the generic snapshot sees it, with its label as a string.
    const shapes = snapshotObjects(doc).filter(isShapeSnapshot);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.id).toBe(id);
    expect(shapes[0]?.label).toBe('');
    expect(shapes[0]?.kind).toBe('rect');
  });

  // TC-02: a click, and a drag too small to be a size, both drop a standard shape
  // centred on the point.
  it('TC-02 drops a standard shape centred on the point for a click and a small drag', () => {
    const doc = seed();
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    const clicked = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 500, y: 300 } }, CREATED_BY);
    const dragged = createShape(
      doc,
      { kind: 'rect', rect: rect(200, 200, 19, 200), at: { x: 210, y: 300 } },
      CREATED_BY,
    );

    expect(clicked).not.toBeNull();
    expect(dragged).not.toBeNull();
    for (const id of [clicked, dragged]) {
      if (id === null) continue;
      const object = raw(doc, id);
      expect(object.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(object.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    }
    // Centred: the click is the middle of the shape, not its corner.
    expect(raw(doc, clicked as string).get('x')).toBe(500 - half);
    expect(raw(doc, clicked as string).get('y')).toBe(300 - half);
    expect(raw(doc, dragged as string).get('x')).toBe(210 - half);
    expect(raw(doc, dragged as string).get('y')).toBe(300 - half);
  });

  // TC-03: the minimum size is a floor, not a threshold that throws away a shape
  // drawn exactly at it.
  it('TC-03 keeps a drag of exactly the minimum size as drawn', () => {
    const doc = seed();
    const id = make(doc, {
      kind: 'diamond',
      rect: rect(50, 50, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD),
    });
    expect(raw(doc, id).get('width')).toBe(20);
    expect(raw(doc, id).get('height')).toBe(20);
    expect(raw(doc, id).get('x')).toBe(50);
  });

  // TC-04: Shift makes it a square out of the corner the drag started at.
  it('TC-04 makes a square anchored at the drag origin when Shift is held', () => {
    const doc = seed();
    const id = make(doc, { kind: 'rect', rect: rect(100, 100, 200, 120), square: true });
    const object = raw(doc, id);
    expect(object.get('width')).toBe(200);
    expect(object.get('height')).toBe(200);
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(100);

    // The shorter edge driving: a tall thin drag becomes a tall square.
    const tall = make(doc, { kind: 'rect', rect: rect(400, 10, 40, 300), square: true });
    expect(raw(doc, tall).get('width')).toBe(300);
    expect(raw(doc, tall).get('height')).toBe(300);
  });

  // TC-05: a swatch paints the shape and nothing else; a colour the palette has never
  // heard of is refused without a transaction.
  it('TC-05 paints with a known colour and refuses an unknown one without a transaction', () => {
    const doc = seed();
    const id = make(doc, { kind: 'rect', rect: rect(0, 0, 200, 120) });
    const label = getShapeLabel(doc, id);
    if (label === undefined) throw new Error('a shape has no label to type into');
    label.insert(0, 'hello');

    const updates = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    });
    expect(updates).toBe(1);

    const object = raw(doc, id);
    expect(object.get('fill')).toBe('blue');
    // The colours changed and nothing else did (TC-05's "label and size unchanged").
    expect(object.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(object.get('width')).toBe(200);
    expect(object.get('height')).toBe(120);
    expect(object.get('x')).toBe(0);
    expect(object.get('y')).toBe(0);
    expect(label.toString()).toBe('hello');
    expect(readShapeSnapshot(doc, id)?.label).toBe('hello');

    // 'teal' is not in the palette: refused, and the document did not move at all.
    const none = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    });
    expect(none).toBe(0);
    expect(raw(doc, id).get('fill')).toBe('blue');

    // A stale id and a shape that is not a shape are refused the same way.
    expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(setShapeStyle(doc, note, { fill: 'blue' })).toBe(false);

    // Asking for the colour it already has is not a change.
    expect(
      updatesDuring(doc, () => {
        expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false);
      }),
    ).toBe(0);

    // 'none' is a colour: the shape becomes unfilled.
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(raw(doc, id).get('stroke')).toBe('red');
    expect(setShapeStyle(doc, id, { fill: 'none', stroke: 'dark' })).toBe(true);
    expect(raw(doc, id).get('fill')).toBe('none');
    expect(raw(doc, id).get('stroke')).toBe('dark');
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
  });

  // TC-06: a kind nothing draws, and a rectangle with numbers missing from it, write
  // nothing at all.
  it('TC-06 refuses an unknown kind and a non-finite rectangle', () => {
    const doc = seed();
    const updates = updatesDuring(doc, () => {
      expect(
        createShape(doc, { kind: 'triangle' as ShapeKind, rect: rect(0, 0, 100, 100) }, CREATED_BY),
      ).toBeNull();
      expect(
        createShape(doc, { kind: 'rect', rect: rect(Number.NaN, 0, 100, 100) }, CREATED_BY),
      ).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, Infinity) }, CREATED_BY)).toBeNull();
      // Nowhere on the board to put it: neither a rectangle nor a point.
      expect(createShape(doc, { kind: 'rect', rect: null, at: null }, CREATED_BY)).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 4 } }, CREATED_BY)).toBeNull();
    });
    expect(updates).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  // The label is a shared Y.Text with a limit of its own, not a note's.
  it('carries a label that is a shared string of its own', () => {
    const doc = seed();
    const id = make(doc, { kind: 'ellipse', rect: rect(0, 0, 100, 100) });
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
    // The board reads the characters out of the shared string.
    doc.transact(() => label?.insert(0, 'a label'));
    expect(readShapeSnapshot(doc, id)?.label).toBe('a label');
    expect(snapshotObjects(doc).find(isShapeSnapshot)?.label).toBe('a label');
  });
});
