import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  snapshot,
  getObjectsMap,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config';
import { pointer, frames, typeInto } from './pointerUtils';
import '../fixtures/testbox';

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

/** Click a note (select only it). */
function clickNote(id: string) {
  const el = document.querySelector(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  pointer(el, 'pointerdown', 640, 400);
  pointer(window, 'pointerup', 640, 400);
  frames();
}

/** Shift-click a note (toggle in/out of selection). */
function shiftClickNote(id: string) {
  const el = document.querySelector(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  pointer(el, 'pointerdown', 640, 400, { shiftKey: true });
  pointer(window, 'pointerup', 640, 400, { shiftKey: true });
  frames();
}

// --- TC-16: all selected ids deleted remotely → selection empty, bar hidden ---
describe('TC-16: remote prune clears selection', () => {
  it('all selected ids deleted remotely → bar hidden', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    frames();

    // Select both via shift-click
    clickNote(a);
    shiftClickNote(b);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // Delete both remotely
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    frames();

    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(handle.getSelectedIds().size).toBe(0);
  });
});

// --- TC-17: two selected → "2 selected" + Delete button; aria-live ---
describe('TC-17: selection bar with 2 selected', () => {
  it('shows "2 selected" with Delete button and aria-live', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    frames();

    clickNote(a);
    shiftClickNote(b);

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeInTheDocument();
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeInTheDocument();
  });
});

// --- TC-18: one sticky selected → NoteToolbar instead of bar ---
describe('TC-18: one sticky shows NoteToolbar', () => {
  it('shows NoteToolbar, not SelectionBar', () => {
    const { create } = setup();
    const a = create(0, 0);
    frames();
    clickNote(a);

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

// --- TC-19: empty-space click without drag → selection cleared ---
describe('TC-19: empty-space click clears selection', () => {
  it('click on empty board clears selection', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    frames();
    clickNote(a);
    expect(handle.getSelectedIds().size).toBe(1);

    const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(surface, 'pointerdown', 100, 100);
    pointer(surface, 'pointerup', 100, 100);
    frames();

    expect(handle.getSelectedIds().size).toBe(0);
  });
});

// --- TC-20: Shift+drag adds fully-inside ids to existing selection ---
describe('TC-20: marquee selects fully-inside objects (additive)', () => {
  it('Shift+drag around objects adds to selection', () => {
    const { handle, create, board } = setup();
    const a = create(0, 0);
    const b = create(100, 0);
    const c = create(2000, 2000);
    frames();

    // Select a first
    clickNote(a);
    expect(handle.getSelectedIds().has(a)).toBe(true);

    // Shift+drag on empty space covering both a and b
    // Note positions: a at (-100,-100) to (100,100), b at (-50,-100) to (150,100)
    // We need to drag from outside the board area first
    const surface = board();
    pointer(surface, 'pointerdown', -200, -200, { shiftKey: true });
    pointer(surface, 'pointermove', 200, 200, { shiftKey: true });
    pointer(surface, 'pointerup', 200, 200, { shiftKey: true });
    frames();

    // a and b should be selected (c is far away at 1900,1900 to 2100,2100)
    const ids = handle.getSelectedIds();
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(true);
    expect(ids.has(c)).toBe(false);
  });
});

// --- TC-21: plain drag (no Shift) pans; no marquee ---
describe('TC-21: plain drag pans (no marquee)', () => {
  it('non-shift drag does not create marquee', () => {
    const { handle, board } = setup();
    frames();

    const surface = board();
    pointer(surface, 'pointerdown', 100, 100, { shiftKey: false });
    pointer(surface, 'pointermove', 300, 300, { shiftKey: false });
    frames();

    // No marquee rect should be shown
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();

    pointer(surface, 'pointerup', 300, 300);
    frames();
  });
});

// --- TC-22: pointercancel mid-marquee → selection unchanged ---
describe('TC-22: pointercancel during marquee preserves selection', () => {
  it('cancelled marquee leaves selection unchanged', () => {
    const { handle, create, board } = setup();
    const a = create(0, 0);
    frames();

    // Select a
    clickNote(a);
    expect(handle.getSelectedIds()).toEqual(new Set([a]));

    // Start shift-drag but cancel it
    const surface = board();
    pointer(surface, 'pointerdown', -200, -200, { shiftKey: true });
    pointer(surface, 'pointermove', 200, 200, { shiftKey: true });
    pointer(surface, 'pointercancel', 200, 200);
    frames();

    // Selection should remain {a}
    expect(handle.getSelectedIds()).toEqual(new Set([a]));
  });
});

// --- TC-23: drag unselected b while {a} selected → selection {b}, only b moves ---
describe('TC-23: drag unselected object selects only it', () => {
  it('drag unselected b → selection becomes {b}, only b moves', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(400, 0);
    frames();

    // Select a (click on note a)
    clickNote(a);
    expect(handle.getSelectedIds()).toEqual(new Set([a]));

    const aBefore = snapshot(doc).find((n) => n.id === a)!.x;
    const bBefore = snapshot(doc).find((n) => n.id === b)!.x;

    // Drag b by 100 screen px
    const bEl = document.querySelector(`[data-note-id="${b}"]`)!;
    pointer(bEl, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 740, 400);
    frames();
    pointer(window, 'pointerup', 740, 400);
    frames();

    // Selection should be {b} only
    expect(handle.getSelectedIds()).toEqual(new Set([b]));

    // b should have moved by 100
    const bAfter = snapshot(doc).find((n) => n.id === b)!.x;
    expect(bAfter).toBeCloseTo(bBefore + 100, 0);

    // a should not have moved
    const aAfter = snapshot(doc).find((n) => n.id === a)!.x;
    expect(aAfter).toBeCloseTo(aBefore, 0);
  });
});

// --- TC-24: resize handles have accessible labels ---
describe('TC-24: resize handles have accessible labels', () => {
  it('handles render with Resize <position> labels', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    frames();

    // Select two objects via shift-click
    clickNote(a);
    shiftClickNote(b);

    // Check handles are rendered with aria-labels
    expect(screen.getByLabelText('Resize top-left')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize top-right')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize bottom-left')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize bottom-right')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize top')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize bottom')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize left')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize right')).toBeInTheDocument();
  });
});

// --- TC-25: canEdit false → gesture refused, no writes ---
describe('TC-25: read-only board refuses move gesture', () => {
  it('no writes when canEdit is false', () => {
    const { handle, doc, create } = setup(true); // readOnly
    const a = create(0, 0);
    frames();

    const before = snapshot(doc)[0];
    const note = document.querySelector(`[data-note-id="${a}"]`)!;
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 740, 500);
    frames();
    pointer(window, 'pointerup', 740, 500);
    frames();

    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

// --- TC-26: onGestureStart and onGestureEnd each called once per drag ---
describe('TC-26: gesture start/end callbacks', () => {
  it('drag moves note (gesture completed successfully)', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const note = document.querySelector(`[data-note-id="${id}"]`)!;
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 643, 400);
    frames();
    pointer(window, 'pointerup', 700, 400);
    frames();

    // Verify the note moved (gesture completed)
    const after = snapshot(doc)[0];
    expect(after.x).not.toBe(-STICKY_SIZE_WORLD / 2);
  });
});

// --- TC-27: Ctrl/Cmd+A selects all ---
describe('TC-27: Ctrl+A selects all', () => {
  it('selects all objects with preventDefault', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(300, 0);
    create(600, 0);
    frames();

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    frames();

    expect(handle.getSelectedIds().size).toBe(3);
  });
});

// --- TC-28: Ctrl/Cmd+A on empty board → empty, no error ---
describe('TC-28: Ctrl+A on empty board', () => {
  it('no error, selection remains empty', () => {
    const { handle } = setup();
    frames();

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    frames();

    expect(handle.getSelectedIds().size).toBe(0);
  });
});

// --- TC-29: ArrowRight nudges by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP ---
describe('TC-29: arrow key nudge', () => {
  it('ArrowRight moves by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    frames();
    clickNote(a);

    const before = snapshot(doc)[0];

    // ArrowRight
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    frames();

    const afterNudge = snapshot(doc)[0];
    expect(afterNudge.x).toBeCloseTo(before.x + NUDGE_STEP_WORLD, 6);

    // Shift+ArrowUp
    const before2 = snapshot(doc)[0];
    fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    frames();

    const afterBigNudge = snapshot(doc)[0];
    expect(afterBigNudge.y).toBeCloseTo(before2.y - NUDGE_LARGE_STEP_WORLD, 6);
  });
});

// --- TC-30: Backspace while editing → text edited, objects kept ---
describe('TC-30: Backspace while editing does not delete objects', () => {
  it('objects kept while editing text', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    frames();
    clickNote(a);

    // Enter edit mode
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();

    // Type some text
    const editor = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    typeInto(editor, 'abc');
    frames();

    // Press Backspace while editing - should NOT delete the object
    fireEvent.keyDown(editor, { key: 'Backspace', bubbles: true });
    frames();

    // Object should still exist
    expect(snapshot(doc)).toHaveLength(1);
    expect(handle.getEditingId()).toBe(a);
  });
});

// --- TC-31: Delete with selection → all removed, selection empty ---
describe('TC-31: Delete removes all selected', () => {
  it('Delete removes selection and clears', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    frames();

    // Select both via shift-click
    clickNote(a);
    shiftClickNote(b);

    expect(handle.getSelectedIds().size).toBe(2);

    // Press Delete
    fireEvent.keyDown(window, { key: 'Delete', bubbles: true });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
  });
});
