import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import { snapshotObjects } from '../../src/shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => count++);
  return () => count;
}

describe('shape.model (unit)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01: createShape rect 200x120 → 1 object with correct properties', () => {
    const getUpdates = countUpdates(doc);
    const rect: Rect = { x: 100, y: 200, width: 200, height: 120 };
    const at: Point = { x: 100, y: 200 };

    const id = createShape(doc, { kind: 'rect', rect, at }, 'user1');
    expect(id).toBeTruthy();
    expect(getUpdates()).toBe(1);

    const snaps = snapshotObjects(doc);
    expect(snaps).toHaveLength(1);
    const s = snaps[0];
    expect(s.id).toBe(id);
    expect(s.type).toBe('shape');
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.width).toBe(200);
    expect(s.height).toBe(120);
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(s.text).toBe('');
    expect(s.z).toBe(1);
  });

  it('TC-02: rect 19x200 and rect null → default size centred at `at`', () => {
    // 19x200: width below SHAPE_MIN_SIZE_WORLD
    const rect1: Rect = { x: 0, y: 0, width: 19, height: 200 };
    const at1: Point = { x: 50, y: 50 };
    const id1 = createShape(doc, { kind: 'rect', rect: rect1, at: at1 }, 'user1');
    expect(id1).toBeTruthy();

    const snaps1 = snapshotObjects(doc);
    expect(snaps1[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snaps1[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snaps1[0].x).toBe(at1.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snaps1[0].y).toBe(at1.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null (click behaviour)
    const at2: Point = { x: 300, y: 400 };
    const id2 = createShape(doc, { kind: 'ellipse', rect: null, at: at2 }, 'user1');
    expect(id2).toBeTruthy();

    const snaps2 = snapshotObjects(doc).filter((s) => s.id === id2);
    expect(snaps2[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snaps2[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snaps2[0].x).toBe(at2.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snaps2[0].y).toBe(at2.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)', () => {
    const rect: Rect = { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    const at: Point = { x: 0, y: 0 };
    const id = createShape(doc, { kind: 'rect', rect, at }, 'user1');
    expect(id).toBeTruthy();

    const snaps = snapshotObjects(doc);
    expect(snaps[0].width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snaps[0].height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04: square=true on 200x120 → 200x200 anchored at drag origin', () => {
    const rect: Rect = { x: 100, y: 200, width: 200, height: 120 };
    const at: Point = { x: 100, y: 200 };
    const id = createShape(doc, { kind: 'rect', rect, at, square: true }, 'user1');
    expect(id).toBeTruthy();

    const snaps = snapshotObjects(doc);
    expect(snaps[0].width).toBe(200);
    expect(snaps[0].height).toBe(200);
    expect(snaps[0].x).toBe(100);
    expect(snaps[0].y).toBe(200);
  });

  it('TC-05: setShapeStyle fill blue → applied; fill teal → false, 0 updates', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const at: Point = { x: 0, y: 0 };
    const id = createShape(doc, { kind: 'rect', rect, at }, 'user1');

    // Valid colour
    const getUpdates = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(getUpdates()).toBe(1);

    const snaps = snapshotObjects(doc);
    expect(snaps[0].fill).toBe('blue');

    // Invalid colour
    const getUpdates2 = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
    expect(getUpdates2()).toBe(0);
  });

  it('TC-06: kind triangle and non-finite rect → null, 0 updates', () => {
    // Unknown kind
    const getUpdates1 = countUpdates(doc);
    const id1 = createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1');
    expect(id1).toBeNull();
    expect(getUpdates1()).toBe(0);

    // Non-finite rect
    const getUpdates2 = countUpdates(doc);
    const id2 = createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1');
    expect(id2).toBeNull();
    expect(getUpdates2()).toBe(0);
  });
});
