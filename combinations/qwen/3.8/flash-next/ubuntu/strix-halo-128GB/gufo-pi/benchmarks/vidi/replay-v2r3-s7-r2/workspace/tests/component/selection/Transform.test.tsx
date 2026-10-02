import React, { StrictMode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardHarness } from '../harness/BoardHarness';
import type { HarnessHandle } from '../harness/BoardHarness';
import { snapshot } from '../../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../../src/shared/config';
import { registerTestbox, TESTBOX_DEFAULT_SIZE } from '../../fixtures/testbox';
import { pointer, frames } from '../pointerUtils';
import {
  addBox,
  addNote,
  click,
  drag,
  moveTo,
  noteEl,
  setCamera,
  shiftClick,
  sp,
  stateOf,
} from './helpers';

function setup(
  readOnly = false,
  gestures: { onStart?(): void; onEnd?(): void } = {},
): { handle: HarnessHandle; doc: Y.Doc } {
  const handleRef: { current: HarnessHandle | null } = { current: null };
  render(
    <StrictMode>
      <BoardHarness
        handleRef={handleRef}
        readOnly={readOnly}
        onGestureStart={gestures.onStart}
        onGestureEnd={gestures.onEnd}
      />
    </StrictMode>,
  );
  const handle = handleRef.current!;
  return { handle, doc: handle.doc };
}

const rect = (doc: Y.Doc, id: string) => {
  const o = snapshot(doc).find((s) => s.id === id)!;
  return { x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 };
};

const zOf = (doc: Y.Doc, id: string): number => snapshot(doc).find((s) => s.id === id)!.z;

describe('group transform', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerTestbox();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-23: dragging an unselected object selects and moves only that object', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    drag(noteEl(b), { x: 600, y: 300 }, { x: 650, y: 320 });

    expect(handle.getSelectedIds()).toEqual([b]);
    expect(rect(doc, b)).toEqual({ x: 550, y: 220, width: 200, height: 200 });
    expect(rect(doc, a)).toEqual({ x: 200, y: 200, width: 200, height: 200 });
  });

  it('TC-23: one pixel below the drag threshold is still a click, and it moves nothing', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const before = stateOf(doc);

    drag(noteEl(a), { x: 300, y: 300 }, { x: 300 + DRAG_THRESHOLD_PX - 1, y: 300 });

    expect(handle.getSelectedIds()).toEqual([a]);
    expect(stateOf(doc)).toBe(before);
  });

  it('TC-23: at exactly the drag threshold the gesture starts and the object moves', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });

    drag(noteEl(a), { x: 300, y: 300 }, { x: 300 + DRAG_THRESHOLD_PX, y: 300 });

    // The write is absolute, so the note sits exactly the threshold further on.
    expect(rect(doc, a)).toEqual({ x: 200 + DRAG_THRESHOLD_PX, y: 200, width: 200, height: 200 });
  });

  it('dragging one member moves the whole selection, keeps its layout and lifts it above the rest', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 360, y: 300 }); // overlapping, 60 apart
    const c = addNote(handle, { x: 300, y: 360 });
    const other = addNote(handle, { x: 900, y: 300 });
    const zOtherBefore = zOf(doc, other);

    click(noteEl(a), { x: 300, y: 300 });
    shiftClick(noteEl(b), { x: 360, y: 300 });
    shiftClick(noteEl(c), { x: 300, y: 360 });
    expect(handle.getSelectedIds()).toHaveLength(3);

    drag(noteEl(a), { x: 300, y: 300 }, { x: 300, y: 300 }); // no-op press, keeps selection
    drag(noteEl(a), { x: 300, y: 300 }, { x: 600, y: 300 }); // 300 units right

    expect(rect(doc, a)).toEqual({ x: 500, y: 200, width: 200, height: 200 });
    expect(rect(doc, b)).toEqual({ x: 560, y: 200, width: 200, height: 200 });
    expect(rect(doc, c)).toEqual({ x: 500, y: 260, width: 200, height: 200 });
    expect(rect(doc, other)).toEqual({ x: 800, y: 200, width: 200, height: 200 });

    // The moved group is above the note it was dragged over, and keeps its own
    // stacking order among its members.
    const za = zOf(doc, a);
    const zb = zOf(doc, b);
    const zc = zOf(doc, c);
    expect(Math.min(za, zb, zc)).toBeGreaterThan(zOf(doc, other));
    expect(za < zb && zb < zc).toBe(true);
    expect(zOf(doc, other)).toBe(zOtherBefore);
  });

  it('a group resize scales sizes and gaps from the opposite edge', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 200, y: 200 }); // world 100,100 - 300,300
    const b = addNote(handle, { x: 500, y: 200 }); // world 400,100 - 600,300, gap 100
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    // Box is 500 wide; dragging the right edge by 500 doubles it.
    drag(screen.getByTestId('resize-handle-e'), { x: 600, y: 200 }, { x: 1100, y: 200 });

    expect(rect(doc, a)).toEqual({ x: 100, y: 0, width: 400, height: 400 });
    expect(rect(doc, b)).toEqual({ x: 700, y: 0, width: 400, height: 400 });
    // Sticky notes stay square, and the gap doubled with everything else.
    expect(rect(doc, b).x - (rect(doc, a).x + rect(doc, a).width)).toBe(200);
  });

  it('TC-24: an edge handle of a type without a locked ratio changes one axis only', () => {
    const { handle, doc } = setup();
    const box = addBox(doc, { x: 100, y: 100 });
    click(screen.getByTestId('testbox'), { x: 180, y: 145 });

    drag(screen.getByTestId('resize-handle-e'), { x: 260, y: 145 }, { x: 340, y: 145 });
    expect(rect(doc, box)).toEqual({ x: 100, y: 100, width: 240, height: 90 });
  });

  it('TC-24: holding Shift while resizing keeps the proportions', () => {
    const { handle, doc } = setup();
    const box = addBox(doc, { x: 100, y: 100 });
    click(screen.getByTestId('testbox'), { x: 180, y: 145 });

    drag(
      screen.getByTestId('resize-handle-e'),
      { x: 260, y: 145 },
      { x: 340, y: 145 },
      { shiftKey: true },
    );

    const after = rect(doc, box);
    expect(after.width).toBeCloseTo(240, 6);
    expect(after.height).toBeCloseTo(240 * (90 / 160), 6);
    // A locked edge handle grows about the middle of the axis it does not move.
    expect(after.y).toBeCloseTo(100 + (90 - after.height) / 2, 6);
  });

  it('a selection containing a sticky note keeps its proportions, every object its own', () => {
    const { handle, doc } = setup();
    const note = addNote(handle, { x: 200, y: 200 }); // world 100,100 - 300,300
    const box = addBox(doc, { x: 400, y: 100 }, TESTBOX_DEFAULT_SIZE); // 160x90
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    // Box 460x200; the bottom-right corner to twice the size.
    drag(screen.getByTestId('resize-handle-se'), { x: 560, y: 300 }, { x: 1020, y: 500 });

    const noteRect = rect(doc, note);
    expect(noteRect.width).toBeCloseTo(400, 6);
    expect(noteRect.height).toBeCloseTo(400, 6); // still square

    const boxRect = rect(doc, box);
    expect(boxRect.width).toBeCloseTo(320, 6);
    expect(boxRect.height).toBeCloseTo(180, 6); // still 16:9
  });

  it('a resize stops at the smallest minimum of the selection, on both axes', () => {
    const { handle, doc } = setup();
    const note = addNote(handle, { x: 200, y: 200 }); // 200 wide, minimum 50
    const box = addBox(doc, { x: 400, y: 100 }, TESTBOX_DEFAULT_SIZE); // 160, minimum 22.5
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    // Far past both minimums: the sticky note reaches 50 first.
    drag(screen.getByTestId('resize-handle-e'), { x: 560, y: 200 }, { x: 160, y: 200 });

    expect(rect(doc, note).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(rect(doc, note).height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(rect(doc, box).width).toBeCloseTo(160 * 0.25, 6);
    expect(rect(doc, box).height).toBeCloseTo(90 * 0.25, 6);
    expect(MAX_OBJECT_SIZE_WORLD).toBeGreaterThan(1000);
  });

  it('TC-23: the overlay keeps its start geometry while a gesture is running', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });
    // The outline is inset by a pixel, so read it instead of spelling out the number.
    const left = () => parseFloat(screen.getByTestId('selection-outline') .style.left);
    const start = left();

    pointer(noteEl(a), 'pointerdown', 300, 300);
    moveTo(noteEl(a), { x: 400, y: 300 });
    expect(rect(doc, a)).toEqual({ x: 300, y: 200, width: 200, height: 200 });
    // The note moved; the overlay is still drawn where the gesture started.
    expect(left()).toBe(start);

    pointer(noteEl(a), 'pointerup', 400, 300);
    expect(left()).toBe(start + 100);
  });

  it('a resize cannot grow past the maximum object size', () => {
    const { handle, doc } = setup();
    const note = addNote(handle, { x: 200, y: 200 });
    click(noteEl(note), { x: 200, y: 200 });

    const past = MAX_OBJECT_SIZE_WORLD * 2;
    drag(screen.getByTestId('resize-handle-e'), { x: 300, y: 200 }, { x: 300 + past, y: 200 });

    expect(rect(doc, note).width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
    expect(rect(doc, note).height).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
  });

  it('TC-25: a read-only board refuses the gesture and writes nothing', () => {
    const { handle, doc } = setup(true);
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const before = stateOf(doc);

    click(noteEl(a), { x: 300, y: 300 });
    shiftClick(noteEl(b), { x: 600, y: 300 });
    expect(handle.getSelectedIds()).toHaveLength(2); // selection still works

    drag(noteEl(a), { x: 300, y: 300 }, { x: 500, y: 400 });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(stateOf(doc)).toBe(before);
    expect(handle.getSelectedIds()).toHaveLength(2);
  });

  it('TC-26: gesture start and end are reported once per drag', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { handle, doc } = setup(false, { onStart, onEnd });
    const a = addNote(handle, { x: 300, y: 300 });

    // A click is not a gesture.
    click(noteEl(a), { x: 300, y: 300 });
    expect(onStart).toHaveBeenCalledTimes(0);
    expect(onEnd).toHaveBeenCalledTimes(0);

    drag(noteEl(a), { x: 300, y: 300 }, { x: 400, y: 300 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(rect(doc, a).x).toBe(300);

    drag(screen.getByTestId('resize-handle-e'), { x: 400, y: 300 }, { x: 500, y: 300 });
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('TC-26: pointercancel in the middle of a drag keeps the last applied positions', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { handle, doc } = setup(false, { onStart, onEnd });
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    pointer(noteEl(a), 'pointerdown', 300, 300);
    moveTo(noteEl(a), { x: 340, y: 320 }); // crosses the drag threshold
    moveTo(noteEl(a), { x: 380, y: 340 });
    const moved = rect(doc, a);
    expect(moved).toEqual({ x: 280, y: 240, width: 200, height: 200 });

    pointer(noteEl(a), 'pointercancel', 380, 340);
    expect(rect(doc, a)).toEqual(moved); // no rewind, no further write
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);

    // The board is usable again after the cancelled gesture.
    drag(noteEl(a), { x: 300, y: 300 }, { x: 320, y: 300 });
    expect(rect(doc, a).x).toBe(300);
  });

  it('a hidden object shows the transforming state only while its gesture runs', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });
    shiftClick(noteEl(b), { x: 600, y: 300 });

    drag(noteEl(a), { x: 300, y: 300 }, { x: 380, y: 300 });

    // Story 2's note toolbar is hidden for a group, and never during a drag.
    expect(screen.queryByTestId('note-toolbar-anchor')).toBeNull();
    expect(noteEl(b).getAttribute('data-dragging')).toBe('false');
  });

  it('a double-click on a resize handle creates a note on the board space it covers', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    // Story 2: a double-click on empty board space writes a note. The handles of
    // a selection sit on that space, so they must let the double-click through.
    fireEvent.doubleClick(screen.getByTestId('resize-handle-se'), { clientX: 400, clientY: 400 });

    expect(snapshot(doc)).toHaveLength(2);
    const created = snapshot(doc).find((o) => o.id !== a)!;
    expect(handle.getEditingId()).toBe(created.id);
    // The new note sits centred on the double-clicked point.
    expect(rect(doc, created.id)).toEqual({ x: 300, y: 300, width: 200, height: 200 });
  });

  it('moves and resizes work in world units at 200%', () => {
    const { handle, doc } = setup();
    setCamera(handle, { x: 200, y: 150, zoom: 2 });
    const cam = handle.getCamera();
    const a = addNote(handle, { x: 400, y: 400 }); // world 300,300

    const centre = sp(cam, { x: 400, y: 400 });
    drag(noteEl(a), centre, { x: centre.x + 100, y: centre.y + 100 });
    expect(rect(doc, a).x).toBeCloseTo(350, 6);
    expect(rect(doc, a).y).toBeCloseTo(350, 6);

    // Handles are drawn in screen space, so their screen position comes from the
    // camera, while the size they set is in world units.
    drag(screen.getByTestId('resize-handle-e'), sp(cam, { x: 650, y: 400 }), sp(cam, { x: 750, y: 400 }));
    expect(rect(doc, a).width).toBeCloseTo(STICKY_SIZE_WORLD * 1.5, 6);
    expect(rect(doc, a).height).toBeCloseTo(STICKY_SIZE_WORLD * 1.5, 6);
  });

  it('Enter opens the single selected note for typing, and not a group', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });

    click(noteEl(a), { x: 300, y: 300 });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handle.getEditingId()).toBe(a);

    // Escape belongs to the editor while typing (story 2), so it closes it.
    fireEvent.keyDown(screen.getByTestId('sticky-note-editor'), { key: 'Escape' });
    expect(handle.getEditingId()).toBeNull();
    expect(handle.getSelectedIds()).toEqual([a]);

    // A group has no text to edit, so Enter does nothing.
    shiftClick(noteEl(b), { x: 600, y: 300 });
    expect(handle.getSelectedIds()).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handle.getEditingId()).toBeNull();
  });
});
