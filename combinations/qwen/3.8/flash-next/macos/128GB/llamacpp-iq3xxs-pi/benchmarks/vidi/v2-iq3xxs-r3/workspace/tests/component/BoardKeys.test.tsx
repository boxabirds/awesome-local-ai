/**
 * TC-27 to TC-31 (story 7, sel.keyboard): the keyboard's four commands on a
 * selection — select all, clear, nudge, delete.
 *
 * `defaultPrevented` matters in most of these: a browser whose Ctrl+A selects the
 * page's text, or whose arrow keys scroll the window, has taken the keystroke away
 * from the board. The camera is checked alongside the arrow keys because "the
 * board did not pan" is the other half of that promise, and an unrelated pan mid
 * nudge would be a second bug the keystroke could cause.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import {
  addNote,
  clickNote,
  dispatchKey,
  noteById,
  readCamera,
  readNote,
  readNotes,
  renderStickyBoard,
  selectedIds,
  setCamera,
} from './helpers/board';

let doc: YDoc;

/** A board with three notes, so "all", "some" and "none of them" can be told. */
function boardWithNotes(): { a: string; b: string; c: string } {
  doc = new Doc();
  renderStickyBoard(doc);
  // A camera at its origin, so the view the arrow keys leave behind is described
  // in the same numbers as the world coordinates above.
  setCamera({ x: 0, y: 0, zoom: 1 });
  const [a = '', b = '', c = ''] = [
    addNote(doc, { x: 100, y: 100, text: 'A' }),
    addNote(doc, { x: 500, y: 100, text: 'B' }),
    addNote(doc, { x: 100, y: 500, text: 'C' }),
  ];
  return { a, b, c };
}

/** Select two of the three notes, leaving `c` behind. */
function selectTwo(a: string, b: string): void {
  clickNote(doc, a);
  clickNote(doc, b, { shift: true });
  expect(selectedIds()).toEqual([a, b].sort());
}

afterEach(cleanup);

describe('select all and clear (TC-27, TC-28)', () => {
  it('TC-27: Ctrl+A takes the whole board, and Escape lets it go', () => {
    const { a, b, c } = boardWithNotes();
    clickNote(doc, a);

    const event = dispatchKey({ key: 'a', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([a, b, c].sort());
    expect(screen.getByTestId('selection-bar').dataset.count).toBe('3');

    // Ctrl+A means the board's objects, not the page's text: the browser's own
    // select-all is prevented here rather than fought afterwards.
    dispatchKey({ key: 'Escape' });
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-28: Ctrl+A on an empty board selects nothing and stays quiet', () => {
    doc = new Doc();
    renderStickyBoard(doc);

    const event = dispatchKey({ key: 'a', ctrlKey: true });
    // There is nothing to select, but the keystroke is still the board's.
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('the Mac command key selects all too', () => {
    const { a, b, c } = boardWithNotes();
    dispatchKey({ key: 'a', metaKey: true });
    expect(selectedIds()).toEqual([a, b, c].sort());
  });
});

describe('nudging a selection (TC-29)', () => {
  it('an arrow moves every selected object by one step, and Shift by ten', () => {
    const { a, b, c } = boardWithNotes();
    selectTwo(a, b);
    const before = { a: readNote(doc, a)!, b: readNote(doc, b)!, c: readNote(doc, c)! };
    const cameraBefore = readCamera();

    const right = dispatchKey({ key: 'ArrowRight' });
    expect(right.defaultPrevented).toBe(true);
    const shifted = dispatchKey({ key: 'ArrowUp', shiftKey: true });
    expect(shifted.defaultPrevented).toBe(true);

    const after = { a: readNote(doc, a)!, b: readNote(doc, b)!, c: readNote(doc, c)! };
    // Both steps in one go: one unit, then ten, on the other axis.
    expect(after.a.x).toBe(before.a.x + NUDGE_STEP_WORLD);
    expect(after.b.x).toBe(before.b.x + NUDGE_STEP_WORLD);
    expect(after.a.y).toBe(before.a.y - NUDGE_LARGE_STEP_WORLD);
    expect(after.b.y).toBe(before.b.y - NUDGE_LARGE_STEP_WORLD);
    // What was not selected stayed, and so did the view.
    expect(after.c.x).toBe(before.c.x);
    expect(after.c.y).toBe(before.c.y);
    expect(readCamera()).toEqual(cameraBefore);
  });

  it('arrows without a selection are left alone, and the view does not move', () => {
    const { a } = boardWithNotes();
    const cameraBefore = readCamera();

    const before = readNote(doc, a)!;
    const event = dispatchKey({ key: 'ArrowRight' });
    expect(event.defaultPrevented).toBe(false);
    expect(readNote(doc, a)!.x).toBe(before.x);
    expect(readCamera()).toEqual(cameraBefore);
  });
});

describe('deleting (TC-30, TC-31)', () => {
  it('TC-31: Delete removes every selected object at once and clears the selection', () => {
    const { a, b, c } = boardWithNotes();
    selectTwo(a, b);

    const event = dispatchKey({ key: 'Delete' });
    expect(event.defaultPrevented).toBe(true);
    const left = readNotes(doc).map((note) => note.id);
    expect(left).toEqual([c]);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('Backspace does the same, and neither reaches a note being edited', () => {
    const { a, b, c } = boardWithNotes();
    clickNote(doc, a);
    expect(selectedIds()).toEqual([a]);

    // Enter opens the text editor; from there Backspace is typing, not deleting.
    dispatchKey({ key: 'Enter' });
    const editor = screen.getByTestId('sticky-textarea');
    expect(document.activeElement).toBe(editor);
    const typed = dispatchKey({ key: 'Backspace' }, editor);
    expect(typed.defaultPrevented).toBe(false);

    // The note is still there, still open, and so are the other two.
    expect(readNotes(doc)).toHaveLength(3);
    expect(screen.getByTestId('sticky-textarea')).not.toBeNull();
    expect(noteById(a)).not.toBeNull();
    expect(noteById(b)).not.toBeNull();
    expect(noteById(c)).not.toBeNull();

    // Escape belongs to the editor while one is open: it stops the editing and
    // leaves the note selected, so deleting afterwards is the same keystroke.
    dispatchKey({ key: 'Escape' }, editor);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(selectedIds()).toEqual([a]);
    dispatchKey({ key: 'Backspace' });
    expect(readNotes(doc).map((note) => note.id).sort()).toEqual([b, c].sort());
  });
});
