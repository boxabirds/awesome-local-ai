/**
 * What counts as one thing a person did (story 8, TC-14 to TC-17).
 *
 * The board writes the same document over and over while a gesture is in progress — a position every
 * animation frame, a character every keystroke — and a history that remembered each of those would be
 * useless: nobody wants to press undo forty times to get a note back where it was. So the board tells
 * the history where its actions begin and end, and this file checks that it tells the truth, on the
 * real board, through the real pointer and the real keyboard.
 *
 * Three of these cases are about the drag, one is about the pause between two actions, and one is about
 * a gesture the system took away mid-drag. The last is the reason the boundary is not written where the
 * position is written: a pointercancel never reaches the code that writes positions, but it does reach
 * the end of the gesture.
 *
 * Coordinates are the harness's: a 1280×800 window whose camera starts at (−640, −400) at zoom 1, so a
 * note created at world (0, 0) is drawn with its centre in the middle of the screen.
 */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, type StickyColor } from '../../src/shared/config';
import {
  act,
  doubleClick,
  nextFrame,
  pointer,
  renderBoard,
  settle,
  type as typeIntoNote,
  noteText,
  type BoardFixture,
} from './harness';

/* ------------------------------------------------------------------ the two buttons */

function undoButton(): HTMLElement {
  return screen.getByTestId('undo');
}

function redoButton(): HTMLElement {
  return screen.getByTestId('redo');
}

const disabled = (element: HTMLElement): boolean => element.hasAttribute('disabled');

/** Presses Undo, and says so in the failure message when there was nothing for it to do. */
async function undo(): Promise<void> {
  const button = undoButton();
  if (disabled(button)) throw new Error('Undo was disabled — the history held something else');
  await tap(button);
}

async function redo(): Promise<void> {
  const button = redoButton();
  if (disabled(button)) throw new Error('Redo was disabled — there was nothing to put back');
  await tap(button);
}

/**
 * A press, a release and the click they make. Board surfaces are driven by the pointer; buttons need
 * the click as well, because jsdom does not invent one.
 */
async function tap(target: HTMLElement, point = { x: 0, y: 0 }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await act(async () => {
    fireEvent.click(target);
    await nextFrame();
  });
}

/** Where a note is, leaving out what the selection happens to be saying about it. */
function where(fx: BoardFixture, id: string): { x: number; y: number; z: number; color: string } {
  const box = fx.noteBox(id);
  return { x: box.x, y: box.y, z: box.z, color: box.color };
}

/** The note's element, or a failure that says which note went missing. */
function el(fx: BoardFixture, id: string): HTMLElement {
  const found = fx.objectEl(id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

/* ------------------------------------------------------------------ the pointer */

/** Selects a note and leaves it the only thing selected. */
async function select(fx: BoardFixture, id: string): Promise<void> {
  await tap(el(fx, id), fx.screenOf(id));
}

/**
 * Drags an object in `frames` moves, waiting an animation frame between each so that every move is
 * really written rather than coalesced away — the gesture writes at most once per frame, so thirty
 * moves fired in one breath would be one write, and a test about thirty writes would be testing nothing.
 *
 * Returns how many transactions the drag put on the document, which is the number that has to be well
 * above one for the assertion that follows it to mean anything.
 */
async function dragInFrames(
  fx: BoardFixture,
  id: string,
  dx: number,
  dy: number,
  frames: number,
  end: 'pointerUp' | 'pointerCancel' = 'pointerUp',
): Promise<number> {
  const target = el(fx, id);
  const from = fx.screenOf(id);

  let writes = 0;
  const counted = (_update: unknown, origin: unknown): void => {
    if (origin === LOCAL_ORIGIN) writes += 1;
  };
  const doc = fx.doc();
  doc.on('update', counted);

  pointer('pointerDown', target, from);
  for (let frame = 1; frame <= frames; frame += 1) {
    pointer('pointerMove', target, {
      x: from.x + (dx * frame) / frames,
      y: from.y + (dy * frame) / frames,
    });
    await act(nextFrame);
  }
  pointer(end, target, { x: from.x + dx, y: from.y + dy });
  await act(nextFrame);

  doc.off('update', counted);
  return writes;
}

describe('one gesture, one step', () => {
  it('TC-14 takes a whole drag of a selection back in one press', async () => {
    const fx = renderBoard();
    const first = await fx.create(-200, 0);
    const second = await fx.create(200, 0, 'blue');
    await fx.selectAll();

    const before = { a: where(fx, first), b: where(fx, second) };
    const writes = await dragInFrames(fx, first, 240, 120, 30);
    const after = { a: where(fx, first), b: where(fx, second) };

    // The drag was a drag: many writes, and both notes moved by the same amount.
    expect(writes, 'thirty frames of a drag write far more than one transaction').toBeGreaterThan(5);
    expect(after.a.x).toBe(before.a.x + 240);
    expect(after.b.x).toBe(before.b.x + 240);

    await undo();

    // One press, both notes home — including the second one, whose note the pointer never touched.
    expect(where(fx, first)).toEqual(before.a);
    expect(where(fx, second)).toEqual(before.b);
    // And nothing else went with them. The notes are still notes, still wearing what they were wearing.
    expect(fx.notes()).toHaveLength(2);
    expect(where(fx, second).color).toBe('blue');
    expect(noteText(fx, second)).toBe('');
  });

  it('TC-14 puts the whole drag back where it was, in one press, at the moment it ended', async () => {
    // The other half of the same promise: the step that comes back is the whole of it, so Redo returns
    // twelve frames of movement at once rather than the last frame of them.
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const start = where(fx, id);

    await dragInFrames(fx, id, 300, 0, 12);
    const moved = where(fx, id);
    expect(moved.x).toBe(start.x + 300);

    await undo();
    expect(where(fx, id).x).toBe(start.x);

    await redo();
    expect(where(fx, id)).toEqual(moved);
  });

  it('TC-15 keeps a colour chosen straight after a drag a separate step from the drag', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const start = where(fx, id);

    await dragInFrames(fx, id, 200, 100, 4);
    // No pause worth the name: the swatch is clicked as soon as the note has landed, well inside the
    // half second that would otherwise let the history call the two writes one burst.
    await tap(screen.getByTestId('color-pink'));

    expect(where(fx, id).color).toBe('pink');
    expect(where(fx, id).x).toBe(start.x + 200);

    await undo();
    // The colour went, the position stayed: two things the person did, however close together.
    expect(where(fx, id).color).toBe(DEFAULT_STICKY_COLOR);
    expect(where(fx, id).x).toBe(start.x + 200);

    await undo();
    expect(where(fx, id).x).toBe(start.x);
    expect(where(fx, id).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-15 keeps a bin click that follows a drag separate from the drag', async () => {
    // The same boundary serves every single write an object makes: the bin is a write the way a colour is.
    const fx = renderBoard();
    const dragged = await fx.create(0, 0);
    const binned = await fx.create(-300, 0, 'green');

    await dragInFrames(fx, dragged, 150, 0, 3);
    const moved = where(fx, dragged);

    // No pause: pick the other note out and drop it in the bin, both well inside the capture window.
    await select(fx, binned);
    await tap(screen.getByTestId('delete-note'));
    expect(fx.notes()).toHaveLength(1);

    await undo();
    // The note is back, and the drag is still where it was left: two things the person did.
    expect(fx.notes()).toHaveLength(2);
    expect(where(fx, dragged)).toEqual(moved);

    await undo();
    // The next press takes the drag back, and leaves the note that was binned and restored alone.
    expect(where(fx, dragged).x).toBe(moved.x - 150);
    expect(fx.notes()).toHaveLength(2);
  });

  it('TC-16 undoes the words typed into a note without undoing where the note was moved', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const start = where(fx, id);

    // A move — one step, taken by the pointer.
    await dragInFrames(fx, id, 200, 100, 3);
    const moved = where(fx, id);
    expect(moved.x).toBe(start.x + 200);

    // …and then the note is opened and typed into, which is the second step.
    doubleClick(el(fx, id), fx.screenOf(id));
    await settle();
    expect(fx.selection().editingId).toBe(id);
    for (const character of 'hello') await typeIntoNote(character);
    expect(fx.textArea().value).toBe('hello');

    // Ctrl+Z with the caret still inside the text. The browser is not asked: it would rewind the words
    // on this screen and leave the document — and everybody else's screens — still holding them.
    const leftToTheBrowser = fireEvent.keyDown(fx.textArea(), { key: 'z', ctrlKey: true });
    await settle();

    expect(leftToTheBrowser, 'the board took the keystroke out of the browser’s hands').toBe(false);
    expect(fx.textArea().value).toBe('');
    // The negative half: the move is a step of its own, and it is where it was left.
    expect(where(fx, id).x).toBe(moved.x);
    expect(where(fx, id).y).toBe(moved.y);

    // The move is still there to take back, and the next press takes it back.
    fireEvent.keyDown(fx.textArea(), { key: 'z', ctrlKey: true });
    await settle();
    expect(where(fx, id).x).toBe(start.x);
  });

  it('TC-17 ends a drag the operating system took away as one step', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const start = where(fx, id);

    // A touch the system reclaims — a gesture recognizer, a notification, a phone deciding what the
    // finger meant. The board is told it happened, and the drag is over.
    const writes = await dragInFrames(fx, id, 180, 60, 6, 'pointerCancel');
    expect(writes).toBeGreaterThan(2);
    expect(where(fx, id).x).toBe(start.x + 180);

    // What it wrote is one step, and one press takes it back. Nothing is left half-finished, and the
    // history never had to know the difference between this and a person letting go.
    await undo();
    expect(where(fx, id)).toEqual(start);
    expect(fx.notes()).toHaveLength(1);
  });

  it('TC-17 leaves the board usable after a drag that was interrupted', async () => {
    // The same interruption, and the thing a person does next: pick the note up again. A session left
    // lying around would move this second drag from where the cancelled one started.
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const start = where(fx, id);

    await dragInFrames(fx, id, 120, 0, 3, 'pointerCancel');
    const cancelled = where(fx, id);

    await dragInFrames(fx, id, 90, 0, 3);
    expect(where(fx, id).x).toBe(cancelled.x + 90);

    // Two drags, two steps: the one that was taken away and the one that was finished.
    await undo();
    expect(where(fx, id).x).toBe(cancelled.x);
    await undo();
    expect(where(fx, id).x).toBe(start.x);
  });

  it('TC-14 drags one of six and takes all six back with one press', async () => {
    const fx = renderBoard();
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const color = colors[index] ?? 'yellow';
      ids.push(await fx.create((index % 3) * 220 - 220, Math.floor(index / 3) * 220 - 110, color));
    }
    await fx.selectAll();
    expect(fx.selection().size).toBe(6);

    const dragged = ids[0];
    const before = ids.map((id) => where(fx, id));
    if (dragged === undefined) throw new Error('six notes were asked for');
    await dragInFrames(fx, dragged, 140, 40, 8);

    await undo();
    // Every one of the six, to the position and the layer it was at, in one press — and each still
    // wearing the colour it was given, because the drag did not touch colours and undo does not either.
    ids.forEach((id, index) => {
      expect(where(fx, id)).toEqual(before[index]);
    });
  });

  it('TC-16 keeps two visits to the same note as two steps', async () => {
    // Typing into a note, closing it, and typing into it again is two things the person did: closing
    // the note ended a step, whatever the clock says about the gap between them.
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const centre = fx.screenOf(id);

    doubleClick(el(fx, id), centre);
    await settle();
    await typeIntoNote('first');
    fireEvent.keyDown(fx.textArea(), { key: 'Escape' });
    await settle();

    doubleClick(el(fx, id), centre);
    await settle();
    await typeIntoNote(' second');
    expect(fx.textArea().value).toBe('first second');

    fireEvent.keyDown(fx.textArea(), { key: 'z', ctrlKey: true });
    await settle();
    // The second visit went; the first is still there.
    expect(noteText(fx, id)).toBe('first');

    // Out of the text, and the next press takes the first visit back too.
    fireEvent.keyDown(fx.textArea(), { key: 'Escape' });
    await settle();
    fireEvent.keyDown(el(fx, id), { key: 'z', ctrlKey: true });
    await settle();
    expect(noteText(fx, id)).toBe('');
  });
});
