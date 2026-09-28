// Story 7, sel.marquee_ui — Shift+drag draws a selection rectangle (TC-20 to
// TC-22). Without Shift the same drag is the story 1 pan, unchanged.
import { describe, it, expect } from 'vitest';
import { renderBoard7, seedSticky, seedBox } from './story7TestUtils.tsx';

// The camera opens centred on the world origin, so a world point becomes a
// screen point by h.toScreen(); every pointer coordinate here is derived from
// the object geometry rather than hard-coded, so the test says what it means.
describe('marquee UI (sel.marquee_ui)', () => {
  // TC-20: Shift+drag adds the objects the rectangle FULLY contains to the
  // selection that already exists. Partial overlap never selects.
  it('TC-20 adds fully-inside ids to the existing selection', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 }); // inside the rect
    const b = seedSticky(h.doc(), { x: 900, y: 900 }); // far away, already selected
    const c = seedSticky(h.doc(), { x: 200, y: 200 }); // pokes out of the rect

    // An existing selection of {b}.
    h.press(h.object(b), 100, 100);
    h.release(h.object(b), 100, 100);
    expect(h.selectedIds()).toEqual([b]);

    const from = h.toScreen({ x: -60, y: -60 });
    const to = h.toScreen({ x: 250, y: 250 });
    h.dragEmpty(from, to, { shiftKey: true, pointerId: 5 });

    expect(h.selectedIds()).toEqual([b, a].sort());
    expect(h.selectedIds()).not.toContain(c);
    expect(h.selectionCount()).toBe('2 selected');
    // The rectangle is gone once the gesture ends.
    expect(h.marqueeRect()).toBeNull();
  });

  // TC-21 (negative): a drag on empty space without Shift is the story 1 pan.
  // No rectangle is drawn and the selection is left alone.
  it('TC-21 a plain drag pans the board and draws no marquee', async () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });

    // Selected first, so we can also prove a pan does not clear the selection.
    h.press(h.note(0), 100, 100);
    h.release(h.note(0), 100, 100);
    expect(h.selectedIds()).toHaveLength(1);

    const before = h.cam();
    h.dragEmpty({ x: 100, y: 100 }, { x: 300, y: 220 }, { pointerId: 6 });
    await h.frames();

    expect(h.marqueeRect()).toBeNull();
    expect(h.cam().x).toBeCloseTo(before.x + (100 - 300), 6);
    expect(h.cam().y).toBeCloseTo(before.y + (100 - 220), 6);
    expect(h.selectedIds()).toHaveLength(1);
  });

  // TC-22: a marquee that is interrupted (pointercancel) selects nothing and
  // leaves the selection exactly as it was.
  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    const keep = seedSticky(h.doc(), { x: 900, y: 900 });

    h.press(h.object(keep), 100, 100);
    h.release(h.object(keep), 100, 100);
    expect(h.selectedIds()).toEqual([keep]);

    h.cancelDragEmpty(h.toScreen({ x: -60, y: -60 }), h.toScreen({ x: 400, y: 400 }), {
      shiftKey: true,
      pointerId: 7,
    });

    expect(h.marqueeRect()).toBeNull();
    expect(h.selectedIds()).toEqual([keep]);
  });

  // The rectangle is drawn in WORLD units inside the world layer, so it stays
  // glued to the objects it selects: its box reads back as the world rect the
  // pointer described.
  it('draws the rectangle in world units while it is being dragged', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });

    const a = h.toScreen({ x: -60, y: -60 });
    const b = h.toScreen({ x: 240, y: 340 });
    h.press(h.viewport(), a.x, a.y, { shiftKey: true, pointerId: 8 });
    h.moveOn(h.viewport(), b.x, b.y, { shiftKey: true, pointerId: 8 });

    const rect = h.marqueeRect();
    expect(rect).not.toBeNull();
    const box = h.marqueeBox()!;
    expect(box.x).toBeCloseTo(-60, 3);
    expect(box.y).toBeCloseTo(-60, 3);
    expect(box.width).toBeCloseTo(300, 3);
    expect(box.height).toBeCloseTo(400, 3);

    h.release(h.viewport(), b.x, b.y, { shiftKey: true, pointerId: 8 });
  });

  // Escape during the marquee throws the rectangle away; the selection is what
  // it was before the drag started.
  it('Escape discards the marquee without touching the selection', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    const keep = seedSticky(h.doc(), { x: 900, y: 900 });
    h.press(h.object(keep), 100, 100);
    h.release(h.object(keep), 100, 100);

    const a = h.toScreen({ x: -60, y: -60 });
    const b = h.toScreen({ x: 400, y: 400 });
    h.press(h.viewport(), a.x, a.y, { shiftKey: true, pointerId: 9 });
    h.moveOn(h.viewport(), b.x, b.y, { shiftKey: true, pointerId: 9 });
    expect(h.marqueeRect()).not.toBeNull();

    h.key('Escape');
    expect(h.marqueeRect()).toBeNull();
    expect(h.selectedIds()).toEqual([keep]);
  });

  // Boundary: a Shift+press with no drag is a zero-area rectangle, which
  // contains nothing - the selection must not change at all.
  it('a shift-press with no drag selects nothing and changes nothing', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    seedBox(h.doc(), { x: 900, y: 900, width: 60, height: 60 });
    h.press(h.note(0), 100, 100);
    h.release(h.note(0), 100, 100);

    const p = h.toScreen({ x: 700, y: 700 });
    h.press(h.viewport(), p.x, p.y, { shiftKey: true, pointerId: 11 });
    h.release(h.viewport(), p.x, p.y, { shiftKey: true, pointerId: 11 });

    expect(h.selectedIds()).toEqual([h.idsOfNotes()[0]]);
  });
});
