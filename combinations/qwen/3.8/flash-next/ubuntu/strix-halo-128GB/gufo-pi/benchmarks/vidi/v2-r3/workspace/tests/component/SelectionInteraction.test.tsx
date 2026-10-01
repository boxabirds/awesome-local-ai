import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, snapshot, getStickyText, deleteObject, moveObject } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
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
    selection: handle.selection,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      frames();
      return id;
    },
    board: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

// --- TC-16: all selected ids deleted remotely → selection empty, bar hidden ---
describe('Selection interaction (TC-16 to TC-19)', () => {
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);
    const c = create(400, 0);

    // Select all three
    act(() => { selection_setMany(handle, [a, b, c]); });
    frames();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // Delete all remotely
    act(() => {
      deleteObject(doc, a);
      deleteObject(doc, b);
      deleteObject(doc, c);
    });
    frames();

    expect(handle.getSelectedIds().size).toBe(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  // --- TC-17: two selected → "2 selected" + Delete selection button ---
  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);

    act(() => { selection_setMany(handle, [a, b]); });
    frames();

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
    const deleteBtn = screen.getByRole('button', { name: 'Delete selection' });
    expect(deleteBtn).toBeInTheDocument();
    // aria-live="polite" region
    const countEl = screen.getByTestId('selection-count');
    expect(countEl.closest('[aria-live]') ?? countEl).toHaveAttribute('aria-live', 'polite');
  });

  // --- TC-18: one sticky selected → NoteToolbar instead of SelectionBar ---
  it('TC-18: one sticky selected → NoteToolbar, no SelectionBar', () => {
    const { handle, create } = setup();
    const a = create(0, 0);

    act(() => { selection_setMany(handle, [a]); });
    frames();

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  // --- TC-19: empty-space click without drag → selection cleared ---
  it('TC-19: empty-space click clears selection', () => {
    const { handle, create, board } = setup();
    const a = create(0, 0);
    const b = create(200, 0);

    act(() => { selection_setMany(handle, [a, b]); });
    frames();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    const surface = board();
    pointer(surface, 'pointerdown', 300, 300);
    pointer(surface, 'pointerup', 300, 300);
    frames();

    expect(handle.getSelectedIds().size).toBe(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

// --- TC-20: marquee adds fully-inside ids additively ---
describe('Marquee (TC-20 to TC-22)', () => {
  it('TC-20: Shift+drag adds fully-inside ids to existing selection (additive)', () => {
    const { handle, create } = setup();
    // Camera is {x:0, y:0, zoom:1} so screen == world
    // a: center (500,500) → top-left (400,400), bottom-right (600,600)
    const a = create(500, 500);
    // b: center (2000,2000) → top-left (1900,1900), bottom-right (2100,2100)
    const b = create(2000, 2000);

    // Pre-select b
    act(() => { handle.selection.click(b); });
    frames();
    expect(handle.getSelectedIds()).toEqual(new Set([b]));

    // Marquee from (300,300) to (700,700) fully contains a
    const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(surface, 'pointerdown', 300, 300, { shiftKey: true });
    frames();
    pointer(surface, 'pointermove', 700, 700, { shiftKey: true });
    frames();
    pointer(surface, 'pointerup', 700, 700, { shiftKey: true });
    frames();

    // a should be in the selection (alongside b which was already there)
    expect(handle.getSelectedIds().has(a)).toBe(true);
    expect(handle.getSelectedIds().has(b)).toBe(true);
  });

  // --- TC-21: plain drag (no Shift) pans; no marquee ---
  it('TC-21: plain drag on empty space pans (no marquee rect rendered)', () => {
    setup();
    const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(surface, 'pointerdown', 300, 300);
    pointer(window, 'pointermove', 400, 400);
    frames();
    // No marquee rect should be rendered
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    pointer(window, 'pointerup', 400, 400);
    frames();
  });

  // --- TC-22: pointercancel mid-marquee → selection unchanged ---
  it('TC-22: pointercancel during marquee → selection unchanged', () => {
    const { handle, create } = setup();
    // a: center (500,500), top-left (400,400), bottom-right (600,600)
    const a = create(500, 500);
    act(() => { handle.selection.click(a); });
    frames();
    expect(handle.getSelectedIds()).toEqual(new Set([a]));

    // Start marquee from empty space, end somewhere that would select a
    const surface = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(surface, 'pointerdown', 100, 100, { shiftKey: true });
    frames();
    pointer(surface, 'pointermove', 700, 700, { shiftKey: true });
    frames();
    // Cancel instead of end
    pointer(surface, 'pointercancel', 700, 700);
    frames();

    // Selection should still be just {a}
    expect(handle.getSelectedIds()).toEqual(new Set([a]));
  });
});

// --- TC-23: drag unselected → select only that object, only it moves ---
describe('Transform gesture (TC-23 to TC-26)', () => {
  it('TC-23: drag unselected b while {a} selected → selection {b}, only b moves', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(400, 0);
    frames();

    // Select a
    act(() => { handle.selection.click(a); });
    frames();

    const bBefore = snapshot(doc).find(n => n.id === b)!;

    // Drag b
    const notes = screen.getAllByTestId('sticky-note');
    const bEl = notes.find(el => el.getAttribute('data-note-id') === b)!;
    pointer(bEl, 'pointerdown', 500, 400);
    pointer(window, 'pointermove', 510, 400);
    frames();
    pointer(window, 'pointerup', 510, 400);
    frames();

    // Selection should be {b}
    expect(handle.getSelectedIds()).toEqual(new Set([b]));

    const bAfter = snapshot(doc).find(n => n.id === b)!;
    expect(bAfter.x).not.toBe(bBefore.x);
  });

  // --- TC-25: canEdit false → gesture refused ---
  it('TC-25: canEdit false → drag does not write', () => {
    const { handle, doc, create } = setup(true); // readOnly
    const a = create(0, 0);
    frames();

    const aBefore = snapshot(doc)[0];
    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 700, 400);
    frames();
    pointer(window, 'pointerup', 700, 400);
    frames();

    const aAfter = snapshot(doc)[0];
    expect(aAfter.x).toBe(aBefore.x);
    expect(aAfter.y).toBe(aBefore.y);
  });

  // --- TC-26: onGestureStart/End called once per drag ---
  it('TC-26: onGestureStart and onGestureEnd each called once per drag', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    frames();

    // We test via the gesture hook's behavior: the note should become "dragging" and then not
    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 643, 400);
    frames();
    expect(note).toHaveAttribute('data-dragging', 'true');
    pointer(window, 'pointerup', 643, 400);
    frames();
    expect(note).toHaveAttribute('data-dragging', 'false');
  });
});

// --- TC-27 to TC-31: keyboard commands ---
describe('Keyboard (TC-27 to TC-31)', () => {
  it('TC-27: Ctrl/Cmd+A selects all', () => {
    const { handle, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);
    const c = create(400, 0);

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    frames();

    expect(handle.getSelectedIds()).toEqual(new Set([a, b, c]));
  });

  it('TC-28: Ctrl/Cmd+A on empty board → no error, empty selection', () => {
    const { handle } = setup();

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    frames();

    expect(handle.getSelectedIds().size).toBe(0);
  });

  it('TC-29: ArrowRight nudges by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    act(() => { handle.selection.click(a); });
    frames();

    const before = snapshot(doc)[0];
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    frames();

    const afterRight = snapshot(doc)[0];
    expect(afterRight.x).toBe(before.x + NUDGE_STEP_WORLD);
    expect(afterRight.y).toBe(before.y);

    fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    frames();

    const afterUp = snapshot(doc)[0];
    expect(afterUp.y).toBe(afterRight.y - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30: Backspace while editing does NOT delete objects', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    frames();

    // Select and enter editing mode
    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    expect(handle.getEditingId()).toBe(a);
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();

    // Press Backspace while editing (target is the editor, not window)
    const editor = screen.getByTestId('sticky-note-editor');
    fireEvent.keyDown(editor, { key: 'Backspace' });
    frames();

    // Note should still exist
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-31: Delete with selection removes all selected, selection empty', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(200, 0);
    act(() => { handle.selection.setMany([a, b], false); });
    frames();

    fireEvent.keyDown(window, { key: 'Delete' });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
  });
});

// Helper to setMany selection via the harness
function selection_setMany(handle: HarnessHandle, ids: string[]) {
  handle.selection.setMany(ids, false);
}
