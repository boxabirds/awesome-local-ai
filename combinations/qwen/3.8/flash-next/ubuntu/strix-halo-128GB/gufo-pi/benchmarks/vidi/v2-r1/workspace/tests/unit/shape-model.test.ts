import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createShape,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * Unit tests for the shape.model contract (TC-01 to TC-06).
 * Tests run against a real Y.Doc so transactions and origins are real.
 */

function harness(): {
  doc: Y.Doc;
  updates: number;
  origins: unknown[];
} {
  const doc = new Y.Doc();
  let updates = 0;
  const origins: unknown[] = [];
  doc.on('update', (_u: unknown, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  return { doc, get updates() { return updates; }, origins };
}

describe('shape.model createShape (TC-01)', () => {
  it('TC-01 createShape rect 200x120 → 1 object, correct fields', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 50, y: 60, width: 200, height: 120 },
      at: { x: 50, y: 60 },
    }, 'user1');

    expect(id).not.toBeNull();
    expect(id).toBeTruthy();

    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    expect(entry.get('type')).toBe('shape');
    expect(entry.get('kind')).toBe('rect');
    expect(entry.get('x')).toBe(50);
    expect(entry.get('y')).toBe(60);
    expect(entry.get('width')).toBe(200);
    expect(entry.get('height')).toBe(120);
    expect(entry.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(entry.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(entry.get('createdBy')).toBe('user1');

    const label = entry.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect((label as Y.Text).toString()).toBe('');

    // z is set above existing max (0 if no objects)
    const z = entry.get('z') as number;
    expect(z).toBeGreaterThanOrEqual(1);

    // exactly one update with LOCAL_ORIGIN
    expect(h.updates).toBe(before + 1);
    expect(h.origins[h.origins.length - 1]).toBe(LOCAL_ORIGIN);
  });
});

describe('shape.model createShape click/default size (TC-02)', () => {
  it('TC-02 rect 19x200 → default size centred at point', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 19, height: 200 },
      at: { x: 100, y: 100 },
    }, 'user1');

    expect(id).not.toBeNull();
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    expect(entry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('x')).toBe(100 - half);
    expect(entry.get('y')).toBe(100 - half);
    expect(h.updates).toBe(before + 1);
  });

  it('TC-02 rect null → default size centred at point', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: null,
      at: { x: 300, y: 400 },
    }, 'user1');

    expect(id).not.toBeNull();
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    expect(entry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('x')).toBe(300 - half);
    expect(entry.get('y')).toBe(400 - half);
    expect(h.updates).toBe(before + 1);
  });
});

describe('shape.model createShape boundary (TC-03)', () => {
  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD × SHAPE_MIN_SIZE_WORLD → kept', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 10, y: 10, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 10, y: 10 },
    }, 'user1');

    expect(id).not.toBeNull();
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(entry.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(entry.get('x')).toBe(10);
    expect(entry.get('y')).toBe(10);
    expect(h.updates).toBe(before + 1);
  });
});

describe('shape.model createShape square (TC-04)', () => {
  it('TC-04 square:true on 200x120 → 200x200 anchored at drag origin', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 50, y: 60, width: 200, height: 120 },
      at: { x: 50, y: 60 },
      square: true,
    }, 'user1');

    expect(id).not.toBeNull();
    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(200);
    expect(entry.get('height')).toBe(200);
    expect(entry.get('x')).toBe(50);
    expect(entry.get('y')).toBe(60);
    expect(h.updates).toBe(before + 1);
  });
});

describe('shape.model setShapeStyle (TC-05)', () => {
  it('TC-05 setShapeStyle fill blue → applied, label and size unchanged', () => {
    const h = harness();
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1')!;

    const before = h.updates;
    const result = setShapeStyle(h.doc, id, { fill: 'blue' });
    expect(result).toBe(true);
    expect(h.updates).toBe(before + 1);

    const objects = h.doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown>;
    expect(entry.get('fill')).toBe('blue');
    expect(entry.get('width')).toBe(100);
    expect(entry.get('height')).toBe(100);
  });

  it('TC-05 setShapeStyle fill "teal" → false, 0 updates', () => {
    const h = harness();
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1')!;

    const before = h.updates;
    const result = setShapeStyle(h.doc, id, { fill: 'teal' });
    expect(result).toBe(false);
    expect(h.updates).toBe(before);
  });
});

describe('shape.model createShape errors (TC-06)', () => {
  it('TC-06 unknown kind → null, 0 updates', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id).toBeNull();
    expect(h.updates).toBe(before);
  });

  it('TC-06 non-finite rect → null, 0 updates', () => {
    const h = harness();
    const before = h.updates;
    const id = createShape(h.doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id).toBeNull();
    expect(h.updates).toBe(before);
  });
});
