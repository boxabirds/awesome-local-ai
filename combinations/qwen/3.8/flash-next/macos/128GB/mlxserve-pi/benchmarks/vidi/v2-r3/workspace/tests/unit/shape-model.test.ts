// shape.model unit tests (TC-01 … TC-06) against a REAL Y.Doc.
//
// What is under test is Yjs's own behaviour as much as this module's: a
// transaction that writes nothing must emit no update, an unknown colour must be
// refused before anything is written, and the shape that comes back must be
// readable by the board's own snapshot. A mocked document would hide all three.
import { describe, expect, it, beforeEach } from 'vitest';
import { Doc, Map as YMap, Text as YText } from 'yjs';
import {
  createSticky,
  getObjects,
  initDoc,
  snapshot,
  snapshotAll,
  LOCAL_ORIGIN,
  type ShapeSnapshot,
} from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from '../../src/shared/config';

/**
 * Counts the `update` events a doc emits: one per successful mutation, none for
 * a rejection — which is the whole of "writes nothing, opens no transaction".
 */
function updateCounter(doc: Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

function newDoc(): Doc {
  const doc = new Doc();
  initDoc(doc);
  return doc;
}

/** The shape under `id` from the board's own all-objects snapshot. */
function shapeOf(doc: Doc, id: string): ShapeSnapshot {
  const object = snapshotAll(doc).find((entry) => entry.id === id);
  if (object === undefined || object.type !== 'shape') throw new Error(`shape ${id} is not on the board`);
  return object;
}

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('shape model', () => {
  let doc: Doc;

  beforeEach(() => {
    doc = newDoc();
  });

  // TC-01: a dragged rect becomes a shape exactly covering it, with defaults.
  describe('TC-01 createShape from a dragged rect', () => {
    it('writes the rect as drawn, with the default colours and an empty label', () => {
      const updates = updateCounter(doc);

      const id = createShape(doc, { kind: 'rect', rect: rect(100, 100, 200, 120), at: { x: 100, y: 100 } }, 'dana');

      expect(id).not.toBeNull();
      expect(updates()).toBe(1);
      const shape = shapeOf(doc, id!);
      expect(shape.type).toBe('shape');
      expect(shape.kind).toBe('rect');
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(120);
      expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(shape.label).toBe('');
      expect(shape.createdBy).toBe('dana');
      expect(shape.createdAt).toBeGreaterThan(0);
      // One shape on an empty board sits above nothing, so its z is the first.
      expect(shape.z).toBe(1);
    });

    it('stacks a new shape above every object already on the board', () => {
      createSticky(doc, { x: 0, y: 0 });
      const before = Math.max(...snapshotAll(doc).map((object) => object.z));
      const id = createShape(doc, { kind: 'ellipse', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      expect(shapeOf(doc, id!).z).toBe(before + 1);
    });

    it('is a shape of each kind, and the board reads all three back', () => {
      const kinds: ShapeKind[] = ['rect', 'ellipse', 'diamond'];
      for (const kind of kinds) {
        const id = createShape(doc, { kind, rect: rect(0, 0, 100, 80), at: { x: 0, y: 0 } });
        expect(shapeOf(doc, id!).kind).toBe(kind);
      }
      expect(snapshotAll(doc).filter((object) => object.type === 'shape')).toHaveLength(3);
      // `snapshot` keeps listing sticky notes only, so story 2's callers are unchanged.
      expect(snapshot(doc)).toHaveLength(0);
    });
  });

  // TC-02: a click, and a drag too small to be a shape, both drop a standard one.
  describe('TC-02 createShape by clicking', () => {
    it('centres the standard size on the point when there is no rect', () => {
      const updates = updateCounter(doc);
      const at = { x: 500, y: 300 };

      const id = createShape(doc, { kind: 'diamond', rect: null, at });

      expect(id).not.toBeNull();
      expect(updates()).toBe(1);
      const shape = shapeOf(doc, id!);
      const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - half);
      expect(shape.y).toBe(at.y - half);
    });

    it('treats a drag narrower than the minimum in either direction as a click', () => {
      const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

      // Too narrow to be a shape: 19 board units wide.
      const narrow = createShape(doc, {
        kind: 'rect',
        rect: rect(40, 40, SHAPE_MIN_SIZE_WORLD - 1, 200),
        at: { x: 40, y: 40 },
      });
      // And too short: 19 board units tall.
      const short = createShape(doc, {
        kind: 'rect',
        rect: rect(300, 40, 200, SHAPE_MIN_SIZE_WORLD - 1),
        at: { x: 300, y: 40 },
      });

      for (const [id, at] of [
        [narrow, { x: 40, y: 40 }],
        [short, { x: 300, y: 40 }],
      ] as const) {
        const shape = shapeOf(doc, id!);
        expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
        expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
        expect(shape.x).toBe(at.x - half);
        expect(shape.y).toBe(at.y - half);
      }
    });

    it('writes nothing for a point that is not a pair of numbers', () => {
      const updates = updateCounter(doc);
      expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 10 } })).toBeNull();
      expect(updates()).toBe(0);
    });
  });

  // TC-03: the minimum size is kept as drawn (the boundary's other side).
  describe('TC-03 createShape at exactly the minimum size', () => {
    it('keeps a drag of exactly SHAPE_MIN_SIZE_WORLD square', () => {
      const updates = updateCounter(doc);
      const id = createShape(doc, {
        kind: 'rect',
        rect: rect(10, 20, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD),
        at: { x: 10, y: 20 },
      });
      const shape = shapeOf(doc, id!);
      expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(shape.x).toBe(10);
      expect(shape.y).toBe(20);
      expect(updates()).toBe(1);
    });

    it('keeps a drag one unit over the minimum in one direction and under in the other', () => {
      // Both directions have to clear the minimum: 21 wide is not enough when
      // the height is 19.
      const id = createShape(doc, {
        kind: 'ellipse',
        rect: rect(0, 0, SHAPE_MIN_SIZE_WORLD + 1, SHAPE_MIN_SIZE_WORLD - 1),
        at: { x: 0, y: 0 },
      });
      const shape = shapeOf(doc, id!);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    });
  });

  // TC-04: Shift squares the shape on the larger dragged dimension.
  describe('TC-04 createShape constrained to a square', () => {
    it('makes both sides the larger dragged dimension, anchored at the drag origin', () => {
      const updates = updateCounter(doc);
      const id = createShape(doc, {
        kind: 'rect',
        rect: rect(100, 100, 200, 120),
        at: { x: 100, y: 100 },
        square: true,
      });
      const shape = shapeOf(doc, id!);
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(200);
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect(updates()).toBe(1);
    });

    it('takes the taller dimension when that is the larger of the two', () => {
      const id = createShape(doc, {
        kind: 'diamond',
        rect: rect(-40, 60, 120, 260),
        at: { x: -40, y: 60 },
        square: true,
      });
      const shape = shapeOf(doc, id!);
      expect(shape.width).toBe(260);
      expect(shape.height).toBe(260);
      expect(shape.x).toBe(-40);
      expect(shape.y).toBe(60);
    });
  });

  // TC-05: restyling changes one key and nothing else; an unknown name is refused.
  describe('TC-05 setShapeStyle', () => {
    it('applies a fill from the palette, in one update, touching nothing else', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(100, 100, 200, 120), at: { x: 100, y: 100 } });
      const before = shapeOf(doc, id!);
      const updates = updateCounter(doc);

      expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);

      expect(updates()).toBe(1);
      const after = shapeOf(doc, id!);
      expect(after.fill).toBe('blue');
      expect(after.stroke).toBe(before.stroke);
      expect(after.label).toBe(before.label);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('applies an outline colour and the no-fill swatch', () => {
      const id = createShape(doc, { kind: 'ellipse', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });

      expect(setShapeStyle(doc, id!, { stroke: 'red' })).toBe(true);
      expect(shapeOf(doc, id!).stroke).toBe('red');
      expect(setShapeStyle(doc, id!, { fill: 'none' })).toBe(true);
      expect(shapeOf(doc, id!).fill).toBe('none');
    });

    it('refuses a colour the palette does not hold, writing nothing', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      const updates = updateCounter(doc);

      expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
      expect(setShapeStyle(doc, id!, { stroke: 'teal' })).toBe(false);
      // A bad name alongside a good one refuses the whole call: a shape is never
      // left half-restyled.
      expect(setShapeStyle(doc, id!, { fill: 'blue', stroke: 'teal' })).toBe(false);

      expect(updates()).toBe(0);
      expect(shapeOf(doc, id!).fill).toBe(DEFAULT_SHAPE_FILL);
    });

    it('refuses a stale id and an object that is not a shape', () => {
      const note = createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
      expect(setShapeStyle(doc, note, { fill: 'blue' })).toBe(false);
      expect(updates()).toBe(0);
    });

    it('writes nothing when the shape already has the colour asked for', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      const updates = updateCounter(doc);

      expect(setShapeStyle(doc, id!, { fill: DEFAULT_SHAPE_FILL })).toBe(true);
      expect(updates()).toBe(0);
    });
  });

  // TC-06: a kind the board does not draw, and numbers that are not numbers.
  describe('TC-06 createShape rejects what it cannot draw', () => {
    it('refuses a kind outside SHAPE_KINDS', () => {
      const updates = updateCounter(doc);

      const id = createShape(doc, { kind: 'triangle' as ShapeKind, rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });

      expect(id).toBeNull();
      expect(updates()).toBe(0);
      expect(snapshotAll(doc)).toHaveLength(0);
    });

    it('refuses a rect holding a number that is not finite', () => {
      const updates = updateCounter(doc);
      const bad = [
        rect(0, 0, Number.POSITIVE_INFINITY, 100),
        rect(0, 0, 100, Number.NaN),
        rect(Number.NaN, 0, 100, 100),
        rect(0, 0, 100, '40' as unknown as number),
      ];

      for (const r of bad) {
        expect(createShape(doc, { kind: 'rect', rect: r, at: { x: 0, y: 0 } })).toBeNull();
      }
      expect(updates()).toBe(0);
      expect(snapshotAll(doc)).toHaveLength(0);
    });

    it('refuses a negative size, which is a rect no browser can draw', () => {
      const updates = updateCounter(doc);
      expect(createShape(doc, { kind: 'rect', rect: rect(0, 0, -200, 120), at: { x: 0, y: 0 } })).toBeNull();
      expect(updates()).toBe(0);
    });
  });

  describe('the label, which is a Y.Text like every other editable object', () => {
    it('hands back the shape label editor writes into', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      const label = getShapeLabel(doc, id!);
      expect(label).toBeInstanceOf(YText);
      label!.insert(0, 'Checkout');
      expect(shapeOf(doc, id!).label).toBe('Checkout');
      expect(getShapeLabel(doc, 'gone')).toBeUndefined();
    });

    it('is not offered to a sticky note or a text object', () => {
      const note = createSticky(doc, { x: 0, y: 0 });
      expect(getShapeLabel(doc, note)).toBeUndefined();
    });

    it('is clamped to SHAPE_LABEL_MAX_CHARS, the limit the editor stops at', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      const label = getShapeLabel(doc, id!)!;

      // One character over the limit is cut to it; exactly the limit is kept.
      const over = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 1);
      expect(clampToLimit(over, SHAPE_LABEL_MAX_CHARS)).toHaveLength(SHAPE_LABEL_MAX_CHARS);
      expect(clampToLimit(over, SHAPE_LABEL_MAX_CHARS)).not.toHaveLength(SHAPE_LABEL_MAX_CHARS + 1);
      const exactly = 'y'.repeat(SHAPE_LABEL_MAX_CHARS);
      expect(clampToLimit(exactly, SHAPE_LABEL_MAX_CHARS)).toHaveLength(SHAPE_LABEL_MAX_CHARS);

      label.insert(0, clampToLimit(over, SHAPE_LABEL_MAX_CHARS));
      expect(shapeOf(doc, id!).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    });
  });

  describe('a document written by something else', () => {
    it('is left off the board when a shape field is not a number', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      getObjects(doc).get(id!)!.set('width', 'wide');
      expect(snapshotAll(doc).find((object) => object.id === id)).toBeUndefined();
    });

    it('falls back to the default colours when the names are unknown', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      const map = getObjects(doc).get(id!)!;
      map.set('fill', 'teal');
      map.set('stroke', 'chartreuse');
      const shape = shapeOf(doc, id!);
      expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    });

    it('keeps a shape whose kind has been lost, as a rectangle', () => {
      const id = createShape(doc, { kind: 'diamond', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      getObjects(doc).get(id!)!.set('kind', 'hexagon');
      expect(shapeOf(doc, id!).kind).toBe('rect');
    });

    it('is read from the raw fields, with the outline width left to the setting', () => {
      const id = createShape(doc, { kind: 'rect', rect: rect(5, 6, 70, 60), at: { x: 5, y: 6 } });
      const map = getObjects(doc).get(id!)!;
      expect(map.get('type')).toBe('shape');
      expect(map.get('label')).toBeInstanceOf(YText);
      // One line for every shape: the width is the setting, read where the shape
      // is drawn, so it is not stored per shape (and cannot disagree with it).
      expect(map.get('strokeWidth')).toBeUndefined();
      expect(map.get('text')).toBeUndefined();
      expect(map instanceof YMap).toBe(true);
    });

    it("writes with the local origin, so story 8 sees it as this person's own", () => {
      const origins: unknown[] = [];
      doc.on('update', (_update: unknown, origin: unknown) => {
        origins.push(origin);
      });
      createShape(doc, { kind: 'rect', rect: rect(0, 0, 100, 100), at: { x: 0, y: 0 } });
      expect(origins).toEqual([LOCAL_ORIGIN]);
    });
  });
});
