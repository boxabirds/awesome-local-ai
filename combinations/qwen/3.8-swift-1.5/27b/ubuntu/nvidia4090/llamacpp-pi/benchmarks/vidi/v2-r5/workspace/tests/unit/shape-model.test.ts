// tests/unit/shape-model.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function countUpdatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

describe('shape.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: createShape rect 200x120
  describe('TC-01: createShape with rect 200x120', () => {
    it('creates 1 object with width 200, height 120, default fill/stroke, empty label, z=1, createdBy set', () => {
      const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'user-1');
      expect(id).not.toBeNull();

      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      const shape = snap[0] as any;
      expect(shape.id).toBe(id);
      expect(shape.type).toBe('shape');
      expect(shape.kind).toBe('rect');
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(120);
      expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
      expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
      expect(shape.label).toBe('');
      expect(shape.z).toBe(1);
      expect(shape.createdBy).toBe('user-1');
    });

    it('emits exactly 1 update event', () => {
      const updates = countUpdatesDuring(doc, () => {
        createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'user-1');
      });
      expect(updates).toBe(1);
    });
  });

  // TC-02: rect 19x200 and rect null → default size centred at `at`
  describe('TC-02: click behaviour (tiny drag and null rect)', () => {
    it('rect 19x200 → default 160x160 centred at `at`', () => {
      const at = { x: 300, y: 400 };
      const id = createShape(doc, { kind: 'ellipse', rect: { x: 290, y: 400, width: 19, height: 200 }, at }, 'user-1');
      expect(id).not.toBeNull();

      const snap = snapshot(doc);
      const shape = snap[0] as any;
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    });

    it('rect null → default 160x160 centred at `at`', () => {
      const at = { x: 100, y: 200 };
      const id = createShape(doc, { kind: 'diamond', rect: null, at }, 'user-1');
      expect(id).not.toBeNull();

      const snap = snapshot(doc);
      const shape = snap[0] as any;
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    });
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  describe('TC-03: rect exactly 20x20 (boundary)', () => {
    it('keeps the 20x20 rect as drawn', () => {
      const at = { x: 50, y: 50 };
      const id = createShape(doc, { kind: 'rect', rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at }, 'user-1');
      expect(id).not.toBeNull();

      const snap = snapshot(doc);
      const shape = snap[0] as any;
      expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(shape.x).toBe(50);
      expect(shape.y).toBe(50);
    });
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at drag origin
  describe('TC-04: Shift constraint (square: true)', () => {
    it('makes 200x120 into 200x200 anchored at drag origin', () => {
      const at = { x: 100, y: 100 };
      const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at, square: true }, 'user-1');
      expect(id).not.toBeNull();

      const snap = snapshot(doc);
      const shape = snap[0] as any;
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(200);
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
    });
  });

  // TC-05: setShapeStyle fill 'blue' → applied; fill 'teal' → false
  describe('TC-05: setShapeStyle', () => {
    it('applies fill blue, 1 update, label/size unchanged', () => {
      const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'user-1')!;
      const before = (snapshot(doc)[0] as any);

      const updates = countUpdatesDuring(doc, () => {
        const result = setShapeStyle(doc, id, { fill: 'blue' });
        expect(result).toBe(true);
      });
      expect(updates).toBe(1);

      const after = (snapshot(doc)[0] as any);
      expect(after.fill).toBe('blue');
      expect(after.label).toBe(before.label);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    });

    it('fill "teal" → false, 0 updates (negative)', () => {
      const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'user-1')!;

      const updates = countUpdatesDuring(doc, () => {
        const result = setShapeStyle(doc, id, { fill: 'teal' });
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  describe('TC-06: error paths', () => {
    it('unknown kind "triangle" → null, 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user-1');
        expect(result).toBeNull();
      });
      expect(updates).toBe(0);
    });

    it('non-finite rect → null, 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user-1');
        expect(result).toBeNull();
      });
      expect(updates).toBe(0);
    });
  });
});
