/**
 * Sticky note text editing (spec anchor `sticky.text`) — the editor's keyboard
 * behaviour, the character limit as the user hits it, and leaving the editor.
 *
 * TC-23 Enter on a selected note            → Editing, textarea focused, caret at end
 * TC-24 Escape while editing                → Selected, text preserved, no further write
 * TC-26 Backspace while editing 'ab'        → note kept, text 'a' (not deleted)
 * TC-38 type 'abc' then click outside       → editor unmounted, Y.Text 'abc', Unselected
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_PASTE, SHORT_NOTE } from '../fixtures/texts';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

let board!: StickyAppHandle;

beforeEach(async () => {
  board = await renderStickyApp();
});

/** Create a note through the board and select it with the pointer. */
async function selectedNote(text = ''): Promise<string> {
  const id = await board.addNote();
  if (text) {
    await act(async () => {
      getStickyText(board.doc, id)?.insert(0, text);
    });
    await advanceFrames();
  }
  await board.press(board.note(), 100, 100);
  await board.release(100, 100);
  return id;
}

describe('sticky.text: entering and leaving the editor', () => {
  it('TC-23 presses Enter on a selected note and starts editing with the caret at the end', async () => {
    const id = await selectedNote(SHORT_NOTE);

    await board.pressKey('Enter');

    const textarea = board.textarea();
    expect(textarea.value).toBe(SHORT_NOTE);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(SHORT_NOTE.length);
    expect(textarea.selectionEnd).toBe(SHORT_NOTE.length);
    // Still selected, and still the same single note.
    expect(board.note().dataset.selected).toBe('true');
    expect(board.noteIds()).toEqual([id]);
  });

  it('TC-24 presses Escape while editing: the note keeps its text and stays selected', async () => {
    await selectedNote();
    await board.pressKey('Enter');
    await board.type('draft idea');

    const updates = await countUpdates(board.doc, async () => {
      await board.pressKey('Escape', board.textarea());
    });

    expect(screen.queryByTestId('sticky-note-editor')).toBeNull();
    expect(board.notes()[0]!.text).toBe('draft idea');
    expect(updates).toBe(0); // leaving the editor writes nothing
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-26 presses Backspace while editing "ab": the note survives and the text becomes "a"', async () => {
    await selectedNote();
    await board.pressKey('Enter');
    await board.type('ab');

    await board.pressKey('Backspace', board.textarea());
    // A browser removes the character before the caret; jsdom does not edit text,
    // so the harness does what the browser would and fires the input event.
    await board.type('a');

    expect(board.noteIds()).toHaveLength(1);
    expect(board.notes()[0]!.text).toBe('a');
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();
  });

  it('TC-38 types text and then clicks outside: the editor unmounts and the text is kept', async () => {
    await selectedNote();
    await board.pressKey('Enter');
    await board.type('abc');

    await board.clickEmpty(30, 40);

    expect(screen.queryByTestId('sticky-note-editor')).toBeNull();
    expect(board.notes()[0]!.text).toBe('abc');
    expect(board.note().dataset.selected).toBe('false');
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(0);
  });

  it('keeps the editor open when Enter breaks a line, and Escape leaves it', async () => {
    await selectedNote();
    await board.pressKey('Enter');

    // Enter inside the textarea is not the board's to take (prd.md:48), so it
    // reaches the textarea, which writes the break.
    await board.pressKey('Enter', board.textarea());
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();
    await board.type('two\nlines');

    expect(board.notes()[0]!.text).toBe('two\nlines');
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();

    // Escape ends editing; the text already went into the document.
    await board.pressKey('Escape', board.textarea());
    expect(screen.queryByTestId('sticky-note-editor')).toBeNull();
    expect(board.notes()[0]!.text).toBe('two\nlines');
    expect((screen.getByTestId('sticky-note') as HTMLElement).dataset.selected).toBe('true');
  });
});

describe('sticky.text: the character limit while typing', () => {
  it('keeps the first 1,000 characters of a 1,200 character paste and shows the counter', async () => {
    await selectedNote();
    await board.pressKey('Enter');
    expect(screen.queryByTestId('sticky-note-counter')).toBeNull();

    await board.type(PROSE_PASTE);

    expect(board.notes()[0]!.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(board.textarea().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId('sticky-note-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('hides the counter while more than 50 characters remain and shows it as they run out', async () => {
    await selectedNote();
    await board.pressKey('Enter');

    await board.type('x'.repeat(STICKY_TEXT_MAX_CHARS - 51));
    expect(screen.queryByTestId('sticky-note-counter')).toBeNull();

    await board.type('x'.repeat(STICKY_TEXT_MAX_CHARS - 50));
    expect(screen.getByTestId('sticky-note-counter').textContent).toBe('950/1000');
  });

  it('ignores what a client would write past the limit and leaves the caret in the text', async () => {
    await selectedNote();
    await board.pressKey('Enter');
    await board.type('x'.repeat(STICKY_TEXT_MAX_CHARS));

    // Keep typing: the value in the DOM grows, the note does not.
    await board.type(`${'x'.repeat(STICKY_TEXT_MAX_CHARS)}yyy`);

    expect(board.notes()[0]!.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(snapshot(board.doc)).toHaveLength(1);
    // The caret is put back inside the text that is really there.
    const textarea = board.textarea();
    expect(textarea.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(textarea.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

/** How many document updates an action produces. */
async function countUpdates(doc: Y.Doc, action: () => Promise<void>): Promise<number> {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    await action();
  } finally {
    doc.off('update', listener);
  }
  return count;
}
