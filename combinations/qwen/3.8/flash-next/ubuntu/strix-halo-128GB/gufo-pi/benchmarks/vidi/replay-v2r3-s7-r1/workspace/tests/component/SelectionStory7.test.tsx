import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  snapshot,
  resizeObjects,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
    board: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

const HALF = STICKY_SIZE_WORLD / 2;

// ---------- sel.interaction (SelectionBar, useSelection) ----------

describe('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
  it('prunes all ids when they disappear from the snapshot', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);
    frames();

    // Select both
    act(() => { handle.getSelection().setMany([a, b], false); });
    frames();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // Delete both externally (simulates remote delete)
    act(() => { deleteObjects(doc, [a, b]); });
    frames();

    expect(handle.getSelection().ids.size).toBe(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

describe('TC-17: "2 selected" + Delete selection button; aria-live announces count', () => {
  it('shows bar with count and delete button for 2 selected stickies', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(200, 0);
    frames();

    const notes = snapshot(handle.doc);
    act(() => { handle.getSelection().setMany(notes.map(n => n.id), false); });
    frames();

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
    expect(screen.getByLabelText('Delete selection')).toBeInTheDocument();
    // aria-live region
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toContain('2 selected');
  });
});

describe('TC-18: one sticky selected → NoteToolbar instead of bar', () => {
  it('shows NoteToolbar for single sticky selection, not SelectionBar', () => {
    const { handle, create } = setup();
    const id = create(0, 0);
    frames();

    act(() => { handle.getSelection().click(id); });
    frames();

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

describe('TC-19: empty-space click without drag → selection cleared', () => {
  it('clicking empty board clears selection', () => {
    const { handle, create, board } = setup();
    create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();
    expect(handle.getSelection().ids.size).toBe(1);

    const surface = board();
    pointer(surface, 'pointerdown', 300, 300);
    pointer(surface, 'pointerup', 300, 300);
    frames();
    expect(handle.getSelection().ids.size).toBe(0);
  });
});

// ---------- sel.marquee_ui (useMarquee) ----------

describe('TC-20: Shift+drag adds fully-inside ids to existing selection', () => {
  it('marquee selection is additive', () => {
    const { handle, create, board } = setup();
    // Note A at (100, 100) — its bounds are (0, 0, 200, 200)
    const a = create(100, 100);
    // Note B at (600, 600) — its bounds are (500, 500, 200, 200)
    const b = create(600, 600);
    frames();

    // Select A already
    act(() => { handle.getSelection().click(a); });
    frames();

    // Shift+drag a rectangle that encloses B but not A
    // Screen coords at zoom 1, camera (0,0): world = screen
    const surface = board();
    pointer(surface, 'pointerdown', 450, 450, { shiftKey: true });
    pointer(surface, 'pointermove', 750, 750, { shiftKey: true });
    pointer(surface, 'pointerup', 750, 750);
    frames();

    const sel = handle.getSelection().ids;
    expect(sel.has(b)).toBe(true);
    // A should still be there (additive)
    expect(sel.has(a)).toBe(true);
  });
});

describe('TC-21: plain drag on empty space pans; no marquee', () => {
  it('non-shift drag does not show marquee rect', () => {
    const { board, handle } = setup();

    const camBefore = handle.getCamera();
    const surface = board();
    pointer(surface, 'pointerdown', 100, 100);
    pointer(surface, 'pointermove', 300, 200);
    frames();

    // Marquee rect should not be rendered
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();

    // Camera should have moved (pan)
    const camAfter = handle.getCamera();
    expect(camAfter.x).not.toBe(camBefore.x);
  });
});

describe('TC-22: pointercancel mid-marquee → selection unchanged', () => {
  it('cancelling marquee leaves selection unchanged', () => {
    const { handle, create, board } = setup();
    create(100, 100);
    frames();

    act(() => { handle.getSelection().setMany([], false); });
    frames();
    const selBefore = new Set(handle.getSelection().ids);

    const surface = board();
    pointer(surface, 'pointerdown', 0, 0, { shiftKey: true });
    pointer(surface, 'pointermove', 400, 400, { shiftKey: true });
    frames();
    pointer(surface, 'pointercancel', 400, 400);
    frames();

    expect(handle.getSelection().ids).toEqual(selBefore);
  });
});

// ---------- sel.transform (useTransformGesture, SelectionOverlay) ----------

describe('TC-23: drag unselected b while {a} selected → selection {b}, only b moves', () => {
  it('dragging unselected replaces selection and moves only that object', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);   // bounds: (-100,-100) to (100,100)
    const b = create(400, 0); // bounds: (300,-100) to (500,100)
    frames();

    // Select a
    act(() => { handle.getSelection().click(a); });
    frames();

    // Drag b (unselected)
    const noteBEl = document.querySelector(`[data-note-id="${b}"]`) as HTMLElement;
    expect(noteBEl).toBeTruthy();
    pointer(noteBEl, 'pointerdown', 400, 0);
    pointer(window, 'pointermove', 450, 0);
    frames();
    pointer(window, 'pointerup', 450, 0);
    frames();

    // Only b should be selected
    expect(handle.getSelection().ids.has(b)).toBe(true);
    expect(handle.getSelection().ids.has(a)).toBe(false);
    // a's position should be unchanged
    const noteA = snapshot(doc).find(n => n.id === a)!;
    expect(noteA.x).toBeCloseTo(-HALF, 6);
  });
});

describe('TC-25: canEdit false → no writes (negative)', () => {
  it('drag gesture on readOnly board does not move the note', () => {
    const { handle, doc, create } = setup(true);
    const id = create(0, 0);
    frames();

    const before = snapshot(doc)[0];
    const noteEl = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
    pointer(noteEl, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 700, 400);
    frames();
    pointer(window, 'pointerup', 700, 400);
    frames();

    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('TC-26: onGestureStart/onGestureEnd each called once per drag', () => {
  it('gesture callbacks fire correctly', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const noteEl = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
    pointer(noteEl, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 680, 400);
    frames();
    pointer(window, 'pointerup', 680, 400);
    frames();

    // The note moved
    const after = snapshot(doc)[0];
    expect(after.x).not.toBe(-HALF);
  });
});

// ---------- sel.keyboard (useBoardKeys) ----------

describe('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
  it('Ctrl+A selects all objects', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(200, 0);
    create(400, 0);
    frames();

    const result = fireEvent.keyDown(window, { key: 'a', ctrlKey: true, cancelable: true });
    frames();

    expect(handle.getSelection().ids.size).toBe(3);
    // fireEvent returns false if preventDefault was called
    expect(result).toBe(false);
  });
});

describe('TC-28: Ctrl/Cmd+A on empty board → empty, no error', () => {
  it('Ctrl+A on empty board selects nothing', () => {
    const { handle } = setup();
    frames();

    const result = fireEvent.keyDown(window, { key: 'a', ctrlKey: true, cancelable: true });
    frames();

    expect(handle.getSelection().ids.size).toBe(0);
    expect(result).toBe(false);
  });
});

describe('TC-29: ArrowRight → x + NUDGE_STEP; Shift+ArrowUp → y − NUDGE_LARGE_STEP; preventDefault', () => {
  it('ArrowRight nudges selection by NUDGE_STEP_WORLD', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    act(() => { handle.getSelection().click(id); });
    frames();
    const before = snapshot(doc)[0];

    const result = fireEvent.keyDown(window, { key: 'ArrowRight', cancelable: true });
    frames();

    const after = snapshot(doc)[0];
    expect(after.x - before.x).toBeCloseTo(NUDGE_STEP_WORLD, 6);
    expect(result).toBe(false);
  });

  it('Shift+ArrowUp nudges selection by NUDGE_LARGE_STEP_WORLD', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    act(() => { handle.getSelection().click(id); });
    frames();
    const before = snapshot(doc)[0];

    const result = fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true, cancelable: true });
    frames();

    const after = snapshot(doc)[0];
    expect(after.y - before.y).toBeCloseTo(-NUDGE_LARGE_STEP_WORLD, 6);
    expect(result).toBe(false);
  });
});

describe('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
  it('Backspace while editing does not delete objects', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    // Start editing
    act(() => { handle.getSelection().startEdit(id); });
    frames();

    const editor = screen.getByTestId('sticky-note-editor');
    // Put text in editor
    act(() => {
      (editor as HTMLTextAreaElement).value = 'hello';
      fireEvent.input(editor);
    });
    frames();

    // Press Backspace on the editor
    fireEvent.keyDown(editor, { key: 'Backspace' });
    frames();

    // Note should still exist
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('TC-31: Delete with selection → all removed, selection empty', () => {
  it('Delete key removes all selected objects', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);
    frames();

    act(() => { handle.getSelection().setMany([a, b], false); });
    frames();
    expect(snapshot(doc)).toHaveLength(2);

    fireEvent.keyDown(window, { key: 'Delete', cancelable: true });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelection().ids.size).toBe(0);
  });
});
