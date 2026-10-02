import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import type { Vidi6TestHooks } from '../../src/client/canvas/testHooks';
import type { StickySnapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, SHORT_NOTE, prose } from '../fixtures/texts';

function hooks(): Vidi6TestHooks {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks are not registered');
  return h;
}

const objects = (): readonly StickySnapshot[] => hooks().getObjects();
const selection = () => hooks().getSelection();

function noteEl(id?: string): HTMLElement {
  const els = screen.getAllByTestId('sticky-note');
  if (!id) return els[els.length - 1]!;
  const el = els.find((e) => e.getAttribute('data-note-id') === id);
  if (!el) throw new Error(`note element ${id} is not rendered`);
  return el;
}

function editorEl(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
}

function dblClickBoard(x: number, y: number): string {
  fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: x, clientY: y });
  const all = objects();
  return all[all.length - 1]!.id;
}

function emptyClick(x = 20, y = 20): void {
  fireEvent.pointerDown(screen.getByTestId('board-viewport'), { clientX: x, clientY: y, pointerId: 9 });
  fireEvent.pointerUp(screen.getByTestId('board-viewport'), { clientX: x, clientY: y, pointerId: 9 });
}

function selectNote(id: string): void {
  const el = noteEl(id);
  fireEvent.pointerDown(el, { clientX: 350, clientY: 250, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 350, clientY: 250, pointerId: 1 });
}

/** Create a note, type text into it, and leave it selected but not editing. */
function createNoteWithText(text: string, x = 300, y = 200): string {
  const id = dblClickBoard(x, y);
  fireEvent.input(editorEl(), { target: { value: text } });
  fireEvent.keyDown(editorEl(), { key: 'Escape' });
  return id;
}

describe('sticky.text: start and end editing', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-23: Enter on a selected note starts editing with the caret at the end', () => {
    const id = createNoteWithText(SHORT_NOTE);
    expect(selection()).toEqual({ selectedId: id, editingId: null });

    selectNote(id);
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(selection().editingId).toBe(id);
    const editor = editorEl();
    expect(editor.value).toBe(SHORT_NOTE);
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(SHORT_NOTE.length);
    expect(editor.selectionEnd).toBe(SHORT_NOTE.length);
  });

  it('TC-24: Escape ends editing and keeps the text', () => {
    const id = dblClickBoard(300, 200);
    fireEvent.input(editorEl(), { target: { value: 'Faster onboarding' } });

    fireEvent.keyDown(editorEl(), { key: 'Escape' });

    expect(selection()).toEqual({ selectedId: id, editingId: null });
    expect(objects()[0]!.text).toBe('Faster onboarding');
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(screen.getByTestId('sticky-text').textContent).toBe('Faster onboarding');
  });

  it('TC-38: typing then clicking outside keeps the text and clears the selection', () => {
    const id = dblClickBoard(300, 200);
    fireEvent.input(editorEl(), { target: { value: 'abc' } });

    emptyClick();

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(objects()[0]!.text).toBe('abc');
    expect(selection()).toEqual({ selectedId: null, editingId: null });
  });

  it('typing writes to the document on every input event, not only on blur', () => {
    const id = dblClickBoard(300, 200);
    const editor = editorEl();

    fireEvent.input(editor, { target: { value: 'One' } });
    expect(objects()[0]!.text).toBe('One');
    fireEvent.input(editor, { target: { value: 'One two' } });
    expect(objects()[0]!.text).toBe('One two');

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(objects()[0]!.text).toBe('One two');
  });

  it('Enter inside a note adds a new line instead of ending editing', () => {
    const id = dblClickBoard(300, 200);
    const editor = editorEl();
    fireEvent.input(editor, { target: { value: 'Line one\nLine two' } });

    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(selection().editingId).toBe(id);
    expect(objects()[0]!.text).toBe('Line one\nLine two');
  });

  it('Escape in the note does not reach the board keyboard handler', () => {
    const id = createNoteWithText('draft');
    selectNote(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(selection().editingId).toBe(id);

    fireEvent.keyDown(editorEl(), { key: 'Escape' });
    expect(selection()).toEqual({ selectedId: id, editingId: null });
  });
});

describe('sticky.text: length limit and counter', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-14 (component part): pasting 1,200 characters keeps exactly 1,000 and shows 1000/1000', () => {
    dblClickBoard(300, 200);
    const editor = editorEl();

    fireEvent.input(editor, { target: { value: PROSE_1200 } });

    expect(objects()[0]!.text).toBe(PROSE_1000);
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const counter = screen.getByTestId('char-counter');
    expect(counter.textContent).toBe('1000/1000');
  });

  it('TC-17 (component part): the counter appears at 950 characters and not before', () => {
    dblClickBoard(300, 200);
    const editor = editorEl();

    fireEvent.input(editor, { target: { value: prose(949) } });
    expect(screen.queryByTestId('char-counter')).toBeNull();

    fireEvent.input(editor, { target: { value: prose(950) } });
    expect(screen.getByTestId('char-counter').textContent).toBe('950/1000');

    fireEvent.input(editor, { target: { value: prose(951) } });
    expect(screen.getByTestId('char-counter').textContent).toBe('951/1000');
  });

  it('TC-16 (component part): typing beyond the limit adds nothing', () => {
    dblClickBoard(300, 200);
    const editor = editorEl();

    fireEvent.input(editor, { target: { value: PROSE_1000 } });
    fireEvent.input(editor, { target: { value: PROSE_1000 + 'overflowing text' } });

    expect(objects()[0]!.text).toBe(PROSE_1000);
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-26: Backspace while editing edits text and does not delete the note', () => {
    const id = dblClickBoard(300, 200);
    const editor = editorEl();
    fireEvent.input(editor, { target: { value: 'ab' } });

    // The browser handles the key; the note must survive it.
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(objects().map((n) => n.id)).toEqual([id]);

    // The browser then reports the edited value.
    fireEvent.input(editor, { target: { value: 'a' } });

    expect(objects()).toHaveLength(1);
    expect(objects()[0]!.text).toBe('a');
    expect(selection().editingId).toBe(id);
  });

  it('Delete while editing does not remove the note', () => {
    const id = dblClickBoard(300, 200);
    const editor = editorEl();
    fireEvent.input(editor, { target: { value: 'keep' } });

    fireEvent.keyDown(editor, { key: 'Delete' });

    expect(objects().map((n) => n.id)).toEqual([id]);
    expect(objects()[0]!.text).toBe('keep');
  });
});

describe('sticky.text: IME composition', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('composition is written once, on compositionend, not as intermediate text', () => {
    dblClickBoard(300, 200);
    const editor = editorEl();

    fireEvent.compositionStart(editor);
    fireEvent.input(editor, { target: { value: 'か' } });
    expect(objects()[0]!.text).toBe('');

    fireEvent.input(editor, { target: { value: 'かな' } });
    expect(objects()[0]!.text).toBe('');

    fireEvent.compositionEnd(editor, { target: { value: 'かな' } });
    expect(objects()[0]!.text).toBe('かな');
  });
});

describe('sticky.text: pasting', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-14 + TC-16: pasting 1,200 characters keeps the first 1,000 and the counter reads 1000/1000', () => {
    dblClickBoard(300, 200);
    // A paste arrives as one input event holding the whole clipboard text.
    fireEvent.input(editorEl(), { target: { value: PROSE_1200 } });

    const text = objects()[0]!.text;
    expect(text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(text).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(screen.getByTestId('char-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('TC-15: a note at 999 characters accepts one more character', () => {
    dblClickBoard(300, 200);
    fireEvent.input(editorEl(), { target: { value: PROSE_1000.slice(0, 999) } });
    fireEvent.input(editorEl(), { target: { value: PROSE_1000 } });

    expect(objects()[0]!.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId('char-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });
});
