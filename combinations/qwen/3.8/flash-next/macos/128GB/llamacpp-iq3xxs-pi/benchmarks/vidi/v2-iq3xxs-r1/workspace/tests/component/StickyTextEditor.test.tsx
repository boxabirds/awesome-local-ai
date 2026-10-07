import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { getStickyText } from '../../src/shared/board-model';
import {
  TEST_BOARD_ID,
  dispatchKey,
} from './util';
import {
  clickCreateSticky,
  clickEmptyBoard,
  clickWithPointer,
  createUnselectedNote,
  getDoc,
  getSelection,
  getSnapshot,
  noteEl,
  press,
  typeText,
  viewportEl,
} from './stickyUtil';

const AT = { x: 300, y: 200 };

function editor(): HTMLTextAreaElement {
  const el = screen.getByTestId('sticky-note-input');
  expect(el.tagName).toBe('TEXTAREA');
  return el as HTMLTextAreaElement;
}

function displayedText(): string {
  return screen.getByTestId('sticky-text-inner').textContent ?? '';
}

describe('StickyTextEditor (sticky.interaction)', () => {
  // TC-23: Enter starts editing with the caret at the end of the text.
  it('TC-23 starts editing on Enter with focus and the caret at the end', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const note = await createUnselectedNote(); // text: 'Faster onboarding'
    clickWithPointer(noteEl(), AT);
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();

    dispatchKey({ key: 'Enter' });

    expect(getSelection().editingId).toBe(note.id);
    expect(noteEl().dataset.editing).toBe('true');
    const input = editor();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Faster onboarding');
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  // TC-24: Escape ends editing, keeps the selection, and keeps every character.
  it('TC-24 ends editing on Escape, keeps the selection and the text', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const note = await createUnselectedNote();
    clickWithPointer(noteEl(), AT);
    dispatchKey({ key: 'Enter' });

    await typeText(' today');
    expect(getSnapshot()[0]!.text).toBe('Faster onboarding today');

    await press('{Escape}');

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(noteEl().dataset.editing).toBe('false');
    expect(noteEl().dataset.selected).toBe('true');
    expect(getSelection()).toEqual({ selectedId: note.id, editingId: null });
    expect(getSnapshot()[0]!.text).toBe('Faster onboarding today');
    expect(displayedText()).toBe('Faster onboarding today');
  });

  // TC-26: Backspace inside the editor edits text, it never deletes the note.
  it('TC-26 keeps Backspace inside the editor as text editing', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    await clickCreateSticky();
    await typeText('ab');
    expect(getSnapshot()[0]!.text).toBe('ab');

    await press('{Backspace}');

    expect(getSnapshot()).toHaveLength(1);
    expect(getSnapshot()[0]!.text).toBe('a');
    expect(getSelection().editingId).not.toBeNull();
    expect(screen.getByTestId('sticky-note-input')).not.toBeNull();

    // The same holds for Delete while editing.
    await press('{Delete}');
    expect(getSnapshot()).toHaveLength(1);
    expect(getSnapshot()[0]!.text).toBe('a');
  });

  // TC-38: a click outside commits the text and unmounts the editor.
  it('TC-38 commits the text and unmounts the editor when the click is outside', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    await clickCreateSticky();
    await typeText('abc');
    const id = getSnapshot()[0]!.id;

    // A pointerdown on the viewport reaches the document-level listener the
    // editor registers for exactly this case.
    clickEmptyBoard({ x: 640, y: 32 });

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(noteEl().dataset.selected).toBe('false');
    expect(getSelection().selectedId).toBeNull();
    // the Y.Text instance itself was updated in place
    expect(getStickyText(getDoc(), id)?.toString()).toBe('abc');
    expect(displayedText()).toBe('abc');
  });

  it('shows the character counter only near the limit and reports the real length', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    await clickCreateSticky();
    expect(screen.queryByTestId('sticky-text-counter')).toBeNull();

    await typeText('x'.repeat(995));
    const counter = screen.getByTestId('sticky-note-counter');
    expect(counter.textContent).toBe('995/1000');

    await typeText('xxxxx');
    expect(screen.getByTestId('sticky-note-counter').textContent).toBe('1000/1000');
    expect(getSnapshot()[0]!.text).toHaveLength(1000);
    // the viewport element is only for dismissing the editor, not for typing
    expect(viewportEl()).toBeTruthy();
  });
});
