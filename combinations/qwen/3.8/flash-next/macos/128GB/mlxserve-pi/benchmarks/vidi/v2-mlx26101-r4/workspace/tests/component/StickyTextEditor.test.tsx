/**
 * Component tests for sticky note text editing (story 2, TC-23, TC-24, TC-26,
 * TC-38, plus the length limit, the character counter and input methods).
 *
 * jsdom performs no layout, so a textarea there has no height and the auto-fit
 * font cannot shrink: the fade and the font size are checked in the browser
 * instead (TC-33). What can be checked here is what the document ends up holding
 * after every kind of keystroke.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  clickStickyButton,
  createSelectedNote,
  doc,
  doubleClickBoard,
  hasTextarea,
  noteElement,
  noteElements,
  noteId,
  pasteText,
  renderBoard,
  stickies,
  surface,
  textarea,
  toolbarPresent,
  typeText,
} from './helpers/stickyBoard';
import { LONG_NOTE, RETRO_NOTE, SHORT_NOTE, TOO_LONG_NOTE } from '../fixtures/texts';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** Text just inside the counter's threshold: `1000 - 50 + 1` characters. */
const NEARLY_FULL = LONG_NOTE.slice(0, STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1);

describe('sticky note text editor', () => {
  it('TC-23: Enter on a selected note edits it, with the cursor at the end of the text', async () => {
    renderBoard();
    await createSelectedNote(400, 300, 'existing');

    expect(fireEvent.keyDown(window, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(hasTextarea()).toBe(true));

    const editor = textarea();
    expect(editor.value).toBe('existing');
    expect(document.activeElement).toBe(editor);
    // The caret is a caret, not a selection: collapsed at the very end.
    expect(editor.selectionStart).toBe('existing'.length);
    expect(editor.selectionEnd).toBe('existing'.length);
    // Editing is not selecting-only: the outline is still on the same note.
    expect(noteElement().dataset.selected).toBe('true');
  });

  it('TC-23b: a note made by the toolbar is ready for typing without another click', async () => {
    renderBoard();
    await clickStickyButton();

    expect(document.activeElement).toBe(textarea());
    expect(textarea().value).toBe('');
    typeText('typed right away');
    expect(stickies()[0].text).toBe('typed right away');
  });

  it('TC-24: Escape stops editing and keeps the text', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText('keep me');

    // Escape is swallowed by the editor: the board must not act on it.
    expect(fireEvent.keyDown(textarea(), { key: 'Escape' })).toBe(false);

    await waitFor(() => expect(hasTextarea()).toBe(false));
    expect(stickies()[0].text).toBe('keep me');
    // Selected, not forgotten: its toolbar is up.
    expect(noteElement().dataset.selected).toBe('true');
    expect(toolbarPresent()).toBe(true);
  });

  it('TC-24b: Escape with an impossible key still keeps the text', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText(SHORT_NOTE);

    // Nothing is written when editing ends: the text was written as it was typed.
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextarea()).toBe(false));
    expect(stickies()[0].text).toBe(SHORT_NOTE);
  });

  it('TC-26: Backspace while typing deletes a character and does not delete the note', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText('ab');

    // The board leaves the key to the text: it is not cancelled.
    expect(fireEvent.keyDown(textarea(), { key: 'Backspace' })).toBe(true);
    // What a browser does with an uncancelled Backspace at the end of the text.
    textarea().value = 'a';
    fireEvent.input(textarea());

    expect(noteElements()).toHaveLength(1);
    expect(stickies()[0].text).toBe('a');
    expect(hasTextarea()).toBe(true);
  });

  it('TC-26b: Enter adds a line instead of ending editing', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText('first');
    expect(fireEvent.keyDown(textarea(), { key: 'Enter' })).toBe(true);

    textarea().value = 'first\nsecond';
    fireEvent.input(textarea());

    expect(stickies()[0].text).toBe('first\nsecond');
    expect(hasTextarea()).toBe(true);
    expect(noteElement().dataset.selected).toBe('true');
  });

  it('TC-38: clicking outside the note types nothing more, saves the text and lets go', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText('abc');

    // A press on empty board space, which is also the press that deselects.
    fireEvent.pointerDown(surface(), { clientX: 60, clientY: 60, pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(surface(), { clientX: 60, clientY: 60, pointerId: 1, pointerType: 'mouse', button: 0 });

    await waitFor(() => expect(hasTextarea()).toBe(false));
    const id = noteId();
    const stored = getStickyText(doc(), id);
    expect(stored?.toString()).toBe('abc');
    expect(stickies()[0].text).toBe('abc');
    // Unselected: no outline, no toolbar, and the displayed text is back.
    expect(noteElement().dataset.selected).toBe('false');
    expect(toolbarPresent()).toBe(false);
    expect(screen.getByTestId('sticky-text').textContent).toBe('abc');
  });

  it('TC-38b: pressing another note with the mouse ends editing and selects that one', async () => {
    renderBoard();
    await doubleClickBoard(200, 200);
    typeText('first');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await doubleClickBoard(700, 500);
    typeText('second');

    // Press the first note (which is behind) without moving.
    fireEvent.pointerDown(screen.getAllByRole('group', { name: 'Sticky note' })[0], {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });
    fireEvent.pointerUp(screen.getAllByRole('group', { name: 'Sticky note' })[0], {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });

    await waitFor(() => expect(hasTextarea()).toBe(false));
    expect(stickies()).toHaveLength(2);
    expect(stickies().map((note) => note.text)).toContain('first');
    expect(stickies().map((note) => note.text)).toContain('second');
  });

  it('keeps text that fits, and drops only what goes past the limit', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);

    pasteText(TOO_LONG_NOTE);

    expect(stickies()[0].text).toBe(TOO_LONG_NOTE.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(stickies()[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    // The caret sits at the end of what the note kept.
    expect(textarea().selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    // One write per keystroke: the note is still there, still being edited.
    expect(hasTextarea()).toBe(true);
  });

  it('refuses the character that goes one past the limit', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);

    pasteText(LONG_NOTE);
    expect(stickies()[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const atLimit = stickies()[0].text;

    // A final character typed at the limit is refused.
    typeText('!');
    expect(stickies()[0].text).toBe(atLimit);
    expect(stickies()[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('shows the character counter only when the note is nearly full', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);

    typeText(RETRO_NOTE);
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    pasteText(NEARLY_FULL);
    const counter = screen.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(`${NEARLY_FULL.length}/${STICKY_TEXT_MAX_CHARS}`);

    // Deleting text that takes it back under the threshold takes the counter away.
    pasteText(RETRO_NOTE);
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
  });

  it('writes an input method composition once, when it is finished', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText('hi ');

    const editor = textarea();
    fireEvent.compositionStart(editor);
    // While composing, the browser shows its own underlined text in the box; the
    // note must not see it yet.
    editor.value = 'hi かな';
    fireEvent.input(editor);
    expect(stickies()[0].text).toBe('hi ');

    fireEvent.compositionEnd(editor);
    await waitFor(() => expect(stickies()[0].text).toBe('hi かな'));
    // Not doubled, not dropped.
    expect(stickies()[0].text).toBe('hi かな');
  });

  it('an input method composition that loses focus is written, not lost', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);

    const editor = textarea();
    fireEvent.compositionStart(editor);
    editor.value = 'かな';
    fireEvent.input(editor);
    expect(stickies()[0].text).toBe('');

    // The window goes away mid-composition: focus leaves without a compositionend.
    fireEvent.blur(editor);
    await waitFor(() => expect(stickies()[0].text).toBe('かな'));
  });

  it('every keystroke is written to the document as it is typed', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    const id = noteId();
    const writes: string[] = [];
    getStickyText(doc(), id)?.observe(() => {
      // One event per transaction: each keystroke must arrive on its own, so a
      // second person typing in this note never has their text overwritten.
      writes.push(stickies().find((entry) => entry.id === id)?.text ?? '');
    });

    for (const character of 'Hello') typeText(character);

    expect(stickies()[0].text).toBe('Hello');
    // One write per keystroke, each one building on the last: no rewrite, so a
    // concurrent typist's characters are never dropped.
    expect(writes).toEqual(['H', 'He', 'Hel', 'Hell', 'Hello']);
  });

  it('editing a note does not move it, recolour it or restack it', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    const before = { ...stickies()[0] };

    typeText(SHORT_NOTE);
    pasteText(LONG_NOTE);
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextarea()).toBe(false));

    const after = stickies()[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
  });

  it('a note whose text was emptied shows nothing and can be edited again', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    typeText(SHORT_NOTE);
    pasteText('');
    expect(stickies()[0].text).toBe('');

    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextarea()).toBe(false));
    expect(screen.getByTestId('sticky-text').textContent).toBe('');

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextarea()).toBe(true));
    expect(textarea().value).toBe('');
  });
});
