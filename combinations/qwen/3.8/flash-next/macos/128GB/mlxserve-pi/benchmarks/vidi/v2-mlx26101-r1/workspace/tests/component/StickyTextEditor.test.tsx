import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import {
  boardDoc,
  clickNote,
  createNote,
  inputInto,
  keyOn,
  noteCount,
  noteEl,
  noteSelected,
  pointer,
  seedText,
  surface,
  textEl,
  windowKey,
} from './helpers';

function textarea(id: string): HTMLTextAreaElement {
  return within(noteEl(id)).getByRole('textbox') as HTMLTextAreaElement;
}

function enterEdit(id: string): void {
  clickNote(id);
  windowKey('Enter');
}

describe('sticky.text editor', () => {
  it('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    render(<App />);
    const id = createNote(300, 300);
    seedText(id, 'Faster onboarding');

    enterEdit(id);

    const ta = textarea(id);
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('Faster onboarding');
    expect(ta.selectionStart).toBe('Faster onboarding'.length);
    expect(ta.selectionEnd).toBe('Faster onboarding'.length);
  });

  it('TC-24 Escape ends editing and preserves the text', () => {
    render(<App />);
    const id = createNote(300, 300);
    seedText(id, 'abc');
    enterEdit(id);
    inputInto(textarea(id), 'abcd');

    keyOn(textarea(id), 'Escape');

    expect(within(noteEl(id)).queryByRole('textbox')).toBeNull();
    expect(noteSelected(id)).toBe(true);
    expect(textEl(id).textContent).toBe('abcd');
    expect(getStickyText(boardDoc(), id)?.toString()).toBe('abcd');
  });

  it('TC-26 Backspace while editing edits text and never deletes the note', () => {
    render(<App />);
    const id = createNote(300, 300);
    seedText(id, 'ab');
    enterEdit(id);

    const ta = textarea(id);
    // The key is typed into the focused textarea; the browser removes a character.
    ta.setSelectionRange(2, 2);
    windowKey('Backspace'); // must NOT delete the note (App ignores it while editing)
    inputInto(ta, 'a'); // jsdom does not edit on the key itself, so apply the edit

    expect(noteCount()).toBe(1);
    expect(getStickyText(boardDoc(), id)?.toString()).toBe('a');
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // still editing
  });

  it('TC-38 typing then clicking outside keeps the text and deselects', () => {
    render(<App />);
    const id = createNote(300, 300);
    enterEdit(id);
    inputInto(textarea(id), 'abc');

    // A pointerdown on empty board space is "outside" the note.
    pointer(surface(), 'pointerdown', 800, 600);

    expect(within(noteEl(id)).queryByRole('textbox')).toBeNull();
    expect(getStickyText(boardDoc(), id)?.toString()).toBe('abc');
    expect(noteSelected(id)).toBe(false);
  });
});
