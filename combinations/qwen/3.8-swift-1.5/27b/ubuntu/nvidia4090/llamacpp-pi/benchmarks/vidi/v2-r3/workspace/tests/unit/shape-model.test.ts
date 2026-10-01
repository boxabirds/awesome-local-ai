import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

/** Run `fn` and count how many `update` events the doc emits. */
function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: unknown;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('shape.model (Yjs shape model against a real Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: createShape rect 200x120 → 1 object, correct dimensions, defaults
  it('TC-01: createShape rect 200x120 → correct dimensions, fill, stroke, label, z, createdBy', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 120 };
    const at: Point = { x: 100, y: 100 };
    const { result, updates } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect, at }, 'user1'));
    const id = result as string;
    expect(updates).toBe(1);
    expect(typeof id).toBe('string');

    const objects = doc.getMap('objects');
    const m = objects.get(id)! as Y.Map<unknown>;
    expect(m.get('type')).toBe('shape');
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(100);
    expect(m.get('width')).toBe(200);
    expect(m.get('height')).toBe(120);
    expect(m.get('kind')).toBe('rect');
    expect(m.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(m.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect((m.get('label') as Y.Text).toString()).toBe('');
    expect(m.get('z')).toBe(1);
    expect(m.get('createdBy')).toBe('user1');
  });

  // TC-02: rect 19x200 (below min) and rect null → default size centred
  it('TC-02: rect below min size and rect null → default 160x160 centred at point', () => {
    const at: Point = { x: 300, y: 200 };

    // Below minimum in width
    const rectSmall: Rect = { x: 300, y: 200, width: 19, height: 200 };
    const { result: id1 } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect: rectSmall, at }, 'user1'));
    const m1 = doc.getMap('objects').get(id1 as string)! as Y.Map<unknown>;
    expect(m1.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(m1.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(m1.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(m1.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // Null rect (click)
    const { result: id2 } = withUpdateCount(doc, () => createShape(doc, { kind: 'ellipse', rect: null, at }, 'user1'));
    const m2 = doc.getMap('objects').get(id2 as string)! as Y.Map<unknown>;
    expect(m2.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(m2.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(m2.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(m2.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD → kept (boundary)
  it('TC-03: rect exactly 20x20 → kept (boundary)', () => {
    const rect: Rect = { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    const at: Point = { x: 50, y: 50 };
    const { result: id } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect, at }, 'user1'));
    const m = doc.getMap('objects').get(id as string)! as Y.Map<unknown>;
    expect(m.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(m.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at drag origin
  it('TC-04: square constraint on 200x120 → 200x200 anchored at origin', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 120 };
    const at: Point = { x: 100, y: 100 };
    const { result: id } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'rect', rect, at, square: true }, 'user1'),
    );
    const m = doc.getMap('objects').get(id as string)! as Y.Map<unknown>;
    expect(m.get('width')).toBe(200);
    expect(m.get('height')).toBe(200);
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(100);
  });

  // TC-05: setShapeStyle fill 'blue' → applied; fill 'teal' → false
  it('TC-05: setShapeStyle fill blue → applied 1 update; fill teal → false 0 updates', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 120 };
    const at: Point = { x: 100, y: 100 };
    const { result: id } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect, at }, 'user1'));

    // Valid colour
    const { result: ok, updates: u1 } = withUpdateCount(doc, () => setShapeStyle(doc, id as string, { fill: 'blue' }));
    expect(ok).toBe(true);
    expect(u1).toBe(1);
    const m = doc.getMap('objects').get(id as string)! as Y.Map<unknown>;
    expect(m.get('fill')).toBe('blue');

    // Invalid colour
    const { result: bad, updates: u2 } = withUpdateCount(doc, () => setShapeStyle(doc, id as string, { fill: 'teal' }));
    expect(bad).toBe(false);
    expect(u2).toBe(0);
    expect(m.get('fill')).toBe('blue'); // unchanged
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  it('TC-06: unknown kind and non-finite rect → null, 0 updates', () => {
    // Unknown kind
    const { result: r1, updates: u1 } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1'),
    );
    expect(r1).toBeNull();
    expect(u1).toBe(0);

    // Non-finite rect
    const { result: r2, updates: u2 } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1'),
    );
    expect(r2).toBeNull();
    expect(u2).toBe(0);

    expect(doc.getMap('objects').size).toBe(0);
  });

  // Extra: getShapeLabel returns Y.Text
  it('getShapeLabel returns the Y.Text for an existing shape and undefined for a stale id', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 120 };
    const { result: id } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect, at: { x: 100, y: 100 } }, 'user1'));
    const label = getShapeLabel(doc, id as string);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
    expect(getShapeLabel(doc, 'missing')).toBeUndefined();
  });

  // Extra: z stacking
  it('shapes stack on top (z = maxZ + 1)', () => {
    const at: Point = { x: 100, y: 100 };
    const rect: Rect = { x: 100, y: 100, width: 200, height: 120 };
    const { result: id1 } = withUpdateCount(doc, () => createShape(doc, { kind: 'rect', rect, at }, 'user1'));
    const { result: id2 } = withUpdateCount(doc, () => createShape(doc, { kind: 'ellipse', rect, at }, 'user1'));
    expect((doc.getMap('objects').get(id1 as string)! as Y.Map<unknown>).get('z')).toBe(1);
    expect((doc.getMap('objects').get(id2 as string)! as Y.Map<unknown>).get('z')).toBe(2);
  });
});
