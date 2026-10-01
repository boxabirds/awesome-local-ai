import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle, type ShapeSnap } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function countUpdates(doc: Y.Doc): { count: () => number; off: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    off: () => { doc.off('update', handler); },
  };
}

function getShapes(doc: Y.Doc): readonly ShapeSnap[] {
  return snapshot(doc).filter((s) => s.type === 'shape') as ShapeSnap[];
}

describe('shape.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: createShape rect 200x120 → 1 object, correct defaults
  it('TC-01: createShape rect 200x120 creates shape with correct properties', () => {
    const up = countUpdates(doc);
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'user1');

    expect(id).toBeTypeOf('string');
    expect(id!.length).toBeGreaterThan(0);

    const shapes = getShapes(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].id).toBe(id);
    expect(shapes[0].type).toBe('shape');
    expect(shapes[0].kind).toBe('rect');
    expect(shapes[0].x).toBe(100);
    expect(shapes[0].y).toBe(100);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(120);
    expect(shapes[0].fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shapes[0].stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shapes[0].label).toBe('');
    expect(shapes[0].z).toBe(1);
    expect(shapes[0].createdBy).toBe('user1');
    expect(up.count()).toBe(1);
    up.off();
  });

  // TC-02: rect 19x200 and rect null → default size centred at point
  it('TC-02: tiny rect and null rect create default size centred at point', () => {
    // Tiny rect (19 < 20 min)
    createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 19, height: 200 },
      at: { x: 150, y: 200 },
    }, 'user1');

    const shapes1 = getShapes(doc);
    expect(shapes1).toHaveLength(1);
    expect(shapes1[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shapes1[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shapes1[0].x).toBe(150 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shapes1[0].y).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // Null rect (click)
    const id2 = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 300, y: 400 },
    }, 'user1');

    const shapes2 = getShapes(doc);
    expect(shapes2).toHaveLength(2);
    const shape2 = shapes2.find((s) => s.id === id2)!;
    expect(shape2.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape2.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape2.x).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shape2.y).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  it('TC-03: rect exactly min size is kept as drawn', () => {
    createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 50, y: 50 },
    }, 'user1');

    const shapes = getShapes(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shapes[0].height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shapes[0].x).toBe(50);
    expect(shapes[0].y).toBe(50);
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at drag origin
  it('TC-04: square constraint makes width equal height (larger dimension)', () => {
    createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    }, 'user1');

    const shapes = getShapes(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(200);
    expect(shapes[0].x).toBe(100);
    expect(shapes[0].y).toBe(100);
  });

  // TC-05: setShapeStyle fill 'blue' → applied; fill 'teal' → false
  it('TC-05: setShapeStyle applies valid colour, rejects invalid', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');

    // Valid colour
    const up = countUpdates(doc);
    const result = setShapeStyle(doc, id!, { fill: 'blue' });
    expect(result).toBe(true);
    expect(up.count()).toBe(1);

    const shapes = getShapes(doc);
    expect(shapes[0].fill).toBe('blue');
    // Label and size unchanged
    expect(shapes[0].label).toBe('');
    expect(shapes[0].width).toBe(100);
    expect(shapes[0].height).toBe(100);
    up.off();

    // Invalid colour
    const up2 = countUpdates(doc);
    const result2 = setShapeStyle(doc, id!, { fill: 'teal' });
    expect(result2).toBe(false);
    expect(up2.count()).toBe(0);
    up2.off();
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  it('TC-06: invalid kind and non-finite rect return null with no updates', () => {
    // Invalid kind
    const up = countUpdates(doc);
    const id1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id1).toBeNull();
    expect(up.count()).toBe(0);
    up.off();

    // Non-finite rect
    const up2 = countUpdates(doc);
    const id2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id2).toBeNull();
    expect(up2.count()).toBe(0);
    up2.off();
  });
});
