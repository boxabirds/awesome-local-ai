import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle, type ShapeSnapshot } from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count++; };
  doc.on('update', listener);
  fn();
  doc.off('update', listener);
  return count;
}

describe('shape model', () => {
  // TC-01: createShape rect 200x120 → 1 object, correct dimensions, defaults
  it('TC-01 createShape rect 200x120 produces correct shape', () => {
    const doc = newDoc();
    const rect = { x: 100, y: 100, width: 200, height: 120 };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 200, y: 160 } }, 'user1');
    expect(id).not.toBeNull();
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    const s = snaps[0] as ShapeSnapshot;
    expect(s.type).toBe('shape');
    expect(s.kind).toBe('rect');
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
    expect(s.width).toBe(200);
    expect(s.height).toBe(120);
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(s.label).toBe('');
    expect(s.z).toBe(1);
    expect(s.createdBy).toBe('user1');
  });

  // TC-02: rect 19x200 → default size centred at at; rect null → default size centred at at
  it('TC-02 rect below min size or null creates default 160x160 centred at point', () => {
    const doc = newDoc();
    const at = { x: 500, y: 400 };

    // rect below min width (19 < 20)
    const id1 = createShape(doc, { kind: 'rect', rect: { x: 500, y: 400, width: 19, height: 200 }, at }, 'user1');
    expect(id1).not.toBeNull();
    let snaps = snapshot(doc);
    let s = snaps.find((o) => o.id === id1) as ShapeSnapshot;
    expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(s.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null (click)
    const id2 = createShape(doc, { kind: 'ellipse', rect: null, at }, 'user1');
    expect(id2).not.toBeNull();
    snaps = snapshot(doc);
    s = snaps.find((o) => o.id === id2) as ShapeSnapshot;
    expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(s.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD is kept', () => {
    const doc = newDoc();
    const rect = { x: 100, y: 100, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 110, y: 110 } }, 'user1');
    expect(id).not.toBeNull();
    const snaps = snapshot(doc);
    const s = snaps[0] as ShapeSnapshot;
    expect(s.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(s.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at drag origin
  it('TC-04 square constraint makes equal sides from larger dimension', () => {
    const doc = newDoc();
    const rect = { x: 50, y: 60, width: 200, height: 120 };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 50, y: 60 }, square: true }, 'user1');
    expect(id).not.toBeNull();
    const snaps = snapshot(doc);
    const s = snaps[0] as ShapeSnapshot;
    expect(s.width).toBe(200);
    expect(s.height).toBe(200);
    expect(s.x).toBe(50);
    expect(s.y).toBe(60);
  });

  // TC-05: setShapeStyle fill 'blue' applied; fill 'teal' → false, 0 updates
  it('TC-05 setShapeStyle validates colours', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user1');
    expect(id).not.toBeNull();

    // Valid fill
    const updates1 = countUpdates(doc, () => {
      const r = setShapeStyle(doc, id!, { fill: 'blue' });
      expect(r).toBe(true);
    });
    expect(updates1).toBe(1);
    let s = snapshot(doc)[0] as ShapeSnapshot;
    expect(s.fill).toBe('blue');
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE); // unchanged

    // Invalid fill
    const updates2 = countUpdates(doc, () => {
      const r = setShapeStyle(doc, id!, { fill: 'teal' });
      expect(r).toBe(false);
    });
    expect(updates2).toBe(0);
  });

  // TC-06: kind 'triangle' → null; non-finite rect → null; 0 updates
  it('TC-06 invalid kind or non-finite rect returns null with 0 updates', () => {
    const doc = newDoc();
    const updates1 = countUpdates(doc, () => {
      const r = createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1');
      expect(r).toBeNull();
    });
    expect(updates1).toBe(0);

    const updates2 = countUpdates(doc, () => {
      const r = createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1');
      expect(r).toBeNull();
    });
    expect(updates2).toBe(0);
  });
});
