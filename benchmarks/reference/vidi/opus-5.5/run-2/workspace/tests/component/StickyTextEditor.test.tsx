import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { LONG_PARAGRAPH, proseOfLength, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import { click, editor, noteEl, renderBoard, viewportEl } from './boardHelpers';

const PASTE_LENGTH = 1200;

function boardWithNote(text: string) {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  getStickyText(doc, id)?.insert(0, text);
  return { ...renderBoard(doc), id, ytext: () => getStickyText(doc, id)?.toString() };
}

/** Replaces the textarea's content as a paste would and fires `input`. */
function pasteInto(el: HTMLTextAreaElement, text: string) {
  const before = el.value.slice(0, el.selectionStart);
  const after = el.value.slice(el.selectionEnd);
  el.value = before + text + after;
  el.setSelectionRange(before.length + text.length, before.length + text.length);
  fireEvent.input(el);
}

describe('sticky.text (StickyTextEditor)', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    const { id } = boardWithNote(RETRO_ITEM);
    click(noteEl(id));
    fireEvent.keyDown(noteEl(id), { key: 'Enter' });
    const el = editor();
    expect(el).toHaveFocus();
    expect(el?.value).toBe(RETRO_ITEM);
    expect(el?.selectionStart).toBe(RETRO_ITEM.length);
    expect(el?.selectionEnd).toBe(RETRO_ITEM.length);
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    // The note toolbar is hidden while editing.
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
  });

  it('typing writes to the Y.Text immediately; Enter inserts a new line', async () => {
    const { id, user, ytext } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard('Went well{Enter}Pairing');
    expect(ytext()).toBe('Went well\nPairing');
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
  });

  it('TC-24 Escape ends editing, keeps the text and leaves the note selected', async () => {
    const { id, user, ytext } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard(SHORT_PHRASE);
    await user.keyboard('{Escape}');
    expect(editor()).toBeNull();
    expect(ytext()).toBe(SHORT_PHRASE);
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
    expect(noteEl(id)).toHaveTextContent(SHORT_PHRASE);
    expect(noteEl(id)).toHaveFocus();
    expect(screen.getByRole('toolbar', { name: 'Note' })).toBeInTheDocument();
  });

  it('TC-26 Backspace while editing deletes a character, not the note', async () => {
    const { id, user, ytext } = boardWithNote('ab');
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard('{Backspace}');
    expect(ytext()).toBe('a');
    expect(noteEl(id)).toBeInTheDocument();
    await user.keyboard('{Delete}');
    expect(noteEl(id)).toBeInTheDocument();
  });

  it('TC-38 type then click outside: editor unmounted, text kept, note unselected', async () => {
    const { id, user, ytext } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard('abc');
    click(viewportEl(), { x: 5, y: 5 });
    expect(editor()).toBeNull();
    expect(ytext()).toBe('abc');
    expect(noteEl(id)).toHaveAttribute('data-state', 'unselected');
  });

  it('pointerdown inside the note while editing keeps editing', async () => {
    const { id, user } = boardWithNote('abc');
    fireEvent.doubleClick(noteEl(id));
    await user.click(editor()!);
    expect(editor()).toBeInTheDocument();
  });

  it(`pasting ${PASTE_LENGTH} characters keeps ${STICKY_TEXT_MAX_CHARS} and shows ${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`, () => {
    const { id, ytext } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    const el = editor()!;
    const pasted = proseOfLength(PASTE_LENGTH);
    pasteInto(el, pasted);
    expect(el.value).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(ytext()).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(el.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId('sticky-counter')).toHaveTextContent(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('typing at the limit adds nothing', async () => {
    const { id, user, ytext } = boardWithNote(LONG_PARAGRAPH);
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard('x');
    expect(ytext()).toBe(LONG_PARAGRAPH);
    expect(editor()?.value).toBe(LONG_PARAGRAPH);
  });

  it('the counter appears only within the threshold of the limit', async () => {
    const edge = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    const { id, user } = boardWithNote(proseOfLength(edge - 1));
    fireEvent.doubleClick(noteEl(id));
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
    await user.keyboard('s');
    expect(screen.getByTestId('sticky-counter')).toHaveTextContent(`${edge}/${STICKY_TEXT_MAX_CHARS}`);
    await user.keyboard('{Backspace}');
    expect(screen.queryByTestId('sticky-counter')).toBeNull();
  });

  it('IME composition is written once, on compositionend', () => {
    const { id, ytext } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    const el = editor()!;
    fireEvent.compositionStart(el);
    el.value = 'に';
    fireEvent.input(el, { isComposing: true });
    el.value = 'にほ';
    fireEvent.input(el, { isComposing: true });
    expect(ytext()).toBe('');
    el.value = '日本';
    fireEvent.compositionEnd(el);
    fireEvent.input(el);
    expect(ytext()).toBe('日本');
  });

  it('an empty note stays on the board and shows no placeholder', async () => {
    const { id, user } = boardWithNote('');
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard('{Escape}');
    expect(noteEl(id)).toBeInTheDocument();
    expect(noteEl(id).textContent).toBe('');
  });

  it('standalone: mounts focused with the caret at the end and calls onEnd on Escape', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, SHORT_PHRASE);
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const el = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    expect(el).toHaveFocus();
    expect(el.style.fontSize).toBe('24px');
    expect(el.selectionStart).toBe(SHORT_PHRASE.length);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onEnd).toHaveBeenCalledWith('selected');
  });

  it('standalone: text changed by someone else updates the textarea', async () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={vi.fn()} />);
    const el = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    act(() => {
      doc.transact(() => ytext.insert(0, 'X'), 'remote');
    });
    expect(el.value).toBe('Xabc');
    // The caret stays after the same character ('c').
    expect(el.selectionStart).toBe('Xabc'.length);
    await userEvent.setup().keyboard('!');
    expect(ytext.toString()).toBe('Xabc!');
  });
});
