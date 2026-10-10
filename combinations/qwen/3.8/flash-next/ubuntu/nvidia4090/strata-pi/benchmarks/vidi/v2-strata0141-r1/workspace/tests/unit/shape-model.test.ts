import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  isShapeSnapshot,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config';

/**
 * Tasks 1-6 (`shape.kind`, `shape.size`, `shape.colours`): the shape model.
 *
 * Every case reads the document back through `objectSnapshots`, because that is
 * what the board renders, and counts `update` events, because "no update" is how
 * the shared model refuses a bad call (design "No throw for user input").
 */

function updatesIn(doc: Y.Doc, run: () => unknown): number {
  let count = 0;
  const listener = (): void => {
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

/** The one shape on the board, as the render model sees it. */
function onlyShape(doc: Y.Doc): ShapeSnapshot {
  const shapes = objectSnapshots(doc).filter(isShapeSnapshot);
  expect(shapes).toHaveLength(1);
  return shapes[0]!;
}

const shapeCount = (doc: Y.Doc): number =>
  objectSnapshots(doc).filter(isShapeSnapshot).length;

const objectCount = (doc: Y.Doc): number => objectSnapshots(doc).length;

describe('shape model (`shape.kind`, `shape.size`, `shape.colours`)', () => {
  describe('TC-01: one case per kind', () => {
    it.each([...SHAPE_KINDS])('%s: stores the dragged rectangle, the defaults, the z and the author', (kind) => {
      const doc = new Y.Doc();
      const noteId = createSticky(doc, { x: 0, y: 0 }); // z = 1
      expect(noteId).not.toBe('');

      let id: string | null = null;
      const count = updatesIn(doc, () => {
        id = createShape(doc, { kind, rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'user-1');
      });

      expect(count).toBe(1);
      expect(id).toEqual(expect.any(String));
      const shape = onlyShape(doc);
      expect(shape.kind).toBe(kind);
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(120);
      expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(shape.label).toBe('');
      // `z = maxZ + 1`: on top of everything that was already there.
      expect(shape.z).toBe(2);
      expect(shape.createdBy).toBe('user-1');
      // The label is a shared Y.Text, empty until someone types it.
      const label = getShapeLabel(doc, shape.id);
      expect(label).toBeInstanceOf(Y.Text);
      expect(label?.toString()).toBe('');
    });

    it('the kinds are exactly rect, ellipse and diamond', () => {
      expect([...SHAPE_KINDS]).toEqual(['rect', 'ellipse', 'diamond']);
    });

    it('a shape is one object of a new type, not a resized sticky note', () => {
      const doc = new Y.Doc();
      const noteId = createSticky(doc, { x: 0, y: 0 });
      createShape(doc, { kind: 'diamond', rect: { x: 10, y: 10, width: 80, height: 80 }, at: { x: 10, y: 10 } }, 'user-1');
      const objects: readonly ObjectSnapshot[] = objectSnapshots(doc);
      expect(objects).toHaveLength(2);
      expect(objects.find((obj) => obj.id === noteId)?.type).toBe('sticky');
      expect(objects.find((obj) => obj.type === 'shape')?.id).toBeTruthy();
    });
  });

  describe('TC-02: a too-small rect and a null rect both take the default size', () => {
    const at = { x: 300, y: 400 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    it.each([
      { label: 'a drag smaller than SHAPE_MIN_SIZE_WORLD', rect: { x: 100, y: 100, width: 19, height: 200 } },
      { label: 'a click (no rect at all)', rect: null },
    ])('$label', ({ rect }) => {
      const doc = new Y.Doc();
      createShape(doc, { kind: 'rect', rect, at }, 'user-1');
      const shape = onlyShape(doc);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      // Centred on the click, not on the drag box.
      expect(shape.x).toBe(at.x - half);
      expect(shape.y).toBe(at.y - half);
    });
  });

  it('TC-03: a rect of exactly SHAPE_MIN_SIZE_WORLD is kept', () => {
    const doc = new Y.Doc();
    createShape(
      doc,
      {
        kind: 'ellipse',
        rect: { x: 100, y: 100, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 120, y: 120 },
      },
      'user-1',
    );
    const shape = onlyShape(doc);
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  describe('TC-04: Shift held (square) makes both sides the larger dimension, anchored on the drag origin', () => {
    it.each([
      { label: 'dragged right and down', at: { x: 100, y: 100 }, expect: { x: 100, y: 100 } },
      { label: 'dragged left and down', at: { x: 300, y: 100 }, expect: { x: 100, y: 100 } },
      { label: 'dragged right and up', at: { x: 100, y: 220 }, expect: { x: 100, y: 20 } },
      { label: 'dragged left and up', at: { x: 300, y: 220 }, expect: { x: 100, y: 20 } },
    ])('$label', ({ at, expect: wanted }) => {
      const doc = new Y.Doc();
      createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at, square: true },
        'user-1',
      );
      const shape = onlyShape(doc);
      // Both sides take the larger dimension (200), anchored on the corner the
      // drag started from.
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(200);
      expect(shape.x).toBe(wanted.x);
      expect(shape.y).toBe(wanted.y);
    });

    it('without Shift the dragged rectangle is kept as it was', () => {
      const doc = new Y.Doc();
      createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
        'user-1',
      );
      expect(onlyShape(doc).height).toBe(120);
    });
  });

  describe('TC-05: setShapeStyle', () => {
    const makeShape = (doc: Y.Doc): string =>
      createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'user-1')!;

    it('a known fill name is applied, in exactly one update', () => {
      const doc = new Y.Doc();
      const id = makeShape(doc);
      const count = updatesIn(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
      expect(count).toBe(1);
      expect(onlyShape(doc).fill).toBe('blue');
    });

    it('an unknown fill name writes nothing', () => {
      const doc = new Y.Doc();
      const id = makeShape(doc);
      const count = updatesIn(doc, () => setShapeStyle(doc, id, { fill: 'teal' as never }));
      expect(count).toBe(0);
      expect(onlyShape(doc).fill).toBe(DEFAULT_SHAPE_FILL);
    });

    it('a known outline name is applied, and both can change in one step', () => {
      const doc = new Y.Doc();
      const id = makeShape(doc);
      const count = updatesIn(doc, () => setShapeStyle(doc, id, { fill: 'none', stroke: 'red' }));
      expect(count).toBe(1);
      const shape = onlyShape(doc);
      expect(shape.fill).toBe('none');
      expect(shape.stroke).toBe('red');
    });

    it('an unknown outline name writes nothing', () => {
      const doc = new Y.Doc();
      const id = makeShape(doc);
      const count = updatesIn(doc, () => setShapeStyle(doc, id, { stroke: 'rainbow' as never }));
      expect(count).toBe(0);
      expect(onlyShape(doc).stroke).toBe(DEFAULT_SHAPE_STROKE);
    });

    it('an unchanged style, an empty patch and a stale id all write nothing', () => {
      const doc = new Y.Doc();
      const id = makeShape(doc);
      expect(updatesIn(doc, () => setShapeStyle(doc, id, { fill: DEFAULT_SHAPE_FILL }))).toBe(0);
      expect(updatesIn(doc, () => setShapeStyle(doc, id, { fill: 'green' }))).toBe(1);
      expect(updatesIn(doc, () => setShapeStyle(doc, id, { fill: 'green' }))).toBe(0);
      expect(updatesIn(doc, () => setShapeStyle(doc, id, {}))).toBe(0);
      expect(updatesIn(doc, () => setShapeStyle(doc, 'missing', { fill: 'blue' }))).toBe(0);
      expect(onlyShape(doc).fill).toBe('green');
    });
  });

  describe('TC-06: an invalid kind and a non-finite rect are rejected without a write', () => {
    it('an invalid kind writes nothing', () => {
      const doc = new Y.Doc();
      const kind = 'triangle' as ShapeKind;
      const count = updatesIn(doc, () => createShape(doc, { kind, rect: null, at: { x: 0, y: 0 } }, 'user-1'));
      expect(count).toBe(0);
      expect(shapeCount(doc)).toBe(0);
      expect(objectCount(doc)).toBe(0);
    });

    it.each([
      { label: 'NaN width', rect: { x: 0, y: 0, width: Number.NaN, height: 100 } },
      { label: 'Infinity x', rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 } },
      { label: 'a zero size', rect: { x: 0, y: 0, width: 0, height: 100 } },
      { label: 'a negative size', rect: { x: 0, y: 0, width: 100, height: -40 } },
    ])('$rect is rejected ($label)', ({ rect }) => {
      const doc = new Y.Doc();
      const count = updatesIn(doc, () =>
        createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'user-1'),
      );
      expect(count).toBe(0);
      expect(shapeCount(doc)).toBe(0);
    });

    it.each([
      { label: 'a non-finite click', at: { x: Number.NaN, y: 10 } },
      { label: 'a missing click', at: null },
    ])('$at is rejected ($label)', ({ at }) => {
      const doc = new Y.Doc();
      const count = updatesIn(doc, () =>
        createShape(doc, { kind: 'rect', rect: null, at: at as never }, 'user-1'),
      );
      expect(count).toBe(0);
      expect(shapeCount(doc)).toBe(0);
    });
  });

  it('getShapeLabel: the shared Y.Text of a shape, undefined for a stale id', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 0, y: 0 } }, 'user-1')!;
    const label = getShapeLabel(doc, id)!;
    doc.transact(() => label.insert(0, 'Checkout'), undefined);
    expect(onlyShape(doc).label).toBe('Checkout');
    expect(getShapeLabel(doc, 'missing')).toBeUndefined();
  });
});
