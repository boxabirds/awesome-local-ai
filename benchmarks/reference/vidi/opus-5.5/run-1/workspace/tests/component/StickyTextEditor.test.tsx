import { act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import {
  clickEmptyBoard,
  doc,
  doubleClickBoard,
  editor,
  notes,
  onlyNoteEl,
  renderBoard,
  user,
} from './stickyHelpers';

const AT = { x: 400, y: 300 } as const;

function textOf(): string {
  const all = notes();
  expect(all).toHaveLength(1);
  return all[0]!.text;
}

function counter(): HTMLElement | null {
  return document.querySelector('[data-testid="sticky-counter"]');
}


describe('sticky.text editor', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('typing writes every character to the document immediately', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard(SHORT_PHRASE);
    expect(textOf()).toBe(SHORT_PHRASE);
    expect(onlyNoteEl().dataset.editing).toBe('true');
  });

  it('Enter inside the note adds a new line (does not end editing)', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard('one{Enter}two');
    expect(textOf()).toBe('one\ntwo');
    expect(editor()).not.toBeNull();
  });

  it('TC-23 Enter on a selected note starts editing with the caret at the end', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard(SHORT_PHRASE);
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(editor()).toBeNull();
    const note = onlyNoteEl();
    expect(note.dataset.selected).toBe('true');

    fireEvent.keyDown(note, { key: 'Enter' });
    const textarea = editor();
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(textarea!.value).toBe(SHORT_PHRASE);
    expect(textarea!.selectionStart).toBe(SHORT_PHRASE.length);
    expect(textarea!.selectionEnd).toBe(SHORT_PHRASE.length);
    // The Enter that started editing did not add a newline.
    expect(textOf()).toBe(SHORT_PHRASE);
  });

  it('TC-24 Escape ends editing, keeps the text, note stays Selected', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard(RETRO_ITEM.replace(/\n/g, '{Enter}'));
    await u.keyboard('{Escape}');
    expect(editor()).toBeNull();
    expect(textOf()).toBe(RETRO_ITEM);
    expect(onlyNoteEl().dataset.selected).toBe('true');
    expect(onlyNoteEl()).toHaveProperty('textContent', RETRO_ITEM);
  });

  it('TC-26 Backspace while editing deletes a character, not the note', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard('ab');
    await u.keyboard('{Backspace}');
    expect(notes()).toHaveLength(1);
    expect(textOf()).toBe('a');
    await u.keyboard('{Delete}');
    expect(notes()).toHaveLength(1);
  });

  it('TC-38 type then click outside: editor unmounted, text kept, note Unselected', async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard('abc');
    clickEmptyBoard();
    expect(editor()).toBeNull();
    expect(textOf()).toBe('abc');
    expect(onlyNoteEl().dataset.selected).toBe('false');
  });

  it('pasting 1,200 characters keeps the first 1,000 and shows 1000/1000', () => {
    doubleClickBoard(AT.x, AT.y);
    const textarea = editor()!;
    fireEvent.change(textarea, { target: { value: PROSE_1200 } });
    expect(textOf()).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(textarea.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(textarea.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(counter()?.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('the counter appears only within 50 characters of the limit', () => {
    doubleClickBoard(AT.x, AT.y);
    const textarea = editor()!;
    const threshold = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    fireEvent.change(textarea, { target: { value: PROSE_1000.slice(0, threshold - 1) } });
    expect(counter()).toBeNull();
    fireEvent.change(textarea, { target: { value: PROSE_1000.slice(0, threshold) } });
    expect(counter()?.textContent).toBe(`${threshold}/${STICKY_TEXT_MAX_CHARS}`);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(counter()).toBeNull(); // only while editing
  });

  it('an empty note stays on the board and shows no placeholder', () => {
    doubleClickBoard(AT.x, AT.y);
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    clickEmptyBoard();
    expect(notes()).toHaveLength(1);
    expect(onlyNoteEl().textContent).toBe('');
  });

  it('IME composition is written once, when composition ends', () => {
    doubleClickBoard(AT.x, AT.y);
    const textarea = editor()!;
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'にほ' } });
    expect(textOf()).toBe('');
    fireEvent.change(textarea, { target: { value: '日本' } });
    fireEvent.compositionEnd(textarea);
    expect(textOf()).toBe('日本');
  });

  it("someone else's typing appears in the open editor; my caret and my next keys stay put", async () => {
    const u = user();
    doubleClickBoard(AT.x, AT.y);
    await u.keyboard('green');
    const textarea = editor()!;
    const id = notes()[0]!.id;
    const ytext = getStickyText(doc(), id)!;
    // Remote edits (any origin other than this page's) at the start and at the end.
    act(() => {
      doc().transact(() => ytext.insert(0, 'red '), 'remote');
      doc().transact(() => ytext.insert(ytext.length, ' blue'), 'remote');
    });
    expect(textarea.value).toBe('red green blue');
    // Caret was after "green": still right after it.
    expect(textarea.selectionStart).toBe('red green'.length);
    expect(textarea.selectionEnd).toBe('red green'.length);
    await u.keyboard('!');
    expect(textOf()).toBe('red green! blue');
  });
});
