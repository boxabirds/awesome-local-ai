import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';
import { initDoc, snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';

/**
 * Unit tests for the shape model (TC-01 to TC-06).
 */

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` while counting the `update` events it emits on the doc. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count += 1; };
  doc.on('update', listener);
  try { fn(); } finally { doc.off('update', listener); }
  return count;
}

describe('shape model', () => {
  // TC-01: create drag creates shape at exact rect.
  it('TC-01 createShape rect 200x120 → 1 object with correct properties', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 200, y: 160 },
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap.length).toBe(1);
    const shape = snap[0]!;
    expect(shape.type).toBe('shape');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect((shape as any).width).toBe(200);
    expect((shape as any).height).toBe(120);
    expect((shape as any).fill).toBe(DEFAULT_SHAPE_FILL);
    expect((shape as any).stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect((shape as any).label).toBe('');
    expect((shape as any).z).toBe(1); // maxZ was 0, so z=1
    expect((shape as any).createdBy).toBe('user1');
  });

  // TC-02: tiny drag / click creates default-size shape centred on `at`.
  it('TC-02 rect 19x200 → default 160x160 centred at at', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: 19, height: 200 },
      at: { x: 100, y: 100 },
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    const shape = snap[0]!;
    expect((shape as any).width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect((shape as any).height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred at `at`: x = 100 - 80 = 20, y = 100 - 80 = 20
    expect(shape.x).toBe(20);
    expect(shape.y).toBe(20);
  });

  it('TC-02b rect null → default 160x160 centred at at', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 300, y: 400 },
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    const shape = snap[0]!;
    expect((shape as any).width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect((shape as any).height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred at (300, 400): x = 300-80=220, y=400-80=320
    expect(shape.x).toBe(220);
    expect(shape.y).toBe(320);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD → kept (boundary).
  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD → kept', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 60, y: 60 },
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    const shape = snap[0]!;
    expect((shape as any).width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect((shape as any).height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  // TC-04: square:true on 200x120 → 200x200 anchored at drag origin.
  it('TC-04 square constraint uses larger dimension', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 200, y: 160 },
      square: true,
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    const shape = snap[0]!;
    expect((shape as any).width).toBe(200);
    expect((shape as any).height).toBe(200);
    // Anchored at drag origin (top-left of rect): x=100, y=100
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  // TC-05: setShapeStyle validation.
  it('TC-05 setShapeStyle fill blue → applied, 1 update', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'user1');
    expect(id).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const result = setShapeStyle(doc, id!, { fill: 'blue' });
      expect(result).toBe(true);
    });
    expect(count).toBe(1);

    const snap = snapshot(doc);
    const shape = snap[0]!;
    expect((shape as any).fill).toBe('blue');
    // Label unchanged:
    expect((shape as any).label).toBe('');
  });

  it('TC-05b setShapeStyle fill "teal" → false, 0 updates', () => {
    const doc = createDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'user1');
    expect(id).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const result = setShapeStyle(doc, id!, { fill: 'teal' });
      expect(result).toBe(false);
    });
    expect(count).toBe(0);
  });

  // TC-06: unknown kind and non-finite rect → null, 0 updates.
  it('TC-06 kind "triangle" → null, 0 updates', () => {
    const doc = createDoc();
    const count = withUpdateCount(doc, () => {
      const result = createShape(doc, {
        kind: 'triangle' as any,
        rect: { x: 0, y: 0, width: 100, height: 100 },
        at: { x: 50, y: 50 },
      }, 'user1');
      expect(result).toBeNull();
    });
    expect(count).toBe(0);
  });

  it('TC-06b non-finite rect → null, 0 updates', () => {
    const doc = createDoc();
    const count = withUpdateCount(doc, () => {
      const result = createShape(doc, {
        kind: 'rect',
        rect: { x: NaN, y: 0, width: 100, height: 100 },
        at: { x: 50, y: 50 },
      }, 'user1');
      expect(result).toBeNull();
    });
    expect(count).toBe(0);
  });
});