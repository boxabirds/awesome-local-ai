import { beforeEach, describe, expect, it } from 'vitest';

import { act, fireEvent, screen } from './tl.js';
import { deleteObject } from '../../src/shared/board-model.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';
import {
  CENTRE,
  board,
  boardDoc,
  camera,
  clickBoard,
  clickStickyButton,
  createSelectedNote,
  docNotes,
  doubleClick,
  doubleClickBoard,
  dragNote,
  editorValue,
  editingNoteId,
  escapeFromEditor,
  flushFrames,
  keydown,
  lostPointerCapture,
  noteData,
  noteElement,
  noteElements,
  noteId,
  noteScreenCentre,
  noteText,
  noteToolbarElement,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  pressAt,
  pressNote,
  renderedNoteText,
  renderBoard,
  selectedNoteId,
  typeText,
} from './helpers.js';

/**
 * sticky.interaction (ui-component): the state machine of a note - press,
 * select, drag, delete - and what happens when the note disappears underneath
 * the user.
 *
 * Notes are addressed both through the rendered DOM (their order in the DOM is
 * their drawing order) and through the document (the test hooks hand out the
 * same Y.Doc the app uses): a test that looked at only one of the two could not
 * tell a rendering bug from a model bug.
 */

beforeEach(() => {
  renderBoard();
});

describe('sticky.interaction: select', () => {
  it('TC-18 selects a note with a press that does not move, and shows its toolbar', () => {
    createSelectedNote();
    clickBoard();
    expect(selectedNoteId()).toBeNull();
    expect(noteToolbarElement()).toBeNull();

    pressNote(noteScreenCentre(0));

    expect(selectedNoteId()).toBe(noteId(0));
    expect(noteElement(0).dataset.selected).toBe('true');
    expect(noteToolbarElement()).not.toBeNull();
    // The note is reachable by name, not only by where it happens to be drawn.
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
  });

  it('TC-22 deselects on a click of empty board space and hides the toolbar', () => {
    createSelectedNote();
    pressNote(noteScreenCentre(0));
    expect(selectedNoteId()).toBe(noteId(0));

    clickBoard();

    expect(selectedNoteId()).toBeNull();
    expect(noteToolbarElement()).toBeNull();
    // Deselecting changes nothing about the note itself.
    expect(docNotes()).toHaveLength(1);
    expect(noteText(0)).toBe('Retro board');
  });

  it('TC-36 does nothing when Enter is pressed while nothing is selected', () => {
    keydown('Enter');

    expect(docNotes()).toHaveLength(0);
    expect(editingNoteId()).toBeNull();
    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
  });

  it('keeps a selection across a board pan, because a pan is not a click', () => {
    createSelectedNote();
    pressNote(noteScreenCentre(0));

    // Press empty space, move, release: the board pans, the note stays selected.
    pointerDown({ x: 40, y: 700 }, board());
    pointerMove({ x: 240, y: 700 }, board());
    pointerUp({ x: 240, y: 700 }, board());

    expect(selectedNoteId()).toBe(noteId(0));
  });
});

describe('sticky.interaction: move', () => {
  it('TC-19 treats 2 px of movement as a select, not as a drag', () => {
    createSelectedNote();
    clickBoard();
    const before = noteData(0);

    const grab = noteScreenCentre(0);
    dragNote(grab, { x: grab.x + 2, y: grab.y }, noteElement(0), 2);

    expect(noteData(0).x).toBe(before.x);
    expect(noteData(0).y).toBe(before.y);
    expect(selectedNoteId()).toBe(before.id);
    expect(noteElement(0).dataset.dragging).toBe('false');
  });

  it('TC-20 starts dragging at exactly 3 px of movement and never moves the camera', () => {
    createSelectedNote();
    clickBoard();
    const before = noteData(0);
    const cameraBefore = camera();

    const grab = noteScreenCentre(0);
    dragNote(grab, { x: grab.x + 3, y: grab.y }, noteElement(0), 3);

    expect(noteData(0).x).toBeCloseTo(before.x + 3, 6);
    expect(noteData(0).y).toBe(before.y);
    // The board did not pan a single pixel: the note swallowed the pointer.
    expect(camera()).toEqual(cameraBefore);
  });

  it('TC-21 keeps the last applied position when a drag is cancelled', () => {
    createSelectedNote();
    clickBoard();
    const before = noteData(0);
    const element = noteElement(0);

    // Press, move 40 px, then the browser takes the pointer away mid-drag.
    const grab = noteScreenCentre(0);
    pointerDown(grab, element);
    pointerMove({ x: grab.x + 40, y: grab.y }, element);
    expect(element.dataset.dragging).toBe('true');
    pointerCancel({ x: grab.x + 40, y: grab.y }, element);

    expect(noteData(0).x).toBeCloseTo(before.x + 40, 6);
    expect(noteData(0).y).toBe(before.y);
    expect(element.dataset.dragging).toBe('false');
    // The note that was being dragged ends up selected (PRD: a drag selects).
    expect(selectedNoteId()).toBe(before.id);
  });

  it('TC-21b ends a drag that is interrupted by lostpointercapture at its last position', () => {
    createSelectedNote();
    clickBoard();
    const before = noteData(0);
    const element = noteElement(0);

    const grab = noteScreenCentre(0);
    pointerDown(grab, element);
    pointerMove({ x: grab.x + 30, y: grab.y + 10 }, element);
    lostPointerCapture({ x: grab.x + 30, y: grab.y + 10 }, element);

    expect(noteData(0).x).toBeCloseTo(before.x + 30, 6);
    expect(noteData(0).y).toBeCloseTo(before.y + 10, 6);
    expect(element.dataset.dragging).toBe('false');
  });

  it('TC-32a draws a dragged note above the note it is dragged onto', () => {
    createSelectedNote('Bottom');
    clickStickyButton();
    escapeFromEditor();
    const first = noteId(0);
    const second = noteId(1);
    expect(docNotes().map((note) => note.id)).toEqual([first, second]);

    // The second note (on top) is dragged away: it was already topmost.
    const top = noteScreenCentre(1);
    dragNote(top, { x: top.x + 200, y: top.y + 150 }, noteElement(1), 2);
    expect(docNotes().map((note) => note.id)).toEqual([first, second]);

    // The bottom note dragged onto the other one: it comes to the front.
    const bottom = noteScreenCentre(0);
    dragNote(bottom, { x: bottom.x + 200, y: bottom.y + 150 }, noteElement(0), 2);
    expect(docNotes().map((note) => note.id)).toEqual([second, first]);
    expect(docNotes()[1].z).toBeGreaterThan(docNotes()[0].z);
  });

  it('TC-20b writes the position once per animation frame, not once per pointer event', () => {
    createSelectedNote();
    clickBoard();
    const before = noteData(0);
    const element = noteElement(0);

    const grab = noteScreenCentre(0);
    pointerDown(grab, element);
    // Three moves without draining a frame in between: nothing is written yet,
    // because every write waits for the next animation frame.
    // act() without drainFrames(): React sees the move, the animation frame in
    // which the position would be written does not run yet.
    const withoutFlush = (point: { x: number; y: number }) => {
      act(() => {
        fireEvent.pointerMove(element, {
          pointerId: 1,
          pointerType: 'mouse',
          buttons: 1,
          clientX: point.x,
          clientY: point.y,
        });
      });
    };
    withoutFlush({ x: grab.x + 10, y: grab.y });
    withoutFlush({ x: grab.x + 20, y: grab.y });
    withoutFlush({ x: grab.x + 30, y: grab.y });
    expect(noteData(0).x).toBe(before.x);

    // One frame later the note is where the pointer last was: one write, and the
    // intermediate positions were never written to the document at all.
    flushFrames();
    expect(noteData(0).x).toBeCloseTo(before.x + 30, 6);

    pointerUp({ x: grab.x + 30, y: grab.y }, element);
    expect(noteData(0).x).toBeCloseTo(before.x + 30, 6);
  });

  it('places a note at its world position inside the world layer', () => {
    clickStickyButton();
    escapeFromEditor();
    const note = noteElement(0);

    // The note is centred on the middle of the view, which starts at world (0, 0).
    expect(note.style.left).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(note.style.top).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(renderedNoteText(0)).toBe('');
    expect(CENTRE.x).toBe(640);
  });
});

describe('sticky.interaction: delete', () => {
  it('TC-25 removes the selected note with Delete', () => {
    createSelectedNote('Ship it');

    keydown('Delete');

    expect(docNotes()).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(selectedNoteId()).toBeNull();
    expect(editingNoteId()).toBeNull();
  });

  it('TC-25b removes the selected note with Backspace', () => {
    createSelectedNote('Ship it');

    keydown('Backspace');

    expect(docNotes()).toHaveLength(0);
    expect(selectedNoteId()).toBeNull();
  });

  it('TC-25c ignores Delete while a note is being edited', () => {
    clickStickyButton();
    typeText('Ship it');

    // The keystroke belongs to the text field: Backspace deletes a character
    // there, not the note (see TC-26 in StickyTextEditor.test.tsx).
    keydown('Delete');

    expect(docNotes()).toHaveLength(1);
    expect(noteText(0)).toBe('Ship it');
  });

  it('TC-25d does not delete a second time when the note is already gone', () => {
    createSelectedNote('Ship it');

    keydown('Delete');
    expect(() => {
      keydown('Delete');
    }).not.toThrow();

    expect(docNotes()).toHaveLength(0);
  });
});

describe('sticky.interaction: gestures that must not create a note', () => {
  it('TC-35 edits the note under a double-click instead of creating another one', () => {
    const id = createSelectedNote('Existing');

    // A double-click on the note: the note stops it before it can reach the board.
    doubleClick(noteElement(0), noteScreenCentre(0));

    expect(docNotes()).toHaveLength(1);
    expect(noteId(0)).toBe(id);
    expect(editingNoteId()).toBe(id);
    expect(editorValue()).toBe('Existing');
  });

  it('TC-28b creates one note per double-click on empty board space', () => {
    doubleClickBoard({ x: 300, y: 300 });
    escapeFromEditor();
    doubleClickBoard({ x: 700, y: 500 });

    expect(docNotes()).toHaveLength(2);
    expect(docNotes()[1].z).toBeGreaterThan(docNotes()[0].z);
    expect(editingNoteId()).toBe(noteId(1));
  });
});

describe('sticky.interaction: a note that disappears mid-interaction (TC-37)', () => {
  it('ends a drag silently when the note is deleted while it is being dragged', () => {
    const id = createSelectedNote('Deleting');
    const element = noteElement(0);

    const grab = noteScreenCentre(0);
    pointerDown(grab, element);
    pointerMove({ x: grab.x + 40, y: grab.y + 20 }, element);
    expect(element.dataset.dragging).toBe('true');

    act(() => {
      deleteObject(boardDoc(), id);
    });
    flushFrames();

    // No exception, no note, nothing re-created; releasing the pointer afterwards
    // is harmless.
    expect(noteElements()).toHaveLength(0);
    expect(() => {
      pressAt({ x: grab.x + 40, y: grab.y + 20 }, element);
    }).not.toThrow();
    expect(noteElements()).toHaveLength(0);
    expect(selectedNoteId()).toBeNull();
    expect(editingNoteId()).toBeNull();
  });

  it('ends editing silently when the note is deleted while it is being edited', () => {
    clickStickyButton();
    typeText('Work in progress');
    const id = noteId(0);

    act(() => {
      deleteObject(boardDoc(), id);
    });
    flushFrames();

    expect(noteElements()).toHaveLength(0);
    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(selectedNoteId()).toBeNull();
    expect(editingNoteId()).toBeNull();
    // The document holds nothing of the note any more, not even its text.
    expect(boardDoc().getMap('objects').get(id)).toBeUndefined();
  });

  it('ignores a pointer release that arrives after the note was deleted', () => {
    const id = createSelectedNote('Deleting');
    const element = noteElement(0);

    dragNote(noteScreenCentre(0), { x: 200, y: 200 }, element, 1);
    act(() => {
      deleteObject(boardDoc(), id);
    });
    flushFrames();
    expect(() => {
      pointerUp({ x: 200, y: 200 }, element);
    }).not.toThrow();

    expect(docNotes()).toHaveLength(0);
    expect(selectedNoteId()).toBeNull();
  });
});
