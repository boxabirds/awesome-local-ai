import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  addNote,
  act,
  clickEmptyBoard,
  fireEvent,
  flushFrames,
  noteById,
  noteElements,
  press,
  release,
  renderBoard,
  screen,
  textOf,
} from './stickyHarness';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { SHORT_PHRASE, PROSE_1200 } from '../fixtures/texts';

function editor(): HTMLTextAreaElement {
  const el = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
  return el;
}

function selectNote(id: string, at: { x: number; y: number } = { x: 300, y: 300 }): void {
  press(noteById(id), at.x, at.y);
  release(noteById(id), at.x, at.y);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sticky.text start and finish editing', () => {
  // TC-23
  it('TC-23: Enter on a selected note starts editing with the caret at the end', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    act(() => {
      getStickyText(doc, id)!.insert(0, SHORT_PHRASE);
    });

    selectNote(id);
    fireEvent.keyDown(document.body, { key: 'Enter' });

    const ta = editor();
    expect(noteById(id).dataset.editing).toBe('true');
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe(SHORT_PHRASE);
    expect(ta.selectionStart).toBe(SHORT_PHRASE.length);
    expect(ta.selectionEnd).toBe(SHORT_PHRASE.length);
  });

  // TC-24
  it('TC-24: Escape ends editing and keeps the text', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });

    await user.dblClick(noteById(id));
    await user.type(ta(), 'Keep my idea');

    expect(textOf(doc, id)).toBe('Keep my idea');

    await user.keyboard('{Escape}');

    expect(noteById(id).dataset.editing).toBe('false');
    expect(noteById(id).dataset.selected).toBe('true');
    expect(textOf(doc, id)).toBe('Keep my idea');
    expect(screen.getByTestId('sticky-note-text')).toHaveTextContent('Keep my idea');
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  // TC-38
  it('TC-38: clicking outside commits the text, closes the editor and deselects', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });

    await user.dblClick(noteById(id));
    await user.type(ta(), 'abc');
    expect(textOf(doc, id)).toBe('abc');

    // Click on empty board space.
    clickEmptyBoard(20, 20);
    await flushFrames();

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(textOf(doc, id)).toBe('abc');
    expect(noteById(id).dataset.selected).toBe('false');
    expect(noteById(id).dataset.editing).toBe('false');
  });

  it('flushes the typed value on blur so nothing is lost', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    await user.type(ta(), 'draft');

    fireEvent.blur(ta());

    expect(textOf(doc, id)).toBe('draft');
    expect(snapshot(doc)[0].text).toBe('draft');
  });

  it('Enter inside the note adds a new line instead of ending editing', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    await user.type(ta(), 'line one\nline two');

    expect(textOf(doc, id)).toBe('line one\nline two');
    expect(noteById(id).dataset.editing).toBe('true');
  });
});

describe('sticky.text limit while editing', () => {
  it('drops characters past 1,000 when typing and keeps the caret in the text', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    const el = ta();
    act(() => {
      getStickyText(doc, id)!.insert(0, 'x'.repeat(STICKY_TEXT_MAX_CHARS - 1));
    });
    // Re-open the editor so it starts from the current text.
    await user.keyboard('{Escape}');
    await user.dblClick(noteById(id));
    expect(editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);

    await user.type(editor(), 'ab');

    expect(textOf(doc, id)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('shows 1000/1000 after a 1,200 character paste and keeps only the first 1,000', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));

    expect(screen.queryByTestId('sticky-char-counter')).not.toBeInTheDocument();

    await user.paste(PROSE_1200);
    await flushFrames();

    expect(textOf(doc, id)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(textOf(doc, id)).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    const counter = screen.getByTestId('sticky-char-counter');
    expect(counter).toHaveTextContent(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('stays hidden while more than 50 characters remain', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));

    await user.paste('a'.repeat(949));
    expect(screen.queryByTestId('sticky-char-counter')).not.toBeInTheDocument();

    await user.paste('a'.repeat(2));
    expect(screen.getByTestId('sticky-char-counter')).toHaveTextContent('951/1000');
  });
});

describe('sticky.text keyboard deletes characters, not the note', () => {
  // TC-26
  it("TC-26: Backspace while editing 'ab' deletes a character and keeps the note", async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    await user.type(ta(), 'ab');
    expect(textOf(doc, id)).toBe('ab');

    await user.keyboard('{Backspace}');

    expect(noteElements()).toHaveLength(1);
    expect(noteById(id)).toBeInTheDocument();
    expect(textOf(doc, id)).toBe('a');
    expect(noteById(id).dataset.editing).toBe('true');
  });

  it('Delete while editing deletes the character under the caret, not the note', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    await user.type(ta(), 'abc');
    // Caret at index 1, then Delete removes 'b'.
    const el = editor();
    el.setSelectionRange(1, 1);
    await user.keyboard('{Delete}');

    expect(noteElements()).toHaveLength(1);
    expect(textOf(doc, id)).toBe('ac');
  });

  it('ends editing on a board click; selecting the note again lets Delete remove it', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    await user.dblClick(noteById(id));
    await user.type(ta(), 'idea');

    clickEmptyBoard(15, 15);
    await flushFrames();
    expect(noteElements()).toHaveLength(1);
    expect(noteById(id).dataset.editing).toBe('false');
    expect(noteById(id).dataset.selected).toBe('false');

    // Delete does nothing while nothing is selected, and removes it once it is.
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(noteElements()).toHaveLength(1);

    selectNote(id);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(noteElements()).toHaveLength(0);
  });
});

/** The live textarea (kept next to the user's typing). */
function ta(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
}
