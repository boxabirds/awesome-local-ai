import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_PROSE, RETRO_ITEM, TEXT_1000, proseOfLength } from '../fixtures/texts';
import {
  CENTRE,
  appendText,
  clickEmptyBoard,
  createNote,
  createNoteWithText,
  doc,
  editor,
  modelNotes,
  note,
  noteCount,
  pressEscape,
  selectNote,
  textOf,
  typeText,
  view,
} from './sticky-helpers';

/**
 * sticky.text: editing the words of a note.
 *
 * Every character is written to the shared text as it is typed, so the model is
 * the thing under test here: what it holds while typing, after Escape, after a
 * click outside, and after more characters than the note may hold.
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  render(<App boardId="test-board-00000000ab" />);
});

/** The shared text of a note, straight from the document. */
function ytextValue(index = 0): string {
  const noteEntry = modelNotes()[index];
  if (!noteEntry) throw new Error(`no note at index ${index}`);
  return getStickyText(doc(), noteEntry.id)?.toString() ?? '';
}

describe('starting and ending text editing', () => {
  it('TC-23 Enter on a selected note opens the editor, focused with the caret at the end', () => {
    createNoteWithText('write me', CENTRE);
    // clicking the board takes focus away from the note's text
    clickEmptyBoard();
    selectNote(0);
    expect(view(0).editing).toBe(false);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(view(0).editing).toBe(true);
    const field = editor();
    expect(field.value).toBe('write me');
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe('write me'.length);
    expect(field.selectionEnd).toBe('write me'.length);
  });

  it('TC-24 Escape ends editing, keeps the note selected and keeps the text', () => {
    createNote(CENTRE);
    typeText('kept');
    appendText(' and more');
    expect(ytextValue()).toBe('kept and more');

    pressEscape();

    expect(view(0).editing).toBe(false);
    expect(view(0).selected).toBe(true);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(ytextValue()).toBe('kept and more');
    expect(modelNotes()[0]?.text).toBe('kept and more');
  });

  it('a double-click opens the editor with the caret at the end of the text', async () => {
    createNoteWithText('double', CENTRE);
    clickEmptyBoard();

    fireEvent.doubleClick(note(), { clientX: CENTRE.x, clientY: CENTRE.y });

    const field = editor();
    expect(field.value).toBe('double');
    expect(document.activeElement).toBe(field);
    // the caret is after the last character, so typing appends
    expect(field.selectionStart).toBe('double'.length);
  });

  it('TC-38 typing then clicking outside writes the text, unmounts the editor and deselects', () => {
    createNote(CENTRE);
    typeText('abc');

    clickEmptyBoard();

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(ytextValue()).toBe('abc');
    expect(view(0).editing).toBe(false);
    expect(view(0).selected).toBe(false);
    expect(textOf(0)).toBe('abc');
  });

  it('text is in the document while still editing, not only when editing ends', () => {
    createNote(CENTRE);
    typeText('one ');
    expect(ytextValue()).toBe('one ');
    appendText('two');
    expect(ytextValue()).toBe('one two');
    expect(view(0).editing).toBe(true);
  });

  it('pressing a different note ends editing of the one being typed into', () => {
    createNoteWithText('first', { x: 300, y: 300 });
    createNote({ x: 800, y: 500 });
    typeText('second');
    expect(modelNotes()).toHaveLength(2);
    expect(modelNotes()[1]?.text).toBe('second');

    // a press on the other note ends editing (and drops the selection)
    const at = { x: 800 + 100, y: 500 + 100 };
    fireEvent.pointerDown(note(0), { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerUp(note(0), { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(view(1).editing).toBe(false);
    expect(view(0).editing).toBe(false);
    expect(view(0).selected).toBe(true);
    expect(view(1).selected).toBe(false);
  });
});

describe('what the keyboard does inside a note', () => {
  it('TC-26 Backspace while editing edits the text and does not delete the note', async () => {
    const user = userEvent.setup();
    createNoteWithText('ab', CENTRE);
    clickEmptyBoard();
    selectNote(0);

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(view(0).editing).toBe(true);

    await user.type(editor(), '{backspace}');

    expect(noteCount()).toBe(1);
    expect(ytextValue()).toBe('a');
    expect(view(0).editing).toBe(true);
  });

  it('Delete while editing is a character, not a deleted note', () => {
    createNoteWithText('abcd', CENTRE);
    clickEmptyBoard();
    selectNote(0);
    fireEvent.keyDown(window, { key: 'Enter' });
    const field = editor();
    field.setSelectionRange(2, 2);

    // the key itself must not reach the window handler that deletes notes
    fireEvent.keyDown(field, { key: 'Delete' });
    expect(noteCount()).toBe(1);
    expect(field.value).toBe('abcd');
    // and the character the browser removes is removed from the shared text
    fireEvent.change(field, { target: { value: 'abd' } });

    expect(noteCount()).toBe(1);
    expect(ytextValue()).toBe('abd');
  });

  it('Enter inserts a newline instead of ending editing', () => {
    createNote(CENTRE);
    typeText('line one');
    appendText('\nline two');

    expect(view(0).editing).toBe(true);
    expect(ytextValue()).toBe('line one\nline two');
    expect(screen.queryByTestId('sticky-editor')).not.toBeNull();
  });

  it('Escape while editing does not reach the window handlers', () => {
    createNote(CENTRE);
    typeText('escape me');
    // the note is still editing; Escape must keep it, not delete it
    pressEscape();

    expect(noteCount()).toBe(1);
    expect(view(0).selected).toBe(true);
    expect(ytextValue()).toBe('escape me');
  });
});

describe('the character limit and the counter', () => {
  it('pasting 1,200 characters keeps exactly 1,000', () => {
    createNote(CENTRE);
    const long = LONG_PROSE.slice(0, 1200);
    expect(long.length).toBe(1200);

    typeText(long);

    expect(ytextValue().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editor().value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(ytextValue()).toBe(long.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('a 1,001st character is refused and the text stays at the limit', () => {
    createNote(CENTRE);
    typeText(TEXT_1000);
    expect(ytextValue().length).toBe(STICKY_TEXT_MAX_CHARS);

    appendText('!');

    expect(ytextValue().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editor().value).toBe(TEXT_1000);
  });

  it('the counter appears at the threshold and counts what is left', () => {
    createNote(CENTRE);
    // one character below the threshold at which the counter appears
    const hidden = 'x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1);
    typeText(hidden);
    expect(ytextValue().length).toBe(949);

    // still nothing on screen
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    appendText('y');

    const counter = screen.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );

    appendText('z');
    expect(screen.getByTestId('sticky-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('the counter disappears again when the text is shortened', () => {
    createNote(CENTRE);
    typeText(proseOfLength(960));
    expect(screen.getByTestId('sticky-counter')).not.toBeNull();

    typeText('short');

    expect(ytextValue()).toBe('short');
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
  });

  it('the caret ends up after the kept characters when a paste is cut off', () => {
    createNote(CENTRE);
    typeText('start: ');
    appendText(LONG_PROSE.slice(0, 1200));

    const field = editor();
    expect(field.value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(field.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(field.selectionEnd).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('input methods', () => {
  it('an IME composition is written once, at the end of the composition', () => {
    createNote(CENTRE);
    typeText('note: ');
    const field = editor();

    fireEvent.compositionStart(field, { data: '' });
    // the input method types ahead: intermediate text must not be written yet
    fireEvent.change(field, { target: { value: 'note: kan' } });
    expect(ytextValue()).toBe('note: ');
    fireEvent.change(field, { target: { value: 'note: かんじ' } });
    expect(ytextValue()).toBe('note: ');

    fireEvent.compositionEnd(field, { data: 'かんじ' });

    expect(ytextValue()).toBe('note: かんじ');
    expect(modelNotes()[0]?.text).toBe('note: かんじ');
  });

  it('an emoji survives typing as a whole character', () => {
    createNote(CENTRE);
    typeText('ship it 🚀');
    pressEscape();

    expect(ytextValue()).toBe('ship it 🚀');
    expect(textOf(0)).toBe('ship it 🚀');
  });

  it('replacing the text keeps the note and its identity', () => {
    createNote(CENTRE);
    typeText(RETRO_ITEM);
    const before = ytextValue();
    expect(before).toBe(RETRO_ITEM);

    // a selection replaced by new words: the shared text is edited, not rebuilt
    typeText(before.replace('demo', 'release'));

    expect(ytextValue()).toBe(RETRO_ITEM.replace('demo', 'release'));
    expect(noteCount()).toBe(1);
    expect(modelNotes()[0]?.id).toBe(view(0).id);
  });
});
