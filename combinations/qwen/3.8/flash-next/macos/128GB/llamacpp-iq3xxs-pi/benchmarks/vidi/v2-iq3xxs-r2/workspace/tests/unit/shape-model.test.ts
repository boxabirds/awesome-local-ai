import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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
import { allObjectIds, objectSnapshots } from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  isShapeSnapshot,
  readShape,
  setShapeStyle,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../../src/shared/objects/shape';

const BY = 'tester';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

/** Every id the document holds. */
function ids(): string[] {
  return allObjectIds(objectSnapshots(doc)).sort();
}

function shapeOf(id: string) {
  const found = readShape(doc, id);
  if (!found) throw new Error(`no shape ${id} in the document`);
  return found;
}

function labelOf(id: string): string {
  const text = getShapeLabel(doc, id);
  if (!text) throw new Error(`shape ${id} has no label`);
  return text.toString();
}

/** How many updates this call made to the document. */
function updatesMade(run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return count;
}

function create(kind: ShapeKind, rect: { x: number; y: number; width: number; height: number } | null, opts: { at?: { x: number; y: number }; square?: boolean } = {}): string | null {
  return createShape(
    doc,
    { kind, rect, at: opts.at ?? { x: 0, y: 0 }, square: opts.square === true },
    BY,
  );
}

describe('creating a shape by dragging (TC-01, TC-03, TC-04)', () => {
  it('TC-01: a 200x120 drag makes one shape of 200x120, in the default colours, with an empty label', () => {
    const before = ids().length;
    const updates = updatesMade(() => {
      const id = create('rect', { x: 40, y: 60, width: 200, height: 120 });
      expect(id).not.toBeNull();
      const shape = shapeOf(id!);
      expect(ids().length).toBe(before + 1);
      expect(shape.type).toBe('shape');
      expect(shape.kind).toBe('rect');
      expect([shape.x, shape.y, shape.width, shape.height]).toEqual([40, 60, 200, 120]);
      expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(shape.fill).toBe('white');
      expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(shape.stroke).toBe('dark');
      expect(labelOf(id!)).toBe('');
      expect(shape.createdBy).toBe(BY);
      // On top of everything else, whatever that was.
      expect(shape.z).toBe(1);
      const next = create('rect', { x: 0, y: 0, width: 40, height: 40 });
      expect(next).not.toBeNull();
      expect(shapeOf(next!).z).toBe(2);
    });
    expect(updates).toBe(2);
  });

  it('TC-01: every kind is kept as it was asked for, and reaches the board as a shape', () => {
    expect(SHAPE_KINDS).toEqual(['rect', 'ellipse', 'diamond']);
    for (const kind of SHAPE_KINDS) {
      const id = create(kind, { x: 0, y: 0, width: 100, height: 100 });
      expect(shapeOf(id!).kind).toBe(kind);
      const listed = objectSnapshots(doc).find((object) => object.id === id);
      expect(listed?.type).toBe('shape');
      expect(isShapeSnapshot(listed)).toBe(true);
    }
  });

  it('TC-03: a drag of exactly the minimum size is kept as drawn', () => {
    const id = create('rect', {
      x: 5,
      y: 5,
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });
    const shape = shapeOf(id!);
    expect([shape.width, shape.height]).toEqual([SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD]);
    expect(ids()).toHaveLength(1);
  });

  it('TC-04: Shift makes the dragged box a square on its longer side, anchored where the drag started', () => {
    const id = create('rect', { x: 10, y: 20, width: 200, height: 120 }, { square: true });
    const shape = shapeOf(id!);
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([10, 20, 200, 200]);
  });
});

describe('creating a shape by clicking (TC-02)', () => {
  const at = { x: 500, y: 300 };

  it('TC-02: a drag one unit under the minimum becomes the standard shape, centred on the click', () => {
    const id = create('rect', { x: 490, y: 200, width: 19, height: 200 }, { at });
    const shape = shapeOf(id!);
    expect([shape.width, shape.height]).toEqual([
      SHAPE_DEFAULT_SIZE_WORLD,
      SHAPE_DEFAULT_SIZE_WORLD,
    ]);
    expect(shape.x + shape.width / 2).toBeCloseTo(at.x, 6);
    expect(shape.y + shape.height / 2).toBeCloseTo(at.y, 6);
  });

  it('TC-02: so does a click, which reports no rectangle at all', () => {
    const id = create('rect', null, { at });
    const shape = shapeOf(id!);
    expect([shape.width, shape.height]).toEqual([
      SHAPE_DEFAULT_SIZE_WORLD,
      SHAPE_DEFAULT_SIZE_WORLD,
    ]);
    expect(shape.x + shape.width / 2).toBeCloseTo(at.x, 6);
    expect(shape.y + shape.height / 2).toBeCloseTo(at.y, 6);
    // Two objects, one per gesture, and nothing else.
    expect(ids()).toHaveLength(1);
    expect(updatesMade(() => create('ellipse', null, { at }))).toBe(1);
    expect(ids()).toHaveLength(2);
  });
});

describe('the style of a shape (TC-05)', () => {
  let id: string;

  beforeEach(() => {
    id = create('rect', { x: 0, y: 0, width: 200, height: 120 })!;
    getShapeLabel(doc, id)!.insert(0, 'Checkout');
  });

  it('TC-05: a fill the settings offer is applied in one update, label and box untouched', () => {
    const before = shapeOf(id);
    const fill: FillColor = 'blue';
    const updates = updatesMade(() => expect(setShapeStyle(doc, id, { fill })).toBe(true));
    expect(updates).toBe(1);
    const after = shapeOf(id);
    expect(after.fill).toBe(fill);
    expect(after.stroke).toBe(before.stroke);
    expect(after.label).toBe('Checkout');
    expect(labelOf(id)).toBe('Checkout');
    expect([after.x, after.y, after.width, after.height, after.z]).toEqual([
      before.x,
      before.y,
      before.width,
      before.height,
      before.z,
    ]);
  });

  it('TC-05: a colour the settings do not offer is refused, and nothing is written', () => {
    const before = JSON.stringify(shapeOf(id));
    const updates = updatesMade(() => {
      expect(setShapeStyle(doc, id, { fill: 'teal' as FillColor })).toBe(false);
      expect(setShapeStyle(doc, id, { stroke: 'teal' as StrokeColor })).toBe(false);
      expect(setShapeStyle(doc, 'never-existed', { fill: 'blue' })).toBe(false);
    });
    expect(updates).toBe(0);
    expect(JSON.stringify(shapeOf(id))).toBe(before);
  });

  it('every colour the shape toolbar will offer, and the defaults among them', () => {
    expect(Object.keys(SHAPE_FILL_COLORS)).toEqual([
      'none',
      'white',
      'blue',
      'green',
      'yellow',
      'pink',
      'grey',
    ]);
    expect(Object.keys(SHAPE_STROKE_COLORS)).toEqual([
      'dark',
      'blue',
      'green',
      'orange',
      'red',
      'grey',
    ]);
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
    expect(isShapeSnapshot(shapeOf(id))).toBe(true);
  });
});

describe('a shape that cannot be made (TC-06)', () => {
  it('TC-06: an unknown kind, and a box with no finite numbers, both write nothing', () => {
    const before = ids().length;
    const updates = updatesMade(() => {
      expect(create('triangle' as ShapeKind, { x: 0, y: 0, width: 100, height: 100 })).toBeNull();
      expect(
        createShape(
          doc,
          {
            kind: 'rect',
            rect: { x: 0, y: 0, width: Number.NaN, height: 100 },
            at: { x: 0, y: 0 },
            square: false,
          },
          BY,
        ),
      ).toBeNull();
      expect(
        createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 0 }, square: false }, BY),
      ).toBeNull();
    });
    expect(updates).toBe(0);
    expect(ids()).toHaveLength(before);
  });

  it('a shape whose label was truncated by the editor keeps the characters that fit', () => {
    const id = create('rect', { x: 0, y: 0, width: 100, height: 100 })!;
    const text = getShapeLabel(doc, id)!;
    const typed = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    updatesMade(() => {
      text.insert(0, typed);
      if (text.length > SHAPE_LABEL_MAX_CHARS) {
        text.delete(SHAPE_LABEL_MAX_CHARS, text.length - SHAPE_LABEL_MAX_CHARS);
      }
    });
    expect(text.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(shapeOf(id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });
});
