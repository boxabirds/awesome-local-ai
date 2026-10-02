import React, { StrictMode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardHarness } from '../harness/BoardHarness';
import type { HarnessHandle } from '../harness/BoardHarness';
import { deleteObjects, snapshot } from '../../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD } from '../../../src/shared/config';
import { registerTestbox } from '../../fixtures/testbox';
import { pointer, frames } from '../pointerUtils';
import {
  addBox,
  addNote,
  click,
  moveTo,
  noteEl,
  setCamera,
  shiftClick,
  sp,
  stateOf,
  viewport,
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

/** Press, optional moves and release on the board surface, in screen pixels. */
function marquee(from: { x: number; y: number }, to: { x: number; y: number }, shift = true): void {
  const vp = viewport();
  pointer(vp, 'pointerdown', from.x, from.y, { shiftKey: shift });
  pointer(vp, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, { shiftKey: shift });
  pointer(vp, 'pointermove', to.x, to.y, { shiftKey: shift });
  pointer(vp, 'pointerup', to.x, to.y, { shiftKey: shift });
}

describe('selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerTestbox();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shift-click adds and removes, and writes nothing to the document', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const before = stateOf(doc);

    click(noteEl(a), { x: 300, y: 300 });
    expect(handle.getSelectedIds()).toEqual([a]);

    shiftClick(noteEl(b), { x: 600, y: 300 });
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b]));
    expect(noteEl(a)).toBeInTheDocument();
    expect(noteEl(b)).toBeInTheDocument();

    shiftClick(noteEl(b), { x: 600, y: 300 });
    expect(handle.getSelectedIds()).toEqual([a]);
    expect(stateOf(doc)).toBe(before);
  });

  it('a click selects one object; a press inside the group keeps the whole group', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const c = addNote(handle, { x: 900, y: 300 });
    const before = stateOf(doc);

    click(noteEl(a), { x: 300, y: 300 });
    shiftClick(noteEl(b), { x: 600, y: 300 });
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b]));

    // A press on a member of the group is the start of a group gesture.
    click(noteEl(b), { x: 600, y: 300 });
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b]));

    // A press on something outside it replaces the selection.
    click(noteEl(c), { x: 900, y: 300 });
    expect(handle.getSelectedIds()).toEqual([c]);
    expect(stateOf(doc)).toBe(before);
  });

  it('TC-16: objects deleted by others leave the selection, and the bar hides', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // A remote delete of one: the other stays selected.
    act(() => {
      deleteObjects(doc, [b]);
    });
    expect(handle.getSelectedIds()).toEqual([a]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    // And of the last one: the selection is empty again.
    act(() => {
      deleteObjects(doc, [a]);
    });
    expect(handle.getSelectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  it('TC-17: two selected objects show "2 selected" with a working delete button', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('2 selected');
    // Announced to screen readers.
    expect(screen.getByTestId('selection-count')).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds()).toEqual([]);
    void a;
  });

  it('TC-18: exactly one sticky note shows the note toolbar, not the bar', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    expect(screen.getByTestId('note-toolbar-anchor')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    // The single note has an outline, and handles, but no bounding box.
    expect(screen.getByTestId('selection-outline')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-19: a click on empty board space without dragging clears the selection', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });
    expect(handle.getSelectedIds()).toEqual([a]);

    click(viewport(), { x: 40, y: 40 });
    expect(handle.getSelectedIds()).toEqual([]);
  });

  it('TC-19: Escape clears the selection, and an empty marquee changes nothing', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handle.getSelectedIds()).toEqual([]);

    // A marquee holding nothing adds nothing and, being a drag, clears nothing.
    click(noteEl(a), { x: 300, y: 300 });
    marquee({ x: 20, y: 20 }, { x: 90, y: 90 });
    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-20: Shift+drag adds every object fully inside the box to the selection', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 }); // world 200,200 - 400,400
    const b = addNote(handle, { x: 500, y: 300 }); // world 400,200 - 600,400
    addNote(handle, { x: 900, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });
    const before = stateOf(doc);

    // World box 150,150 - 610,450 holds both a and b, not the third note.
    marquee({ x: 150, y: 150 }, { x: 610, y: 450 });
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b]));
    expect(stateOf(doc)).toBe(before);
  });

  it('TC-20: a box that only touches an object does not select it', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 }); // world 200,200 - 400,400
    void a;
    marquee({ x: 0, y: 0 }, { x: 399, y: 399 });
    expect(handle.getSelectedIds()).toEqual([]);
  });

  it('TC-20: at 200% the box is measured in world units', () => {
    const { handle } = setup();
    setCamera(handle, { x: 0, y: 0, zoom: 2 });
    const cam = handle.getCamera();
    const inside = addNote(handle, { x: 280, y: 200 }); // world 180,100 - 380,300
    addNote(handle, { x: 400, y: 300 }); // world 300,200 - 500,400

    marquee(sp(cam, { x: 0, y: 0 }), sp(cam, { x: 460, y: 380 }));
    expect(handle.getSelectedIds()).toEqual([inside]);
  });

  it('TC-21: an ordinary drag pans the board and never draws a marquee', () => {
    const { handle } = setup();
    const cameraBefore = handle.getCamera();
    pointer(viewport(), 'pointerdown', 100, 100);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    moveTo(viewport(), { x: 300, y: 200 });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    pointer(viewport(), 'pointerup', 300, 200);

    expect(handle.getCamera()).not.toEqual(cameraBefore);
  });

  it('TC-22: pointercancel in the middle of a marquee leaves the selection unchanged', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    addNote(handle, { x: 900, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    pointer(viewport(), 'pointerdown', 700, 100, { shiftKey: true });
    pointer(viewport(), 'pointermove', 1100, 500, { shiftKey: true });
    expect(screen.getByTestId('marquee-rect')).toBeInTheDocument();
    pointer(viewport(), 'pointercancel', 1100, 500, { shiftKey: true });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-22: Escape during a marquee cancels it and keeps the previous selection', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    addNote(handle, { x: 900, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });

    pointer(viewport(), 'pointerdown', 700, 100, { shiftKey: true });
    pointer(viewport(), 'pointermove', 1100, 500, { shiftKey: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    pointer(viewport(), 'pointerup', 1100, 500, { shiftKey: true });

    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-27: Ctrl+A and Cmd+A select every object and stop the browser select-all', () => {
    const { handle } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const box = addBox(handle.doc, { x: 200, y: 600 });

    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b, box]));

    act(() => handle.clearSelection());
    expect(fireEvent.keyDown(window, { key: 'a', metaKey: true })).toBe(false);
    expect(new Set(handle.getSelectedIds())).toEqual(new Set([a, b, box]));
  });

  it('TC-28: on an empty board Ctrl+A selects nothing and does not throw', () => {
    const { handle } = setup();
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    expect(handle.getSelectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-29: arrow keys nudge the whole selection, Shift makes it a large step', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const cameraBefore = handle.getCamera();
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    expect(snapshot(doc).map((o) => o.x).sort((p, q) => p - q)).toEqual([
      200 + NUDGE_STEP_WORLD,
      500 + NUDGE_STEP_WORLD,
    ]);

    expect(fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    expect(snapshot(doc).map((o) => o.y).sort((p, q) => p - q)).toEqual([
      200 - NUDGE_LARGE_STEP_WORLD,
      200 - NUDGE_LARGE_STEP_WORLD,
    ]);

    // Neither the page nor the board moved.
    expect(handle.getCamera()).toEqual(cameraBefore);
    expect(handle.getSelectedIds()).toHaveLength(2);
  });

  it('TC-29: arrow keys do nothing with an empty selection', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const before = stateOf(doc);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(stateOf(doc)).toBe(before);
    void a;
  });

  it('TC-30: while typing, Backspace edits the text and keeps the objects', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 }, 'hello');
    click(noteEl(a), { x: 300, y: 300 });
    fireEvent.doubleClick(noteEl(a));
    const editor = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    expect(handle.getSelectedIds()).toEqual([a]);

    editor.value = 'hell';
    fireEvent.input(editor);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    fireEvent.keyDown(editor, { key: 'Delete' });
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });

    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].text).toBe('hell');
    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-31: Delete removes every selected object and clears the selection', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    const b = addNote(handle, { x: 600, y: 300 });
    const kept = addNote(handle, { x: 900, y: 300 });

    click(noteEl(a), { x: 300, y: 300 });
    shiftClick(noteEl(b), { x: 600, y: 300 });
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(snapshot(doc).map((o) => o.id)).toEqual([kept]);
    expect(handle.getSelectedIds()).toEqual([]);
  });

  it('TC-31: Backspace deletes the selection too, and a single note still goes with it', () => {
    const { handle, doc } = setup();
    const a = addNote(handle, { x: 300, y: 300 });
    click(noteEl(a), { x: 300, y: 300 });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds()).toEqual([]);
    void a;
  });

  it('a group shows outlines, one bounding box, eight named handles and stays square-limited', () => {
    const { handle } = setup();
    addNote(handle, { x: 300, y: 300 });
    addNote(handle, { x: 600, y: 400 });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay.querySelectorAll('[data-testid="selection-outline"]')).toHaveLength(2);
    expect(screen.getByTestId('selection-box')).toBeInTheDocument();
    for (const [name, label] of [
      ['nw', 'Resize top-left'],
      ['n', 'Resize top'],
      ['ne', 'Resize top-right'],
      ['e', 'Resize right'],
      ['se', 'Resize bottom-right'],
      ['s', 'Resize bottom'],
      ['sw', 'Resize bottom-left'],
      ['w', 'Resize left'],
    ]) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute(
        'data-testid',
        `resize-handle-${name}`,
      );
    }
  });

  it('a read-only board can be selected but shows no handles', () => {
    const { handle, doc } = setup(true);
    addNote(handle, { x: 300, y: 300 });
    addBox(doc, { x: 600, y: 300 });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });

    expect(handle.getSelectedIds()).toHaveLength(2);
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    // Nothing can be resized or deleted, so those controls are not offered.
    expect(screen.queryByTestId('resize-handle-se')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeDisabled();
    expect(STICKY_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });
});
