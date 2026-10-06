/**
 * sticky.text component tests (TC-23, TC-24, TC-26, TC-38): starting and ending text
 * editing, the caret position, and the rule that the keyboard edits text while a note is
 * being edited instead of deleting it.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, runFrames } from './helpers';
import { createSticky, getStickyText, type StickySnapshot } from '../../src/shared/board-model';
import { RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function notes(): readonly StickySnapshot[] {
  return window.__vidi6?.getNotes() ?? [];
}

function note(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

function textOf(id: string): string {
  return getStickyText(doc(), id)?.toString() ?? '';
}

async function addNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  return id;
}

async function selectNote(id: string): Promise<void> {
  const element = note(id);
  fireEvent.pointerDown(element, {
    pointerId: 3,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerUp(element, { pointerId: 3, clientX: 200, clientY: 200 });
  await runFrames();
}

function input(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-note-input') as HTMLTextAreaElement;
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

describe('sticky.text.editing', () => {
  test('TC-23 Enter on a selected note starts editing with the caret at the end', async () => {
    renderBoard();
    const id = await addNote();
    await act(() => {
      getStickyText(doc(), id)?.insert(0, SHORT_NOTE);
    });
    await selectNote(id);
    expect(note(id)).toHaveAttribute('data-selected', 'true');

    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    const editor = input();
    expect(editor).toHaveFocus();
    expect(editor.value).toBe(SHORT_NOTE);
    expect(editor.selectionStart).toBe(SHORT_NOTE.length);
    expect(editor.selectionEnd).toBe(SHORT_NOTE.length);
  });

  test('TC-24 Escape ends editing and keeps the text, the note stays selected', async () => {
    renderBoard();
    const id = await addNote();
    await selectNote(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    type(RETRO_ITEM);
    await runFrames();
    expect(textOf(id)).toBe(RETRO_ITEM);

    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(textOf(id)).toBe(RETRO_ITEM);
    expect(note(id)).toHaveAttribute('data-selected', 'true');
    // the display shows the text that was typed
    expect(note(id).textContent).toBe(RETRO_ITEM);
  });

  test('TC-26 Backspace while editing edits text and never deletes the note', async () => {
    renderBoard();
    const id = await addNote();
    await selectNote(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    type('ab');
    await runFrames();
    fireEvent.keyDown(input(), { key: 'Backspace' });
    fireEvent.change(input(), { target: { value: 'a' } }); // what a browser does after Backspace
    await runFrames();

    expect(notes().map((item) => item.id)).toEqual([id]);
    expect(textOf(id)).toBe('a');
    expect(input()).toHaveFocus();
  });

  test('TC-38 typing then clicking outside stores the text and deselects', async () => {
    renderBoard();
    const id = await addNote();
    await selectNote(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    type('a');
    type('ab');
    type('abc');
    await runFrames();
    expect(textOf(id)).toBe('abc');

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, {
      pointerId: 4,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 950,
      clientY: 700,
    });
    fireEvent.pointerUp(viewport, { pointerId: 4, clientX: 950, clientY: 700 });
    await runFrames();

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(textOf(id)).toBe('abc');
    expect(note(id)).not.toHaveAttribute('data-selected');
  });

  test('a blank note keeps its empty text and shows no placeholder', async () => {
    renderBoard();
    const id = await addNote();
    await selectNote(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('   ');
    await runFrames();

    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    expect(notes()).toHaveLength(1);
    expect(textOf(id)).toBe('   ');
    expect(note(id).textContent).toBe('   ');
  });

  test('the counter appears only near the 1,000 character limit', async () => {
    renderBoard();
    const id = await addNote();
    await selectNote(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    type('x'.repeat(949));
    await runFrames();
    expect(screen.queryByTestId('note-counter')).toBeNull();

    type('x'.repeat(950));
    await runFrames();
    expect(screen.getByTestId('note-counter')).toHaveTextContent('950/1000');

    // a paste over the limit is cut, and the counter shows the limit
    type('x'.repeat(1200));
    await runFrames();
    expect(textOf(id)).toHaveLength(1000);
    expect(input().value).toHaveLength(1000);
    expect(screen.getByTestId('note-counter')).toHaveTextContent('1000/1000');
  });
});
