/**
 * Component tests for sticky note interaction (story 2, TC-18 to TC-22, TC-25,
 * TC-35, TC-36, TC-37).
 *
 * They render the whole app, because selecting, dragging and deleting a note are
 * decided between the note, the board under it and the window's keyboard: testing
 * `StickyNote` on its own would have to fake all of that and would not catch a
 * note that pans the board while it is being dragged.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  camera,
  createSelectedNote,
  centreOf,
  doc,
  doubleClickBoard,
  hasTextarea,
  noteElement,
  noteElements,
  noteElementById,
  noteId,
  pasteText,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  renderBoard,
  stickies,
  stickyById,
  surface,
  textarea,
  toolbarPresent,
  typeText,
  zIndex,
} from './helpers/stickyBoard';
import { deleteObject } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A point on the board with plenty of empty space around it. */
const CREATE_AT = { x: 400, y: 300 };
/** Where the pointer grabs that point on the note. */
const GRAB = CREATE_AT;
const EPSILON = 6;

/** Wait for the note's own interaction attribute to read as expected. */
async function interaction(index = 0): Promise<string | undefined> {
  await waitFor(() => expect(noteElement(index).dataset.interaction).toBeDefined());
  return noteElement(index).dataset.interaction;
}

describe('sticky note interaction', () => {
  it('TC-18: pressing a note and releasing without moving selects it and shows its toolbar', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y, 'idea');
    // Let go of it first, so the press is what selects it.
    pointerDown(surface(), 60, 60);
    pointerUp(surface(), 60, 60);
    await waitFor(() => expect(noteElement().dataset.selected).toBe('false'));
    expect(toolbarPresent()).toBe(false);

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    expect(await interaction()).toBe('pressed');
    pointerUp(noteElement(), GRAB.x, GRAB.y);

    // Selected: the note says so, the outline is on it, and its toolbar is up.
    await waitFor(() => expect(noteElement().dataset.selected).toBe('true'));
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBe(noteElement());
    expect(toolbarPresent()).toBe(true);
    // A press is not a double-click: nothing was opened for typing.
    expect(hasTextarea()).toBe(false);
    // And a press is not a pan.
    expect(camera().zoom).toBe(1);
  });

  it('TC-19: moving 2px (below DRAG_THRESHOLD_PX) stays a press and does not move the note', async () => {
    renderBoard();
    const before = await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    const position = stickies()[0];

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 2, GRAB.y + 2);

    expect(await interaction()).toBe('pressed');
    expect(stickies()[0].x).toBeCloseTo(position.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(position.y, EPSILON);

    pointerUp(noteElement(), GRAB.x + 2, GRAB.y + 2);
    await waitFor(() => expect(noteElement().dataset.selected).toBe('true'));
    expect(stickies()[0].x).toBeCloseTo(position.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(position.y, EPSILON);
    // The note that was only pressed is still the only one, and still selected.
    expect(noteElements()).toHaveLength(1);
    expect(before).toBe(noteId());
  });

  it('TC-20: moving 3px (the threshold) starts a drag, and the board does not pan', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    const before = stickies()[0];
    const cameraBefore = camera();

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + DRAG_THRESHOLD_PX, GRAB.y);

    expect(await interaction()).toBe('dragging');
    await waitFor(() => expect(stickies()[0].x).not.toBe(before.x));
    // At 100% zoom, three screen pixels are three board units.
    expect(stickies()[0].x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(before.y, EPSILON);
    // Negative: the drag belongs to the note, never to the board.
    expect(camera()).toBe(cameraBefore);
    expect(surface().dataset.interactionState).toBe('idle');

    pointerUp(noteElement(), GRAB.x + DRAG_THRESHOLD_PX, GRAB.y);
    await waitFor(() => expect(noteElement().dataset.selected).toBe('true'));
  });

  it('TC-21: pointercancel during a drag leaves the note where it was last shown', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    const before = stickies()[0];

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 40, GRAB.y + 20);
    await waitFor(() => expect(noteElement().dataset.interaction).toBe('dragging'));
    const moved = { ...stickies()[0] };
    expect(moved.x).toBeCloseTo(before.x + 40, EPSILON);
    expect(moved.y).toBeCloseTo(before.y + 20, EPSILON);

    expect(pointerCancel(noteElement(), GRAB.x + 40, GRAB.y + 20)).toBe(true);
    await waitFor(() => expect(noteElement().dataset.interaction).toBe('idle'));
    expect(noteElement().dataset.selected).toBe('true');
    expect(stickies()[0].x).toBeCloseTo(moved.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(moved.y, EPSILON);

    // The pointer is no longer holding the note: later moves do nothing.
    pointerMove(noteElement(), GRAB.x + 300, GRAB.y + 300);
    expect(stickies()[0].x).toBeCloseTo(moved.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(moved.y, EPSILON);
  });

  it('TC-22: clicking empty board space deselects and takes the toolbar away', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    expect(noteElement().dataset.selected).toBe('true');
    expect(toolbarPresent()).toBe(true);

    pointerDown(surface(), 100, 600);
    pointerUp(surface(), 100, 600);

    await waitFor(() => expect(noteElement().dataset.selected).toBe('false'));
    await waitFor(() => expect(toolbarPresent()).toBe(false));
    // The note itself is untouched by letting go of it.
    expect(noteElements()).toHaveLength(1);
  });

  it('TC-22b: panning the board does not clear the selection', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);

    pointerDown(surface(), 100, 600);
    pointerMove(surface(), 200, 640);
    pointerUp(surface(), 200, 640);

    expect(noteElement().dataset.selected).toBe('true');
    expect(toolbarPresent()).toBe(true);
  });

  it('TC-25: Delete removes the selected note', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    // Cancelled: Backspace on a page is the browser's "go back", and a selected
    // note wins over that.
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(false);

    await waitFor(() => expect(stickies()).toHaveLength(0));
    expect(noteElements()).toHaveLength(0);
    expect(toolbarPresent()).toBe(false);
  });

  it('TC-25b: Backspace removes the selected note', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(false);

    await waitFor(() => expect(stickies()).toHaveLength(0));
    expect(toolbarPresent()).toBe(false);
  });

  it('TC-25c: deleting with the keyboard takes the topmost note out of the stack', async () => {
    renderBoard();
    await doubleClickBoard(300, 200);
    typeText('first');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await doubleClickBoard(600, 400);
    typeText('second');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(stickies()).toHaveLength(2));

    // The second note is the one that was pressed last, so it is the selected one.
    expect(noteElement(1).dataset.selected).toBe('true');
    const survivor = noteId(0);
    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => expect(stickies()).toHaveLength(1));
    expect(noteId()).toBe(survivor);
  });

  it('TC-35: double-clicking an existing note edits it instead of making another', async () => {
    renderBoard();
    const id = await createSelectedNote(CREATE_AT.x, CREATE_AT.y, 'existing');
    const position = { ...stickies()[0] };

    fireEvent.doubleClick(noteElement(), { clientX: GRAB.x, clientY: GRAB.y });
    await waitFor(() => expect(hasTextarea()).toBe(true));

    expect(stickies()).toHaveLength(1);
    expect(noteId()).toBe(id);
    expect(textarea().value).toBe('existing');
    // The note did not move when it was double-clicked.
    expect(stickies()[0].x).toBeCloseTo(position.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(position.y, EPSILON);
    // And the board did not create a note underneath it.
    expect(stickies()[0].text).toBe('existing');
  });

  it('TC-36: Enter with nothing selected creates and edits nothing', async () => {
    renderBoard();
    expect(stickies()).toHaveLength(0);

    expect(fireEvent.keyDown(window, { key: 'Enter' })).toBe(true);

    expect(stickies()).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(hasTextarea()).toBe(false);
  });

  it('TC-37: a note deleted while it is being dragged ends the drag quietly', async () => {
    renderBoard();
    const id = await createSelectedNote(CREATE_AT.x, CREATE_AT.y);

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 60, GRAB.y + 30);
    await waitFor(() => expect(noteElement().dataset.interaction).toBe('dragging'));

    // Somebody else (or the keyboard) removes it from under the pointer.
    expect(deleteObject(doc(), id)).toBe(true);
    await waitFor(() => expect(noteElements()).toHaveLength(0));

    // The drag continues and finishes without an exception, and the note stays gone.
    pointerMove(noteElements()[0] ?? surface(), GRAB.x + 120, GRAB.y + 60);
    pointerUp(surface(), GRAB.x + 120, GRAB.y + 60);
    expect(stickies()).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(toolbarPresent()).toBe(false);
  });

  it('TC-37b: a note deleted while it is being typed in ends editing quietly', async () => {
    renderBoard();
    await doubleClickBoard(CREATE_AT.x, CREATE_AT.y);
    typeText('doomed');
    const id = noteId();

    expect(deleteObject(doc(), id)).toBe(true);
    await waitFor(() => expect(noteElements()).toHaveLength(0));
    expect(hasTextarea()).toBe(false);

    // Keys typed afterwards belong to nobody: they create and edit nothing.
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(stickies()).toHaveLength(0);
    expect(hasTextarea()).toBe(false);
    // And the document is not left with a note that is only in the selection.
    expect(stickies()).toHaveLength(0);
  });

  it('TC-37c: a drag of a note that is deleted mid-drag does not recreate it', async () => {
    renderBoard();
    const id = await createSelectedNote(CREATE_AT.x, CREATE_AT.y);

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 20, GRAB.y + 10);
    await waitFor(() => expect(noteElement().dataset.interaction).toBe('dragging'));
    deleteObject(doc(), id);
    await waitFor(() => expect(stickies()).toHaveLength(0));

    // Every later frame write is refused; the note cannot come back.
    pointerMove(noteElements()[0] ?? surface(), GRAB.x + 200, GRAB.y + 100);
    await waitFor(() => expect(stickies()).toHaveLength(0));
    pointerUp(surface(), GRAB.x + 200, GRAB.y + 100);
    expect(stickies()).toHaveLength(0);
  });

  it('a note is placed centred on the point that was double-clicked', async () => {
    renderBoard();
    await doubleClickBoard(CREATE_AT.x, CREATE_AT.y);
    const world = screenToWorld(camera(), CREATE_AT);

    expect(stickies()[0].text).toBe('');
    await waitFor(() => expect(centreOf(stickies()[0]).x).toBeCloseTo(world.x, EPSILON));
    expect(centreOf(stickies()[0]).y).toBeCloseTo(world.y, EPSILON);
    // The note's size is the setting, not something the component decides.
    expect(noteElement().style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(noteElement().style.height).toBe(`${STICKY_SIZE_WORLD}px`);
  });

  it('a note dragged a long way ends up exactly under the pointer', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    const before = stickies()[0];

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    for (let step = 1; step <= 20; step++) pointerMove(noteElement(), GRAB.x + step * 50, GRAB.y + step * 25);
    pointerUp(noteElement(), GRAB.x + 1000, GRAB.y + 500);

    await waitFor(() => expect(stickies()[0].x).toBeCloseTo(before.x + 1000, EPSILON));
    expect(stickies()[0].y).toBeCloseTo(before.y + 500, EPSILON);
  });

  it('a note dragged at 50% zoom moves twice as far in board units as the pointer', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    setZoom(0.5);
    await waitFor(() => expect(camera().zoom).toBe(0.5));
    const before = stickies()[0];

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 100, GRAB.y + 50);
    pointerUp(noteElement(), GRAB.x + 100, GRAB.y + 50);

    // 100 screen pixels at half zoom is 200 board units: the grabbed point of the
    // note stays under the pointer.
    await waitFor(() => expect(stickies()[0].x).toBeCloseTo(before.x + 200, EPSILON));
    expect(stickies()[0].y).toBeCloseTo(before.y + 100, EPSILON);
  });

  it('a note dragged at 200% zoom moves half as far in board units', async () => {
    renderBoard();
    await createSelectedNote(CREATE_AT.x, CREATE_AT.y);
    setZoom(2);
    await waitFor(() => expect(camera().zoom).toBe(2));
    const before = stickies()[0];

    pointerDown(noteElement(), GRAB.x, GRAB.y);
    pointerMove(noteElement(), GRAB.x + 100, GRAB.y + 50);
    pointerUp(noteElement(), GRAB.x + 100, GRAB.y + 50);

    await waitFor(() => expect(stickies()[0].x).toBeCloseTo(before.x + 50, EPSILON));
    expect(stickies()[0].y).toBeCloseTo(before.y + 25, EPSILON);
  });

  it('dragging a note brings it above the notes it crosses', async () => {
    renderBoard();
    await doubleClickBoard(300, 200);
    typeText('under');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await doubleClickBoard(340, 230);
    typeText('over');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(stickies()).toHaveLength(2));
    // The snapshot is in stacking order: the first note is the one drawn under.
    expect(stickies().map((note) => note.text)).toEqual(['under', 'over']);
    expect(stickies()[0].z).toBeLessThan(stickies()[1].z);

    // Drag the bottom note up over the other one: it ends up on top.
    const underId = noteElement(0).dataset.noteId ?? '';
    pointerDown(noteElement(0), 300, 200);
    pointerMove(noteElementById(underId), 320, 210);
    await waitFor(() => expect(noteElementById(underId).dataset.interaction).toBe('dragging'));
    pointerUp(noteElementById(underId), 320, 210);

    // The dragged note is now the last drawn, and it is still the same note.
    await waitFor(() => expect(stickies()[stickies().length - 1].id).toBe(underId));
    expect(stickies()).toHaveLength(2);
    expect(stickyById(underId).text).toBe('under');
  });

  it('a note that is raised while it is held stays in its place in the page', async () => {
    renderBoard();
    await doubleClickBoard(300, 200);
    typeText('under');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await doubleClickBoard(340, 230);
    typeText('over');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(stickies()).toHaveLength(2));

    const under = noteId(0);
    const over = noteId(1);
    const order = noteElements().map((element) => element.dataset.noteId ?? '');

    pointerDown(noteElement(0), 300, 200);
    pointerMove(noteElementById(under), 320, 210);
    await waitFor(() => expect(noteElementById(under).dataset.interaction).toBe('dragging'));

    // The element the pointer holds is not moved: raising a note changes the number
    // it is drawn with, and nothing else. A browser lets go of the pointer when the
    // element that captured it leaves its place in the document, and the drag stops.
    expect(noteElements().map((element) => element.dataset.noteId ?? '')).toEqual(order);
    expect(zIndex(under)).toBeGreaterThan(zIndex(over));

    pointerUp(noteElementById(under), 320, 210);
    // The document agrees with what is on screen: the dragged note is the top one.
    await waitFor(() => expect(stickies()[stickies().length - 1].id).toBe(under));
    expect(zIndex(under)).toBeGreaterThan(zIndex(over));
  });

  it('typing a long note does not move or recolour it', async () => {
    renderBoard();
    await doubleClickBoard(CREATE_AT.x, CREATE_AT.y);
    const before = stickies()[0];

    pasteText('word '.repeat(200));

    expect(stickies()[0].x).toBeCloseTo(before.x, EPSILON);
    expect(stickies()[0].y).toBeCloseTo(before.y, EPSILON);
    expect(stickies()[0].color).toBe(before.color);
    expect(stickies()[0].z).toBe(before.z);
  });

  it('a note created near the edge of the board is still a whole note', async () => {
    renderBoard();
    await doubleClickBoard(12, 8);
    const world = screenToWorld(camera(), { x: 12, y: 8 });

    // The note is centred on the click even when that puts part of it off screen.
    await waitFor(() => expect(centreOf(stickies()[0]).x).toBeCloseTo(world.x, EPSILON));
    expect(stickies()[0].x).toBeLessThan(0);
  });

  it('notes keep their stacking order in the snapshot after a drag', async () => {
    renderBoard();
    await doubleClickBoard(300, 200);
    typeText('one');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await doubleClickBoard(700, 500);
    typeText('two');
    fireEvent.keyDown(textarea(), { key: 'Escape' });

    // Order in the snapshot follows stacking order, which drags change.
    expect(stickies().map((note) => note.text)).toEqual(['one', 'two']);
    pointerDown(noteElement(1), 700, 500);
    pointerMove(noteElement(1), 720, 510);
    await waitFor(() => expect(noteElement(1).dataset.interaction).toBe('dragging'));
    pointerUp(noteElement(1), 720, 510);

    expect(stickies().map((note) => note.text)).toEqual(['one', 'two']);
    expect(stickies()[1].z).toBeGreaterThan(stickies()[0].z);
  });
});

/** Zoom the way the zoom control would, so the note drag uses the real camera. */
function setZoom(zoom: number): void {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('the board did not register its test hooks');
  hooks.setCamera({ zoom });
}
