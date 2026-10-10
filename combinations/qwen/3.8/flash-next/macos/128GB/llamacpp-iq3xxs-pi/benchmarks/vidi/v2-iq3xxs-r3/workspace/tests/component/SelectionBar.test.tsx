/**
 * TC-16 to TC-19 (story 7, sel.interaction): the bar above a selection of more
 * than one object, the toolbar above a single note, and the two ways a selection
 * lets go — everything selected deleted behind this client's back, and a click on
 * empty board space.
 *
 * The board is the app's own tree (`renderStickyBoard`), the document is a real
 * `Y.Doc`, and remote deletions are made through it, not through the components:
 * what the test is asking is "when other people remove these objects, what does
 * this screen do with its selection".
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import { deleteObjects } from '../../src/shared/board-model';
import {
  addNote,
  clickNote,
  pointerEvent,
  readNotes,
  renderStickyBoard,
  selectedIds,
  viewportElement,
} from './helpers/board';

let doc: YDoc;

beforeEach(() => {
  doc = new Doc();
  renderStickyBoard(doc);
});

afterEach(cleanup);

/** How many objects the screen is drawing an outline around. */
function outlined(): number {
  return selectedIds().length;
}

describe('selection bar (TC-17, TC-18)', () => {
  it('TC-17: two notes selected shows "2 selected" and one delete for both', () => {
    const a = addNote(doc, { x: 100, y: 100, text: 'A' });
    const b = addNote(doc, { x: 400, y: 100, text: 'B' });
    clickNote(doc, a);
    clickNote(doc, b, { shift: true });

    expect(outlined()).toBe(2);
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    // Announced, so a keyboard user hears the count change rather than seeing it.
    expect(screen.getByTestId('selection-count').getAttribute('aria-live')).toBe('polite');
    // One button for the whole selection, not one per note.
    const del = screen.getByRole('button', { name: 'Delete selection' });
    expect(screen.queryAllByTestId('delete-note')).toHaveLength(0);

    fireEvent.click(del);
    expect(readNotes(doc)).toHaveLength(0);
    expect(outlined()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-18: one note selected shows the note toolbar, not the bar', () => {
    const a = addNote(doc, { x: 100, y: 100 });
    clickNote(doc, a);

    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-count')).toBeNull();
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(screen.queryAllByTestId(/^swatch-/)).toHaveLength(6);
    expect(screen.getByTestId('delete-note')).not.toBeNull();

    // Adding a second note swaps the toolbar for the bar.
    const b = addNote(doc, { x: 400, y: 100 });
    clickNote(doc, b, { shift: true });
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(screen.getByTestId('selection-bar').dataset.count).toBe('2');
  });
});

describe('selection clearing (TC-16, TC-19)', () => {
  it('TC-16: notes deleted by somebody else leave the selection, and the bar goes', () => {
    const a = addNote(doc, { x: 100, y: 100 });
    const b = addNote(doc, { x: 400, y: 100 });
    const c = addNote(doc, { x: 700, y: 100 });
    clickNote(doc, a);
    clickNote(doc, b, { shift: true });
    clickNote(doc, c, { shift: true });
    expect(screen.getByTestId('selection-bar').dataset.count).toBe('3');

    // All three vanish behind this client's back.
    act(() => {
      deleteObjects(doc, [a, b, c]);
    });
    expect(outlined()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-count')).toBeNull();
  });

  it('TC-19: a click on empty board space clears the selection; a pan keeps it', () => {
    const a = addNote(doc, { x: 100, y: 100 });
    const b = addNote(doc, { x: 400, y: 100 });
    clickNote(doc, a);
    clickNote(doc, b, { shift: true });
    expect(outlined()).toBe(2);

    // Pan first: the selection survives it (story 1's TC-22 rule, now for many).
    pointerEvent('pointerDown', viewportElement(), { x: 900, y: 650 });
    pointerEvent('pointerMove', viewportElement(), { x: 1000, y: 700 });
    pointerEvent('pointerUp', viewportElement(), { x: 1000, y: 700 });
    expect(outlined()).toBe(2);
    expect(screen.getByTestId('selection-bar').dataset.count).toBe('2');

    // Then a press and release without movement: everything lets go.
    pointerEvent('pointerDown', viewportElement(), { x: 900, y: 650 });
    pointerEvent('pointerUp', viewportElement(), { x: 900, y: 650 });
    expect(outlined()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
