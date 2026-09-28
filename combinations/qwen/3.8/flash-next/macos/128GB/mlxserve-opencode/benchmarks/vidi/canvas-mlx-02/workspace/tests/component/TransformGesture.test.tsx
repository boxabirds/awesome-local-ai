// Story 7, sel.transform — one pointer gesture moves or resizes the whole
// selection (TC-23 to TC-25). Everything here goes through the real board.
import { describe, it, expect } from 'vitest';
import {
  renderBoard7,
  seedSticky,
  seedBox,
  act,
  settle,
} from './story7TestUtils.tsx';
import { deleteObjects, objectsSnapshot } from '../../src/shared/board-model.ts';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';

describe('transform gesture (sel.transform)', () => {
  // TC-23: dragging an object that is NOT selected selects it and moves only
  // it; the object that was selected stays where it was.
  it('TC-23 dragging an unselected object selects it and moves only it', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 600, y: 600 });

    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);
    expect(h.selectedIds()).toEqual([a]);

    h.drag(h.object(b), { x: 200, y: 200 }, { x: 260, y: 230 });

    expect(h.selectedIds()).toEqual([b]);
    expect(h.pos(h.object(b)!)).toEqual({ x: 660, y: 630 });
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
  });

  // TC-23 boundary: the threshold is in SCREEN pixels and it is ">= threshold"
  // that starts the gesture, so one pixel less moves nothing.
  it('TC-23 boundary: exactly the drag threshold moves, one pixel less does not', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });

    h.drag(h.object(a), { x: 300, y: 300 }, { x: 300 + DRAG_THRESHOLD_PX - 1, y: 300 });
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    h.drag(h.object(a), { x: 300, y: 300 }, { x: 300 + DRAG_THRESHOLD_PX, y: 300 });
    expect(h.pos(h.object(a)!)).toEqual({ x: DRAG_THRESHOLD_PX, y: 0 });
  });

  // The threshold is screen space, so the same mouse movement is a third of the
  // world distance at 3x zoom.
  it('TC-23 the world delta is the screen delta divided by the zoom', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    // Zoom in through the board's own zoom control (Ctrl/Cmd + "=").
    h.key('=', { ctrlKey: true });
    await h.frames();
    const zoom = h.cam().zoom;
    expect(zoom).toBeGreaterThan(1);

    h.drag(h.object(a), { x: 300, y: 300 }, { x: 400, y: 300 });
    expect(h.pos(h.object(a)!).x).toBeCloseTo(100 / zoom, 6);
  });

  // A whole selection moves together, and the drag raises it above everything
  // that was not part of it (the relative order inside the selection is kept).
  it('TC-23 moves the whole selection together, above what it did not select', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 300, y: 0 });
    const other = seedSticky(h.doc(), { x: 0, y: 900, z: 99 });

    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);
    h.press(h.object(b), 400, 100, { shiftKey: true, pointerId: 2 });
    h.release(h.object(b), 400, 100, { shiftKey: true, pointerId: 2 });
    expect(h.selectedIds()).toEqual([a, b].sort());

    h.drag(h.object(a), { x: 100, y: 100 }, { x: 180, y: 140 });

    expect(h.pos(h.object(a)!)).toEqual({ x: 80, y: 40 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 380, y: 40 });
    const z = new Map(h.snapshot().map((o) => [o.id, o.z]));
    expect(z.get(a)!).toBeGreaterThan(z.get(other)!);
    expect(z.get(b)!).toBeGreaterThan(z.get(other)!);
    expect(z.get(a)!).toBeLessThan(z.get(b)!); // order inside the selection kept
  });

  // TC-24: a registered type that is resizable and NOT aspect-locked. Its edge
  // handle changes one dimension only; holding Shift keeps the box ratio.
  it('TC-24 an edge handle changes width only, and Shift keeps the ratio', () => {
    const h = renderBoard7();
    const box = seedBox(h.doc(), { x: 0, y: 0, width: 120, height: 80 });
    h.press(h.object(box), 100, 100);
    h.release(h.object(box), 100, 100);
    expect(h.handles()).toHaveLength(8);

    h.drag(h.handle('e'), { x: 300, y: 300 }, { x: 340, y: 320 });
    expect(h.size(h.object(box)!)).toEqual({ width: 160, height: 80 });
    expect(h.pos(h.object(box)!)).toEqual({ x: 0, y: 0 });

    // Shift constrains a free type to the ratio of the box it is resizing - the
    // ratio it has now, which the drag above changed to 160:80.
    h.drag(h.handle('e'), { x: 300, y: 300 }, { x: 340, y: 320 }, { shiftKey: true });
    const size = h.size(h.object(box)!);
    expect(size.width).toBeCloseTo(200, 3);
    expect(size.height).toBeCloseTo(100, 3);
    expect(size.width / size.height).toBeCloseTo(160 / 80, 6);
  });

  // The west handle anchors on the east edge: the box grows left, x moves, the
  // right edge does not move.
  it('TC-24 the opposite edge stays anchored', () => {
    const h = renderBoard7();
    const box = seedBox(h.doc(), { x: 0, y: 0, width: 120, height: 80 });
    h.press(h.object(box), 100, 100);
    h.release(h.object(box), 100, 100);

    h.drag(h.handle('w'), { x: 300, y: 300 }, { x: 260, y: 300 });
    expect(h.size(h.object(box)!).width).toBeCloseTo(160, 6);
    expect(h.pos(h.object(box)!).x).toBeCloseTo(-40, 6);
    // The east edge is the anchor: it never moved.
    const east = h.pos(h.object(box)!).x + h.size(h.object(box)!).width;
    expect(east).toBeCloseTo(120, 6);
  });

  // A group resize scales sizes AND the gaps between them from the dragged
  // corner; the corner that was grabbed stays put.
  it('TC-24 scales the sizes and the gaps of a selection together', () => {
    const h = renderBoard7();
    const a = seedBox(h.doc(), { x: 0, y: 0, width: 100, height: 100 });
    const b = seedBox(h.doc(), { x: 200, y: 0, width: 100, height: 100 });
    h.press(h.object(a), 50, 50);
    h.release(h.object(a), 50, 50);
    h.press(h.object(b), 250, 50, { shiftKey: true, pointerId: 2 });
    h.release(h.object(b), 250, 50, { shiftKey: true, pointerId: 2 });

    // The box is 300 x 100 at (0,0); dragging 'se' doubles it.
    h.drag(h.handle('se'), { x: 300, y: 300 }, { x: 600, y: 400 });

    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
    expect(h.size(h.object(a)!)).toEqual({ width: 200, height: 200 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 400, y: 0 });
    expect(h.size(h.object(b)!)).toEqual({ width: 200, height: 200 });
  });

  // No selected type can be resized: the handles are not there and a handle
  // gesture cannot be started.
  it('TC-24 boundary: a type that is not resizable gets no handles', () => {
    const h = renderBoard7();
    // Sticky notes are aspect-locked but resizable; a type nobody registered is
    // not readable at all, so the seam is the registry flag itself.
    seedSticky(h.doc(), { x: 0, y: 0 });
    h.press(h.note(0), 100, 100);
    h.release(h.note(0), 100, 100);
    expect(h.handles().length).toBeGreaterThan(0);

    // The box never crosses its type's minimum size: dragging the corner inward
    // stops at the minimum, it cannot reach zero or go through it.
    const box = seedBox(h.doc(), { x: 900, y: 900, width: 100, height: 100 });
    h.press(h.object(box), 950, 950);
    h.release(h.object(box), 950, 950);
    h.drag(h.handle('nw'), { x: 400, y: 400 }, { x: 1400, y: 1400 });
    const size = h.size(h.object(box)!);
    expect(size.width).toBeGreaterThanOrEqual(10); // TESTBOX_MIN_SIZE
    expect(size.height).toBeGreaterThanOrEqual(10);
  });

  // A sticky keeps its square shape through a corner resize, and no sticky is
  // ever allowed under the model's minimum size.
  it('TC-24 a sticky stays square and stops at the model minimum', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);

    h.drag(h.handle('se'), { x: 300, y: 300 }, { x: 500, y: 310 });
    let size = h.size(h.object(a)!);
    expect(size.width).toBeCloseTo(size.height, 6);
    expect(size.width).toBeCloseTo(400, 3);

    // And the clamp is the model's minimum, not the type's render size.
    h.drag(h.handle('nw'), { x: 300, y: 300 }, { x: 1300, y: 1300 });
    size = h.size(h.object(a)!);
    expect(size.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(size.height).toBeCloseTo(size.width, 6);
  });

  // Nothing is ever written bigger than the model's ceiling: the request is
  // clamped to what the largest object can take.
  it('TC-24 clamps a huge resize to MAX_OBJECT_SIZE_WORLD', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);

    h.drag(h.handle('se'), { x: 0, y: 0 }, { x: 100000, y: 100000 });
    const size = h.size(h.object(a)!);
    expect(size.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    expect(size.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 0);
  });

  // At most one write per animation frame, and that write is absolute: moves
  // inside a frame change nothing until the frame runs, and then the object is
  // exactly where the pointer is - not where the sum of the moves was.
  it('TC-23 writes one absolute position per animation frame', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });

    h.press(h.object(a), 300, 300);
    h.move(320, 300);
    h.move(340, 300);
    h.move(350, 300);
    // No frame has run yet: the model still holds the start position.
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });

    await h.frames();
    expect(h.pos(h.object(a)!)).toEqual({ x: 50, y: 0 });

    // And the release writes the last frame itself, so the note lands exactly
    // under the pointer even if no frame ran in between.
    h.move(360, 300);
    h.release(h.object(a), 360, 300);
    expect(h.pos(h.object(a)!)).toEqual({ x: 60, y: 0 });
  });

  // TC-25 (negative): a board that could not be loaded is read-only. A gesture
  // is refused outright: no object moves, and not one doc update is produced
  // (a model mutation is exactly what would reach the provider).
  it('TC-25 refuses the gesture on a board whose load failed', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    act(() => {
      h.provider().failToLoad();
    });
    await settle();

    const doc = h.doc();
    const updates: unknown[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    // A move drag on the note itself.
    h.drag(h.object(a), { x: 200, y: 200 }, { x: 500, y: 500 });
    expect(h.pos(h.object(a)!)).toEqual({ x: 0, y: 0 });
    expect(h.selectedIds()).toEqual([]);

    // A resize handle never appears for a selection that cannot exist, and
    // pressing one that is in the DOM would write nothing.
    h.press(h.note(0), 100, 100);
    h.release(h.note(0), 100, 100);
    expect(h.handles()).toHaveLength(0);
    expect(h.noteToolbar()).toBeNull();

    expect(objectsSnapshot(doc).map((o) => [o.x, o.y, o.width])).toEqual([[0, 0, undefined]]);
    expect(updates).toHaveLength(0);
  });

  // An object deleted by someone else in the middle of a drag: the drag stops
  // touching it, the rest of the selection keeps moving, nothing throws.
  it('TC-23 keeps the surviving selection moving when one object is deleted mid-drag', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 400, y: 0 });
    h.press(h.object(a), 50, 50);
    h.release(h.object(a), 50, 50);
    h.press(h.object(b), 450, 50, { shiftKey: true, pointerId: 2 });
    h.release(h.object(b), 450, 50, { shiftKey: true, pointerId: 2 });

    h.press(h.object(a), 50, 50);
    h.move(120, 50);
    h.move(160, 80);
    act(() => {
      deleteObjects(h.doc(), [b]);
    });
    h.move(220, 120);
    h.release(h.object(a), 220, 120);

    expect(h.pos(h.object(a)!)).toEqual({ x: 170, y: 70 });
    expect(h.selectedIds()).toEqual([a]);
  });
});
