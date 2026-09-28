/**
 * Unit tests for the shape model (TC-01 to TC-06).
 * Uses a real Y.Doc.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import {
  initDoc,
  LOCAL_ORIGIN,
  createSticky,
} from '../../src/shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

describe('shape model', () => {
  let doc: Y.Doc;
  let updateCount: number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    updateCount = 0;
    doc.on('update', () => { updateCount++; });
  });

  // TC-01: createShape rect 200x120 → 1 object, width 200, height 120, fill white, stroke dark, empty label, z=maxZ+1, createdBy set
  it('TC-01: createShape with drag rect 200x120', () => {
    updateCount = 0;
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 200, width: 200, height: 120 },
      at: { x: 100, y: 200 },
    }, 'user1');
    expect(id).not.toBeNull();
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('shape');
    expect(obj!.get('kind')).toBe('rect');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(200);
    expect(obj!.get('width')).toBe(200);
    expect(obj!.get('height')).toBe(120);
    expect(obj!.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj!.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(obj!.get('createdBy')).toBe('user1');
    const label = obj!.get('label') as Y.Text;
    expect(label.toString()).toBe('');
    // z should be at least 1
    expect(obj!.get('z')).toBeGreaterThanOrEqual(1);
    // Exactly 1 update (the initDoc transaction happened before we started counting)
    expect(updateCount).toBe(1);
  });

  // TC-02: rect 19x200 and rect null → SHAPE_DEFAULT_SIZE_WORLD centred at `at`
  it('TC-02: tiny rect and null rect use default size centred at point', () => {
    updateCount = 0;
    const at = { x: 500, y: 300 };

    // Tiny rect (width < min)
    const id1 = createShape(doc, {
      kind: 'ellipse',
      rect: { x: at.x, y: at.y, width: 19, height: 200 },
      at,
    }, 'user1');
    expect(id1).not.toBeNull();
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj1 = objects.get(id1!);
    expect(obj1!.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj1!.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj1!.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj1!.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // Null rect (click)
    const id2 = createShape(doc, {
      kind: 'diamond',
      rect: null,
      at,
    }, 'user1');
    expect(id2).not.toBeNull();
    const obj2 = objects.get(id2!);
    expect(obj2!.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2!.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2!.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj2!.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    expect(updateCount).toBe(2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  it('TC-03: rect exactly at minimum size is kept', () => {
    updateCount = 0;
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 50, y: 50 },
    }, 'user1');
    expect(id).not.toBeNull();
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    expect(obj!.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj!.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(updateCount).toBe(1);
  });

  // TC-04: square:true on 200x120 → 200x200 anchored at drag origin
  it('TC-04: square constraint uses larger dimension anchored at origin', () => {
    updateCount = 0;
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    }, 'user1');
    expect(id).not.toBeNull();
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    expect(obj!.get('width')).toBe(200);
    expect(obj!.get('height')).toBe(200);
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(100);
    expect(updateCount).toBe(1);
  });

  // TC-05: setShapeStyle fill 'blue' → applied, 1 update; fill 'teal' → false, 0 updates
  it('TC-05: setShapeStyle valid colour applied, invalid rejected', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user1');
    expect(id).not.toBeNull();
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const label = objects.get(id!)!.get('label') as Y.Text;
    doc.transact(() => { label.insert(0, 'Hello'); }, LOCAL_ORIGIN);

    updateCount = 0;
    // Valid fill
    const r1 = setShapeStyle(doc, id!, { fill: 'blue' });
    expect(r1).toBe(true);
    expect(objects.get(id!)!.get('fill')).toBe('blue');
    expect(updateCount).toBe(1);
    // Label unchanged
    expect(label.toString()).toBe('Hello');
    // Size/position unchanged
    expect(objects.get(id!)!.get('x')).toBeDefined();

    // Invalid fill
    updateCount = 0;
    const r2 = setShapeStyle(doc, id!, { fill: 'teal' });
    expect(r2).toBe(false);
    expect(updateCount).toBe(0);

    // Valid stroke
    updateCount = 0;
    const r3 = setShapeStyle(doc, id!, { stroke: 'red' });
    expect(r3).toBe(true);
    expect(objects.get(id!)!.get('stroke')).toBe('red');
    expect(updateCount).toBe(1);

    // Invalid stroke
    updateCount = 0;
    const r4 = setShapeStyle(doc, id!, { stroke: 'neon' });
    expect(r4).toBe(false);
    expect(updateCount).toBe(0);
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  it('TC-06: invalid kind or non-finite rect returns null with no transaction', () => {
    updateCount = 0;
    const r1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(r1).toBeNull();

    const r2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(r2).toBeNull();

    const r3 = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: Infinity, y: 0 },
    }, 'user1');
    expect(r3).toBeNull();

    expect(updateCount).toBe(0);
  });

  // Additional: z = maxZ + 1
  it('z is maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user');
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const shapeObj = objects.get(id!);
    // Sticky gets z=1, shape should be z=2
    expect(shapeObj!.get('z')).toBe(2);
  });
});
