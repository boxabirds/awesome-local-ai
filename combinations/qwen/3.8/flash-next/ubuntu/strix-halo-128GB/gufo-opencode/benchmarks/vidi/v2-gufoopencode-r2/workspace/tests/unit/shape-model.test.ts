// TC-01 to TC-06: the shape object model. Creation by drag/click, Shift
// squaring, min-size boundary, style validation, label Y.Text, and rejection
// of unknown kinds / non-finite input with zero Y.Doc updates.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config';

function countUpdates(doc: Y.Doc, fn: () => unknown): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

describe('shape model', () => {
  it('TC-01: createShape by drag stores the exact rect, default style, empty label, top z', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    if (typeof sticky !== 'string') throw new Error('sticky creation failed');
    const stickyZ = objectsMap(doc).get(sticky)!.get('z') as number;

    const seen = countUpdates(doc, () =>
      createShape(doc, { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g_test'),
    );
    expect(seen.updates).toBe(1);
    const id = seen.result as string;
    expect(typeof id).toBe('string');

    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('type')).toBe('shape');
    expect(obj.get('kind')).toBe('rect');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(120);
    expect(obj.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    const label = obj.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect((label as Y.Text).toString()).toBe('');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(obj.get('z') as number).toBeGreaterThan(stickyZ);
  });

  it('TC-02: a below-min drag and a click both drop a default-size shape centred at the point', () => {
    const doc = freshDoc();
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    // Drag of 19 (below SHAPE_MIN_SIZE_WORLD) in one direction: click behaviour.
    const tiny = createShape(doc, { kind: 'ellipse', rect: { x: 300, y: 400, width: 19, height: 200 }, at: { x: 500, y: 600 } }, 'g_test')!;
    const t = objectsMap(doc).get(tiny)!;
    expect(t.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(t.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(t.get('x')).toBe(500 - half);
    expect(t.get('y')).toBe(600 - half);

    // rect null (a pure click).
    const click = createShape(doc, { kind: 'diamond', rect: null, at: { x: 1000, y: 200 } }, 'g_test')!;
    const c = objectsMap(doc).get(click)!;
    expect(c.get('kind')).toBe('diamond');
    expect(c.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(c.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(c.get('x')).toBe(1000 - half);
    expect(c.get('y')).toBe(200 - half);
  });

  it('TC-03: a drag of exactly SHAPE_MIN_SIZE_WORLD is kept as drawn', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 40, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 0, y: 0 } }, 'g_test')!;
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj.get('x')).toBe(40);
    expect(obj.get('y')).toBe(60);
  });

  it('TC-04: square constrains both sides to the larger dragged dimension, anchored at origin', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: true }, 'g_test')!;
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(200);
    expect(obj.get('x')).toBe(10);
    expect(obj.get('y')).toBe(20);
  });

  it('TC-05: setShapeStyle applies valid colours in one update and rejects unknown ones silently', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g_test')!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'Keep me');

    const applied = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'blue', stroke: 'red' }));
    expect(applied.result).toBe(true);
    expect(applied.updates).toBe(1);
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('fill')).toBe('blue');
    expect(obj.get('stroke')).toBe('red');
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(120);
    expect(label.toString()).toBe('Keep me');

    const rejected = countUpdates(doc, () => setShapeStyle(doc, id, { fill: 'teal' }));
    expect(rejected.result).toBe(false);
    expect(rejected.updates).toBe(0);
    expect(objectsMap(doc).get(id)!.get('fill')).toBe('blue');
  });

  it('TC-06: unknown kind and non-finite input return null with zero updates', () => {
    const doc = freshDoc();
    const cases: Array<{ kind: ShapeKind; rect: { x: number; y: number; width: number; height: number } | null; at: { x: number; y: number } }> = [
      { kind: 'triangle' as ShapeKind, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      { kind: 'rect', rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 }, at: { x: 0, y: 0 } },
      { kind: 'rect', rect: null, at: { x: Number.NaN, y: 5 } },
    ];
    for (const a of cases) {
      const seen = countUpdates(doc, () => expect(createShape(doc, a, 'g_test')).toBeNull());
      expect(seen.updates).toBe(0);
    }
    expect(objectsMap(doc).size).toBe(0);
  });

  it('stale ids and non-shape ids: setters return false, label is undefined, nothing written', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    if (typeof sticky !== 'string') throw new Error('sticky creation failed');
    const seen = countUpdates(doc, () => {
      expect(setShapeStyle(doc, 'gone', { fill: 'blue' })).toBe(false);
      expect(setShapeStyle(doc, sticky, { fill: 'blue' })).toBe(false);
    });
    expect(seen.updates).toBe(0);
    expect(getShapeLabel(doc, 'gone')).toBeUndefined();
    expect(getShapeLabel(doc, sticky)).toBeUndefined();
  });
});
