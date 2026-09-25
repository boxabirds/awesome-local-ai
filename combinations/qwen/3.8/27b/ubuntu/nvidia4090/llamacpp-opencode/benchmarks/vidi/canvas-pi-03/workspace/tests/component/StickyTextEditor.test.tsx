import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderFullApp, firePointer, hooks, makeNote, pressKey, setText, typeText } from './story2';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Selects the single note on the board. */
function selectNote(): void {
  const notes = hooks().getNotes();
  const p = { x: notes[0].x + 100 + 512, y: notes[0].y + 100 + 384 };
  const note = document.querySelector(`[data-id="${notes[0].id}"]`) as HTMLElement;
  firePointer(note, 'pointerdown', p.x, p.y);
  firePointer(note, 'pointerup', p.x, p.y);
}

/** Clicks empty board space (outside any note). */
function clickOutside(x = 40, y = 40): void {
  const viewport = screen.getByTestId('board-viewport');
  firePointer(viewport, 'pointerdown', x, y);
  firePointer(viewport, 'pointerup', x, y);
}

describe('StickyTextEditor (story 2)', () => {
  it('TC-23: starting editing focuses the textarea with the caret at the end of the text', () => {
    renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'abc');
    selectNote();
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();

    pressKey(window, 'Enter');

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
  });

  it('TC-24: Escape ends editing, keeps the selection and the typed text', () => {
    renderFullApp();
    const id = makeNote(0, 0);
    selectNote();
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    typeText(textarea, 'typed');

    pressKey(textarea, 'Escape');

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    const note = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(hooks().getNotes()[0].text).toBe('typed');
  });

  it('TC-26: Backspace while editing deletes a character, never the note', () => {
    renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'ab');
    selectNote();
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    // The window-level delete handler must ignore Backspace while editing.
    pressKey(textarea, 'Backspace');
    expect(hooks().getNotes()).toHaveLength(1);

    // The user deletes the last character in the textarea.
    typeText(textarea, 'a');

    expect(hooks().getNotes()).toHaveLength(1);
    expect(hooks().getNotes()[0].text).toBe('a');
    const note = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(note).toBeInTheDocument();
  });

  it('TC-38: clicking outside ends editing, the text is kept, and the note is unselected', () => {
    renderFullApp();
    const id = makeNote(0, 0);
    selectNote();
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    typeText(textarea, 'abc');

    clickOutside();

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(hooks().getNotes()[0].text).toBe('abc'); // typed text kept in the doc
    const note = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(note.hasAttribute('data-selected')).toBe(false);
  });

  it('extra: input beyond the limit is clamped and the caret moves to the end of the kept text', () => {
    renderFullApp();
    makeNote(0, 0);
    selectNote();
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    const over = 'x'.repeat(1200); // 1,200 pasted characters (TC-14 behaviour in the UI)
    typeText(textarea, over);

    expect(hooks().getNotes()[0].text).toHaveLength(1000);
    expect(textarea.value).toHaveLength(1000); // DOM value truncated to the kept text
    expect(textarea.selectionStart).toBe(1000); // caret restored to the end
  });

  it('extra: Enter inserts a newline inside the text (editing keeps going)', () => {
    renderFullApp();
    makeNote(0, 0);
    selectNote();
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    typeText(textarea, 'a\nb');

    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    expect(hooks().getNotes()[0].text).toBe('a\nb');
  });
});
