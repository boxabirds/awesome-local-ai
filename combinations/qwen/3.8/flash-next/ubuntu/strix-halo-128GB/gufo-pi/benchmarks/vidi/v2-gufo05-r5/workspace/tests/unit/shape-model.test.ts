/**
 * Shape object model unit tests (TC-01 to TC-06) against a real Y.Doc.
 *
 * The contract under test is `shape.model`: a shape is `type 'shape'` with a kind, a fill, an
 * outline and a shared `Y.Text` label. Every accepted change is exactly one `LOCAL_ORIGIN`
 * transaction; every rejection (unknown kind, unknown colour, non-finite rect, stale id) is
 * decided before a transaction is opened, so it produces no update at all.
 */
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import {
  createSticky,
  initDoc,
  LOCAL_ORIGIN,
  snapshot,
  type ShapeSnapshot,
} from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Every update this screen wrote, counted at the document. */
function watchLocalWrites(doc: Y.Doc): { count: number } {
  const seen = { count: 0 };
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) seen.count += 1;
  });
  return seen;
}

function shapeOf(doc: Y.Doc, id: string): ShapeSnapshot | undefined {
  return snapshot(doc).find((obj) => obj.id === id) as ShapeSnapshot | undefined;
}

/** A drag from one corner to the other, in world units. */
const drag = (width: number, height: number) => ({ x: 100, y: 100, width, height });

describe('shape.model.create', () => {
  test('TC-01 a 200x120 drag creates that rectangle, with the default style and an empty label', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const noteZ = snapshot(doc).find((obj) => obj.id === note)!.z;

    const id = createShape(doc, { kind: 'rect', rect: drag(200, 120), at: { x: 100, y: 100 } }, 'g_test');
    expect(id).toBeTruthy();

    const shapes = snapshot(doc).filter((obj) => obj.type === 'shape');
    expect(shapes).toHaveLength(1);
    const shape = shapeOf(doc, id!)!;
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    expect(shape.z).toBeGreaterThan(noteZ);
    expect(shape.createdBy).toBe('g_test');

    // the label is a real, empty Y.Text, so story 2's editor can take it over
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  test('TC-02 a 19x200 drag and a click both drop the standard size, centred on the point', () => {
    const doc = board();
    const at = { x: 400, y: 300 };

    const tiny = createShape(
      doc,
      { kind: 'ellipse', rect: { x: at.x, y: at.y, width: 19, height: 200 }, at },
      'g_test',
    )!;
    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'g_test')!;

    for (const id of [tiny, click]) {
      const shape = shapeOf(doc, id)!;
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    }
    expect(shapeOf(doc, tiny)!.kind).toBe('ellipse');
    expect(shapeOf(doc, click)!.kind).toBe('diamond');
  });

  test('TC-03 a drag of exactly the minimum size is kept as drawn', () => {
    const doc = board();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 50, y: 60 },
      },
      'g_test',
    )!;
    const shape = shapeOf(doc, id)!;
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(50);
    expect(shape.y).toBe(60);
  });

  test('TC-04 Shift squares the shape on the larger dimension, anchored at the drag origin', () => {
    const doc = board();
    const id = createShape(
      doc,
      { kind: 'rect', rect: drag(200, 120), at: { x: 100, y: 100 }, square: true },
      'g_test',
    )!;
    const shape = shapeOf(doc, id)!;
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    // the corner the drag started from does not move
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  test('every documented kind is created, and a shape sits above what was there before', () => {
    const doc = board();
    const ids = ['rect', 'ellipse', 'diamond'].map((kind, index) =>
      createShape(
        doc,
        { kind: kind as 'rect', rect: drag(100 + index, 100 + index), at: { x: 0, y: 0 } },
        'g_test',
      )!,
    );
    const order = snapshot(doc).map((obj) => obj.id);
    expect(order).toEqual(ids);
    expect(snapshot(doc).map((obj) => (obj as ShapeSnapshot).kind)).toEqual([
      'rect',
      'ellipse',
      'diamond',
    ]);
  });

  test('TC-06 an unknown kind or a non-finite rect writes nothing and returns null', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);

    expect(
      createShape(
        doc,
        { kind: 'triangle' as 'rect', rect: drag(100, 100), at: { x: 0, y: 0 } },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createShape(
        doc,
        {
          kind: 'rect',
          rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
          at: { x: 0, y: 0 },
        },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.NaN } }, 'g_test'),
    ).toBeNull();

    expect(writes.count).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('shape.model.style', () => {
  test('TC-05 a known fill name is applied in one update, leaving label, size and position alone', () => {
    const doc = board();
    const id = createShape(
      doc,
      { kind: 'rect', rect: drag(200, 120), at: { x: 100, y: 100 } },
      'g_test',
    )!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'Checkout');
    const before = shapeOf(doc, id)!;

    const writes = watchLocalWrites(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(writes.count).toBe(1);

    const after = shapeOf(doc, id)!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe(before.stroke);
    expect(after.label).toBe('Checkout');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.z).toBe(before.z);
  });

  test('TC-05 an unknown colour is refused without a transaction', () => {
    const doc = board();
    const id = createShape(doc, { kind: 'rect', rect: drag(100, 100), at: { x: 0, y: 0 } }, 'g_test')!;
    const before = shapeOf(doc, id)!;
    const writes = watchLocalWrites(doc);

    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'blue', stroke: 'mauve' })).toBe(false);
    expect(writes.count).toBe(0);
    expect(shapeOf(doc, id)).toEqual(before);
  });

  test('every palette name is accepted, including "no fill"', () => {
    const doc = board();
    const id = createShape(doc, { kind: 'rect', rect: drag(100, 100), at: { x: 0, y: 0 } }, 'g_test')!;
    // the colour a shape already has is a no-op, so each name below is applied from another one
    for (const fill of Object.keys(SHAPE_FILL_COLORS)) {
      if (shapeOf(doc, id)!.fill === fill) {
        setShapeStyle(doc, id, { fill: fill === 'white' ? 'none' : 'white' });
      }
      expect(setShapeStyle(doc, id, { fill }), `fill ${fill}`).toBe(true);
      expect(shapeOf(doc, id)!.fill).toBe(fill);
    }
    for (const stroke of Object.keys(SHAPE_STROKE_COLORS)) {
      if (shapeOf(doc, id)!.stroke === stroke) {
        setShapeStyle(doc, id, { stroke: stroke === 'blue' ? 'dark' : 'blue' });
      }
      expect(setShapeStyle(doc, id, { stroke }), `outline ${stroke}`).toBe(true);
      expect(shapeOf(doc, id)!.stroke).toBe(stroke);
    }
    const writes = watchLocalWrites(doc);
    expect(setShapeStyle(doc, id, { fill: 'grey', stroke: 'grey' })).toBe(false);
    expect(writes.count).toBe(0);
  });

  test('a stale id, a sticky note and an empty change are refused without a transaction', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const id = createShape(doc, { kind: 'rect', rect: drag(100, 100), at: { x: 0, y: 0 } }, 'g_test')!;
    const writes = watchLocalWrites(doc);

    expect(setShapeStyle(doc, 'never-existed', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, note, { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, {})).toBe(false);
    expect(writes.count).toBe(0);
    expect(getShapeLabel(doc, 'never-existed')).toBeUndefined();
    // a sticky note is not a shape: it has no label of this kind
    expect(getShapeLabel(doc, note)).toBeUndefined();
  });
});

describe('shape.model.label', () => {
  test('the label travels in the snapshot and the limit is the one the PRD states', () => {
    const doc = board();
    const id = createShape(doc, { kind: 'rect', rect: drag(200, 120), at: { x: 0, y: 0 } }, 'g_test')!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'Paid?');
    expect(shapeOf(doc, id)!.label).toBe('Paid?');
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);
  });
});
