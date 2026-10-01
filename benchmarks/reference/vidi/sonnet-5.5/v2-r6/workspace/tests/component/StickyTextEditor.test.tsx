import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getStickyText } from '../../src/shared/board-model';
import { addNote, click, noteEl, notes, renderBoard } from './board';
import { LONG_TEXT } from '../fixtures/texts';

const editor = () => screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;

describe('sticky text editor', () => {
  it('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    getStickyText(doc, id)!.insert(0, 'hello');
    click(noteEl(id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor();
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps the text and the selection', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    fireEvent.keyDown(window, { key: 'Enter' });
    await userEvent.type(editor(), 'idea');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(notes(doc)[0].text).toBe('idea');
    expect(noteEl(id).dataset.selected).toBe('true');
  });

  it('TC-26 Backspace while editing edits text and does not delete the note', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    fireEvent.keyDown(window, { key: 'Enter' });
    await userEvent.type(editor(), 'ab');
    await userEvent.keyboard('{Backspace}');
    expect(notes(doc)).toHaveLength(1);
    expect(notes(doc)[0].text).toBe('a');
    await userEvent.keyboard('{Delete}');
    expect(notes(doc)).toHaveLength(1);
  });

  it('TC-38 clicking outside ends editing and unselects, keeping the text', async () => {
    const { doc, viewport } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    await userEvent.type(editor(), 'abc');
    fireEvent.pointerDown(viewport, { clientX: 900, clientY: 700, button: 0, pointerId: 1 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(noteEl(id).dataset.selected).toBe('false');
  });

  it('Enter inside the editor adds a new line', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    await userEvent.type(editor(), 'a{Enter}b');
    expect(notes(doc)[0].text).toBe('a\nb');
  });

  it('pasting 1,200 characters keeps 1,000 and shows the counter', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    expect(screen.queryByText(/\/1000$/)).toBeNull();
    fireEvent.input(editor(), { target: { value: LONG_TEXT + LONG_TEXT.slice(0, 200) } });
    expect(getStickyText(doc, id)!.toString()).toBe(LONG_TEXT);
    expect(editor().value).toBe(LONG_TEXT);
    expect(screen.getByText('1000/1000')).toBeTruthy();
  });
});
