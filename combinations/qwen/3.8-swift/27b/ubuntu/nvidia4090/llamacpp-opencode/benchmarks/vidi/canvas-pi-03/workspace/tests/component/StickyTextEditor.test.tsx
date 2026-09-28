import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { snapshot, getStickyText } from 'src/shared/board-model';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

async function createNoteByDblClick() {
  const viewport = screen.getByTestId('board-viewport');
  fireEvent.doubleClick(viewport, { clientX: 0, clientY: 0 });
  return screen.getAllByTestId('sticky-note');
}

describe('sticky.text (component)', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-23: Enter on a selected note starts editing with the caret at the end', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'ab');
    await user.keyboard('{Escape}'); // ends editing → selected, text 'ab'
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();

    fireEvent.keyDown(window, { key: 'Enter' });

    const textarea = screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('ab');
    expect(textarea.selectionStart).toBe(2); // caret at end
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-24: Escape ends editing as selected and preserves the text', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'abc');
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(snapshot(getDoc())[0].text).toBe('abc');
    expect(note.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-26: Backspace while editing deletes a character, not the note', async () => {
    const user = userEvent.setup();
    await createNoteByDblClick();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'ab');
    await user.type(screen.getByTestId('sticky-note-textarea'), '{Backspace}');

    expect(snapshot(getDoc())).toHaveLength(1);
    expect(snapshot(getDoc())[0].text).toBe('a');
  });

  it('TC-38: typing then clicking outside unmounts the editor, keeps the text, deselects', async () => {
    const user = userEvent.setup();
    const [note] = await createNoteByDblClick();
    await user.type(screen.getByTestId('sticky-note-textarea'), 'abc');

    const id = snapshot(getDoc())[0].id;
    await user.click(screen.getByTestId('board-viewport'));

    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(getStickyText(getDoc(), id)!.toString()).toBe('abc');
    expect(snapshot(getDoc())[0].text).toBe('abc');
    expect(note.hasAttribute('data-selected')).toBe(false);
  });

  it('the counter appears within 50 characters of the limit and shows n/1000', async () => {
    const user = userEvent.setup({ delay: 0 });
    await createNoteByDblClick();
    const textarea = screen.getByTestId('sticky-note-textarea');

    expect(screen.queryByTestId('sticky-char-counter')).toBeNull();

    // 950 chars → remaining 50 → visible; content 949 chars first to check the boundary
    await user.clear(textarea);
    await user.type(textarea, 'a'.repeat(949));
    expect(screen.queryByTestId('sticky-char-counter')).toBeNull();
    await user.type(textarea, 'a');
    const counter = screen.getByTestId('sticky-char-counter');
    expect(counter.textContent).toBe('950/1000');
  });

  it('pasting past the limit keeps exactly 1000 characters (1000/1000 shown)', async () => {
    await createNoteByDblClick();
    const textarea = screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement;

    const long = 'a'.repeat(1200);
    // jsdom has no ClipboardEvent; use a plain Event with clipboardData attached.
    // Dispatch directly (not via fireEvent, which re-wraps the event in jsdom
    // and drops the attached property).
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => long, setData: () => undefined },
    });
    act(() => {
      textarea.dispatchEvent(event);
    });

    expect(textarea.value.length).toBe(1000);
    expect(snapshot(getDoc())[0].text.length).toBe(1000);
    expect(screen.getByTestId('sticky-char-counter').textContent).toBe('1000/1000');
  });
});
