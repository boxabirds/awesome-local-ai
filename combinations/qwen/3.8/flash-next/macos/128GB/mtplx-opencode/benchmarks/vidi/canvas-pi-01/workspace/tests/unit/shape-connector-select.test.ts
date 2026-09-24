/**
 * Story 10 · picking shapes and arrows (PRD `shape.create_drag`,
 * `shape.arrow_select`).
 *
 * Both rules are zoom-invariant on purpose: a shape is picked by its bounding
 * box, an arrow only within a fixed *screen* tolerance of its line.
 */

import { describe, expect, test } from 'vitest';
import type { ObjectSnapshot } from '../../src/shared/board-model.js';
import {
  CONNECTOR_TYPE,
  SHAPE_TYPE,
  getObjectType,
  hitTestAt,
} from '../../src/client/objects/registry.js';

/** Snapshots only need the fields the hit tests actually read. */
function snap(fields: Record<string, unknown>): ObjectSnapshot {
  return {
    id: 'o',
    type: SHAPE_TYPE,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rot: 0,
    z: 0,
    createdAt: 0,
    ...fields,
  } as unknown as ObjectSnapshot;
}

function shape(id: string, x: number, y: number, width = 160, height = 100): ObjectSnapshot {
  return snap({ id, type: SHAPE_TYPE, x, y, width, height });
}

function arrow(id: string, from: { x: number; y: number }, to: { x: number; y: number }): ObjectSnapshot {
  return snap({ id, type: CONNECTOR_TYPE, ends: { from, to } });
}

describe('object types registered for story 10', () => {
  test('a shape resizes freely in both axes and owns editable label text', () => {
    const spec = getObjectType(SHAPE_TYPE);
    expect(spec).toMatchObject({ resizable: true, aspectLocked: false, editableText: true });
    expect(spec?.minSize).toBeGreaterThan(0);
  });

  test('an arrow is not resizable and is not picked by its bounding box', () => {
    const spec = getObjectType(CONNECTOR_TYPE);
    expect(spec).toMatchObject({ resizable: false, editableText: false });
  });
});

describe('picking a shape', () => {
  const rect = shape('s1', 0, 0, 200, 120);
  const spec = getObjectType(SHAPE_TYPE)!;

  test('anywhere inside the box selects it, even outside the drawn outline', () => {
    // A diamond/ellipse leaves the corners empty; the PRD still wants the box.
    expect(spec.hitTest(rect, { x: 4, y: 4 }, 1)).toBe(true);
    expect(spec.hitTest(rect, { x: 100, y: 60 }, 1)).toBe(true);
  });

  test('a point outside the box does not', () => {
    expect(spec.hitTest(rect, { x: 240, y: 60 }, 1)).toBe(false);
    expect(spec.hitTest(rect, { x: -20, y: 60 }, 1)).toBe(false);
  });
});

describe('picking an arrow', () => {
  const flat = arrow('c1', { x: 0, y: 100 }, { x: 400, y: 100 });
  const spec = getObjectType(CONNECTOR_TYPE)!;

  test('a press on the line selects it', () => {
    expect(spec.hitTest(flat, { x: 200, y: 100 }, 1)).toBe(true);
    expect(spec.hitTest(flat, { x: 200, y: 103 }, 1)).toBe(true);
  });

  test('a press inside the bounding box but far from the line does not', () => {
    expect(spec.hitTest(flat, { x: 200, y: 140 }, 1)).toBe(false);
  });

  test('the tolerance is screen pixels: zooming out widens it in world units', () => {
    // 6 px at 2× is 3 world units; the same 6 px at 0.5× is 12.
    expect(spec.hitTest(flat, { x: 200, y: 102 }, 2)).toBe(true);
    expect(spec.hitTest(flat, { x: 200, y: 104 }, 2)).toBe(false);
    expect(spec.hitTest(flat, { x: 200, y: 111 }, 0.5)).toBe(true);
    expect(spec.hitTest(flat, { x: 200, y: 113 }, 0.5)).toBe(false);
  });

  test('an arrow with no resolved ends is never a hit', () => {
    const orphan = snap({ id: 'c1', type: CONNECTOR_TYPE, ends: { from: { x: 0, y: 100 }, to: { x: 400, y: 100 } } });
    delete (orphan as { ends?: unknown }).ends;
    expect(spec.hitTest(orphan, { x: 200, y: 100 }, 1)).toBe(false);
  });
});

describe('what is under the pointer', () => {
  test('the topmost object wins, so an arrow drawn over a shape picks first', () => {
    const below = shape('s1', 0, 0, 200, 200);
    const above = arrow('c1', { x: 20, y: 100 }, { x: 180, y: 100 });
    expect(hitTestAt([below, above], { x: 100, y: 100 }, 1)?.id).toBe('c1');
    expect(hitTestAt([above, below], { x: 100, y: 100 }, 1)?.id).toBe('s1');
  });

  test('empty space yields nothing', () => {
    expect(hitTestAt([shape('s1', 0, 0, 40, 40)], { x: 500, y: 500 }, 1)).toBeNull();
  });
});
