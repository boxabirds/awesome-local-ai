import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  clickElement,
  createNote,
  deleteNote,
  docNotes,
  doubleClickElement,
  drawnPosition,
  editorElement,
  flushFrame,
  noteElement,
  noteElements,
  notePosition,
  noteOf,
  noteToolbarElement,
  pointerAt,
  pressKey,
  renderBoard,
} from './harness';

const hasRaf = (): boolean => typeof requestAnimationFrame === 'function';

const CENTRE = { x: 300, y: 200 };
const HALF = STICKY_SIZE_WORLD / 2;
const START = { x: CENTRE.x - STICKY_SIZE_WORLD / 2, y: CENTRE.y - STICKY_SIZE_WORLD / 2 };

/** One note, created through the model, with the board rendered around it. */
function renderWithNote() {
  const doc = new Y.Doc();
  const view = renderBoard({ doc });
  const id = createNote(doc, CENTRE);
  return { doc, id, view };
}

const press = (id: string, x: number, y: number) => pointerAt(noteElement(id), 'pointerdown', x, y);
const moveTo = (id: string, x: number, y: number) => pointerAt(noteElement(id), 'pointermove', x, y);
const release = (id: string, x: number, y: number) => pointerAt(noteElement(id), 'pointerup', x, y);

describe('sticky.interaction - selecting (TC-18, TC-22)', () => {
  it('TC-18 press and release without moving selects the note', () => {
    const { doc, id } = renderWithNote();
    const note = noteElement(id);

    press(id, 320, 240);
    release(id, 320, 240);

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-selected') !== null).toBe(true);
    // Selected: the note toolbar is rendered.
    expect(noteToolbarElement()).not.toBeNull();
    // Accessible name exactly as specified.
    expect(note.getAttribute('role')).toBe('group');
    expect(note.getAttribute('aria-label')).toBe('Sticky note');
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBe(note);
    // Rendered where the document says.
    expect(drawnPosition(id)).toEqual({ x: START.x, y: START.y });
    expect(docNotes(doc)).toHaveLength(1);
  });

  it('TC-18 nothing is selected before the note is pressed', () => {
    const { id } = renderWithNote();
    expect(noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(noteToolbarElement()).toBeNull();
  });

  it('TC-22 clicking the empty board clears the selection and the note toolbar', () => {
    const { id } = renderWithNote();
    const note = noteElement(id);
    clickElement(note, 320, 240);
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(noteToolbarElement()).not.toBeNull();

    clickElement(screen.getByTestId('board'), 700, 500);

    expect(noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(noteToolbarElement()).toBeNull();
  });

  it('pressing a note selects the note that was pressed, not the other one', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const first = createNote(doc, { x: 200, y: 200 });
    const second = createNote(doc, { x: 700, y: 200 });

    clickElement(noteElement(second), 750, 250);

    expect(noteElement(first).getAttribute('data-selected')).toBe('false');
    expect(noteElement(second).getAttribute('data-selected')).toBe('true');
    // The toolbar belongs to the selected note only.
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(1);
    expect(noteElement(second).querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
  });
});

describe('sticky.interaction - dragging (TC-19 to TC-21)', () => {
  it('TC-19 a press with 2 px of movement is a click: selected, note not moved', async () => {
    const { doc, id } = renderWithNote();
    const before = noteOf(doc, id);

    press(id, 320, 240);
    moveTo(id, 322, 240);
    await flushFrame();
    expect(noteOf(doc, id)).toEqual(before); // moveObject never ran
    release(id, 322, 240);

    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(noteOf(doc, id)).toEqual(before);
  });

  it('TC-20 dragging a note does not move the board camera', async () => {
    const { doc, id } = renderWithNote();
    const board = screen.getByTestId('board');

    press(id, 320, 240);
    expect(board.getAttribute('data-panning')).toBe('false');
    moveTo(id, 340, 250);
    await flushFrame();
    moveTo(id, 360, 265);
    await flushFrame();
    release(id, 360, 265);

    expect(board.getAttribute('data-panning')).toBe('false');
    // A drag of (40, 25) screen px at zoom 1 moves the note, not the board.
    expect(notePosition(doc, id)).toEqual({ x: START.x + 40, y: START.y + 25 });
  });

  it('the drag threshold is exact: 2 px is a click, 3 px is a drag', async () => {
    const { doc, id } = renderWithNote();
    const before = noteOf(doc, id);

    press(id, 320, 240);
    moveTo(id, 322, 240);
    expect(noteElement(id).getAttribute('data-dragging')).toBe('false');
    release(id, 322, 240);
    expect(noteOf(doc, id)).toEqual(before);

    press(id, 320, 240);
    moveTo(id, 320 + DRAG_THRESHOLD_PX, 240);
    expect(noteElement(id).getAttribute('data-dragging')).toBe('true');
    await flushFrame();
    release(id, 320 + DRAG_THRESHOLD_PX, 240);

    expect(notePosition(doc, id)).toEqual({ x: START.x + DRAG_THRESHOLD_PX, y: START.y });
  });

  it('a drag writes once per animation frame, not once per pointer move', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const dragged = createNote(doc, CENTRE);
    const onTop = createNote(doc, { x: 340, y: 210 }); // created later, so it is above
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    press(dragged, 320, 240);
    for (let step = 1; step <= 5; step += 1) {
      moveTo(dragged, 320 + step * 20, 240); // five moves, no frame in between
    }
    // Only the single raise-to-front ran; the five positions are still coalesced.
    expect(updates).toBe(1);
    expect(noteOf(doc, dragged).z).toBeGreaterThan(noteOf(doc, onTop).z);

    await flushFrame(); // the coalesced position is written once
    release(dragged, 420, 240);

    expect(updates).toBe(2);
    expect(notePosition(doc, dragged)).toEqual({ x: START.x + 100, y: START.y });
  });

  it('dragging moves the note by screen delta / zoom and brings it to front', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const under = createNote(doc, CENTRE);
    const dragged = createNote(doc, { x: 340, y: 210 });
    const from = { x: 340 - HALF, y: 210 - HALF };
    const zBefore = noteOf(doc, dragged).z;
    const zUnder = noteOf(doc, under).z;
    expect(zBefore).toBeGreaterThan(zUnder);

    press(dragged, 320, 240);
    moveTo(dragged, 400, 300);
    await flushFrame();
    release(dragged, 400, 300);

    const moved = noteOf(doc, dragged);
    expect({ x: moved.x, y: moved.y }).toEqual({ x: from.x + 80, y: from.y + 60 });
    // Stacking: the dragged note is on top of everything it can overlap.
    expect(moved.z).toBeGreaterThan(noteOf(doc, under).z);
    expect(noteElement(dragged).getAttribute('data-dragging')).toBe('false');
    expect(zUnder).toBeLessThan(moved.z);
  });

  it('the note toolbar is hidden while dragging and back afterwards', async () => {
    const { id } = renderWithNote();
    clickElement(noteElement(id), 320, 240);
    expect(noteToolbarElement()).not.toBeNull();

    press(id, 320, 240);
    moveTo(id, 330, 240);
    expect(noteElement(id).getAttribute('data-dragging')).toBe('true');
    expect(noteToolbarElement()).toBeNull();
    await flushFrame();
    release(id, 330, 240);

    expect(noteElement(id).getAttribute('data-dragging')).toBe('false');
    expect(noteToolbarElement()).not.toBeNull();
  });

  it('TC-21 pointercancel keeps the last applied position and selects the note', async () => {
    const { doc, id } = renderWithNote();

    press(id, 320, 240);
    moveTo(id, 360, 240);
    await flushFrame();
    const applied = noteOf(doc, id);
    expect({ x: applied.x, y: applied.y }).toEqual({ x: START.x + 40, y: START.y });

    // A further move that has not been applied yet is dropped by the cancel.
    if (hasRaf()) {
      moveTo(id, 400, 240);
    }
    pointerAt(noteElement(id), 'pointercancel', 400, 240);
    await flushFrame();

    expect({ x: noteOf(doc, id).x, y: noteOf(doc, id).y }).toEqual({
      x: applied.x,
      y: applied.y,
    });
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(noteElement(id).getAttribute('data-dragging')).toBe('false');
  });
});

describe('sticky.interaction - double click and keyboard (TC-25, TC-35 to TC-37)', () => {
  it('TC-35 double-clicking a note edits it and creates nothing new', () => {
    const { doc, id } = renderWithNote();

    doubleClickElement(noteElement(id), 320, 240);

    expect(docNotes(doc)).toHaveLength(1);
    expect(editorElement()).not.toBeNull();
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-36 Enter with nothing selected creates and edits nothing', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('Enter');

    expect(docNotes(doc)).toHaveLength(0);
    expect(editorElement()).toBeNull();
  });

  it('Enter edits the selected note and Delete removes it (TC-25)', () => {
    const { doc, id } = renderWithNote();
    clickElement(noteElement(id), 320, 240);

    pressKey('Enter');
    expect(editorElement()).not.toBeNull();

    pressKey('Escape');
    expect(editorElement()).toBeNull();
    expect(docNotes(doc)).toHaveLength(1);

    pressKey('Delete');
    expect(docNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(noteToolbarElement()).toBeNull();
  });

  it('TC-25 Backspace deletes a selected note that is not being edited', () => {
    const { doc, id } = renderWithNote();
    clickElement(noteElement(id), 320, 240);

    pressKey('Backspace');

    expect(docNotes(doc)).toHaveLength(0);
  });

  it('an empty note shows no placeholder text', () => {
    const { id } = renderWithNote();
    const text = noteElement(id).querySelector('[data-testid^="sticky-text-"]');
    expect(text?.textContent).toBe('');
  });

  it('TC-37 a note deleted while dragging ends the interaction silently', async () => {
    const { doc, id } = renderWithNote();

    press(id, 320, 240);
    moveTo(id, 360, 260); // a move is queued for the next animation frame

    expect(() => {
      deleteNote(doc, id); // deleted elsewhere, mid-drag
    }).not.toThrow();

    // The queued write runs against a note that no longer exists.
    await expect(flushFrame()).resolves.not.toThrow();

    expect(docNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(noteToolbarElement()).toBeNull();
  });

  it('TC-37 a note deleted while editing is not recreated', () => {
    const { doc, id } = renderWithNote();
    doubleClickElement(noteElement(id), 320, 240);
    expect(editorElement()).not.toBeNull();

    expect(() => {
      deleteNote(doc, id);
    }).not.toThrow();

    expect(docNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(editorElement()).toBeNull();
  });
});
