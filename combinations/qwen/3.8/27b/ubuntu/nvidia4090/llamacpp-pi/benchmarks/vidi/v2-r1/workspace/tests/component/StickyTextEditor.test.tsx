// Story 2 component tests: sticky text editing (TC-23 to TC-26, TC-35,
// TC-36, TC-38).

import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import {
  renderApp,
  hooks,
  addNote,
  note,
  noteText,
  click,
  typeIntoEditor,
} from './helpers';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

function theNote(): HTMLElement {
  const el = screen.queryByTestId('sticky-note');
  if (!el) throw new Error('no sticky note rendered');
  return el;
}

function editor(): HTMLTextAreaElement {
  const el = screen.queryByTestId('sticky-editor');
  if (!el) throw new Error('no sticky editor rendered');
  return el as HTMLTextAreaElement;
}

function dblclick(el: Element): void {
  fireEvent.dblClick(el);
}

describe('sticky text editing (component)', () => {
  it('TC-23: Enter on the selected note starts editing with the textarea focused, caret at the end', async () => {
    await renderApp();
    const id = addNote(0, 0);
    typeIntoEditorByClick(id, 'existing'); // give the note some text

    const el = theNote();
    fireEvent.keyDown(window, { key: 'Enter' });

    const ta = editor();
    expect(ta).toHaveFocus();
    expect(ta.value).toBe('existing');
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it('TC-24: Escape ends editing and keeps the note selected with its text', async () => {
    await renderApp();
    const id = addNote(0, 0);
    typeIntoEditorByClick(id, 'draft');

    const el = theNote();
    dblclick(el);
    const ta = editor();
    typeIntoEditor(ta, 'draft more');

    fireEvent.keyDown(ta, { key: 'Escape' });

    expect(screen.queryByTestId('sticky-editor')).not.toBeInTheDocument();
    expect(el).toHaveAttribute('data-selected');
    expect(noteText(id)).toBe('draft more');
  });

  it('TC-25: Delete removes the selected note', async () => {
    await renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    click(el);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(note(id)).toBeUndefined();
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).not.toBeInTheDocument();
  });

  it('TC-25: Backspace removes the selected note (separate run)', async () => {
    await renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    click(el);

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(note(id)).toBeUndefined();
    expect(hooks().getNotes()).toHaveLength(0);
  });

  it('TC-26: Backspace while editing deletes a character, not the note', async () => {
    await renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    dblclick(el);
    const ta = editor();
    typeIntoEditor(ta, 'ab');
    // Caret at the end; Backspace deletes the last character (native default
    // is not simulated in jsdom, so the resulting value is set directly).
    ta.setSelectionRange(2, 2);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    ta.value = 'a';
    fireEvent.input(ta, { target: { value: 'a' } });

    expect(note(id)).toBeDefined(); // the note survived
    expect(noteText(id)).toBe('a');
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument(); // still editing
  });

  it('TC-35: a double-click on an existing note edits it and creates no new note', async () => {
    await renderApp();
    const id = addNote(0, 0);
    const el = theNote();

    dblclick(el);

    expect(editor()).toBeInTheDocument();
    expect(hooks().getNotes()).toHaveLength(1);
    expect(note(id)).toBeDefined();
  });

  it('TC-36: Enter while nothing is selected creates nothing and edits nothing', async () => {
    await renderApp();

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
  });

  it('TC-38: typing then clicking outside ends editing, unselects, and keeps the text', async () => {
    await renderApp();
    const id = addNote(0, 0);
    const el = theNote();
    dblclick(el);
    const ta = editor();
    typeIntoEditor(ta, 'abc');

    // Click outside the note, on the empty board.
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 500, clientY: 500, bubbles: true });
    fireEvent.pointerUp(vp, { pointerId: 1, clientX: 500, clientY: 500, bubbles: true });

    expect(screen.queryByTestId('sticky-editor')).not.toBeInTheDocument();
    expect(noteText(id)).toBe('abc');
    expect(el).not.toHaveAttribute('data-selected');
  });

  it('the counter appears within the threshold and shows length/limit', async () => {
    await renderApp();
    addNote(0, 0);
    const el = theNote();
    dblclick(el);
    const ta = editor();

    // 950 chars => exactly STICKY_COUNTER_THRESHOLD_CHARS (50) remaining.
    typeIntoEditor(ta, 'x'.repeat(STICKY_TEXT_MAX_CHARS - 50));
    const counter = screen.queryByTestId('sticky-counter');
    expect(counter).toBeInTheDocument();
    expect(counter!.textContent).toBe(`${STICKY_TEXT_MAX_CHARS - 50}/${STICKY_TEXT_MAX_CHARS}`);
  });
});

// Click the note, type via the editor, and end editing with Escape so the
// note holds the given text in its Y.Text.
function typeIntoEditorByClick(id: string, text: string): void {
  const el = theNote();
  click(el);
  dblclick(el);
  const ta = editor();
  typeIntoEditor(ta, text);
  fireEvent.keyDown(ta, { key: 'Escape' });
  expect(noteText(id)).toBe(text);
}
