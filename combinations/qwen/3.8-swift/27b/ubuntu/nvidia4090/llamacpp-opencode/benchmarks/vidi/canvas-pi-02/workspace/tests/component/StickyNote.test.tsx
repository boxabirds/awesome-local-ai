// Component tests for sticky note interaction (sticky.interaction):
// TC-18 to TC-22, TC-25, TC-35 to TC-37.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import * as boardModel from '../../src/shared/board-model';

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true });
  return e;
}

function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

/** Flush the rAF-batched camera/drag updates (fake timers). */
function flush(): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(16);
  });
}

function notes(): Array<{ id: string; x: number; y: number; color: string; text: string; z: number }> {
  return window.__vidi6?.getStickyNotes() ?? [];
}

const STICKY_BUTTON = { name: 'Sticky note' };

/** Clicks the toolbar's Sticky note button (creates a note, starts editing). */
function createNote(): void {
  fireEvent.click(screen.getByRole('button', STICKY_BUTTON));
}

/** Escape ends editing; the note stays selected. */
function endEditing(): void {
  fireEvent.keyDown(screen.getByTestId('sticky-editor-input'), { key: 'Escape' });
}

/** A window keydown (keyboard rules live on window in App). */
function windowKey(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.interaction', () => {
  it('TC-18: press+release without move → Selected; outline attribute and NoteToolbar rendered', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    // A short press without movement keeps the selection.
    fire(note, pointerEvent('pointerdown', 100, 100));
    fire(note, pointerEvent('pointerup', 100, 100));
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(note.className).not.toContain('sticky-note--dragging');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-19: move 2px (< DRAG_THRESHOLD_PX) stays Selected, moveObject not called', async () => {
    const moveSpy = vi.spyOn(boardModel, 'moveObject').mockImplementation(() => true);
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');

    fire(note, pointerEvent('pointerdown', 100, 100));
    fire(note, pointerEvent('pointermove', 102, 100)); // 2px < 3
    fire(note, pointerEvent('pointerup', 102, 100));

    expect(moveSpy).not.toHaveBeenCalled();
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(notes()[0].x).toBe(-100); // unchanged (centered on world 0,0)
    moveSpy.mockRestore();
  });

  it('TC-20: move 3px (= threshold) → Dragging; board camera unchanged (no pan)', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');
    const world = screen.getByTestId('board-world');

    fire(note, pointerEvent('pointerdown', 100, 100));
    fire(note, pointerEvent('pointermove', 103, 100)); // 3px = threshold
    expect(note.className).toContain('sticky-note--dragging');
    await flush();
    expect(notes()[0].x).toBeCloseTo(-97, 6); // +3 world units

    // The note's pointerdown stopped propagation: the board never panned.
    expect(world.style.transform).toBe('scale(1) translate(0px, 0px)');

    fire(note, pointerEvent('pointerup', 103, 100));
    expect(note.className).not.toContain('sticky-note--dragging');
    expect(note).toHaveAttribute('data-selected', 'true');
  });

  it('TC-21: pointercancel during drag → Selected at the last applied position', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');

    fire(note, pointerEvent('pointerdown', 100, 100));
    fire(note, pointerEvent('pointermove', 110, 100)); // 10px → dragging
    await flush(); // apply the move
    fire(note, pointerEvent('pointercancel', 110, 100));

    expect(note.className).not.toContain('sticky-note--dragging');
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(notes()[0].x).toBeCloseTo(-90, 6); // kept where last applied
  });

  it('TC-22: click empty board → Unselected; toolbar gone', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');
    const viewport = screen.getByTestId('board-viewport');

    fire(viewport, pointerEvent('pointerdown', 300, 300));
    fire(viewport, pointerEvent('pointerup', 300, 300));

    expect(note).not.toHaveAttribute('data-selected');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25: Delete key on a selected (not editing) note removes it', async () => {
    render(<App />);
    createNote();
    endEditing();
    expect(notes()).toHaveLength(1);

    windowKey('Delete');

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });

  it('TC-25: Backspace key on a selected (not editing) note removes it', async () => {
    render(<App />);
    createNote();
    endEditing();
    expect(notes()).toHaveLength(1);

    windowKey('Backspace');

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });

  it('TC-35 (negative): dblclick on an existing note does not create a new note; it edits', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');

    fire(note, new Event('dblclick', { bubbles: true, cancelable: true }));

    expect(notes()).toHaveLength(1);
    expect(screen.getByTestId('sticky-editor-input')).toBeTruthy(); // editing the existing note
    expect(note).toHaveAttribute('data-editing', 'true');
  });

  it('TC-36 (negative): Enter while nothing selected does nothing', async () => {
    render(<App />);

    windowKey('Enter');

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });

  it('TC-37: note deleted while Dragging → interaction ends, no exception, note not recreated', async () => {
    render(<App />);
    createNote();
    endEditing();
    const note = screen.getByTestId('sticky-note');
    const id = notes()[0].id;

    fire(note, pointerEvent('pointerdown', 100, 100));
    fire(note, pointerEvent('pointermove', 120, 100));
    await flush();
    expect(note.className).toContain('sticky-note--dragging');

    expect(() => {
      act(() => {
        window.__vidi6?.deleteSticky(id);
      });
    }).not.toThrow();

    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(notes()).toHaveLength(0); // not recreated
  });

  it('TC-37: note deleted while Editing → interaction ends, no exception, note not recreated', async () => {
    render(<App />);
    createNote();
    const id = notes()[0].id;
    expect(screen.getByTestId('sticky-editor-input')).toBeTruthy();

    expect(() => {
      act(() => {
        window.__vidi6?.deleteSticky(id);
      });
    }).not.toThrow();

    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(screen.queryByTestId('sticky-editor-input')).toBeNull();
    expect(notes()).toHaveLength(0);
  });
});
