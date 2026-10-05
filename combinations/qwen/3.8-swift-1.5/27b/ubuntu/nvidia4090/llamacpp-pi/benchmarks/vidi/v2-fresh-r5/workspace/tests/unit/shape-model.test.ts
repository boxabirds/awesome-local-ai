import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

describe('shape model', () => {
  // TC-01: createShape rect 200x120 → 1 object, width 200, height 120, fill DEFAULT_SHAPE_FILL, stroke DEFAULT_SHAPE_STROKE, empty label Y.Text, z = maxZ+1, createdBy set.
  it('TC-01: creates a shape with given rect dimensions', () => {
    const doc = newDoc();
    const getUpdates = countUpdates(doc);

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'local');

    expect(id).toBeTypeOf('string');
    expect(id).not.toBe('');

    const objects = doc.getMap('objects');
    const obj = objects.get(id!) as Y.Map<unknown>;
    expect(obj).toBeDefined();
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(100);
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(120);
    expect(obj.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(obj.get('kind')).toBe('rect');
    expect(obj.get('z')).toBe(1);
    expect(obj.get('createdBy')).toBe('local');

    const label = obj.get('text') as Y.Text;
    expect(label).toBeInstanceOf(Y.Text);
    expect(label.toString()).toBe('');

    expect(getUpdates()).toBe(1);
  });

  // TC-02: rect 19x200 and rect null → SHAPE_DEFAULT_SIZE_WORLD square centred at `at` (click behaviour).
  it('TC-02: small rect and null rect create default-size shape centred at point', () => {
    const doc = newDoc();

    // Small rect (19 < SHAPE_MIN_SIZE_WORLD = 20)
    const id1 = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 19, height: 200 },
      at: { x: 300, y: 200 },
    }, 'local');

    const obj1 = doc.getMap('objects').get(id1!) as Y.Map<unknown>;
    expect(obj1.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj1.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred at (300, 200)
    expect(obj1.get('x')).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj1.get('y')).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // Null rect (click)
    const id2 = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 500, y: 400 },
    }, 'local');

    const obj2 = doc.getMap('objects').get(id2!) as Y.Map<unknown>;
    expect(obj2.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2.get('x')).toBe(500 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj2.get('y')).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary).
  it('TC-03: rect exactly at minimum size is kept as drawn', () => {
    const doc = newDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 50, y: 60 },
    }, 'local');

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj.get('x')).toBe(50);
    expect(obj.get('y')).toBe(60);
  });

  // TC-04: `square: true` on 200x120 → 200x200 anchored at drag origin.
  it('TC-04: square constraint makes width equal height (larger dimension)', () => {
    const doc = newDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    }, 'local');

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(200);
    // Anchored at drag origin
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(100);
  });

  // TC-05: setShapeStyle fill 'blue' → applied, 1 update, label/size unchanged; fill 'teal' → false, 0 updates (negative).
  it('TC-05: setShapeStyle applies valid colours and rejects invalid ones', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'local')!;

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const originalWidth = obj.get('width');
    const originalHeight = obj.get('height');
    const label = obj.get('text') as Y.Text;
    label.insert(0, 'Hello');

    // Valid fill
    const getUpdates = countUpdates(doc);
    const result = setShapeStyle(doc, id, { fill: 'blue' });
    expect(result).toBe(true);
    expect(getUpdates()).toBe(1);
    expect(obj.get('fill')).toBe('blue');
    expect(obj.get('width')).toBe(originalWidth);
    expect(obj.get('height')).toBe(originalHeight);
    expect(label.toString()).toBe('Hello');

    // Invalid fill
    const getUpdates2 = countUpdates(doc);
    const result2 = setShapeStyle(doc, id, { fill: 'teal' });
    expect(result2).toBe(false);
    expect(getUpdates2()).toBe(0);
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates (error path).
  it('TC-06: unknown kind and non-finite rect return null with no updates', () => {
    const doc = newDoc();

    // Unknown kind
    const getUpdates1 = countUpdates(doc);
    const id1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'local');
    expect(id1).toBeNull();
    expect(getUpdates1()).toBe(0);

    // Non-finite rect
    const getUpdates2 = countUpdates(doc);
    const id2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'local');
    expect(id2).toBeNull();
    expect(getUpdates2()).toBe(0);
  });
});
