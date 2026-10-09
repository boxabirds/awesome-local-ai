import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { getStickyText } from '../../src/shared/board-model';
import {
  App,
  board,
  createNote,
  flush,
  noteEl,
  notes,
  pressAndRelease,
} from './stickyHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function textarea(): HTMLTextAreaElement {
  const el = screen.queryByTestId('sticky-textarea');
  if (!el) throw new Error('editor not mounted');
  return el as HTMLTextAreaElement;
}

describe('sticky.text', () => {
  it('TC-23: Enter on the selected note starts editing with caret at the end', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    act(() => {
      getStickyText(board().doc, id)?.insert(0, 'hello');
    });
    flush();
    pressAndRelease(noteEl(id));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    flush();

    expect(document.activeElement).toBe(textarea());
    expect(textarea().value).toBe('hello');
    expect(textarea().selectionStart).toBe(5);
    expect(textarea().selectionEnd).toBe(5);
  });

  it('TC-24: Escape ends editing back to Selected and keeps the text', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    fireEvent.dblClick(noteEl(id));
    flush();

    fireEvent.input(textarea(), { target: { value: 'keep me' } });
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    flush();

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(getStickyText(board().doc, id)?.toString()).toBe('keep me');
  });

  it('TC-26: Backspace while editing edits text and never deletes the note', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    fireEvent.dblClick(noteEl(id));
    flush();

    fireEvent.input(textarea(), { target: { value: 'ab' } });
    // native backspace mutates the value; the key event must not reach deleteObject
    fireEvent.keyDown(textarea(), { key: 'Backspace' });
    fireEvent.input(textarea(), { target: { value: 'a' } });
    flush();

    expect(notes()).toHaveLength(1);
    expect(getStickyText(board().doc, id)?.toString()).toBe('a');
  });

  it('TC-38: clicking outside ends editing unselected with the text already saved', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    fireEvent.dblClick(noteEl(id));
    flush();

    fireEvent.input(textarea(), { target: { value: 'abc' } });
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { pointerId: 3, clientX: 600, clientY: 600 });
    fireEvent.pointerUp(viewport, { pointerId: 3, clientX: 600, clientY: 600 });
    flush();

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(getStickyText(board().doc, id)?.toString()).toBe('abc');
    expect(noteEl(id).getAttribute('data-selected')).toBe('false');
  });
});
