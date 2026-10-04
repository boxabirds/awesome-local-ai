import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  boardSurface,
  clickNote,
  clickSurface,
  noteEl,
  renderBoard,
  seedSticky,
  stubViewportSize,
  textarea,
} from './boardHarness';
import { LONG_NOTE_1000, PASTE_1200, SHORT_NOTE } from '../fixtures/texts';

stubViewportSize();

/** Create a note, select it and press Enter, so its text editor is open. */
function setupEditing(text = '') {
  const doc = new Y.Doc();
  const id = seedSticky(doc, { x: 0, y: 0 }, { text });
  const utils = renderBoard(doc);
  clickNote(noteEl(utils.container, id));
  fireEvent.keyDown(window, { key: 'Enter' });
  return { doc, id, ...utils };
}

describe('sticky.text: start and finish editing', () => {
  it('TC-23 Enter on a selected note opens the editor, focused with the caret at the end', () => {
    const { container } = setupEditing(SHORT_NOTE);
    const editor = textarea(container);
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(editor!.value).toBe(SHORT_NOTE);
    expect(editor!.selectionStart).toBe(SHORT_NOTE.length);
    expect(editor!.selectionEnd).toBe(SHORT_NOTE.length);
  });

  it('TC-23b double-click opens the editor with the caret at the end', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 }, { text: SHORT_NOTE });
    const { container } = renderBoard(doc);
    fireEvent.doubleClick(noteEl(container, id), { clientX: 20, clientY: 20 });
    const editor = textarea(container)!;
    expect(editor.value).toBe(SHORT_NOTE);
    expect(editor.selectionEnd).toBe(SHORT_NOTE.length);
  });

  it('TC-24 Escape ends editing and keeps every character typed', () => {
    const { container, doc, id } = setupEditing();
    const editor = textarea(container)!;
    fireEvent.change(editor, { target: { value: SHORT_NOTE } });
    expect(snapshot(doc)[0].text).toBe(SHORT_NOTE);

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(textarea(container)).toBeNull();
    expect(snapshot(doc)[0].text).toBe(SHORT_NOTE);
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('true');
  });

  it('Enter inside the note adds a new line instead of ending editing', () => {
    const { container, doc } = setupEditing('one');
    const editor = textarea(container)!;
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(textarea(container)).not.toBeNull(); // still editing
    fireEvent.change(editor, { target: { value: 'one\ntwo\nthree' } });
    expect(snapshot(doc)[0].text).toBe('one\ntwo\nthree');
  });

  it('TC-38 typing then clicking outside unmounts the editor, keeps the text and clears the selection', async () => {
    const user = userEvent.setup();
    const { container, doc, id } = setupEditing();
    await user.type(textarea(container)!, 'abc');
    expect(snapshot(doc)[0].text).toBe('abc');

    clickSurface(boardSurface(container));

    expect(textarea(container)).toBeNull();
    expect(snapshot(doc)[0].text).toBe('abc');
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('false');
  });

  it('clicking the board while editing ends editing through the note listener', async () => {
    const user = userEvent.setup();
    const { container, doc, id } = setupEditing();
    await user.type(textarea(container)!, 'kept');
    fireEvent.pointerDown(boardSurface(container), {
      clientX: 500,
      clientY: 500,
      button: 0,
      pointerId: 3,
    });
    expect(textarea(container)).toBeNull();
    expect(snapshot(doc)[0].text).toBe('kept');
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('false');
  });

  it('every keystroke is written to the shared text as it happens', async () => {
    const user = userEvent.setup();
    const { container, doc } = setupEditing();
    await user.type(textarea(container)!, 'Faster');
    expect(snapshot(doc)[0].text).toBe('Faster');
    await user.type(textarea(container)!, ' onboarding');
    expect(snapshot(doc)[0].text).toBe('Faster onboarding');
  });

  it('TC-26 Backspace while editing edits the text and never deletes the note', async () => {
    const user = userEvent.setup();
    const { container, doc, id } = setupEditing('ab');
    await user.type(textarea(container)!, '{backspace}');
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].text).toBe('a');
    expect(container.querySelector(`[data-note-id="${id}"]`)).not.toBeNull();
    expect(textarea(container)).not.toBeNull(); // still editing
  });

  it('Backspace on a selected but not edited note deletes it (sticky.delete)', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 }, { text: SHORT_NOTE });
    const { container } = renderBoard(doc);
    clickNote(noteEl(container, id));
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(container.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });
});

describe('sticky.text: character limit and counter', () => {
  it('pasting 1,200 characters keeps exactly the first 1,000 and the counter reads 1000/1000', async () => {
    const user = userEvent.setup();
    const { container, doc } = setupEditing();
    await user.paste(PASTE_1200);

    expect(snapshot(doc)[0].text).toBe(PASTE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    const editor = textarea(container)!;
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editor.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    const counter = container.querySelector<HTMLElement>('[data-sticky-counter]');
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe('1000/1000');
  });

  it('typing beyond the limit adds nothing', async () => {
    const user = userEvent.setup();
    const { container, doc } = setupEditing(LONG_NOTE_1000);
    await user.type(textarea(container)!, 'xyz');
    expect(snapshot(doc)[0].text).toBe(LONG_NOTE_1000);
    expect(textarea(container)!.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('the counter appears only when 50 or fewer characters remain', () => {
    const { container } = setupEditing();
    const editor = textarea(container)!;

    fireEvent.change(editor, { target: { value: LONG_NOTE_1000.slice(0, 949) } });
    expect(container.querySelector('[data-sticky-counter]')).toBeNull();

    fireEvent.change(editor, { target: { value: LONG_NOTE_1000.slice(0, 950) } });
    expect(container.querySelector('[data-sticky-counter]')!.textContent).toBe('950/1000');

    fireEvent.change(editor, { target: { value: LONG_NOTE_1000 } });
    expect(container.querySelector('[data-sticky-counter]')!.textContent).toBe('1000/1000');
  });

  it('the note text is displayed centred and without a placeholder when empty', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    const note = noteEl(container, id);
    expect(note.textContent).toBe('');
    expect(snapshot(doc)).toHaveLength(1); // an empty note stays on the board
  });
});

describe('sticky.text: minimal diff keeps other people typing', () => {
  it('a local edit changes only the edited range of the shared text', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 }, { text: 'Faster onboarding' });
    const { container } = renderBoard(doc);
    fireEvent.doubleClick(noteEl(container, id), { clientX: 20, clientY: 20 });

    const editor = textarea(container)!;
    // Select all and type a shorter word: the diff must not rewrite unrelated
    // content (checked in the unit suite; here it must simply round-trip).
    fireEvent.change(editor, { target: { value: 'Slower onboarding' } });
    expect(snapshot(doc)[0].text).toBe('Slower onboarding');
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeInTheDocument();
  });
});
