/**
 * Component tests for the sticky note editor (design capability
 * `sticky.text`): the editor opens with the caret at the end, text lands in the
 * shared `Y.Text` one minimal operation per edit, Escape and outside clicks
 * commit and blur, Backspace/Enter keep working as text editing, and pasted text
 * over the limit is truncated with the counter shown.
 */

import { fireEvent, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { getStickyText } from '../../src/shared/board-model';
import { LONG_PROSE_1000, LONG_PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import {
  board,
  doubleClick,
  noteText,
  pointer,
  renderBoard,
  settle,
  setInput,
  type,
  type BoardFixture,
} from './harness';

/** Opens a note for editing the way a double-click does, and returns the editor. */
async function edit(fx: BoardFixture, id: string): Promise<HTMLTextAreaElement> {
  const el = fx.noteEl(id);
  if (!el) throw new Error('note is not rendered');
  doubleClick(el);
  await settle();
  return fx.textArea();
}

/** Counts the insert and delete operations a note's text absorbed while running. */
async function countOperations(
  fx: BoardFixture,
  id: string,
  run: () => Promise<void>,
): Promise<{ inserted: number; deleted: number }> {
  const ytext = getStickyText(fx.doc(), id);
  if (!ytext) throw new Error('note has no text');
  const counts = { inserted: 0, deleted: 0 };
  const observer = (event: Y.YTextEvent): void => {
    for (const op of event.delta) {
      if (op.insert !== undefined) counts.inserted += 1;
      if (op.delete !== undefined) counts.deleted += 1;
    }
  };
  ytext.observe(observer);
  await run();
  ytext.unobserve(observer);
  return counts;
}

describe('editing sticky note text', () => {
  it('TC-23 opens with the caret at the end of the existing text', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await fx.setText(id, RETRO_ITEM);

    const editor = await edit(fx, id);

    expect(editor.getAttribute('aria-label')).toBe('Sticky note text');
    expect(editor.value).toBe(RETRO_ITEM);
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(RETRO_ITEM.length);
    expect(editor.selectionEnd).toBe(RETRO_ITEM.length);
    expect(screen.queryByTestId('sticky-text')).toBeNull(); // the editor replaces it
  });

  it('TC-23 writes one insertion for typing and one deletion for clearing', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await edit(fx, id);

    const typed = await countOperations(fx, id, () => type(SHORT_PHRASE));
    expect(noteText(fx, id)).toBe(SHORT_PHRASE);
    expect(typed).toEqual({ inserted: 1, deleted: 0 });

    // Appending one character is one more insertion, not a rewrite.
    const appended = await countOperations(fx, id, () => type('s'));
    expect(noteText(fx, id)).toBe(`${SHORT_PHRASE}s`);
    expect(appended).toEqual({ inserted: 1, deleted: 0 });

    const cleared = await countOperations(fx, id, () => setInput(''));
    expect(noteText(fx, id)).toBe('');
    expect(cleared).toEqual({ inserted: 0, deleted: 1 });
  });

  it('TC-24 commits the text and leaves the note selected on Escape', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const editor = await edit(fx, id);

    await type('abc');
    expect(noteText(fx, id)).toBe('abc');

    fireEvent.keyDown(editor, { key: 'Escape' });
    await settle();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(noteText(fx, id)).toBe('abc'); // nothing is lost
    expect(fx.selection().editingId).toBeNull();
    expect(fx.selection().selectedId).toBe(id); // Esc selects, it does not deselect
  });

  it('TC-26 lets Backspace through and deletes a character, not the note', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await fx.setText(id, 'ab');

    const editor = await edit(fx, id);
    expect(fx.selection().selectedId).toBe(id);
    expect(editor.selectionStart).toBe(2); // caret at the end

    // The board's Delete/Backspace handler must not swallow the key here.
    expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(true);
    // The browser's own deletion arrives as the following input event.
    await setInput('a');

    expect(noteText(fx, id)).toBe('a');
    expect(fx.notes()).toHaveLength(1); // the note is still there
    expect(fx.selection().editingId).toBe(id);
  });

  it('TC-26 lets Enter through and writes a newline', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const editor = await edit(fx, id);

    expect(fireEvent.keyDown(editor, { key: 'Enter' })).toBe(true);
    await setInput('two\nlines');

    expect(noteText(fx, id)).toBe('two\nlines');
    expect(fx.notes()).toHaveLength(1); // Enter did not create a note
  });

  it('TC-38 commits and deselects when a click lands outside the note', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await edit(fx, id);
    await type('abc');

    // A press on empty board space, far away from the note.
    pointer('pointerDown', board(), { x: 20, y: 700 });
    await settle();

    expect(screen.queryByTestId('sticky-editor')).toBeNull(); // editor gone first
    expect(document.activeElement).not.toBe(fx.noteEl(id)); // never focused the note
    expect(noteText(fx, id)).toBe('abc');
    expect(fx.selection().editingId).toBeNull();
    expect(fx.selection().selectedId).toBeNull(); // 'unselected'
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('keeps editing when the click lands on the note being edited', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await edit(fx, id);
    await type('abc');

    const note = fx.noteEl(id);
    if (!note) throw new Error('note is not rendered');
    pointer('pointerDown', note, { x: 300, y: 200 });
    await settle();
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();
    expect(noteText(fx, id)).toBe('abc');
    expect(fx.selection().selectedId).toBe(id);
    expect(fx.selection().editingId).toBe(id);
  });

  it('shows the counter only at the threshold and clamps a paste to the limit', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const editor = await edit(fx, id);
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    await type('abcdefghij'); // 10 characters, below the threshold
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
    expect(noteText(fx, id)).toBe('abcdefghij');

    // A paste of 1200 characters: the value is truncated before it is stored.
    await setInput(LONG_PROSE_1200);
    expect(fx.textArea().value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(noteText(fx, id)).toBe(LONG_PROSE_1000);
    expect(screen.getByTestId('sticky-counter').textContent).toBe('1000 / 1000');

    // Exactly at the limit the counter stays visible.
    await setInput(`${LONG_PROSE_1000}x`);
    expect(fx.textArea().value).toBe(LONG_PROSE_1000);
    expect(screen.getByTestId('sticky-counter').textContent).toBe('1000 / 1000');
    expect(fx.notes()).toHaveLength(1);
    expect(editor).toBeTruthy();
  });

  it('writes an IME composition once, when it ends', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const editor = await edit(fx, id);

    fireEvent.compositionStart(editor);
    // The browser fires input during the composition; nothing is committed yet.
    await setInput('中');
    expect(noteText(fx, id)).toBe('');

    // Escape in the middle of a composition does not end editing either.
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();

    fireEvent.compositionEnd(editor);
    await settle();
    expect(noteText(fx, id)).toBe('中');
    expect(fx.selection().editingId).toBe(id);
  });

  it('shows the whole note text in the read-only view when it is not being edited', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await fx.setText(id, LONG_PROSE_1000);
    // jsdom has no layout, so overflow (and the fade it triggers) is measured
    // e2e; what can be checked here is that the whole text is in the DOM.
    expect(screen.getByTestId('sticky-text').textContent).toBe(LONG_PROSE_1000);
    expect(fx.noteEl(id)?.getAttribute('data-font-px')).toBeTruthy();

    await edit(fx, id);
    expect(screen.queryByTestId('sticky-text')).toBeNull();
    fireEvent.keyDown(fx.textArea(), { key: 'Escape' });
    await settle();
    expect(screen.getByTestId('sticky-text').textContent).toBe(LONG_PROSE_1000);
  });
});
