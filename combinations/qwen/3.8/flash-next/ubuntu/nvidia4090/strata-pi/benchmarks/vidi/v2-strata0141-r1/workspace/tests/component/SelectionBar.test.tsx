import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardElement,
  clickElement,
  createNote,
  deleteNote,
  docNotes,
  noteElement,
  noteToolbarElement,
  pointerAt,
  renderBoard,
  screenOf,
  selectionBarElement,
  selectionCount,
  selectionCountText,
} from './harness';

/**
 * `sel.interaction` in the rendered board (TC-16 to TC-19): a selection is a
 * set, it is announced, it is pruned when other people delete what this client
 * had selected, and clicking empty space empties it.
 *
 * A selection is per-client state and is never written to the Y.Doc, so every
 * test here reads the document back to prove that too.
 */

/** Where a note sits, so a test can press its middle without guessing. */
interface Placed {
  id: string;
  x: number;
  y: number;
}

/** Press the middle of a note placed at this world position. */
function pressNote(note: Placed, additive = false): void {
  const screen = screenOf({
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  });
  clickElement(noteElement(note.id), screen.x, screen.y, additive ? { shiftKey: true } : {});
}

/** These tests always place the notes they ask for. */
function at(notes: Placed[], index: number): Placed {
  const note = notes[index];
  if (!note) {
    throw new Error(`no note placed at index ${index}`);
  }
  return note;
}

function placeNotes(doc: Y.Doc, positions: { x: number; y: number }[]): Placed[] {
  return positions.map((at) => ({ id: createNote(doc, at), x: at.x, y: at.y }));
}

describe('sel.interaction - selection bar and pruning (TC-16 to TC-19)', () => {
  it('TC-16 all of it deleted elsewhere: selection empty, bar hidden', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const notes = placeNotes(doc, [
      { x: 300, y: 300 },
      { x: 600, y: 300 },
      { x: 900, y: 300 },
    ]);
    notes.forEach((note, index) => pressNote(note, index > 0));
    expect(selectionCount()).toBe(3);
    expect(selectionBarElement()).not.toBeNull();
    expect(selectionCountText()).toBe('3 selected');

    // Another client deletes all three.
    for (const note of notes) {
      deleteNote(doc, note.id);
    }

    expect(selectionCount()).toBe(0);
    expect(selectionBarElement()).toBeNull();
    expect(docNotes(doc)).toHaveLength(0);
  });

  it('TC-17 two selected: the announced count and one Delete action', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const notes = placeNotes(doc, [
      { x: 300, y: 300 },
      { x: 600, y: 300 },
    ]);
    const a = at(notes, 0);
    const b = at(notes, 1);
    pressNote(a);
    pressNote(b, true);

    const bar = selectionBarElement();
    expect(bar).not.toBeNull();
    const counter = bar!.querySelector('[data-testid="selection-count"]');
    expect(counter?.textContent).toBe('2 selected');
    // The count is announced politely, so a screen reader follows the selection.
    expect(counter?.getAttribute('aria-live')).toBe('polite');

    const button = bar!.querySelector<HTMLButtonElement>('[data-testid="delete-selection"]');
    expect(button?.getAttribute('aria-label')).toBe('Delete selection');
    fireEvent.click(button!);

    expect(docNotes(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
    expect(selectionBarElement()).toBeNull();
  });

  it('TC-18 one sticky selected: story 2 toolbar, no selection bar', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = at(placeNotes(doc, [{ x: 300, y: 300 }]), 0);
    pressNote(a);

    expect(selectionCount()).toBe(1);
    expect(noteToolbarElement()).not.toBeNull();
    expect(selectionBarElement()).toBeNull();
    expect(noteElement(a.id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-19 clicking empty board space without dragging clears the selection', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const notes = placeNotes(doc, [
      { x: 300, y: 300 },
      { x: 600, y: 300 },
    ]);
    notes.forEach((note, index) => pressNote(note, index > 0));
    expect(selectionCount()).toBe(2);

    // One press and release on empty space, without moving.
    pointerAt(boardElement(), 'pointerdown', 40, 40);
    pointerAt(boardElement(), 'pointerup', 40, 40);

    expect(selectionCount()).toBe(0);
    for (const note of notes) {
      expect(noteElement(note.id).getAttribute('data-selected')).toBe('false');
    }
    // The board itself is untouched.
    expect(docNotes(doc)).toHaveLength(2);
  });

  it('the selection never reaches the document, so no other client sees it', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const notes = placeNotes(doc, [
      { x: 300, y: 300 },
      { x: 600, y: 300 },
    ]);
    notes.forEach((note, index) => pressNote(note, index > 0));
    expect(selectionCount()).toBe(2);

    const changes: unknown[] = [];
    doc.getMap<unknown>('objects').observeDeep((events) => changes.push(...events));
    expect(selectionCount()).toBe(2);

    expect(changes).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(2);
  });
});
