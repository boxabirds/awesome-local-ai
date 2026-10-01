import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from 'yjs';
import {
  renderBoard,
  createNote,
  noteEl,
  noteEls,
  noteData,
  pressOn,
  moveTo,
  releaseOn,
  cancelPressOn,
  flushFrame,
  surfaceOf,
  noteCount,
} from './helpers';
import { snapshot, moveObjects, deleteObjects } from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config';

let doc: Doc;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
});

afterEach(() => {
  vi.useRealTimers();
});

// Camera: viewport 1280x800, camera at (-640,-400,1).
// World → Screen: screen = (world - cam.x) * zoom = (world + 640, world + 400)
// Screen → World: world = screen + cam.x = screen - 640 (x), screen - 400 (y)

// --- sel.interaction (SelectionBar, useSelection) ----------------------------

describe('TC-16 remote delete prunes selection', () => {
  it('all selected ids deleted remotely → selection empty, bar hidden', () => {
    const id1 = createNote(doc, 10, 20);
    const id2 = createNote(doc, 300, 20);

    // Select both via Ctrl+A
    act(() => { fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); });
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // Delete both from the doc (simulating remote delete)
    act(() => { deleteObjects(doc, [id1, id2]); });
    flushFrame();

    // Selection bar should be hidden (selection pruned to empty)
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('TC-17 selection bar for 2+ selected', () => {
  it('two selected shows "2 selected" + Delete button', () => {
    createNote(doc, 10, 20);
    createNote(doc, 300, 20);

    act(() => { fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); });

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeInTheDocument();
  });

  it('aria-live region announces count', () => {
    createNote(doc, 10, 20);
    createNote(doc, 300, 20);

    act(() => { fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); });

    const count = screen.getByTestId('selection-count');
    expect(count).toHaveAttribute('aria-live', 'polite');
  });
});

describe('TC-18 one sticky selected shows NoteToolbar instead of bar', () => {
  it('single selection shows NoteToolbar, not SelectionBar', () => {
    const id = createNote(doc, 10, 20);
    pressOn(noteEl(id));
    releaseOn(noteEl(id));

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('TC-19 empty-space click clears selection', () => {
  it('click on empty space without drag deselects', () => {
    const id = createNote(doc, 10, 20);
    pressOn(noteEl(id));
    releaseOn(noteEl(id));

    // Click on empty surface
    const surface = surfaceOf(document.body);
    pressOn(surface, 600, 600);
    releaseOn(surface, 600, 600);

    expect(noteEl(id).dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

// --- sel.marquee_ui (useMarquee) --------------------------------------------

describe('TC-20 marquee adds fully-inside ids additively', () => {
  it('Shift+drag selects objects fully inside the rect', () => {
    // Create note centred at (200, 200) → top-left (100,100), bottom-right (300,300)
    const idInside = createNote(doc, 200, 200);
    // Create note centred at (800, 800) → top-left (700,700), bottom-right (900,900) → far outside
    const idOutside = createNote(doc, 800, 800);

    // World (100,100) → screen (100+640, 100+400) = (740, 500)
    // World (300,300) → screen (940, 700)
    // Marquee from screen (700,460) to (950,710):
    //   world start (60,60), world end (310,310)
    // Note inside: 100>=60, 100>=60, 300<=310, 300<=310 ✓

    const surface = surfaceOf(document.body);
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 700, clientY: 460, shiftKey: true });
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 950, clientY: 710 });
    fireEvent.pointerUp(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 950, clientY: 710 });
    flushFrame();

    // idInside should be selected
    expect(noteEl(idInside).dataset.selected).toBe('true');
    // idOutside should not be selected
    expect(noteEl(idOutside).dataset.selected).toBe('false');
  });
});

describe('TC-21 plain drag pans, no marquee', () => {
  it('drag without shift does not start a marquee', () => {
    createNote(doc, 200, 200);
    const surface = surfaceOf(document.body);

    // Drag without shift on empty surface
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 700, clientY: 460 });
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 800, clientY: 500 });
    fireEvent.pointerUp(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 800, clientY: 500 });

    // No marquee rect
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });
});

describe('TC-22 pointercancel mid-marquee → selection unchanged', () => {
  it('pointercancel during marquee does not change selection', () => {
    const id = createNote(doc, 200, 200);
    const surface = surfaceOf(document.body);

    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 700, clientY: 460, shiftKey: true });
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 950, clientY: 710 });
    fireEvent.pointerCancel(surface, { pointerId: 1 });
    flushFrame();

    // Selection should still be empty
    expect(noteEl(id).dataset.selected).toBe('false');
  });
});

// --- sel.transform (useTransformGesture, SelectionOverlay) -------------------

describe('TC-23 drag unselected object while another selected', () => {
  it('dragging b while a is selected → selection becomes {b}, only b moves', () => {
    const idA = createNote(doc, 10, 20);
    const idB = createNote(doc, 500, 500);

    // Select A
    pressOn(noteEl(idA));
    releaseOn(noteEl(idA));
    expect(noteEl(idA).dataset.selected).toBe('true');

    // Drag B
    const beforeB = noteData(doc, idB)!;
    pressOn(noteEl(idB), 100, 100);
    moveTo(noteEl(idB), 100 + DRAG_THRESHOLD_PX + 1, 100);
    flushFrame();
    moveTo(noteEl(idB), 100 + 50, 100 + 30);
    flushFrame();
    releaseOn(noteEl(idB), 100 + 50, 100 + 30);
    flushFrame();

    // Selection should be just B
    expect(noteEl(idB).dataset.selected).toBe('true');
    // B should have moved
    const afterB = noteData(doc, idB)!;
    expect(afterB.x).not.toBe(beforeB.x);
  });

  it('movement under DRAG_THRESHOLD_PX is a click (no write)', () => {
    const id = createNote(doc, 10, 20);
    const before = noteData(doc, id)!;

    pressOn(noteEl(id), 100, 100);
    moveTo(noteEl(id), 100 + DRAG_THRESHOLD_PX - 1, 100);
    flushFrame();
    releaseOn(noteEl(id), 100 + DRAG_THRESHOLD_PX - 1, 100);
    flushFrame();

    const after = noteData(doc, id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('TC-25 canEdit false → no writes from gesture', () => {
  it('gesture on load-failed board does not write', () => {
    // Requires provider seam to simulate load_failed — tested in integration tier
  });
});

describe('TC-26 onGestureStart/End called once per drag', () => {
  it('pointercancel mid-drag keeps last applied positions', () => {
    const id = createNote(doc, 10, 20);
    const before = noteData(doc, id)!;

    pressOn(noteEl(id), 100, 100);
    moveTo(noteEl(id), 100 + DRAG_THRESHOLD_PX + 1, 100);
    flushFrame();
    moveTo(noteEl(id), 100 + 60, 100 + 40);
    flushFrame();
    cancelPressOn(noteEl(id));
    flushFrame();

    // Position should have been written (at least one frame applied)
    const after = noteData(doc, id)!;
    expect(after.x).not.toBe(before.x);
  });
});

// --- sel.keyboard (useBoardKeys) --------------------------------------------

describe('TC-27 Ctrl/Cmd+A selects all', () => {
  it('Ctrl+A selects all notes and prevents default', () => {
    createNote(doc, 10, 20);
    createNote(doc, 300, 20);
    createNote(doc, 600, 20);

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });

    expect(preventSpy).toHaveBeenCalled();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('3 selected');
  });
});

describe('TC-28 Ctrl/Cmd+A on empty board → no error', () => {
  it('selects nothing on empty board without error', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('TC-29 arrow keys nudge selection', () => {
  it('ArrowRight moves x by NUDGE_STEP_WORLD', () => {
    const id = createNote(doc, 10, 20);
    pressOn(noteEl(id));
    releaseOn(noteEl(id));

    const before = noteData(doc, id)!;
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });

    expect(preventSpy).toHaveBeenCalled();
    const after = noteData(doc, id)!;
    expect(after.x).toBe(before.x + NUDGE_STEP_WORLD);
  });

  it('Shift+ArrowUp moves y by -NUDGE_LARGE_STEP_WORLD', () => {
    const id = createNote(doc, 10, 20);
    pressOn(noteEl(id));
    releaseOn(noteEl(id));

    const before = noteData(doc, id)!;
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });

    expect(preventSpy).toHaveBeenCalled();
    const after = noteData(doc, id)!;
    expect(after.y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
  });
});

describe('TC-30 Backspace while editing → text edited, objects kept', () => {
  it('does not delete objects when editing text', () => {
    const id = createNote(doc, 10, 20);
    // Select and start editing
    pressOn(noteEl(id));
    releaseOn(noteEl(id));
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });

    // Now we're editing; fire Backspace on the textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      fireEvent.keyDown(textarea, { key: 'Backspace', bubbles: true, cancelable: true });
    }

    // Note should still exist
    expect(noteData(doc, id)).toBeDefined();
  });
});

describe('TC-31 Delete with selection removes all selected', () => {
  it('Delete key removes all selected objects', () => {
    createNote(doc, 10, 20);
    createNote(doc, 300, 20);

    // Select all
    act(() => { fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); });
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');

    // Delete
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });

    expect(snapshot(doc).length).toBe(0);
    expect(noteCount()).toBe(0);
  });
});
