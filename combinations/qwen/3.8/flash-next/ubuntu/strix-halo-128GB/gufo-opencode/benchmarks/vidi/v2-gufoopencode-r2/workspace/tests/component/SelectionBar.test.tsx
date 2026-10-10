// TC-16 to TC-19: the selection bar, remote-delete pruning and the
// empty-space click that clears the selection.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { deleteObjects } from '../../src/shared/board-model';
import {
  App,
  board,
  createNote,
  flush,
  noteEl,
  pressAndRelease,
} from './stickyHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('selection bar', () => {
  it('TC-16: remote delete of all selected ids empties the selection and hides the bar', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(500, 0);
    pressAndRelease(noteEl(a));
    fireEvent.pointerDown(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    flush();
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Remote deletion of both notes prunes the whole selection.
    act(() => {
      deleteObjects(board().doc, [a, b]);
    });
    flush();

    expect(screen.queryByText('2 selected')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-17: two selected shows "2 selected" with a delete button and an aria-live region', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(500, 0);
    pressAndRelease(noteEl(a));
    fireEvent.pointerDown(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    flush();

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete selection')).toBeInTheDocument();
    const live = bar.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe('2 selected');
    // NoteToolbar is not shown for a multi-selection.
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-18: exactly one sticky shows the NoteToolbar instead of the bar', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    pressAndRelease(noteEl(a));

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.queryByLabelText('Delete selection')).toBeNull();
    // Toolbar still recolours (story 2 path intact).
    fireEvent.click(screen.getByTestId('swatch-pink'));
    flush();
    expect(noteEl(a)).toHaveStyle({ background: '#F48FB1' });
  });

  it('TC-19: a click on empty board space without dragging clears the selection', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    pressAndRelease(noteEl(a));
    expect(noteEl(a).getAttribute('data-selected')).toBe('true');

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 900, clientY: 700 });
    flush();

    expect(noteEl(a).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
