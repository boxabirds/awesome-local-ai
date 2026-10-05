/**
 * Shape model unit tests (story 10, task 7): TC-01 to TC-06.
 *
 * Every case asserts the number of `update` events as well as the result: a
 * rejected call must not open a transaction, because an empty transaction would
 * travel to every other screen as sync traffic (story 3) and would occupy an
 * undo step (story 8).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
} from '../../src/shared/objects/shape';
import { snapshot } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';

/** Count the `update` events `fn` produces. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => {
    updates++;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

/** The raw stored map of an object. */
function stored(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

describe('shape model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-01: a dragged rectangle is stored exactly as dragged, with the default
  // style, an empty label, on top of the pile and attributed to its author.
  it('TC-01 createShape keeps a dragged rectangle and writes one update', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'dana',
    );
    expect(id).toBeTruthy();

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(1);

    const shape = stored(doc, id!);
    expect(shape.get('type')).toBe('shape');
    expect(shape.get('kind')).toBe('rect');
    expect(shape.get('x')).toBe(100);
    expect(shape.get('y')).toBe(100);
    expect(shape.get('width')).toBe(200);
    expect(shape.get('height')).toBe(120);
    expect(shape.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    const label = shape.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect((label as Y.Text).toString()).toBe('');
    expect(shape.get('createdBy')).toBe('dana');
    expect(shape.get('createdAt')).toBeGreaterThan(0);

    // Snapshot exposes it as a shape.
    const snap = snapshot(doc).find((object) => object.id === id);
    expect(snap?.type).toBe('shape');
    if (snap?.type === 'shape') {
      expect(snap.kind).toBe('rect');
      expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(snap.label).toBe('');
    }
  });

  // TC-01b: one transaction per creation, and z stacks above what is there.
  it('TC-01 one update per shape, z above every existing object', () => {
    const first = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'dana',
    );
    expect(stored(doc, first!).get('z')).toBe(1);

    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const second = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 300, y: 0, width: 120, height: 120 }, at: { x: 300, y: 0 } },
      'dana',
    );
    expect(updates).toBe(1);
    expect(stored(doc, second!).get('z')).toBe(2);
  });

  // TC-02: a drag below the minimum size, and a click, both drop a
  // standard-size shape centred on the press point.
  it('TC-02 a tiny drag and a click both create a standard shape centred on the point', () => {
    const at = { x: 500, y: 400 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });

    const tiny = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: at.x, y: at.y, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 },
        at,
      },
      'dana',
    );
    expect(tiny).toBeTruthy();
    const tinyShape = stored(doc, tiny!);
    expect(tinyShape.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(tinyShape.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(tinyShape.get('x')).toBe(at.x - half);
    expect(tinyShape.get('y')).toBe(at.y - half);

    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'dana');
    expect(click).toBeTruthy();
    const clickShape = stored(doc, click!);
    expect(clickShape.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickShape.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickShape.get('x')).toBe(at.x - half);
    expect(clickShape.get('y')).toBe(at.y - half);

    // One update each, nothing else written.
    expect(updates).toBe(2);
  });

  // TC-03: exactly the minimum size is a real drag and is kept as drawn.
  it('TC-03 a drag of exactly the minimum size is kept', () => {
    const id = createShape(
      doc,
      {
        kind: 'ellipse',
        rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 10, y: 20 },
      },
      'dana',
    );
    const shape = stored(doc, id!);
    expect(shape.get('x')).toBe(10);
    expect(shape.get('y')).toBe(20);
    expect(shape.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  // TC-04: Shift makes the shape square, anchored at the drag origin.
  it('TC-04 square keeps the drag origin and uses the larger dimension', () => {
    const forward = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: 200, height: 120 },
        at: { x: 0, y: 0 },
        square: true,
      },
      'dana',
    );
    const forwardShape = stored(doc, forward!);
    expect(forwardShape.get('x')).toBe(0);
    expect(forwardShape.get('y')).toBe(0);
    expect(forwardShape.get('width')).toBe(200);
    expect(forwardShape.get('height')).toBe(200);

    // Dragging up and left keeps the corner the pointer started on.
    const back = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: -120, y: -300, width: 120, height: 300 },
        at: { x: 0, y: 0 },
        square: true,
      },
      'dana',
    );
    const backShape = stored(doc, back!);
    expect(backShape.get('x')).toBe(-300);
    expect(backShape.get('y')).toBe(-300);
    expect(backShape.get('width')).toBe(300);
    expect(backShape.get('height')).toBe(300);
  });

  // TC-05: a known colour is applied in one update without touching anything
  // else; an unknown colour is refused without a transaction.
  it('TC-05 setShapeStyle applies known colours and refuses unknown ones', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } },
      'dana',
    )!;
    getShapeLabel(doc, id)?.insert(0, 'Checkout');

    let result = false;
    let updates = countUpdates(doc, () => {
      result = setShapeStyle(doc, id, { fill: 'blue' });
    });
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const shape = stored(doc, id);
    expect(shape.get('fill')).toBe('blue');
    expect(SHAPE_FILL_COLORS.blue).toBe('#BBDEFB');
    // Label, size and position are untouched.
    expect((shape.get('label') as Y.Text).toString()).toBe('Checkout');
    expect(shape.get('width')).toBe(200);
    expect(shape.get('height')).toBe(120);
    expect(shape.get('x')).toBe(0);
    expect(shape.get('y')).toBe(0);

    result = false;
    updates = countUpdates(doc, () => {
      result = setShapeStyle(doc, id, { stroke: 'red' });
    });
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(stored(doc, id).get('stroke')).toBe('red');
    expect(SHAPE_STROKE_COLORS.red).toBe('#E53935');

    result = true;
    updates = countUpdates(doc, () => {
      result = setShapeStyle(doc, id, { fill: 'teal' });
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(stored(doc, id).get('fill')).toBe('blue');

    // A stale id is refused too.
    result = true;
    updates = countUpdates(doc, () => {
      result = setShapeStyle(doc, 'gone', { fill: 'green' });
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  // TC-06: an unknown kind and a non-finite rectangle create nothing.
  it('TC-06 an unknown kind or a non-finite rectangle writes nothing', () => {
    let id: string | null = 'x';
    let updates = countUpdates(doc, () => {
      id = createShape(
        doc,
        {
          kind: 'triangle' as never,
          rect: { x: 0, y: 0, width: 100, height: 100 },
          at: { x: 0, y: 0 },
        },
        'dana',
      );
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    id = 'x';
    updates = countUpdates(doc, () => {
      id = createShape(
        doc,
        {
          kind: 'rect',
          rect: { x: Number.NaN, y: 0, width: 100, height: 100 },
          at: { x: 0, y: 0 },
        },
        'dana',
      );
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    // A non-finite press point is refused as well.
    id = 'x';
    updates = countUpdates(doc, () => {
      id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.POSITIVE_INFINITY } }, 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
  });
});
