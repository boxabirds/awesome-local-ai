/**
 * Task 7: Shape model unit tests (TC-01 to TC-06)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '@/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD } from '@/shared/config';

// Import stubs — these will be implemented in Task 8
let createShape: any;
let setShapeStyle: any;
let getShapeLabel: any;

async function loadModules() {
  const mod = await import('@/shared/objects/shape');
  createShape = mod.createShape;
  setShapeStyle = mod.setShapeStyle;
  getShapeLabel = mod.getShapeLabel;
}

function countUpdateEvents(doc: Y.Doc, cb: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  cb();
  doc.off('update', handler);
  return count;
}

describe('shape.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(async () => {
    await loadModules();
    doc = new Y.Doc();
    initDoc(doc);
  });

  // ---- TC-01: createShape by drag creates correct shape ----
  it('TC-01: createShape rect 200x120 → 1 object with correct fields', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
    expect(id).toBeDefined();
    const snaps = doc.getMap('objects') as any;
    expect(snaps.size).toBe(1);
    const inner = snaps.get(id);
    expect(inner.get('type')).toBe('shape');
    expect(inner.get('kind')).toBe('rect');
    expect(inner.get('x')).toBe(0);
    expect(inner.get('y')).toBe(0);
    expect(inner.get('width')).toBe(200);
    expect(inner.get('height')).toBe(120);
    expect(inner.get('fill')).toBe('white');
    expect(inner.get('stroke')).toBe('dark');
    expect(inner.get('label')).toBeInstanceOf(Y.Text);
    expect(inner.get('label').toString()).toBe('');
    expect(inner.get('z')).toBe(1);
    expect(inner.get('createdBy')).toBe('user-1');
  });

  // ---- TC-02: createShape click (null rect) or tiny drag → default size centred ----
  it('TC-02a: createShape with rect null → default 160x160 centred at at point', () => {
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 200 }, square: false }, 'user-1');
    expect(id).toBeDefined();
    const snaps = doc.getMap('objects') as any;
    const inner = snaps.get(id);
    expect(inner.get('x')).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(inner.get('y')).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(inner.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(inner.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-02b: createShape with rect smaller than min → default 160x160 centred at at point', () => {
    // rect is tiny (19 wide) so it triggers click behaviour
    const id = createShape(doc, { kind: 'rect', rect: { x: 50, y: 100, width: 19, height: 200 }, at: { x: 100, y: 200 }, square: false }, 'user-1');
    expect(id).toBeDefined();
    const snaps = doc.getMap('objects') as any;
    const inner = snaps.get(id);
    expect(inner.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(inner.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred on the at point
    expect(inner.get('x')).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(inner.get('y')).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });



  // ---- TC-03: exact min size kept ----
  it('TC-03: createShape with exactly min-size rect → kept as drawn', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 10, width: 20, height: 20 }, at: { x: 10, y: 10 }, square: false }, 'user-1');
    expect(id).toBeDefined();
    const snaps = doc.getMap('objects') as any;
    const inner = snaps.get(id);
    expect(inner.get('width')).toBe(20);
    expect(inner.get('height')).toBe(20);
  });

  // ---- TC-04: square flag -> larger dimension used for both ----
  it('TC-04: createShape with square=true on 200x120 → 200x200 anchored at origin', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: true }, 'user-1');
    expect(id).toBeDefined();
    const snaps = doc.getMap('objects') as any;
    const inner = snaps.get(id);
    expect(inner.get('width')).toBe(200);
    expect(inner.get('height')).toBe(200);
    expect(inner.get('x')).toBe(0);
    expect(inner.get('y')).toBe(0);
  });

  // ---- TC-05: setShapeStyle valid colour applied, invalid returns false ----
  it('TC-05a: setShapeStyle fill blue → applied, 1 update', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
    const updates = countUpdateEvents(doc, () => {
      const result = setShapeStyle(doc, id, { fill: 'blue' });
      expect(result).toBe(true);
    });
    expect(updates).toBe(1);
    const snaps = doc.getMap('objects') as any;
    expect(snaps.get(id).get('fill')).toBe('blue');
    // Label and size unchanged
    expect(snaps.get(id).get('label').toString()).toBe('');
    expect(snaps.get(id).get('width')).toBe(100);
    expect(snaps.get(id).get('height')).toBe(100);
  });

  it('TC-05b: setShapeStyle unknown colour "teal" → false, 0 updates', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
    const updates = countUpdateEvents(doc, () => {
      const result = setShapeStyle(doc, id, { fill: 'teal' });
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-05c: setShapeStyle on stale id → false, 0 updates', () => {
    const updates = countUpdateEvents(doc, () => {
      const result = setShapeStyle(doc, 'nonexistent-id', { fill: 'blue' });
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // ---- TC-06: unknown kind or non-finite rect → null ----
  it('TC-06a: createShape with unknown kind → null, 0 updates', async () => {
    const mod = await import('@/shared/objects/shape');
    const badCreateShape = mod.createShape;
    const updates = countUpdateEvents(doc, () => {
      const id = badCreateShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
      expect(id).toBe(null);
    });
    expect(updates).toBe(0);
    const snaps = doc.getMap('objects') as any;
    expect(snaps.size).toBe(0);
  });

  it('TC-06b: createShape with non-finite rect → null', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: Infinity, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
    expect(id).toBe(null);
  });

  it('TC-06c: createShape with non-finite at point → null', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: NaN, y: 0 }, square: false }, 'user-1');
    expect(id).toBe(null);
  });

  // ---- getShapeLabel ----
  it('getShapeLabel returns Y.Text for valid id', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'user-1');
    const label = getShapeLabel(doc, id);
    expect(label).toBeDefined();
    expect(label!.toString()).toBe('');
  });

  it('getShapeLabel returns undefined for stale id', () => {
    const label = getShapeLabel(doc, 'nonexistent');
    expect(label).toBe(undefined);
  });
});
