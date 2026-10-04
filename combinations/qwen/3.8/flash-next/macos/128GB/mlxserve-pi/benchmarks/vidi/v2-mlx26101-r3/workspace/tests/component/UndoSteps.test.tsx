import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { Point } from '../../src/client/canvas/camera';
import {
  cancelDrag,
  centreOnScreen,
  clickUndo,
  doubleClick,
  doubleClickBoard,
  dragWithPointer,
  mountSticky,
  pressKey,
  pressCombo,
  pressKeyIn,
  moveTo,
  press,
  release,
  shiftDrag,
  typeInto,
} from './helpers/sticky';
import { flushFrames } from './helpers';

/**
 * What one press of undo takes back, on the real board.
 *
 * An undo step is supposed to be the change a person meant, and the things a person means are
 * things like "write this sentence", "put that note over there", "get rid of these six". None of
 * them is a transaction: a sentence is a keystroke at a time, a move is a pointer position sixty
 * times a second. What turns many writes into one step is the pair of rules in the undo controller
 * - changes that run into each other are one change, and the board says out loud when one thing
 * stops being another - and these four are those two rules seen from the side of somebody holding
 * the mouse.
 *
 * The board here is the real one: `mountSticky` mounts the app, so the same component that calls
 * `boundary()` when a drag ends is the thing being tested. Nobody else is on this board: what the
 * history does when a peer is involved is `tests/unit/undo-history.test.ts` and
 * `tests/e2e/undo.spec.ts`.
 */

/** Put the note into its editing state and hand back the field to type into. */
async function editOn(board: Awaited<ReturnType<typeof mountSticky>>, id: string) {
  doubleClick(board.element(id), centreOnScreen(board, board.object(id)));
  await flushFrames();
  return board.editor();
}

/** Type the way a person types: one character per change, the way the field reports one keystroke. */
function keystrokes(editor: HTMLTextAreaElement, text: string): void {
  for (const char of text) {
    typeInto(editor, char);
  }
}

/**
 * A drag drawn out over `frames` animation frames, which is what a real drag is: the pointer
 * reports a position sixty times a second, and the app writes a position to the document once per
 * frame it is given. The frames are flushed as they go, so every one of them is a transaction that
 * really happened and has to be merged back into one step.
 */
async function dragAcrossFrames(
  target: Parameters<typeof press>[0],
  from: Point,
  to: Point,
  frames: number,
): Promise<void> {
  press(target, from);
  for (let frame = 1; frame <= frames; frame += 1) {
    await moveTo(target, {
      x: from.x + ((to.x - from.x) * frame) / frames,
      y: from.y + ((to.y - from.y) * frame) / frames,
    });
    await flushFrames();
  }
  release(target, to);
  await flushFrames();
}

/**
 * A note made by double-click and then left alone.
 *
 * A note that has just been double-clicked into existence is open to be typed in, and while a note
 * is open the board takes no keyboard shortcuts and no drags - which is right, and is why a test
 * that wants to drag a note has to finish making it first.
 */
async function madeNote(board: Awaited<ReturnType<typeof mountSticky>>, at: Point): Promise<string> {
  const id = await doubleClickBoard(board, at);
  pressKeyIn(board.editor(), 'Escape');
  await flushFrames();
  return id;
}

/** Choose a colour off the note's own toolbar. */
async function chooseColour(
  board: Awaited<ReturnType<typeof mountSticky>>,
  colour: string,
): Promise<void> {
  const swatch = board.view.container.querySelector(`[data-color-name="${colour}"]`);
  if (swatch === null) {
    throw new Error(`the note's toolbar offers no ${colour} swatch`);
  }
  fireEvent.click(swatch);
  await flushFrames();
}

describe('what one press of undo takes back (TC-14 to TC-17)', () => {
  it('takes a written sentence back in one press', async () => {
    const board = await mountSticky();
    const id = await doubleClickBoard(board, { x: 0, y: 0 });

    const editor = await editOn(board, id);
    keystrokes(editor, 'Buy milk');
    await flushFrames();
    // Read out of the document: while a note is being written in, the words are in the field, not
    // in the text element the note is normally drawn with.
    expect(board.object(id).text).toBe('Buy milk');
    // Leave the note, which is where a change of mind about the words stops being a change of the
    // words.
    pressKeyIn(board.editor(), 'Escape');
    await flushFrames();
    expect(board.textOf()).toBe('Buy milk');

    // One press, and the sentence is gone - not one letter per press, which is what a history of
    // transactions would do to somebody who typed eleven of them.
    clickUndo(board);
    await flushFrames();
    expect(board.textOf()).toBe('');
    // The note is still here: taking back what was written on it does not take back the note,
    // because making the note was a different thing to do.
    expect(board.noteCount()).toBe(1);

    // And that earlier thing is still undoable, in its own turn.
    clickUndo(board);
    await flushFrames();
    expect(board.noteCount()).toBe(0);
  });

  it('puts a dragged note back where it was in one press', async () => {
    const board = await mountSticky();
    const moved = await doubleClickBoard(board, { x: -200, y: 0 });
    const kept = await doubleClickBoard(board, { x: 200, y: 0 });
    const from = board.object(moved);
    const keptWhere = board.object(kept);

    // A drag is a hundred little writes; the app writes one per frame it is given.
    const start = centreOnScreen(board, from);
    await dragWithPointer(board.element(moved), start, { x: start.x + 260, y: start.y + 140 });
    expect(board.object(moved).x).not.toBe(from.x);

    clickUndo(board);
    await flushFrames();
    expect(board.object(moved)).toEqual(from);
    // The other note was on the way, and was not part of the step.
    expect(board.object(kept)).toEqual(keptWhere);
  });

  it('undoes a move without undoing the words on the note', async () => {
    const board = await mountSticky();
    const id = await doubleClickBoard(board, { x: 0, y: 0 });

    const editor = await editOn(board, id);
    keystrokes(editor, 'a note about things');
    pressKeyIn(board.editor(), 'Escape');
    await flushFrames();
    const written = board.object(id);

    const start = centreOnScreen(board, written);
    await dragWithPointer(board.element(id), start, { x: start.x + 300, y: start.y });
    expect(board.object(id).y).toBeCloseTo(written.y, 0);
    expect(board.object(id).x).not.toBe(written.x);

    // The move was the last thing done, so it is the first thing undone - and the sentence stays
    // written, because when the writing stopped and the dragging started are two different facts.
    clickUndo(board);
    await flushFrames();
    expect(board.object(id).x).toBe(written.x);
    expect(board.textOf()).toBe('a note about things');

    clickUndo(board);
    await flushFrames();
    expect(board.textOf()).toBe('');
  });

  it('brings a whole batch of deleted notes back from one press', async () => {
    const board = await mountSticky();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(await doubleClickBoard(board, { x: (index - 1) * 260, y: 0 }));
    }
    // Writing on two of them first, so that "exactly as they were" has something to mean.
    for (const [index, id] of ids.entries()) {
      if (index === 2) {
        continue;
      }
      const editor = await editOn(board, id);
      keystrokes(editor, `note ${String(index)}`);
      pressKeyIn(board.editor(), 'Escape');
      await flushFrames();
    }
    const before = board.objects();
    expect(before).toHaveLength(3);

    // Select everything by drawing a box around it, then delete the selection.
    await shiftDrag(board, { x: 4, y: 4 }, { x: 1200, y: 700 }, 3);
    expect(board.outlineCount()).toBe(3);
    pressKey('Delete');
    await flushFrames();
    expect(board.noteCount()).toBe(0);

    clickUndo(board);
    await flushFrames();
    // Three notes, with the words that were on them, where they were. One action was performed and
    // one action is undone, whatever the number of notes it went through.
    expect(board.objects().map((object) => [object.x, object.y, object.text])).toEqual(
      before.map((object) => [object.x, object.y, object.text]),
    );
  });

  it('TC-14 brings a whole selection back from one press, however long the drag took', async () => {
    const board = await mountSticky();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(await madeNote(board, { x: (index - 1) * 300, y: index * 40 }));
    }
    // Everything on the board is chosen, so the drag carries three notes at once.
    pressCombo('KeyA', { ctrlKey: true });
    await flushFrames();
    expect(board.outlineCount()).toBe(3);

    const before = board.objects();
    // Thirty frames of one drag, which is thirty writes to the document and one thing that
    // happened. A step per transaction would need thirty presses to put three notes back, and
    // would put them back one at a time, which is not what anybody means by undo.
    const dragged = ids[0]!;
    const from = centreOnScreen(board, board.object(dragged));
    await dragAcrossFrames(board.element(dragged), from, { x: from.x + 320, y: from.y + 180 }, 30);
    const after = board.objects();
    expect(after.map((object) => object.x)).not.toEqual(before.map((object) => object.x));

    clickUndo(board);
    await flushFrames();
    // Every object is back at the place it was dragged from, in the one press - including the two
    // that were never under the mouse, which came along because the person holding the drag had
    // chosen all three.
    expect(board.objects().map((object) => [object.id, object.x, object.y])).toEqual(
      before.map((object) => [object.id, object.x, object.y]),
    );
    // Nothing else went with the drag: the three notes are still here, and each of the three
    // presses below takes one of them, which is what "making a note is a step" means - the drag
    // was one step, and making the notes was three.
    expect(board.notes()).toHaveLength(3);
    for (let remaining = 2; remaining >= 0; remaining -= 1) {
      pressCombo('KeyZ', { ctrlKey: true });
      await flushFrames();
      expect(board.objects()).toHaveLength(remaining);
    }
  });

  it('TC-15 tells a drag and the colour chosen straight after it apart', async () => {
    const board = await mountSticky();
    const id = await madeNote(board, { x: -200, y: 0 });
    const made = board.object(id);

    const start = centreOnScreen(board, made);
    await dragWithPointer(board.element(id), start, { x: start.x + 240, y: start.y + 60 });
    const moved = board.object(id);
    expect(moved.x).not.toBe(made.x);

    // The colour is chosen immediately afterwards - well inside the time in which two writes are
    // taken for one change. What separates them is not the clock: it is that one thing stopped
    // before the other began, which is a fact only the board knows and is why it says so.
    await chooseColour(board, 'blue');
    expect(board.object(id).color).toBe('blue');
    expect(board.object(id).x).toBe(moved.x);

    clickUndo(board);
    await flushFrames();
    // The colour goes back and the note stays where it was put, because the colour was a different
    // thing that was done.
    expect(board.object(id).color).toBe(made.color);
    expect(board.object(id).x).toBe(moved.x);

    clickUndo(board);
    await flushFrames();
    // and the move is the step underneath it, undone in its own turn.
    expect(board.object(id).x).toBe(made.x);
  });

  it('TC-16 takes the typing back at the keyboard without taking the move with it', async () => {
    const board = await mountSticky();
    const id = await madeNote(board, { x: 0, y: 0 });
    const made = board.object(id);

    // First a move, then the note is opened and written in: two things done, in that order.
    const start = centreOnScreen(board, made);
    await dragWithPointer(board.element(id), start, { x: start.x + 300, y: start.y });
    const moved = board.object(id);
    expect(moved.x).not.toBe(made.x);

    const editor = await editOn(board, id);
    keystrokes(editor, 'hello');
    await flushFrames();
    expect(board.object(id).text).toBe('hello');

    // Ctrl+Z with the note open for typing. What goes back is the word, and the note keeps the
    // place it was put in - which is the negative half of this case: the move is the step
    // underneath, and a press that went past the typing would have taken it too.
    pressKeyIn(editor, 'z', { ctrlKey: true });
    await flushFrames();
    expect(board.object(id).text).toBe('');
    expect(board.object(id).x).toBe(moved.x);

    // The same key, one step further down, and now it is the move that goes - the history is one
    // history, walked one step at a time, whatever key did the walking and from where.
    pressKeyIn(editor, 'z', { ctrlKey: true });
    await flushFrames();
    expect(board.object(id).x).toBe(made.x);
  });

  it('TC-17 keeps a drag the browser took away mid-way as one step', async () => {
    const board = await mountSticky();
    const id = await madeNote(board, { x: 0, y: 0 });
    const made = board.object(id);

    // Press, move, and then the browser ends the drag: no release, no chance to tidy up. Chromium
    // does this of its own accord when a note is brought to the front under the pointer and its
    // element moves out from under the capture.
    const start = centreOnScreen(board, made);
    press(board.element(id), start);
    await moveTo(board.element(id), { x: start.x + 5, y: start.y });
    await flushFrames();
    const halfway = { x: start.x + 180, y: start.y + 90 };
    await moveTo(board.element(id), halfway);
    await flushFrames();
    cancelDrag(board.element(id), halfway);
    await flushFrames();

    // The note stays where the interrupted drag left it - story 7's answer - and that place is
    // one step of history, not one step per frame it took to get there.
    const dropped = board.object(id);
    expect(dropped.x).not.toBe(made.x);

    clickUndo(board);
    await flushFrames();
    expect(board.object(id)).toEqual(made);
  });
});
