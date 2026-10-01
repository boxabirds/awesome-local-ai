import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_NOTE_1000, PASTE_1200 } from '../fixtures/texts';
import {
  createNote,
  flushFrame,
  noteEl,
  pressOn,
  releaseOn,
  renderBoard,
  setNoteText,
  surfaceOf,
  textareaEl,
  typeInto,
} from './helpers';

/**
 * TC-23, TC-24, TC-26, TC-38 and the text rules of sticky.text: editing a note
 * writes to the document as it is typed, and finishing editing never writes
 * again, never loses a character and never deletes the note.
 */

const NOTE_TEXT = 'Faster onboarding';

let doc: Doc;
let id: string;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
  id = createNote(doc, 0, 0);
  setNoteText(doc, id, NOTE_TEXT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Select the note with a short press, then open it for editing with Enter. */
function startEditing(): HTMLTextAreaElement {
  pressOn(noteEl(id), 100, 100);
  releaseOn(noteEl(id), 100, 100);
  fireEvent.keyDown(window, { key: 'Enter' });
  return textareaEl();
}

function textOf(): string {
  return getStickyText(doc, id)?.toString() ?? '';
}

describe('starting to edit a note', () => {
  it('TC-23 opens the note on Enter with the text loaded and the caret at the end', () => {
    pressOn(noteEl(id), 100, 100);
    releaseOn(noteEl(id), 100, 100);

    fireEvent.keyDown(window, { key: 'Enter' });

    const editor = textareaEl();
    expect(noteEl(id).dataset.state).toBe('editing');
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe(NOTE_TEXT);
    expect(editor.selectionStart).toBe(NOTE_TEXT.length);
    expect(editor.selectionEnd).toBe(NOTE_TEXT.length);
  });

  it('TC-35 opens the note on double-click with the same edit state', () => {
    fireEvent.doubleClick(noteEl(id));

    const editor = textareaEl();
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe(NOTE_TEXT);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('finishing editing', () => {
  it('TC-24 keeps everything typed and the note selected when Escape ends editing', () => {
    const editor = startEditing();
    typeInto(editor, `${NOTE_TEXT} today`);

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(noteEl(id).dataset.state).toBe('selected');
    expect(textOf()).toBe(`${NOTE_TEXT} today`);
  });

  it('TC-38 stores the typed text and deselects when a click lands outside the note', () => {
    const editor = startEditing();
    typeInto(editor, 'abc');

    const surface = surfaceOf(document.body);
    pressOn(surface, 700, 600);
    releaseOn(surface, 700, 600);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(textOf()).toBe('abc');
    expect(noteEl(id).dataset.selected).toBe('false');
    expect(noteEl(id).dataset.state).toBe('unselected');
  });

  it('writes nothing more when editing ends, because every keystroke was written', () => {
    const editor = startEditing();
    typeInto(editor, 'abc');

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    fireEvent.keyDown(editor, { key: 'Escape' });
    flushFrame();

    expect(updates).toBe(0);
  });

  it('inserts a new line on Enter instead of closing the editor', () => {
    const editor = startEditing();
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(screen.queryByRole('textbox')).not.toBeNull();
    typeInto(editor, `${NOTE_TEXT}\nkeep it short`);
    expect(textOf()).toBe(`${NOTE_TEXT}\nkeep it short`);
  });

  it('leaves the editor open when Escape belongs to an IME composition', () => {
    const editor = startEditing();
    fireEvent.compositionStart(editor);
    typeInto(editor, `${NOTE_TEXT}か`);

    // Escape cancels the composition, it does not finish editing.
    fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });

    expect(screen.queryByRole('textbox')).not.toBeNull();
    fireEvent.compositionEnd(editor, { data: 'か' });
    expect(textOf()).toBe(`${NOTE_TEXT}か`);
  });
});

describe('typing in a note', () => {
  it('TC-26 deletes one character on Backspace and keeps the note', () => {
    setNoteText(doc, id, 'ab');
    const editor = startEditing();

    // The browser would remove a character; the note itself must survive.
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(1);

    typeInto(editor, 'a');

    expect(textOf()).toBe('a');
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeNull();
  });

  it('composes IME text exactly once on compositionend', () => {
    const editor = startEditing();

    fireEvent.compositionStart(editor);
    typeInto(editor, `${NOTE_TEXT}か`);
    // Nothing is written while the composition is open.
    expect(textOf()).toBe(NOTE_TEXT);

    fireEvent.compositionEnd(editor, { data: 'か' });

    expect(textOf()).toBe(`${NOTE_TEXT}か`);
  });

  it('counts every character typed and shows the counter only near the limit', () => {
    const editor = startEditing();
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    const near = 'x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1);
    typeInto(editor, near);
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    typeInto(editor, `${near}x`);
    expect(screen.getByTestId('sticky-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );

    typeInto(editor, 'x'.repeat(STICKY_TEXT_MAX_CHARS));
    expect(screen.getByTestId('sticky-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('drops the characters of a paste that go past the limit', () => {
    const editor = startEditing();

    typeInto(editor, PASTE_1200);

    expect(textOf()).toBe(LONG_NOTE_1000);
    expect(textOf().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editorValue(editor)).toBe(LONG_NOTE_1000);
    // The caret sits at the end of the text that was kept.
    expect(editor.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('keeps the text of a note that is edited twice', () => {
    const editor = startEditing();
    typeInto(editor, 'abc');
    fireEvent.keyDown(editor, { key: 'Escape' });

    fireEvent.doubleClick(noteEl(id));
    const again = textareaEl();

    expect(again.value).toBe('abc');
    typeInto(again, 'abcdef');
    expect(textOf()).toBe('abcdef');
  });
});

function editorValue(el: HTMLTextAreaElement): string {
  return el.value;
}
