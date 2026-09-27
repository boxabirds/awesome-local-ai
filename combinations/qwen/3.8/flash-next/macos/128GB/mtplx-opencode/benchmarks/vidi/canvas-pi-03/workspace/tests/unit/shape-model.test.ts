// Story 10, shape.model: the shape schema and every mutation a client can make
// to a shape, tested against a real Y.Doc (no DOM, no React).
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  getShapeStyle,
} from '../../src/shared/objects/shape';
import { initDoc, createSticky, objectSnapshots, objectBounds } from '../../src/shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/client/objects/StickyText';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
});

/** Count the document updates `fn` produces (an unwanted write is a write). */
function updatesDuring(fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  const result = fn();
  doc.off('update', observer);
  return { result, updates };
}

function record(id: string): Y.Map<unknown> {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

function count(): number {
  return doc.getMap<Y.Map<unknown>>('objects').size;
}

const AT = { x: 500, y: 400 };

describe('shape.model: create by drag (TC-01)', () => {
  it('a drag becomes a shape covering exactly the dragged area', () => {
    const { result, updates } = updatesDuring(() =>
      createShape(doc, { kind: 'rect', rect: { x: 100, y: 120, width: 200, height: 120 }, at: AT }, 'me'),
    );
    expect(typeof result).toBe('string');
    expect(count()).toBe(1);
    // One transaction, whatever the number of keys it writes.
    expect(updates).toBe(1);

    const id = result as string;
    const shape = objectSnapshots(doc).find((o) => o.id === id);
    expect(shape?.type).toBe('shape');
    expect(shape?.width).toBe(200);
    expect(shape?.height).toBe(120);
    expect(shape?.x).toBe(100);
    expect(shape?.y).toBe(120);
    const obj = record(id);
    expect(obj.get('kind')).toBe('rect');
    expect(obj.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect((obj.get('label') as Y.Text).toString()).toBe('');
    expect(obj.get('createdBy')).toBe('me');
    expect(typeof obj.get('createdAt')).toBe('number');
  });

  it('stacks above what is already on the board (z = maxZ + 1)', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = record(sticky).get('z') as number;
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: AT }, 'me')!;
    expect(record(id).get('z')).toBe(stickyZ + 1);
  });

  it('a rectangle, an ellipse and a diamond all store their own kind', () => {
    for (const kind of ['rect', 'ellipse', 'diamond'] as const) {
      const d = new Y.Doc();
      initDoc(d);
      const id = createShape(d, { kind, rect: null, at: AT }, 'me')!;
      expect(d.getMap<Y.Map<unknown>>('objects').get(id)!.get('kind')).toBe(kind);
    }
  });
});

describe('shape.model: create by click (TC-02)', () => {
  it('a click creates a default-sized shape CENTRED on the point', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'me')!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred, not anchored at the top-left.
    expect(snap.x).toBe(AT.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(AT.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('a drag thinner than the minimum in EITHER direction is a click', () => {
    // 19 wide: under the 20-unit minimum even though it is 200 tall.
    const id = createShape(doc, { kind: 'rect', rect: { x: 300, y: 200, width: 19, height: 200 }, at: AT }, 'me')!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });
});

describe('shape.model: the minimum-size boundary (TC-03)', () => {
  it('a drag of exactly SHAPE_MIN_SIZE_WORLD is kept as drawn', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: AT },
      'me',
    )!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
    // It keeps its own footprint, so the selection box and the hit test agree
    // with what was drawn.
    expect(objectBounds(doc, id)).toEqual({ x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD });
  });
});

describe('shape.model: Shift squares the shape (TC-04)', () => {
  it('square:true takes the larger side on both axes, anchored at the drag origin', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: AT, square: true },
      'me',
    )!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
  });

  it('the shorter axis grows too: 120x200 squared is 200x200', () => {
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 40, y: 40, width: 120, height: 200 }, at: AT, square: true },
      'me',
    )!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
  });
});

describe('shape.model: style (TC-05)', () => {
  it('a known colour is applied in one update and touches nothing else', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: AT }, 'me')!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'hello');
    const before = objectSnapshots(doc).find((o) => o.id === id)!;

    const { result, updates } = updatesDuring(() => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const style = getShapeStyle(doc, id)!;
    expect(style.fill).toBe('blue');
    expect(style.stroke).toBe(DEFAULT_SHAPE_STROKE);
    // Position, size, kind and label are untouched.
    const after = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(after).toEqual({ ...before, fill: 'blue' });
    expect(getShapeLabel(doc, id)!.toString()).toBe('hello');
  });

  it('an unknown colour returns false and writes NOTHING', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'me')!;
    const { result, updates } = updatesDuring(() => setShapeStyle(doc, id, { fill: 'teal' }));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('a stale id, a non-shape and a repeat of the current colour all write nothing', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'me')!;
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(setShapeStyle(doc, 'no-such-id', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, sticky, { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'grey' })).toBe(true);
    // The very same colour again is a redundant write, so it is not made.
    const { result, updates } = updatesDuring(() => setShapeStyle(doc, id, { stroke: 'grey' }));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('fill and stroke can be set together, in one update', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'me')!;
    const { result, updates } = updatesDuring(() => setShapeStyle(doc, id, { fill: 'pink', stroke: 'red' }));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(getShapeStyle(doc, id)).toMatchObject({ fill: 'pink', stroke: 'red' });
  });

  it('"no fill" is a legal choice and is stored as the key, not a colour', () => {
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: AT }, 'me')!;
    expect(setShapeStyle(doc, id, { fill: 'none' })).toBe(true);
    expect(record(id).get('fill')).toBe('none');
  });
});

describe('shape.model: error paths (TC-06)', () => {
  it('an unknown kind creates nothing', () => {
    const { result, updates } = updatesDuring(() =>
      createShape(doc, { kind: 'triangle', rect: { x: 0, y: 0, width: 100, height: 100 }, at: AT }, 'me'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(count()).toBe(0);
  });

  it('a non-finite rectangle or point creates nothing', () => {
    const bad = [
      { kind: 'rect' as const, rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: AT },
      { kind: 'rect' as const, rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 }, at: AT },
      { kind: 'rect' as const, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: Number.NaN, y: 0 } },
    ];
    for (const args of bad) {
      const d = new Y.Doc();
      initDoc(d);
      let updates = 0;
      d.on('update', () => {
        updates += 1;
      });
      expect(createShape(d, args, 'me')).toBeNull();
      expect(updates).toBe(0);
      expect(d.getMap<Y.Map<unknown>>('objects').size).toBe(0);
    }
  });

  it('getShapeLabel is undefined for a stale id and for a note', () => {
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(getShapeLabel(doc, sticky)).toBeUndefined();
  });
});

describe('shape.model: the label', () => {
  it('is a shared Y.Text clamped to SHAPE_LABEL_MAX_CHARS', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'me')!;
    const label = getShapeLabel(doc, id)!;
    expect(label).toBeInstanceOf(Y.Text);
    const typed = 'x'.repeat(600);
    label.insert(0, clampToLimit(typed, SHAPE_LABEL_MAX_CHARS));
    expect(label.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(objectSnapshots(doc).find((o) => o.id === id)!.type).toBe('shape');
    expect((objectSnapshots(doc).find((o) => o.id === id) as { label?: string })!.label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });
});
