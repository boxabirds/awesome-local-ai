/**
 * Where one thing this person did ends and the next begins (TC-14 to TC-17).
 *
 * A step is not a document change. A drag writes the document thirty times and is one thing that
 * happened; a drag followed immediately by a colour click is two things that happened, two frames apart.
 * Both of those are decided by a call to `boundary()` and by nothing else, which makes this the file where
 * the difference is worth pinning down — the capture window alone gets both of them wrong: left to itself it
 * would merge the thirty frames *and* the colour click into one step, and then the second would be
 * unreachable.
 *
 * Everything here is read back out of the document, and the undo is pressed through the button a person
 * would press, because the thing under test is what a press of that button takes back. Timers are the ones
 * the browser has: a drag whose frames are all synthetic happens inside the capture window whatever the
 * clock says, which is the honest reading of these tests — they are about boundaries, and the boundary's
 * distance from the clock is story 8's unit file's business.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { NUDGE_STEP_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import {
  cancelWindow,
  dragObject,
  moveWindow,
  noteElementById,
  objectById,
  objects,
  placeNote,
  pointOn,
  pressOn,
  renderBoard,
  textarea,
  upWindow,
} from './helpers/selection';

/** One position, so a comparison says which of the two numbers disagrees. */
function whereIs(id: string): { x: number; y: number; color: string } {
  const object = objectById(id);
  // A sticky always has a colour; an object of some other type might not, and this helper is written to be
  // able to say so without lying about a number.
  return { x: object.x, y: object.y, color: object.color ?? '' };
}

function undoButton(): HTMLButtonElement {
  return screen.getByTestId('undo') as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByTestId('redo') as HTMLButtonElement;
}

/**
 * Whether the button is saying "there is nothing here".
 *
 * Both halves are checked, because the board is drawn on a browser that will not grey a button out on its
 * own: `disabled` is what stops a keyboard reaching it and `aria-disabled` is what tells a screen reader.
 */
function isOff(button: HTMLButtonElement): boolean {
  return button.disabled && button.getAttribute('aria-disabled') === 'true';
}

function nothingLeftToUndo(): boolean {
  return isOff(undoButton());
}

/** The press of the button a person would press. */
function pressUndo(): void {
  fireEvent.click(undoButton());
}

/**
 * Open a note that is already on the board, and wait until it can be typed into.
 *
 * Aimed at the note, not at the board: a double-click that lands on the surface beside a note makes a new
 * note, which is the right answer for a person and would be a silently different test.
 */
async function openNote(id: string): Promise<void> {
  const at = pointOn(objectById(id), 'centre');
  fireEvent.doubleClick(noteElementById(id), { clientX: at.x, clientY: at.y });
  await waitFor(() => expect(textarea().value).toBe(''));
}

/**
 * Type into the note that is open, one keystroke at a time as far as the board is concerned.
 *
 * The browser's own undo is what the board has to answer inside a text field, so the typing is written the
 * way a browser writes it: the value changes, and an `input` event reports it.
 */
function typeIntoEditor(text: string): void {
  const element = textarea();
  element.value = element.value + text;
  fireEvent.input(element);
}

function pressRedo(): void {
  fireEvent.click(redoButton());
}

/** The object is gone from the board; the honest way to ask whether its creation was undone. */
function isOnBoard(id: string): boolean {
  return objects().some((object) => object.id === id);
}

describe('undo step boundaries', () => {
  it('TC-14: a drag drawn over thirty frames is one thing that happened, and one thing that goes back', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const start = whereIs(id);
    const travelled = { x: start.x + 120, y: start.y + 60 };

    // Thirty frames, held open by hand rather than by the `drag` helper, because the point of this test is
    // what the document looks like *during* them.
    const from = pointOn(objectById(id), 'centre');
    pressOn(id);
    for (let frame = 1; frame <= 30; frame += 1) {
      moveWindow({ x: from.x + frame * 4, y: from.y + frame * 2 });
    }
    // The frames really were written, one after another: the document is where the last of them put it. A
    // gesture that had only ever written once would pass the rest of this test without testing anything.
    await waitFor(() => expect(whereIs(id)).toEqual({ ...travelled, color: 'yellow' }));
    upWindow({ x: from.x + 120, y: from.y + 60 });

    // One press takes back all thirty frames at once, to where the note was before the pointer went down —
    // not to where the twenty-ninth frame left it.
    pressUndo();
    await waitFor(() => expect(whereIs(id)).toEqual(start));

    // And the whole drag comes back on one press of the other button, which is the same claim read the
    // other way: thirty writes in, one step out.
    pressRedo();
    await waitFor(() => expect(whereIs(id)).toEqual({ ...travelled, color: 'yellow' }));

    // The history holds exactly the two things this test did — make a note, move a note — and the pointer
    // is back at the end of it, so one more press takes the drag back again and the one after that takes
    // the note away. A drag drawn as thirty steps would need twenty-eight more presses before the note
    // went anywhere.
    pressUndo();
    await waitFor(() => expect(whereIs(id)).toEqual(start));
    pressUndo();
    await waitFor(() => expect(isOnBoard(id)).toBe(false));
    expect(nothingLeftToUndo()).toBe(true);
  });

  it('TC-15: a move and a colour two frames apart are two steps, and undo takes them one at a time', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const start = whereIs(id);

    dragObject(id, 100, 0);
    await waitFor(() => expect(objectById(id).x).toBe(start.x + 100));

    // The colour, straight after: no pause, no second thought, well inside the capture window. The window
    // would have merged these into one step; the boundary at the end of the drag is the only reason it did
    // not, and this is the test that says so.
    const bothWithinTheWindow = Date.now();
    fireEvent.click(screen.getByTestId('color-blue'));
    await waitFor(() => expect(objectById(id).color).toBe('blue'));
    expect(Date.now() - bothWithinTheWindow).toBeLessThan(UNDO_CAPTURE_TIMEOUT_MS);

    // First press: the colour, and only the colour.
    pressUndo();
    await waitFor(() => expect(objectById(id).color).toBe('yellow'));
    expect(objectById(id).x).toBe(start.x + 100);

    // Second press: the move, which the colour click had not swallowed.
    expect(nothingLeftToUndo()).toBe(false);
    pressUndo();
    await waitFor(() => expect(objectById(id).x).toBe(start.x));
  });

  it('TC-16: typing undone inside a note leaves the move that came before it where it is', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const start = whereIs(id);

    dragObject(id, 140, 40);
    await waitFor(() => expect(objectById(id).x).toBe(start.x + 140));

    // Open the note again and write in it — on the note itself, because a double-click aimed at the board
    // beside it would make a new note rather than open this one.
    await openNote(id);
    typeIntoEditor('draft');
    expect(textarea().value).toBe('draft');

    // The keystroke a person reaches for while typing: the browser's own undo, which this time belongs to
    // the board, and takes the word and nothing else.
    fireEvent.keyDown(textarea(), { key: 'z', ctrlKey: true });
    await waitFor(() => expect(textarea().value).toBe(''));

    // The note is still where it was dragged to. The move is a different step, and the typing was never in
    // it — and it is still there to be had back, which is what the button is for.
    expect(whereIs(id)).toEqual({ ...start, x: start.x + 140, y: start.y + 40 });
    expect(nothingLeftToUndo()).toBe(false);

    pressUndo();
    await waitFor(() => expect(whereIs(id)).toEqual(start));
  });

  it('TC-17: a gesture given up halfway through is still a thing that happened, and is undone as one', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const start = whereIs(id);

    const from = pressOn(id);
    moveWindow({ x: from.x + 40, y: from.y + 40 });
    // The move landed while the pointer was still down: a cancel that rolled the note back itself would
    // leave this next line with nothing to prove.
    await waitFor(() => expect(objectById(id).x).toBe(start.x + 40));
    cancelWindow({ x: from.x + 40, y: from.y + 40 });

    // A gesture the system took away is not a gesture that never happened: the note is forty units along,
    // and so it stays until this person says otherwise. One press, and it is home.
    expect(whereIs(id)).toEqual({ ...start, x: start.x + 40, y: start.y + 40 });
    pressUndo();
    await waitFor(() => expect(whereIs(id)).toEqual(start));

    // One step, not one per frame: nothing is left but the note's own creation.
    pressUndo();
    await waitFor(() => expect(isOnBoard(id)).toBe(false));
    expect(nothingLeftToUndo()).toBe(true);
  });

  it('a press that never travelled is a click, and a click writes no step at all', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const start = whereIs(id);

    // Select it again by pressing and releasing without moving, then let go of the note and press undo.
    const at = pressOn(id);
    upWindow(at);
    expect(whereIs(id)).toEqual(start);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    // The only step in the history is the note's creation, so the press below is the second thing this test
    // did, not a third: a click that opened a step would leave the note in the board after two presses.
    pressUndo();
    await waitFor(() => expect(isOnBoard(id)).toBe(false));
    expect(nothingLeftToUndo()).toBe(true);
  });

  it('a delete and the nudge that came before it are two steps, and come back one at a time', async () => {
    renderBoard();
    const id = await placeNote({ x: 650, y: 250 });
    const placed = whereIs(id);
    const nudged = { ...placed, x: placed.x + NUDGE_STEP_WORLD, y: placed.y };

    // One arrow key is one step, and one write: the note is one unit along, which is a thing a person did.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(whereIs(id)).toEqual({ ...nudged, color: 'yellow' }));

    // Then the delete, immediately after — inside the capture window, and a step of its own anyway.
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(isOnBoard(id)).toBe(false));

    // The delete comes back first, and comes back as the delete left it: one unit along, because the nudge
    // was never part of it.
    pressUndo();
    await waitFor(() => expect(isOnBoard(id)).toBe(true));
    expect(whereIs(id)).toEqual({ ...nudged, color: 'yellow' });

    // And the nudge is still there to be had back, which is the half of this that a merged history loses.
    pressUndo();
    await waitFor(() => expect(whereIs(id)).toEqual({ ...placed, color: 'yellow' }));
  });
});
