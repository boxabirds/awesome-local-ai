/**
 * Unit tests for the shape model (story 10, shape.model).
 * TC-01 to TC-06.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function trackUpdates(doc: Y.Doc): { count: () => number; cleanup: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    cleanup: () => doc.off('update', handler),
  };
}

describe('shape.model (TC-01 to TC-06)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-01: createShape rect 200x120 → 1 object, correct dimensions and defaults', () => {
    const tracker = trackUpdates(doc);
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'user1');

    expect(id).not.toBeNull();
    const snap = objectSnapshot(doc);
    expect(snap).toHaveLength(1);
    const shape = snap[0];
    expect(shape.type).toBe('shape');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);

    const shapeSnap = shape as unknown as { fill: string; stroke: string; label: string; kind: string };
    expect(shapeSnap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shapeSnap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shapeSnap.label).toBe('');
    expect(shapeSnap.kind).toBe('rect');

    // z = maxZ + 1 (first object → z=1)
    expect(shape.z).toBe(1);

    // Y.Text label exists
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');

    tracker.cleanup();
  });

  it('TC-02: rect 19x200 and rect null → default 160x160 centred at `at`', () => {
    // Below minimum in width
    const id1 = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 19, height: 200 },
      at: { x: 500, y: 300 },
    }, 'user1');
    expect(id1).not.toBeNull();

    const snap1 = objectSnapshot(doc);
    expect(snap1[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap1[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred at (500, 300)
    expect(snap1[0].x).toBe(500 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap1[0].y).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null (click)
    const id2 = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 200, y: 400 },
    }, 'user1');
    expect(id2).not.toBeNull();

    const snap2 = objectSnapshot(doc);
    const second = snap2.find((s) => s.id === id2)!;
    expect(second.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(second.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(second.x).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(second.y).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)', () => {
    const id = createShape(doc, {
      kind: 'diamond',
      rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 10, y: 20 },
    }, 'user1');
    expect(id).not.toBeNull();
    const snap = objectSnapshot(doc);
    expect(snap[0].width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap[0].x).toBe(10);
    expect(snap[0].y).toBe(20);
  });

  it('TC-04: square:true on 200x120 → 200x200 anchored at drag origin', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    }, 'user1');
    expect(id).not.toBeNull();
    const snap = objectSnapshot(doc);
    expect(snap[0].width).toBe(200);
    expect(snap[0].height).toBe(200);
    // Anchored at drag origin (top-left)
    expect(snap[0].x).toBe(100);
    expect(snap[0].y).toBe(100);
  });

  it('TC-05: setShapeStyle fill blue → applied; fill teal → false', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');

    const tracker = trackUpdates(doc);

    // Valid colour
    const ok = setShapeStyle(doc, id!, { fill: 'blue' });
    expect(ok).toBe(true);
    expect(tracker.count()).toBe(1);

    const snap = objectSnapshot(doc);
    const shape = snap[0] as unknown as { fill: string; label: string };
    expect(shape.fill).toBe('blue');
    expect(shape.label).toBe(''); // label unchanged

    // Invalid colour
    const tracker2 = trackUpdates(doc);
    const fail = setShapeStyle(doc, id!, { fill: 'teal' });
    expect(fail).toBe(false);
    expect(tracker2.count()).toBe(0);

    tracker.cleanup();
    tracker2.cleanup();
  });

  it('TC-06: kind "triangle" and non-finite rect → null, 0 updates', () => {
    const tracker = trackUpdates(doc);

    // Unknown kind
    const id1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id1).toBeNull();

    // Non-finite rect
    const id2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1');
    expect(id2).toBeNull();

    expect(tracker.count()).toBe(0);
    tracker.cleanup();
  });
});
