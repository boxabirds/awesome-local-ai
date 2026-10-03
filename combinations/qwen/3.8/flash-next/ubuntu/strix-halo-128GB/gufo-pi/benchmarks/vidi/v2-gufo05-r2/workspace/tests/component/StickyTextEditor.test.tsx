import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { snapshot } from '../../src/shared/board-model';
import {
  clickNote,
  firePointer,
  flushFrames,
  pressKeyOn,
  renderApp,
  seedNoteWithText,
  seedSticky,
  surface,
  textareaFor,
  typeInto,
} from './stickyHarness';

// The App's window keydown listener handles Enter for the selected note.
import { fireKey } from './boardHarness';

describe('sticky.text — start and end editing', () => {
  it('TC-23: Enter on a selected note opens the editor focused with the caret at the end', () => {
    const doc = renderApp();
    const id = seedNoteWithText(doc, 'hi');
    clickNote(id);
    fireKey('Enter');
    flushFrames();
    const textarea = textareaFor(id);
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(textarea!.value).toBe('hi');
    expect(textarea!.selectionStart).toBe(2);
    expect(textarea!.selectionEnd).toBe(2);
  });

  it('TC-24: Escape keeps the text and drops to the selected state', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireKey('Enter');
    flushFrames();
    const textarea = textareaFor(id)!;
    typeInto(textarea, 'abc');
    pressKeyOn(textarea, 'Escape');
    expect(textareaFor(id)).toBeNull();
    expect(snapshot(doc)[0]!.text).toBe('abc');
    expect(document.querySelector(`[data-note-id="${id}"]`)!.getAttribute('data-selected')).toBe(
      'true',
    );
  });

  it('TC-26: Backspace while editing edits text and never deletes the note', () => {
    const doc = renderApp();
    const id = seedNoteWithText(doc, 'ab');
    clickNote(id);
    fireKey('Enter');
    flushFrames();
    const textarea = textareaFor(id)!;
    pressKeyOn(textarea, 'Backspace');
    // The note survives the key press.
    expect(snapshot(doc)).toHaveLength(1);
    // The resulting text after the browser removes a character is written.
    typeInto(textarea, 'a');
    expect(snapshot(doc)[0]!.text).toBe('a');
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-38: typing then clicking outside writes the text and drops the selection', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireKey('Enter');
    flushFrames();
    const textarea = textareaFor(id)!;
    typeInto(textarea, 'abc');
    // A pointerdown outside the note ends editing as unselected.
    firePointer(surface(), 'pointerdown', 600, 600);
    flushFrames();
    expect(textareaFor(id)).toBeNull();
    expect(snapshot(doc)[0]!.text).toBe('abc');
    expect(document.querySelector(`[data-note-id="${id}"]`)!.getAttribute('data-selected')).toBe(
      'false',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});