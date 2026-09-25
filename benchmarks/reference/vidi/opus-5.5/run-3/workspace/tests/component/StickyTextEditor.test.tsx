import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { SHORT_TEXT, prose } from '../fixtures/texts';
import { key, noteEl, press, renderApp } from './helpers';

function docWithNote(text: string) {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
  getStickyText(doc, id)!.insert(0, text);
  return { doc, id, ytext: getStickyText(doc, id)! };
}

function textbox() {
  return screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
}

/** Selects the note, then presses Enter to edit it. */
function editWithEnter(id: string) {
  press(noteEl(id));
  return key('Enter', noteEl(id));
}

function user() {
  return userEvent.setup({ delay: null });
}

describe('sticky note text editing (sticky.text)', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    const { doc, id, ytext } = docWithNote(SHORT_TEXT);
    renderApp(doc);
    const prevented = editWithEnter(id);
    expect(prevented).toBe(true); // the Enter is not also typed into the new editor
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    const ta = textbox();
    expect(ta).toHaveFocus();
    expect(ta.value).toBe(SHORT_TEXT);
    expect(ta.selectionStart).toBe(SHORT_TEXT.length);
    expect(ta.selectionEnd).toBe(SHORT_TEXT.length);
    expect(ta.style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
    expect(ytext.toString()).toBe(SHORT_TEXT);
  });

  it('typing writes to the Y.Text; Enter inside the note adds a new line', async () => {
    const { doc, id, ytext } = docWithNote('');
    renderApp(doc);
    editWithEnter(id);
    await user().keyboard('Went well{Enter}pairing');
    expect(ytext.toString()).toBe('Went well\npairing');
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    expect(noteEl(id)).toHaveTextContent('Went well pairing');
  });

  it('TC-24 Escape ends editing, keeps the text and leaves the note selected', async () => {
    const { doc, id, ytext } = docWithNote('Faster');
    renderApp(doc);
    editWithEnter(id);
    await user().keyboard(' onboarding');
    await user().keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext.toString()).toBe(SHORT_TEXT);
    expect(noteEl(id)).toHaveAttribute('data-state', 'idle');
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(id)).toHaveFocus();
    expect(noteEl(id)).toHaveTextContent(SHORT_TEXT);
  });

  it('TC-26 Backspace while editing deletes a character, not the note', async () => {
    const { doc, id, ytext } = docWithNote('ab');
    renderApp(doc);
    editWithEnter(id);
    await user().keyboard('{Backspace}');
    expect(doc.getMap('objects').size).toBe(1);
    expect(ytext.toString()).toBe('a');
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    await user().keyboard('{Delete}');
    expect(doc.getMap('objects').size).toBe(1);
  });

  it('TC-38 typing then clicking outside ends editing, keeps the text and deselects', async () => {
    const { doc, id, ytext } = docWithNote('');
    const { viewport } = renderApp(doc);
    editWithEnter(id);
    await user().keyboard('abc');
    press(viewport, 700, 500);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext.toString()).toBe('abc');
    expect(noteEl(id)).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
  });

  it('pressing inside the note being edited does not end editing', () => {
    const { doc, id } = docWithNote(SHORT_TEXT);
    renderApp(doc);
    editWithEnter(id);
    act(() => {
      fireEvent.pointerDown(textbox(), { pointerId: 1, button: 0 });
    });
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
  });

  it('pressing another note while editing ends editing and selects that note', () => {
    const { doc, id } = docWithNote(SHORT_TEXT);
    const other = createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);
    editWithEnter(id);
    press(noteEl(other));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(noteEl(id)).toHaveAttribute('data-selected', 'false');
    expect(noteEl(other)).toHaveAttribute('data-selected', 'true');
  });

  it('shows the counter only within 50 characters of the limit', async () => {
    const { doc, id, ytext } = docWithNote(prose(949));
    renderApp(doc);
    editWithEnter(id);
    expect(screen.queryByTestId('note-counter')).toBeNull();
    await user().keyboard('x');
    expect(ytext.length).toBe(950);
    expect(screen.getByTestId('note-counter')).toHaveTextContent(`950/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('pasting past the limit keeps the first 1,000 characters and shows 1000/1000', () => {
    const { doc, id, ytext } = docWithNote('');
    renderApp(doc);
    editWithEnter(id);
    const ta = textbox();
    const pasted = prose(1200);
    act(() => {
      ta.value = pasted;
      fireEvent.input(ta);
    });
    expect(ytext.toString()).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(ta.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ta.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId('note-counter')).toHaveTextContent('1000/1000');
  });

  it('does not write while an IME composition is in progress', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={STICKY_FONT_MAX_PX} onEnd={onEnd} />);
    const ta = textbox();
    act(() => {
      fireEvent.compositionStart(ta);
      ta.value = 'にほ';
      fireEvent.input(ta);
    });
    expect(ytext.toString()).toBe('');
    act(() => {
      ta.value = '日本';
      fireEvent.compositionEnd(ta);
    });
    expect(ytext.toString()).toBe('日本');
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(onEnd).toHaveBeenCalledWith('selected');
  });
});
