import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, getObjectsMap, snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts Y.Doc `update` events (1 per successful transaction, 0 for rejections). */
function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

describe('shape.model', () => {
  it('TC-01: createShape rect 200x120 → 1 object, w 200, h 120, fill white, stroke dark, label empty, z maxZ+1, createdBy', () => {
    const doc = freshDoc();
    // Create a sticky to establish a base z
    createSticky(doc, { x: 0, y: 0 });

    const stop = updateCounter(doc);
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 200, width: 200, height: 120 },
      at: { x: 100, y: 200 },
    }, 'user-1');
    const count = stop();

    expect(id).not.toBeNull();
    expect(id).toBeTruthy();
    expect(count).toBe(1);

    const snap = snapshot(doc);
    const shape = snap.find((o) => o.id === id);
    expect(shape).toBeDefined();
    expect(shape!.type).toBe('shape');
    const s = shape as any;
    expect(s.kind).toBe('rect');
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.width).toBe(200);
    expect(s.height).toBe(120);
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(s.label).toBe('');
    expect(s.z).toBeGreaterThan(1); // above the sticky's z
    expect(s.createdBy).toBe('user-1');
  });

  it('TC-02: rect 19x200 below min → default 160x160 centred at point; rect null → same', () => {
    const doc = freshDoc();

    // 19 < SHAPE_MIN_SIZE_WORLD in width → use default size centred at `at`
    const id1 = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: 19, height: 200 },
      at: { x: 300, y: 400 },
    }, 'user-1');
    expect(id1).not.toBeNull();

    const snap = snapshot(doc);
    const s1 = snap.find((o) => o.id === id1) as any;
    expect(s1.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s1.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s1.x).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(s1.y).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null → click → default size centred at `at`
    const id2 = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 500, y: 600 },
    }, 'user-1');
    expect(id2).not.toBeNull();

    const snap2 = snapshot(doc);
    const s2 = snap2.find((o) => o.id === id2) as any;
    expect(s2.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s2.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s2.x).toBe(500 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(s2.y).toBe(600 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly 20x20 (SHAPE_MIN_SIZE_WORLD boundary) → kept as drawn', () => {
    const doc = freshDoc();

    const id = createShape(doc, {
      kind: 'diamond',
      rect: { x: 100, y: 100, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 100, y: 100 },
    }, 'user-1');
    expect(id).not.toBeNull();

    const snap = snapshot(doc);
    const s = snap.find((o) => o.id === id) as any;
    expect(s.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(s.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
  });

  it('TC-04: square: true on 200x120 → 200x200 anchored at drag origin', () => {
    const doc = freshDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 60, width: 200, height: 120 },
      at: { x: 50, y: 60 },
      square: true,
    }, 'user-1');
    expect(id).not.toBeNull();

    const snap = snapshot(doc);
    const s = snap.find((o) => o.id === id) as any;
    // square → both sides = max(200, 120) = 200, anchored at origin of drag rect
    expect(s.width).toBe(200);
    expect(s.height).toBe(200);
    // anchored at drag rect origin (top-left of the original rect)
    expect(s.x).toBe(50);
    expect(s.y).toBe(60);
  });

  it('TC-05: setShapeStyle fill blue → applied 1 update; fill teal → false 0 updates', () => {
    const doc = freshDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user-1')!;

    // Valid fill
    const stop1 = updateCounter(doc);
    const r1 = setShapeStyle(doc, id, { fill: 'blue' });
    const c1 = stop1();
    expect(r1).toBe(true);
    expect(c1).toBe(1);

    const snap = snapshot(doc);
    const s = snap.find((o) => o.id === id) as any;
    expect(s.fill).toBe('blue');
    // label, size, position unchanged
    expect(s.label).toBe('');
    expect(s.width).toBe(100);
    expect(s.height).toBe(100);

    // Invalid fill colour
    const stop2 = updateCounter(doc);
    const r2 = setShapeStyle(doc, id, { fill: 'teal' });
    const c2 = stop2();
    expect(r2).toBe(false);
    expect(c2).toBe(0);
  });

  it('TC-06: kind triangle → null 0 updates; non-finite rect → null 0 updates', () => {
    const doc = freshDoc();

    const stop1 = updateCounter(doc);
    const r1 = createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user-1');
    const c1 = stop1();
    expect(r1).toBeNull();
    expect(c1).toBe(0);

    const stop2 = updateCounter(doc);
    const r2 = createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user-1');
    const c2 = stop2();
    expect(r2).toBeNull();
    expect(c2).toBe(0);
  });

  it('getShapeLabel returns Y.Text for a valid shape', () => {
    const doc = freshDoc();

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user-1')!;

    const ytext = getShapeLabel(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');

    // Non-existent shape
    expect(getShapeLabel(doc, 'no-such-id')).toBeUndefined();
  });
});
