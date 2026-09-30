/**
 * Story 10: shape model unit tests (TC-01 to TC-06).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createShape, setShapeStyle, getShapeLabel, asShape } from '@shared/objects/shape';
import { snapshot } from '@shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE,
} from '@shared/config';

function makeDoc(): Y.Doc {
  return new Y.Doc();
}

function trackUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => count++;
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

describe('shape.model', () => {
  it('TC-01: createShape rect 200x120 → 1 object, correct properties', () => {
    const doc = makeDoc();
    const stopTracking = trackUpdates(doc);

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'user1');

    expect(id).toBeTypeOf('string');
    expect(id).not.toBe('');

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    const snap = asShape(snaps[0]);
    expect(snap.type).toBe('shape');
    expect(snap.kind).toBe('rect');
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(120);
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.label).toBe('');

    // z should be maxZ + 1 = 1
    expect(snap.z).toBe(1);

    const updates = stopTracking();
    expect(updates).toBe(1);
  });

  it('TC-02: rect 19x200 → default size centred at at (click behaviour)', () => {
    const doc = makeDoc();
    const at = { x: 300, y: 200 };

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 290, y: 100, width: 19, height: 200 },
      at,
    }, 'user1');

    expect(id).not.toBe('');
    const snap = asShape(snapshot(doc)[0]);
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-02b: rect null → default size centred at at', () => {
    const doc = makeDoc();
    const at = { x: 500, y: 400 };

    const id = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at,
    }, 'user1');

    expect(id).not.toBe('');
    const snap = asShape(snapshot(doc)[0]);
    expect(snap.kind).toBe('ellipse');
    expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly 20x20 → kept (boundary)', () => {
    const doc = makeDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 0, y: 0 },
    }, 'user1');

    expect(id).not.toBe('');
    const snap = asShape(snapshot(doc)[0]);
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04: square true on 200x120 → 200x200 anchored at drag origin', () => {
    const doc = makeDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 60, width: 200, height: 120 },
      at: { x: 50, y: 60 },
      square: true,
    }, 'user1');

    expect(id).not.toBe('');
    const snap = asShape(snapshot(doc)[0]);
    expect(snap.x).toBe(50);
    expect(snap.y).toBe(60);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
  });

  it('TC-05: setShapeStyle fill blue → applied; fill teal → false', () => {
    const doc = makeDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'user1')!;

    // Set label so we can verify it's unchanged
    const label = getShapeLabel(doc, id)!;
    doc.transact(() => { label.insert(0, 'Hello'); });

    const stopTracking = trackUpdates(doc);

    // Valid colour
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(stopTracking()).toBe(1);

    const snap = asShape(snapshot(doc)[0]);
    expect(snap.fill).toBe('blue');
    expect(snap.label).toBe('Hello');
    expect(snap.width).toBe(100);
    expect(snap.height).toBe(100);

    // Invalid colour
    const stopTracking2 = trackUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(stopTracking2()).toBe(0);
  });

  it('TC-06: kind triangle → null; non-finite rect → null', () => {
    const doc = makeDoc();

    // Unknown kind
    const stopTracking1 = trackUpdates(doc);
    const id1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'user1');
    expect(id1).toBeNull();
    expect(stopTracking1()).toBe(0);

    // Non-finite rect
    const stopTracking2 = trackUpdates(doc);
    const id2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'user1');
    expect(id2).toBeNull();
    expect(stopTracking2()).toBe(0);
  });
});
