import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { deleteObject } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import {
  App,
  board,
  createNote,
  flush,
  keyDown,
  noteEl,
  notes,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.interaction', () => {
  it('TC-18: press and release without moving selects the note and shows the toolbar', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);

    pressAndRelease(noteEl(id));

    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();
    // position untouched
    expect(notes()[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('TC-19: move below the drag threshold does not move the note', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    const el = noteEl(id);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 50 + DRAG_THRESHOLD_PX - 1,
      clientY: 50,
    });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 50 + DRAG_THRESHOLD_PX - 1, clientY: 50 });
    flush();

    expect(notes()[0]).toMatchObject({ x: 100, y: 100 });
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-20: move at the drag threshold drags the note and never pans the board', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    const el = noteEl(id);
    const cameraBefore = readCamera();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 50 + DRAG_THRESHOLD_PX,
      clientY: 50,
    });
    flush();

    // screen delta 3px at zoom 1 = world delta 3
    expect(notes()[0].x).toBeCloseTo(103, 6);
    // the board itself did not pan
    expect(readCamera()).toEqual(cameraBefore);
    expect(screen.getByTestId('board-viewport').getAttribute('data-interaction')).toBe('idle');

    fireEvent.pointerUp(el, { pointerId: 1, clientX: 50 + DRAG_THRESHOLD_PX, clientY: 50 });
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-21: pointercancel during a drag ends at the last position, note selected', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    const el = noteEl(id);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 90, clientY: 70 });
    flush();
    fireEvent.pointerCancel(el, { pointerId: 1 });

    expect(notes()[0].x).toBeCloseTo(140, 6);
    expect(notes()[0].y).toBeCloseTo(120, 6);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-22: clicking empty board clears selection and hides the toolbar', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    pressAndRelease(noteEl(id));
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 600, clientY: 600 });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 600, clientY: 600 });
    flush();

    expect(noteEl(id).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('TC-25: %s deletes the selected note (separate run)', (key) => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    pressAndRelease(noteEl(id));

    keyDown(window, key);
    flush();

    expect(notes()).toHaveLength(0);
  });

  it('TC-35: double-click on an existing note edits it and does not create another', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);

    fireEvent.dblClick(noteEl(id));
    flush();

    expect(notes()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });

  it('TC-36: Enter with nothing selected does nothing', () => {
    render(<App />);
    flush();
    createNote(100, 100);

    keyDown(window, 'Enter');
    flush();

    expect(notes()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
  });

  it('TC-37: note deleted while editing ends editing without exceptions and is not recreated', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    fireEvent.dblClick(noteEl(id));
    flush();
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();

    act(() => {
      deleteObject(board().doc, id);
    });
    flush();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
  });

  it('TC-37: note deleted mid-drag ends the drag without exceptions', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    const el = noteEl(id);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 110, clientY: 50 });
    // pending rAF write not flushed yet when the note disappears
    act(() => {
      deleteObject(board().doc, id);
    });
    flush();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 110, clientY: 50 });

    expect(notes()).toHaveLength(0);
  });
});
