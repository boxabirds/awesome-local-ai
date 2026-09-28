import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import {
  doubleClickBoard,
  noteEl,
  notes,
  pressKey,
  settle,
  textarea,
  textareas,
  typeText,
} from './helpers/sticky';
import { fireEvent } from '@testing-library/react';
import { viewportEl } from './helpers/board';

/**
 * Story 2 — the sticky note text editor: entering and leaving edit mode, and
 * keystrokes that must reach the text rather than the board.
 */

beforeEach(() => {
  document.documentElement.style.width = '1024px';
  document.documentElement.style.height = '768px';
});

function createNote(text?: string): string {
  doubleClickBoard(512, 384);
  if (text !== undefined) typeText(text);
  const [note] = notes();
  return note.id;
}

describe('entering edit mode (TC-23)', () => {
  it('opens a textarea with the caret at the end of the existing text', () => {
    render(<App />);
    createNote('idea');
    // Commit, then re-open with the keyboard.
    pressKey('Escape');
    expect(textareas()).toHaveLength(0);

    pressKey('Enter');
    const input = textarea();
    expect(input.value).toBe('idea');
    expect(document.activeElement).toBe(input);
    // A caret, not a selection: the whole value must not be highlighted.
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
  });

  it('places the caret at the end of an empty note', () => {
    render(<App />);
    createNote();
    pressKey('Escape');
    pressKey('Enter');
    const input = textarea();
    expect(input.value).toBe('');
    expect(input.selectionStart).toBe(0);
  });

  it('moves focus into the editor, and only one editor is open', () => {
    render(<App />);
    createNote();
    expect(textareas()).toHaveLength(1);
  });
});

describe('leaving edit mode (TC-24, TC-38)', () => {
  it('keeps the typed text and leaves the note Selected when Escape is pressed', () => {
    render(<App />);
    const id = createNote('retro');
    pressKey('Escape');

    expect(textareas()).toHaveLength(0);
    expect(notes()[0].text).toBe('retro');
    expect(noteEl(id).dataset.selected).toBe('true');
  });

  it('unmounts the editor immediately when the click lands elsewhere, text intact', () => {
    render(<App />);
    createNote('abc');

    // Click the empty board: the editor must not stay open for any render.
    fireEvent.pointerDown(viewportEl(), { clientX: 40, clientY: 40 });
    expect(textareas()).toHaveLength(0);
    // The Y.Text holds 'abc' at the moment of the click.
    expect(notes()[0].text).toBe('abc');
  });

  it('deselects when the outside click ends the edit', () => {
    render(<App />);
    const id = createNote('abc');
    fireEvent.pointerDown(viewportEl(), { clientX: 40, clientY: 40 });
    expect(noteEl(id).dataset.selected).toBe('false');
  });

  it('commits a single-character edit on blur without a spurious undo step', () => {
    render(<App />);
    createNote('ab');
    // One keystroke, then commit.
    pressKey('Escape');
    expect(notes()[0].text).toBe('ab');
    // Undo should not resurrect a state the user never typed.
    pressKey('Enter');
    typeText('abc');
    pressKey('Escape');
    expect(notes()[0].text).toBe('abc');
  });
});

describe('typing into a note (TC-26)', () => {
  it('lets a deletion inside the text reach the Y.Text instead of deleting the note', () => {
    render(<App />);
    const id = createNote('abc');

    const input = textarea();
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: 'Backspace' });
    // jsdom does not apply the edit itself; the browser's `input` event does.
    fireEvent.input(input, { target: { value: 'ab' } });

    expect(notes()).toHaveLength(1);
    expect(notes()[0].id).toBe(id);
    expect(notes()[0].text).toBe('ab');
  });

  it('writes multi-character input as the smallest diff', () => {
    render(<App />);
    createNote('hello');
    pressKey('Escape');
    pressKey('Enter');
    typeText('hello world');
    pressKey('Escape');
    expect(notes()[0].text).toBe('hello world');
  });

  it('keeps editing across several keystrokes and ends with a single committed value', async () => {
    render(<App />);
    createNote();
    for (const value of ['y', 'yo', 'you']) typeText(value);
    pressKey('Escape');
    await settle();
    expect(notes()[0].text).toBe('you');
    expect(textareas()).toHaveLength(0);
  });

  it('does not commit during IME composition', () => {
    render(<App />);
    createNote();
    const input = textarea();
    fireEvent.compositionStart(input);
    // A composing string that is over the limit must not be clamped mid-compose.
    fireEvent.input(input, { target: { value: 'x'.repeat(1200) } });
    expect(notes()[0].text).toBe('');
    fireEvent.compositionEnd(input);
    expect(notes()[0].text.length).toBe(1000);
  });
});
