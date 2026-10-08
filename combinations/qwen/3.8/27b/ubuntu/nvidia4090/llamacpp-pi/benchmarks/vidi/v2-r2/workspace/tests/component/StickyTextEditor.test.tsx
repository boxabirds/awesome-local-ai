import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import {
  createSticky,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

/** Create a note with the given text, select it, and start editing it. */
function editNote(
  utils: ReturnType<typeof renderStickyBoard>,
  text: string,
): string {
  let id = '';
  act(() => {
    id = createSticky(utils.doc, { x: 0, y: 0 });
  });
  if (text !== '') {
    act(() => {
      getStickyText(utils.doc, id)!.insert(0, text);
    });
  }
  const note = utils.getByTestId('sticky-note');
  fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(note, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.keyDown(window, { key: 'Enter' });
  return id;
}

describe('ui-component: sticky text editing (StickyTextEditor)', () => {
  it('TC-23: Enter on a selected note starts editing: focused textarea, caret at the end', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = editNote(utils, 'hello');

    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5); // caret at the end
    expect(ta.selectionEnd).toBe(5);
    expect(snapshot(utils.doc).find((o) => o.id === id)!.text).toBe('hello');
  });

  it('TC-24: Escape ends editing, keeps the selection, and preserves the text', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = editNote(utils, 'hello');

    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Escape' });

    expect(utils.queryByTestId('sticky-textarea')).toBeNull();
    const note = utils.getByTestId('sticky-note');
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(getStickyText(utils.doc, id)!.toString()).toBe('hello');
  });

  it('TC-26: typing (e.g. Backspace) inside the editor changes the text, never the note', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = editNote(utils, 'ab');

    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Simulate a Backspace at the caret: the textarea value loses one char
    // and an input event fires.
    act(() => {
      ta.value = 'a';
    });
    fireEvent.input(ta);

    expect(getStickyText(utils.doc, id)!.toString()).toBe('a');
    expect(snapshot(utils.doc)).toHaveLength(1); // the note itself is untouched
  });

  it('TC-38: typing then clicking outside: editor unmounts, text is synced, note unselected', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = editNote(utils, '');

    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    act(() => {
      ta.value = 'abc';
    });
    fireEvent.input(ta);

    const viewport = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 5 });

    expect(utils.queryByTestId('sticky-textarea')).toBeNull();
    expect(getStickyText(utils.doc, id)!.toString()).toBe('abc');
    const note = utils.getByTestId('sticky-note');
    expect(note.getAttribute('data-selected')).toBe('false');
  });
});
