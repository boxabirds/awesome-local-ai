import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '@shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '@shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '@shared/config';

describe('shape.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: createShape rect 200x120 → 1 object, width 200, height 120, fill white, stroke dark, empty label, z=maxZ+1, createdBy set
  describe('TC-01: createShape with drag rect', () => {
    it('creates a shape 200x120 with correct defaults', () => {
      // Pre-existing sticky for z ordering
      createSticky(doc, { x: 0, y: 0 });

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 50, y: 60, width: 200, height: 120 }, at: { x: 150, y: 120 } },
        'user1',
      );
      expect(id).not.toBeNull();
      expect(id!.length).toBeGreaterThan(0);

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('type')).toBe('shape');
      expect(obj.get('x')).toBe(50);
      expect(obj.get('y')).toBe(60);
      expect(obj.get('width')).toBe(200);
      expect(obj.get('height')).toBe(120);
      expect(obj.get('fill')).toBe(DEFAULT_SHAPE_FILL);
      expect(obj.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
      expect((obj.get('label') as Y.Text).toString()).toBe('');
      expect(obj.get('z')).toBe(2); // above sticky z=1
      expect(obj.get('createdBy')).toBe('user1');
      expect(updateCount).toBe(1);
    });
  });

  // TC-02: rect 19x200 and rect null → default 160x160 centred at point (click behaviour)
  describe('TC-02: click creates default size', () => {
    it('rect below min in width creates default 160x160 centred at at', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 19, height: 200 }, at: { x: 109, y: 200 } },
        'user1',
      );
      expect(id).not.toBeNull();
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(obj.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(obj.get('x')).toBe(109 - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(obj.get('y')).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(updateCount).toBe(1);
    });

    it('null rect creates default 160x160 centred at point', () => {
      const id = createShape(
        doc,
        { kind: 'ellipse', rect: null, at: { x: 300, y: 400 } },
        'user1',
      );
      expect(id).not.toBeNull();
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(obj.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(obj.get('x')).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(obj.get('y')).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    });
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  describe('TC-03: exact min size boundary', () => {
    it('rect of exactly 20x20 is kept as drawn', () => {
      const id = createShape(
        doc,
        { kind: 'diamond', rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 60, y: 60 } },
        'user1',
      );
      expect(id).not.toBeNull();
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(obj.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
      expect(obj.get('x')).toBe(50);
      expect(obj.get('y')).toBe(50);
    });
  });

  // TC-04: square:true on 200x120 → 200x200 anchored at drag origin
  describe('TC-04: shift constraint (square)', () => {
    it('makes width and height equal to the larger dimension', () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
        'user1',
      );
      expect(id).not.toBeNull();
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('width')).toBe(200);
      expect(obj.get('height')).toBe(200);
      expect(obj.get('x')).toBe(100);
      expect(obj.get('y')).toBe(100);
    });
  });

  // TC-05: setShapeStyle fill 'blue' → applied, 1 update; fill 'teal' → false, 0 updates
  describe('TC-05: style validation', () => {
    it('applies valid fill colour', () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
        'user1',
      )!;

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const result = setShapeStyle(doc, id, { fill: 'blue' });
      expect(result).toBe(true);
      expect(updateCount).toBe(1);

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id)!;
      expect(obj.get('fill')).toBe('blue');
      // label and size unchanged
      expect((obj.get('label') as Y.Text).toString()).toBe('');
      expect(obj.get('width')).toBe(100);
    });

    it('rejects invalid fill colour with false and 0 updates', () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
        'user1',
      )!;

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const result = setShapeStyle(doc, id, { fill: 'teal' });
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  describe('TC-06: invalid kind and rect', () => {
    it('rejects unknown kind', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createShape(
        doc,
        { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
        'user1',
      );
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('rejects non-finite rect', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
        'user1',
      );
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('rejects non-finite at point', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createShape(
        doc,
        { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } },
        'user1',
      );
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });
  });

  // getShapeLabel
  describe('getShapeLabel', () => {
    it('returns Y.Text for existing shape', () => {
      const id = createShape(
        doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
        'user1',
      )!;
      const ytext = getShapeLabel(doc, id);
      expect(ytext).toBeDefined();
      expect(ytext!.toString()).toBe('');
    });

    it('returns undefined for stale id', () => {
      const ytext = getShapeLabel(doc, 'nonexistent');
      expect(ytext).toBeUndefined();
    });
  });
});
