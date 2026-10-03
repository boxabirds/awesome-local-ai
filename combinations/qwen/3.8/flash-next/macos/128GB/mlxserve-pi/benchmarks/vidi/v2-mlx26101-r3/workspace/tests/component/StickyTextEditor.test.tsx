import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { flushFrames } from './helpers';
import {
  clickAt,
  doubleClick,
  doubleClickBoard,
  mountSticky,
  pasteInto,
  pressKey,
  pressKeyIn,
  typeInto,
  type MountedSticky,
} from './helpers/sticky';
import { LONG_PROSE, PASTE_OVER_LIMIT, SHORT_PHRASE, proseOfLength } from '../fixtures/texts';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

/**
 * Text editing inside a note (sticky.text at component level): what the textarea does, the
 * text the document ends up with, and where the caret is.
 *
 * Font fitting needs real text layout, so it is only asserted in the browser (TC-33); here
 * the fit is checked as "the size the editor asks for is inside the allowed range".
 */

const NOTE_AT = { x: 40, y: -60 };

async function noteInText(board: MountedSticky, text: string): Promise<string> {
  const id = createSticky(board.doc, NOTE_AT);
  const ytext = getStickyText(board.doc, id);
  if (ytext === undefined) {
    throw new Error('the note has no text to edit');
  }
  if (text !== '') {
    ytext.insert(0, text);
  }
  await flushFrames();
  return id;
}

/** Select the note and press Enter: this is how editing starts from the keyboard. */
async function startEditing(board: MountedSticky): Promise<HTMLTextAreaElement> {
  clickAt(board.note(), board.screenOf(NOTE_AT));
  await flushFrames();
  pressKey('Enter');
  await flushFrames();
  return board.editor();
}

describe('sticky.text: start editing (TC-23)', () => {
  it('TC-23: Enter puts the caret at the end of the existing text', async () => {
    const board = await mountSticky();
    await noteInText(board, 'abc');

    const editor = await startEditing(board);

    expect(editor).toBe(document.activeElement);
    expect(editor.value).toBe('abc');
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
    expect(editor.getAttribute('aria-label')).toBe('Sticky note text');
    // The note is edited in place: it is still the same note, still selected.
    expect(board.noteCount()).toBe(1);
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-23b: a double-click edits the note too, with the caret at the end', async () => {
    const board = await mountSticky();
    await noteInText(board, SHORT_PHRASE);

    doubleClick(board.note(), board.screenOf(NOTE_AT));
    await flushFrames();

    const editor = board.editor();
    expect(editor.value).toBe(SHORT_PHRASE);
    expect(editor.selectionStart).toBe(SHORT_PHRASE.length);
  });

  it('TC-23c: a brand new note is empty, focused and ready for typing', async () => {
    const board = await mountSticky();
    await doubleClickBoard(board, { x: 0, y: 0 });
    await flushFrames();

    const editor = board.editor();
    expect(editor.value).toBe('');
    expect(editor).toBe(document.activeElement);
    expect(board.counter()).toBeNull();
  });
});

describe('sticky.text: typing writes the document (TC-13 side effects, TC-38)', () => {
  it('TC-38: text typed into the note is in the document before editing stops', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, '');
    const editor = await startEditing(board);

    typeInto(editor, 'a');
    typeInto(editor, 'b');
    typeInto(editor, 'c');

    expect(getStickyText(board.doc, id)?.toString()).toBe('abc');
  });

  it('TC-38b: every keystroke is one document update, so peers see them as they happen', async () => {
    const board = await mountSticky();
    await noteInText(board, '');
    const updates: string[] = [];
    const observed = (event: 'update'): void => {
      board.doc.on(event, () => {
        updates.push('update');
      });
    };
    observed('update');

    const editor = await startEditing(board);
    updates.length = 0;
    typeInto(editor, 'a');
    typeInto(editor, 'b');
    typeInto(editor, 'c');

    expect(updates).toHaveLength(3);
    expect(board.editor().value).toBe('abc');
  });

  it('TC-24: pressing Escape keeps the text and the selection', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, 'abc');
    const editor = await startEditing(board);
    typeInto(editor, 'def');

    pressKeyIn(editor, 'Escape');
    await flushFrames();

    expect(board.editorOrNull()).toBeNull();
    expect(getStickyText(board.doc, id)?.toString()).toBe('abcdef');
    expect(board.note().dataset.selected).toBe('true');
    expect(board.note().textContent).toBe('abcdef');
  });

  it('TC-38d: clicking outside the note keeps the text and deselects', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, 'abc');
    const editor = await startEditing(board);
    typeInto(editor, 'def');

    // A press on empty board space, far away from the note.
    clickAt(board.board, board.screenOf({ x: 600, y: 400 }));
    await flushFrames();

    expect(board.editorOrNull()).toBeNull();
    expect(getStickyText(board.doc, id)?.toString()).toBe('abcdef');
    expect(board.note().dataset.selected).toBe('false');
    expect(board.toolbarOrNull()).toBeNull();
  });

  it('TC-38e: a click inside the note while editing does not stop editing', async () => {
    const board = await mountSticky();
    await noteInText(board, 'abc');
    await startEditing(board);

    // The corner of the note, where there is no text: still the same note.
    clickAt(board.note(), board.screenOf({ x: NOTE_AT.x + 90, y: NOTE_AT.y + 90 }));
    await flushFrames();

    expect(board.editorOrNull()).not.toBeNull();
    expect(board.editor().value).toBe('abc');
  });

  it('TC-23d: Enter inside the text inserts a newline instead of ending editing', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, 'one');
    const editor = await startEditing(board);

    const event = fireKeyDown(editor, 'Enter');
    expect(event.defaultPrevented).toBe(false);
    // The browser would now insert the line break; report what it would have produced.
    typeInto(editor, '\ntwo');

    expect(getStickyText(board.doc, id)?.toString()).toBe('one\ntwo');
    expect(board.editorOrNull()).not.toBeNull();
  });
});

function fireKeyDown(element: HTMLElement, key: string): Event {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

describe('sticky.text: delete keys while editing (TC-26)', () => {
  it.each([['Backspace'], ['Delete']])(
    'TC-26: %s while editing edits text, never deletes the note',
    async (key) => {
      const board = await mountSticky();
      const id = await noteInText(board, 'ab');
      const editor = await startEditing(board);

      const event = fireKeyDown(editor, key);
      expect(event.defaultPrevented).toBe(false);
      // The key would have taken one character off the text; report what is left.
      pasteInto(editor, 'a');
      await flushFrames();

      expect(board.noteCount()).toBe(1);
      expect(getStickyText(board.doc, id)?.toString()).toBe('a');
    },
  );
});

describe('sticky.text: the length limit while typing (TC-14, TC-16)', () => {
  it('TC-14: a paste that is too long keeps the first 1,000 characters and the caret goes to the end', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, '');
    const editor = await startEditing(board);

    pasteInto(editor, PASTE_OVER_LIMIT);
    await flushFrames();

    const text = getStickyText(board.doc, id);
    expect(text?.toString()).toBe(PASTE_OVER_LIMIT.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(text?.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const shown = board.editor();
    expect(shown.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(shown.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(shown.selectionEnd).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16: typing at the limit adds nothing', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, LONG_PROSE);
    const editor = await startEditing(board);
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);

    typeInto(editor, 'X');
    await flushFrames();

    expect(getStickyText(board.doc, id)?.toString()).toBe(LONG_PROSE);
    expect(board.editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-14b: the counter shows the characters used against the limit', async () => {
    const board = await mountSticky();
    await noteInText(board, '');
    const editor = await startEditing(board);

    pasteInto(editor, LONG_PROSE);
    await flushFrames();

    const counter = board.counter();
    expect(counter?.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('TC-17b: the counter appears when only 50 characters are left', async () => {
    const board = await mountSticky();
    await noteInText(board, '');
    const editor = await startEditing(board);

    pasteInto(editor, proseOfLength(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1));
    await flushFrames();
    expect(board.counter()).toBeNull();

    pasteInto(editor, proseOfLength(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS));
    await flushFrames();
    expect(board.counter()?.textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('TC-26b: a space typed into the text reaches the text, and is not eaten by the note', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, 'a');
    const editor = await startEditing(board);

    // The keydown for a space bubbles from the textarea up through the note; the note must
    // not cancel it, or no space could ever be typed. fireEvent gives back false when a
    // handler cancelled the event.
    expect(fireEvent.keyDown(editor, { key: ' ' })).toBe(true);

    // Once the note is merely selected, Space is the note's own key and is cancelled so the
    // page behind the board does not scroll.
    pressKeyIn(editor, 'Escape');
    await flushFrames();
    expect(fireEvent.keyDown(board.note(), { key: ' ' })).toBe(false);
    expect(getStickyText(board.doc, id)?.toString()).toBe('a');
  });

  it('TC-33b: the editor asks for a font size inside the allowed range', async () => {
    const board = await mountSticky();
    await noteInText(board, SHORT_PHRASE);
    const editor = await startEditing(board);

    const size = Number.parseFloat(editor.style.fontSize);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    expect(size).toBeGreaterThanOrEqual(1);
  });
});

describe('sticky.text: the note shows the text it holds', () => {
  it('renders multi-line text with the line breaks intact', async () => {
    const board = await mountSticky();
    const id = await noteInText(board, 'Retro:');
    const ytext = getStickyText(board.doc, id);
    ytext?.insert(ytext.length, ' what went well\nwhat to change');
    await flushFrames();

    expect(board.textOf()).toBe('Retro: what went well\nwhat to change');
    expect(board.note().querySelector<HTMLElement>('.sticky-note__text')?.style.fontSize).toBe(
      `${STICKY_FONT_MAX_PX}px`,
    );
  });
});
