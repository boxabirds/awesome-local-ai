import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { TransformGesture } from '../../src/client/board/transform-gesture';
import { initDoc, createSticky, objectBounds } from '../../src/shared/board-model';
import { registerObjectType, getObjectType } from '../../src/shared/object-types';
import { DRAG_THRESHOLD_PX, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

// A second object type proves the gesture is generic (contract sel.all_types):
// resizable, but NOT aspect-locked, so an edge handle may change one axis only.
if (!getObjectType('testbox')) {
  registerObjectType({
    type: 'testbox',
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (b, p) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height,
  });
}

let doc: Y.Doc;
let starts: string[][];
let ends: number;

function makeGesture(canEdit = true, zoom = 1) {
  starts = [];
  ends = 0;
  return new TransformGesture({
    doc,
    zoom: () => zoom,
    canEdit: () => canEdit,
    onGestureStart: (ids) => starts.push([...ids]),
    onGestureEnd: () => (ends += 1),
  });
}

/** Plant an object directly, so a test can control its exact footprint. */
function plant(type: string, rect: Rect): string {
  const id = `${type}-${rect.x}-${rect.y}`;
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    map.set('type', type);
    map.set('x', rect.x);
    map.set('y', rect.y);
    map.set('width', rect.width);
    map.set('height', rect.height);
    map.set('z', 1);
    map.set('color', 'yellow');
    map.set('text', new Y.Text());
    map.set('createdAt', 0);
    doc.getMap<Y.Map<unknown>>('objects').set(id, map);
  });
  return id;
}

function boundsOf(id: string): Rect | null {
  return objectBounds(doc, id);
}

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
});

describe('transform gesture: group move', () => {
  it('TC-23: below the threshold nothing is written, at the threshold the drag begins', () => {
    const a = createSticky(doc, { x: 300, y: 300 });
    const g = makeGesture();
    g.beginMove([a], { x: 0, y: 0 });
    // One pixel short of DRAG_THRESHOLD_PX is still a click.
    expect(g.update({ x: DRAG_THRESHOLD_PX - 1, y: 0 }, DRAG_THRESHOLD_PX - 1)).toBe(false);
    expect(g.mode).toBe('pending-move');
    expect(starts).toHaveLength(0);
    // Exactly the threshold starts the gesture.
    expect(g.update({ x: DRAG_THRESHOLD_PX, y: 0 }, DRAG_THRESHOLD_PX)).toBe(true);
    expect(g.mode).toBe('move');
    expect(starts).toHaveLength(1);
  });

  it('dragging an unselected object moves ONLY that object', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 800, y: 0 });
    const beforeB = boundsOf(b)!;
    const g = makeGesture();
    g.beginMove([b], { x: 0, y: 0 }); // b alone: it was not part of a group
    g.update({ x: 100, y: 0 }, 100);
    expect(boundsOf(b)!.x).toBeCloseTo(beforeB.x + 100);
    expect(boundsOf(a)!.x).toBeCloseTo(-100); // untouched
  });

  it('a whole selection moves the same distance and keeps its layout', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const c = createSticky(doc, { x: 800, y: 0 });
    const gapBefore = boundsOf(b)!.x - (boundsOf(a)!.x + boundsOf(a)!.width);
    const g = makeGesture();
    g.beginMove([a, b, c], { x: 0, y: 0 });
    g.update({ x: 300, y: 0 }, 300);
    const gapAfter = boundsOf(b)!.x - (boundsOf(a)!.x + boundsOf(a)!.width);
    expect(gapAfter).toBeCloseTo(gapBefore);
    expect(boundsOf(c)!.x).toBeCloseTo(800 - 100 + 300);
  });

  it('the dragged group is raised above the others but keeps its own order', () => {
    const other = createSticky(doc, { x: 0, y: 0 }); // z 1
    const a = createSticky(doc, { x: 600, y: 600 }); // z 2
    const b = createSticky(doc, { x: 900, y: 600 }); // z 3
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const zA = () => objects.get(a)!.get('z') as number;
    const zB = () => objects.get(b)!.get('z') as number;
    const zOther = () => objects.get(other)!.get('z') as number;
    const g = makeGesture();
    g.beginMove([a, b], { x: 0, y: 0 });
    g.update({ x: 200, y: 200 }, 200);
    expect(zA()).toBeGreaterThan(zOther());
    expect(zB()).toBeGreaterThan(zOther());
    expect(zB() - zA()).toBe(1); // relative stacking preserved
    // A second frame does not raise the group again.
    starts.length = 0;
    g.update({ x: 400, y: 400 }, 400);
    expect(starts).toHaveLength(0);
  });

  it('zoom divides the drag, so the grabbed point tracks the cursor', () => {
    const a = createSticky(doc, { x: 300, y: 300 });
    const before = boundsOf(a)!.x;
    const g = makeGesture(true, 2); // 200 % zoom
    g.beginMove([a], { x: 0, y: 0 });
    g.update({ x: 200, y: 0 }, 200);
    expect(boundsOf(a)!.x).toBeCloseTo(before + 100); // 200 screen px = 100 world units
  });

  it('an id deleted mid-drag stops following, without breaking the others', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const g = makeGesture();
    g.beginMove([a, b], { x: 0, y: 0 });
    g.update({ x: 100, y: 0 }, 100);
    // A colleague deletes b.
    doc.getMap<Y.Map<unknown>>('objects').delete(b);
    expect(() => g.update({ x: 200, y: 0 }, 200)).not.toThrow();
    expect(boundsOf(a)!.x).toBeCloseTo(-100 + 200);
  });
});

describe('transform gesture: bounding-box resize', () => {
  it('TC-04 / sel.resize: a 2x box resize doubles the notes AND the gap', () => {
    // Two 200-unit notes 100 units apart: the box is 500 x 200.
    const a = plant('sticky', { x: 0, y: 0, width: 200, height: 200 });
    const b = plant('sticky', { x: 300, y: 0, width: 200, height: 200 });
    const g = makeGesture();
    g.beginResize('se', [a, b], { x: 0, y: 0, width: 500, height: 200 }, { x: 0, y: 0 });
    // Drag the bottom-right corner by +500 x +200 screen units at zoom 1 -> x2.
    g.update({ x: 500, y: 200 }, 500);
    const na = boundsOf(a)!;
    const nb = boundsOf(b)!;
    expect(na.width).toBeCloseTo(400);
    expect(na.height).toBeCloseTo(400); // stickies stay square
    expect(nb.width).toBeCloseTo(400);
    expect(nb.x - (na.x + na.width)).toBeCloseTo(200); // gap doubled with the box
  });

  it('TC-24: an edge handle on a non-locked type changes the width only', () => {
    const box = plant('testbox', { x: 0, y: 0, width: 200, height: 100 });
    const g = makeGesture();
    g.beginResize('e', [box], { x: 0, y: 0, width: 200, height: 100 }, { x: 0, y: 0 });
    g.update({ x: 100, y: 0 }, 100);
    const out = boundsOf(box)!;
    expect(out.width).toBeCloseTo(300);
    expect(out.height).toBeCloseTo(100); // height untouched
    expect(out.y).toBeCloseTo(0);
  });

  it('TC-24 / sel.aspect: Shift keeps the proportions of a non-locked type', () => {
    const box = plant('testbox', { x: 0, y: 0, width: 200, height: 100 });
    const g = makeGesture();
    g.setShift(true);
    g.beginResize('se', [box], { x: 0, y: 0, width: 200, height: 100 }, { x: 0, y: 0 });
    g.update({ x: 100, y: 0 }, 100);
    const out = boundsOf(box)!;
    expect(out.height / out.width).toBeCloseTo(100 / 200); // ratio preserved
  });

  it('TC-02 / sel.size_limits: shrinking stops at the minimum size', () => {
    const a = plant('sticky', { x: 0, y: 0, width: 200, height: 200 });
    const b = plant('sticky', { x: 400, y: 0, width: 100, height: 100 });
    const g = makeGesture();
    g.beginResize('se', [a, b], { x: 0, y: 0, width: 500, height: 200 }, { x: 0, y: 0 });
    // Shrink hard: b would fall to 20 units, far below its 50-unit minimum.
    g.update({ x: -400, y: -160 }, 400);
    const na = boundsOf(a)!;
    const nb = boundsOf(b)!;
    expect(nb.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
    expect(na.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
    // And the whole group stopped at ONE scale, so the layout is intact.
    expect(nb.width / 100).toBeCloseTo(na.width / 200);
  });

  it('a resize keeps the corner opposite the handle pinned', () => {
    const a = plant('sticky', { x: 0, y: 0, width: 200, height: 200 });
    const g = makeGesture();
    g.beginResize('nw', [a], { x: 0, y: 0, width: 200, height: 200 }, { x: 0, y: 0 });
    g.update({ x: 100, y: 100 }, 100);
    const out = boundsOf(a)!;
    expect(out.x + out.width).toBeCloseTo(200);
    expect(out.y + out.height).toBeCloseTo(200);
  });

  it('a selection of non-resizable types has no gesture at all', () => {
    // 'text' is deliberately not registered: an unknown type is skipped by every
    // generic operation, so it cannot be half-resized.
    const text = plant('text', { x: 0, y: 0, width: 100, height: 40 });
    const raw = () => doc.getMap<Y.Map<unknown>>('objects').get(text)!.get('width');
    expect(objectBounds(doc, text)).toBeNull();
    const g = makeGesture();
    g.beginResize('se', [text], { x: 0, y: 0, width: 100, height: 40 }, { x: 0, y: 0 });
    expect(g.active).toBe(false);
    expect(g.update({ x: 200, y: 200 }, 200)).toBe(false);
    expect(raw()).toBe(100);
  });
});

describe('transform gesture: lifecycle and read-only board', () => {
  it('TC-26: start and end are announced exactly once per drag', () => {
    const a = createSticky(doc, { x: 300, y: 300 });
    const g = makeGesture();
    g.beginMove([a], { x: 0, y: 0 });
    g.update({ x: 50, y: 0 }, 50);
    g.update({ x: 100, y: 0 }, 100);
    g.update({ x: 150, y: 0 }, 150);
    expect(starts).toHaveLength(1);
    g.reset();
    expect(ends).toBe(1);
    expect(g.active).toBe(false);
    // A press that never moves never announces a gesture at all.
    g.beginMove([a], { x: 0, y: 0 });
    g.reset();
    expect(starts).toHaveLength(1);
    expect(ends).toBe(1);
  });

  it('TC-26: cancelling mid-drag keeps the last applied positions', () => {
    const a = createSticky(doc, { x: 300, y: 300 });
    const g = makeGesture();
    g.beginMove([a], { x: 0, y: 0 });
    g.update({ x: 100, y: 0 }, 100);
    const moved = boundsOf(a)!.x;
    expect(moved).not.toBeCloseTo(200);
    g.reset(); // pointercancel
    expect(boundsOf(a)!.x).toBeCloseTo(moved);
    expect(ends).toBe(1);
  });

  it('TC-25: a read-only board ignores moves and resizes entirely', () => {
    const a = createSticky(doc, { x: 300, y: 300 });
    const before = boundsOf(a)!;
    const g = makeGesture(false);
    g.beginMove([a], { x: 0, y: 0 });
    expect(g.update({ x: 300, y: 0 }, 300)).toBe(false);
    g.beginResize('se', [a], before, { x: 0, y: 0 });
    expect(g.update({ x: 600, y: 0 }, 600)).toBe(false);
    expect(boundsOf(a)!.x).toBeCloseTo(before.x);
    expect(starts).toHaveLength(0);
    expect(ends).toBe(0);
  });

  it('a malformed press (no ids, no box) arms nothing', () => {
    const g = makeGesture();
    g.beginMove([], { x: 0, y: 0 });
    expect(g.active).toBe(false);
    g.beginResize('se', [], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0 });
    expect(g.active).toBe(false);
    g.beginResize('se', ['ghost'], { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0 });
    expect(g.active).toBe(false);
    expect(g.update({ x: 10, y: 10 }, 10)).toBe(false);
  });
});
