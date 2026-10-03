// The multi-object selection bar and outlines (sel.interaction, ui-component).
//
// A selection of two or more objects shows a single floating bar ("N selected" +
// Delete) and outlines every selected object; one object shows its own toolbar
// instead; and a remote delete prunes the selection (hiding the bar when the last
// object goes). These render the real board against a real Y.Doc and read the DOM.

import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import {
  boardDoc,
  clickNote,
  createNote,
  modelSnapshot,
  noteSelected,
  pointer,
  renderBoard,
  selectionBarEl,
  selectionCountText,
  shiftClickNote,
  surface,
} from './helpers';

describe('sel.interaction (ui-component)', () => {
  // TC-16: every selected object deleted by someone else → selection empty, bar gone.
  it('TC-16 hides the bar when a remote user deletes every selected object', () => {
    renderBoard();
    const ids = [createNote(0, 0), createNote(300, 0), createNote(600, 0)];
    // Select all three.
    clickNote(ids[0]!);
    shiftClickNote(ids[1]!);
    shiftClickNote(ids[2]!);
    expect(selectionBarEl()).not.toBeNull();

    // A colleague deletes all three (a remote delete: its own update, outside the
    // batch we watch). Our selection prunes itself and the bar disappears.
    act(() => {
      const objects = boardDoc().getMap('objects');
      for (const id of ids) objects.delete(id);
    });

    expect(selectionBarEl()).toBeNull();
    expect(screen.queryAllByTestId(/^sticky-note-./)).toHaveLength(0);
  });

  // TC-17: two selected → "2 selected" + a Delete action, announced politely.
  it('TC-17 shows "2 selected" and a Delete action with an aria-live count', () => {
    renderBoard();
    const a = createNote(0, 0);
    const b = createNote(300, 0);
    clickNote(a);
    shiftClickNote(b);

    const bar = selectionBarEl();
    expect(bar).not.toBeNull();
    expect(selectionCountText()).toBe('2 selected');
    // Both selected objects are outlined.
    expect(noteSelected(a)).toBe(true);
    expect(noteSelected(b)).toBe(true);
    // One Delete action for the whole selection.
    expect(within(bar!).getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    // The count lives in a polite live region so screen readers hear it change.
    const live = within(bar!).getByText('2 selected');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  // TC-18: exactly one selected shows the note's own toolbar, not the bar.
  it('TC-18 shows the sticky note toolbar instead of the bar for one object', () => {
    renderBoard();
    const a = createNote(0, 0);
    clickNote(a);

    expect(selectionBarEl()).toBeNull();
    const note = screen.getByTestId(`sticky-note-${a}`);
    // The note's own colour / delete toolbar is present, and it is *not* the bar.
    expect(within(note).getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  // TC-19: a plain click on empty board clears the selection (without panning it).
  it('TC-19 clears the selection on an empty-space click', () => {
    renderBoard();
    const a = createNote(0, 0);
    const b = createNote(300, 0);
    clickNote(a);
    shiftClickNote(b);
    expect(selectionBarEl()).not.toBeNull();

    // Press and release on the empty board surface without dragging.
    pointer(surface(), 'pointerdown', 900, 600);
    pointer(surface(), 'pointerup', 900, 600);

    expect(selectionBarEl()).toBeNull();
    expect(modelSnapshot()).toHaveLength(2); // nothing deleted
    expect(noteSelected(a)).toBe(false);
  });
});
