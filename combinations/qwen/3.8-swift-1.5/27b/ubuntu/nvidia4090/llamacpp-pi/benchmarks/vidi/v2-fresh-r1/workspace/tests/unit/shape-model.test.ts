// Unit tests for the shape model (shape.model contract) using a real Y.Doc.
// TC-01 to TC-06.

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count `update` events emitted on the doc during `fn`. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

describe('shape.model', () => {
  // TC-01: createShape rect 200x120 → 1 object, correct dimensions and defaults
  test('TC-01 createShape rect 200x120: 1 object, width 200, height 120, fill white, stroke dark, empty label, z=1', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      id,
      type: 'shape',
      kind: 'rect',
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      z: 1,
    });
    // Label is empty
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  // TC-02: rect 19x200 (below min in width) and rect null → default size centred at `at`
  test('TC-02a rect 19x200 (below min width): default 160x160 centred at point', () => {
    const doc = newDoc();
    const at = { x: 500, y: 300 };
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 500, y: 300, width: 19, height: 200 },
      at,
    }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  test('TC-02b rect null (click): default 160x160 centred at point', () => {
    const doc = newDoc();
    const at = { x: 500, y: 300 };
    const id = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at,
    }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)
  test('TC-03 rect exactly 20x20: kept as drawn (boundary)', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 100, y: 100 },
    }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap[0].width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  // TC-04: square: true on 200x120 → 200x200 anchored at drag origin
  test('TC-04 square:true on 200x120: 200x200 anchored at drag origin', () => {
    const doc = newDoc();
    const at = { x: 100, y: 100 };
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at,
      square: true,
    }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc);
    expect(snap[0].width).toBe(200);
    expect(snap[0].height).toBe(200);
    // Anchored at drag origin
    expect(snap[0].x).toBe(at.x);
    expect(snap[0].y).toBe(at.y);
  });

  // TC-05: setShapeStyle fill 'blue' → applied, 1 update; fill 'teal' → false, 0 updates
  test('TC-05a setShapeStyle fill blue: applied, 1 update, label/size unchanged', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'local')!;

    const before = snapshot(doc)[0];
    const updates = countUpdates(doc, () => {
      const ok = setShapeStyle(doc, id, { fill: 'blue' });
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);

    const after = snapshot(doc)[0] as any;
    expect(after.fill).toBe('blue');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  test('TC-05b setShapeStyle fill teal: false, 0 updates', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    }, 'local')!;

    const updates = countUpdates(doc, () => {
      const ok = setShapeStyle(doc, id, { fill: 'teal' });
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);

    const snap = snapshot(doc)[0] as any;
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
  });

  // TC-06: kind 'triangle' and non-finite rect → null, 0 updates
  test('TC-06a kind triangle: null, 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const id = createShape(doc, {
        kind: 'triangle' as any,
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: { x: 100, y: 100 },
      }, 'local');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  test('TC-06b non-finite rect: null, 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const id = createShape(doc, {
        kind: 'rect',
        rect: { x: NaN, y: 100, width: 200, height: 120 },
        at: { x: 100, y: 100 },
      }, 'local');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
