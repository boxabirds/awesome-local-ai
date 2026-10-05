import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import {
  clickNote,
  noteEl,
  renderBoard,
  seedSticky,
  selectedIds,
  shiftClickAt,
  stubViewportSize,
  textarea,
} from './boardHarness';

stubViewportSize();

/** Send a real key event at the window and report whether the board consumed it. */
function pressWindow(key: string, modifiers: Record<string, boolean> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function positions(doc: Y.Doc): Map<string, { x: number; y: number }> {
  return new Map(snapshot(doc).map((note) => [note.id, { x: note.x, y: note.y }]));
}

/**
 * Story 7, sel.keyboard: the board answers select-all, clear, nudge and delete,
 * and stays out of the way of anything the keyboard already belongs to.
 */
describe('selection keyboard commands (sel.keyboard)', () => {
  it('TC-27 Ctrl+A selects every object and takes the key', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 400, y: 0 });
    const c = seedSticky(doc, { x: 800, y: 0 });
    const { container } = renderBoard(doc);

    const prevented = pressWindow('a', { ctrlKey: true });

    expect(prevented).toBe(true);
    expect(selectedIds(container)).toEqual([a, b, c].sort());
    expect(container.querySelector('[data-selection-count]')?.textContent).toBe('3 selected');
  });

  it('TC-27 the Command key does the same on a Mac keyboard', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    pressWindow('a', { metaKey: true });
    expect(selectedIds(container)).toEqual([a]);
  });

  it('TC-27 the plain letter is left to the browser', () => {
    const doc = new Y.Doc();
    seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    expect(pressWindow('a')).toBe(false);
    expect(selectedIds(container)).toEqual([]);
  });

  it('TC-28 Ctrl+A on an empty board selects nothing and complains about nothing', () => {
    const doc = new Y.Doc();
    const { container } = renderBoard(doc);

    expect(pressWindow('a', { ctrlKey: true })).toBe(true);
    expect(selectedIds(container)).toEqual([]);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(container.querySelector('[data-selection-live]')?.textContent).toBe('Selection cleared');
  });

  it('TC-29 arrow keys nudge the whole selection, Shift for the long step', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 400, y: 0 });
    const away = seedSticky(doc, { x: 0, y: 900 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));

    let before = positions(doc);
    expect(pressWindow('ArrowRight')).toBe(true);
    let now = positions(doc);
    for (const id of [a, b]) {
      expect(now.get(id)!.x).toBeCloseTo(before.get(id)!.x + NUDGE_STEP_WORLD, 6);
      expect(now.get(id)!.y).toBeCloseTo(before.get(id)!.y, 6);
    }
    // The unselected note is not part of the nudge.
    expect(now.get(away)).toEqual(before.get(away));

    before = positions(doc);
    expect(pressWindow('ArrowUp', { shiftKey: true })).toBe(true);
    now = positions(doc);
    for (const id of [a, b]) {
      expect(now.get(id)!.x).toBeCloseTo(before.get(id)!.x, 6);
      expect(now.get(id)!.y).toBeCloseTo(before.get(id)!.y - NUDGE_LARGE_STEP_WORLD, 6);
    }
  });

  it('TC-29 arrows without a selection are left alone, so the page can still scroll', () => {
    const doc = new Y.Doc();
    seedSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0].x;

    expect(pressWindow('ArrowRight')).toBe(false);
    expect(snapshot(doc)[0].x).toBe(before);
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 400, y: 0 });
    const kept = seedSticky(doc, { x: 800, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));

    expect(pressWindow('Delete')).toBe(true);
    expect(snapshot(doc).map((note) => note.id)).toEqual([kept]);
    expect(selectedIds(container)).toEqual([]);
    expect(container.querySelector('[data-selection-live]')?.textContent).toBe('Selection cleared');
  });

  it('Backspace deletes a selection too', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 }, { text: 'Hello' });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    expect(pressWindow('Backspace')).toBe(true);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-30 Backspace inside the editor edits the text and keeps the object', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 }, { text: 'Hello' });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    fireEvent.doubleClick(noteEl(container, a));
    const editor = textarea(container)!;
    expect(editor).toBeTruthy();

    // The caret owns these keys: the note must survive, and so must the edit.
    fireEvent.keyDown(editor, { key: 'Backspace' });
    fireEvent.keyDown(editor, { key: 'Delete' });
    expect(snapshot(doc).map((note) => note.id)).toEqual([a]);
    expect(textarea(container)).toBeTruthy();

    // Typing still works while a selection is up.
    fireEvent.change(editor, { target: { value: 'Hell' } });
    expect(snapshot(doc)[0].text).toBe('Hell');
  });

  it('the shortcuts are silent while focus sits in a field of its own', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    clickNote(noteEl(container, a));

    const field = document.createElement('input');
    document.body.appendChild(field);
    try {
      fireEvent.keyDown(field, { key: 'Delete' });
      fireEvent.keyDown(field, { key: 'a', ctrlKey: true });
      fireEvent.keyDown(field, { key: 'ArrowRight' });
      expect(snapshot(doc).map((note) => note.id)).toEqual([a]);
      expect(selectedIds(container)).toEqual([a]);
    } finally {
      field.remove();
    }
  });

  it('Escape clears the selection', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    expect(pressWindow('Escape')).toBe(true);
    expect(selectedIds(container)).toEqual([]);
    // Nothing selected: Escape is not swallowed, so a dialog above the board
    // could still answer it.
    expect(pressWindow('Escape')).toBe(false);
  });

  it('Enter still opens the text of a single selected note', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 }, { text: 'Hello' });
    const b = seedSticky(doc, { x: 400, y: 0 }, { text: 'Second' });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    pressWindow('Enter');
    expect(textarea(container)).toBeTruthy();

    // Close it the way a user does, then select two notes: Enter would not know
    // which one to open, so it opens nothing.
    fireEvent.keyDown(textarea(container)!, { key: 'Escape' });
    shiftClickAt(noteEl(container, b));
    expect(selectedIds(container)).toEqual([a, b].sort());
    pressWindow('Enter');
    expect(textarea(container)).toBeNull();
  });

  it('Enter belongs to a focused button instead of the board', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    clickNote(noteEl(container, a));

    const button = screen.getByRole('button', { name: 'Sticky note' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(textarea(container)).toBeNull();
    expect(snapshot(doc)).toHaveLength(1);
  });
});
