/**
 * The two buttons, and the keys that do the same thing (TC-18 to TC-21).
 *
 * What is under test is the control surface: whether the buttons say the truth about what this
 * person can wind back, whether the shortcuts reach the same history as the buttons, and whether
 * an undo with nothing to undo is a nothing rather than an error. What the history itself is made
 * of is the business of `undo-history.test.ts` (the model) and `UndoSteps.test.tsx` (a whole
 * action at a time).
 *
 * The buttons are only worth what the document says they are worth, so where a claim is about
 * "nothing happening" it is counted at the document - an update is a transaction, and a disabled
 * button that wrote to the document would be counted even though the screen looked unmoved.
 */

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { boardOf, noteSeeds } from '../fixtures/boards';
import { snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { flushFrames } from './helpers';
import {
  centreOnScreen,
  clickRedo,
  clickUndo,
  doubleClick,
  doubleClickBoard,
  isDisabled,
  mountSticky,
  pressKeyIn,
  pressCombo,
  redoTitle,
  typeInto,
  undoTitle,
  type MountedSticky,
} from './helpers/sticky';
import { forgetProviders, theProvider, type FakeWebsocketProvider } from './helpers/fake-provider';

// See the note in connectBoard.test.ts: the client's provider is stubbed, and the import happens
// inside the factory because `vi.mock` is hoisted above the imports at the top of this file.
vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

const undoButton = (board: MountedSticky): HTMLButtonElement =>
  board.view.getByTestId('undo') as HTMLButtonElement;
const redoButton = (board: MountedSticky): HTMLButtonElement =>
  board.view.getByTestId('redo') as HTMLButtonElement;

/** A board with two notes on it that this person did not make. */
async function boardSomebodyElseFilled(): Promise<MountedSticky> {
  return mountSticky(boardOf(noteSeeds(2)));
}

/** Everything the document was asked to write, counted at the document. */
function countWrites(doc: Y.Doc): () => number {
  let writes = 0;
  doc.on('update', () => {
    writes += 1;
  });
  return () => writes;
}

/**
 * A note made by this person, and nothing else: made by double-click, then left.
 *
 * Leaving it matters. A note that was just double-clicked into existence is open for typing, and
 * while a note is open the keyboard belongs to that note - so a test that pressed Ctrl+Z there
 * would be testing the editor, which has its own section below.
 */
async function madeANote(board: MountedSticky, at = { x: 0, y: 0 }): Promise<string> {
  const id = await doubleClickBoard(board, at);
  pressKeyIn(board.editor(), 'Escape');
  await flushFrames();
  return id;
}

beforeEach(() => {
  forgetProviders();
});

describe('the two buttons (TC-18)', () => {
  it('TC-18 opens with nothing to undo and nothing to redo', async () => {
    const board = await boardSomebodyElseFilled();

    // Both buttons are there, and say what they are.
    expect(undoButton(board)).toBeTruthy();
    expect(redoButton(board)).toBeTruthy();
    expect(undoTitle(board)).toContain('Ctrl/Cmd + Z');
    expect(redoTitle(board)).toContain('Ctrl/Cmd + Shift + Z');

    // Nothing on this board was made by this tab, so there is nothing of this tab's to wind back -
    // the notes being on screen is not a step.
    expect(isDisabled(undoButton(board))).toBe(true);
    expect(isDisabled(redoButton(board))).toBe(true);
    expect(board.noteCount()).toBe(2);
  });

  it('the buttons take a note back and return it', async () => {
    const board = await mountSticky();

    // The toolbar's own button, which puts a note in the middle of what is visible.
    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrames();
    expect(board.noteCount()).toBe(1);

    // Making a note is something this person did, so it can be undone.
    expect(isDisabled(undoButton(board))).toBe(false);
    expect(isDisabled(redoButton(board))).toBe(true);

    clickUndo(board);
    await flushFrames();
    expect(board.noteCount()).toBe(0);
    expect(isDisabled(undoButton(board))).toBe(true);
    expect(isDisabled(redoButton(board))).toBe(false);

    clickRedo(board);
    await flushFrames();
    expect(board.noteCount()).toBe(1);
    expect(isDisabled(undoButton(board))).toBe(false);
    expect(isDisabled(redoButton(board))).toBe(true);
  });

  it('the buttons keep a pile of steps in order', async () => {
    const board = await mountSticky();
    const first = await doubleClickBoard(board, { x: -400, y: 0 });
    const second = await doubleClickBoard(board, { x: -200, y: 0 });
    const third = await doubleClickBoard(board, { x: 0, y: 0 });
    expect(board.noteCount()).toBe(3);

    // The undo button does not skip to the beginning: one press, one step, newest first.
    clickUndo(board);
    await flushFrames();
    expect(board.notes().map((note) => note.id)).toEqual([first, second]);

    clickUndo(board);
    await flushFrames();
    expect(board.notes().map((note) => note.id)).toEqual([first]);

    clickRedo(board);
    clickRedo(board);
    await flushFrames();
    expect(board.notes().map((note) => note.id)).toEqual([first, second, third]);

    // The third note went away and came back; nobody had to be told which one was meant.
    expect(board.element(third)).toBeTruthy();
  });
});

describe('undo and redo keyboard shortcuts (TC-19)', () => {
  it('TC-19 undoes with Ctrl+Z and with the Apple key', async () => {
    const board = await mountSticky();
    await madeANote(board);
    expect(board.noteCount()).toBe(1);

    expect(pressCombo('KeyZ', { ctrlKey: true })).toBe(true);
    await flushFrames();
    expect(board.noteCount()).toBe(0);

    // Back and forth again, this time holding the Apple key instead of Control.
    pressCombo('KeyY', { ctrlKey: true });
    await flushFrames();
    expect(board.noteCount()).toBe(1);
    expect(pressCombo('KeyZ', { metaKey: true })).toBe(true);
    await flushFrames();
    expect(board.noteCount()).toBe(0);
  });

  it('TC-19 redoes with Ctrl+Shift+Z and with Ctrl+Y, whatever the casing', async () => {
    const board = await mountSticky();
    await madeANote(board);
    pressCombo('KeyZ', { ctrlKey: true });
    await flushFrames();
    expect(board.noteCount()).toBe(0);

    expect(pressCombo('KeyZ', { ctrlKey: true, shiftKey: true })).toBe(true);
    await flushFrames();
    expect(board.noteCount()).toBe(1);

    pressCombo('KeyZ', { ctrlKey: true });
    await flushFrames();
    expect(board.noteCount()).toBe(0);

    // Ctrl+Y is the Windows convention and is here for people who grew up with it.
    expect(pressCombo('KeyY', { ctrlKey: true })).toBe(true);
    await flushFrames();
    expect(board.noteCount()).toBe(1);

    pressCombo('KeyZ', { ctrlKey: true });
    await flushFrames();
    // The same key in the other direction, with the letter as a capital - the browser reports the
    // physical key either way, and so does this.
    expect(pressCombo('KeyZ', { ctrlKey: true, shiftKey: true, key: 'Z' })).toBe(true);
    await flushFrames();
    expect(board.noteCount()).toBe(1);
  });

  it('TC-19 takes the keys off the browser only when there is something to take', async () => {
    const board = await mountSticky();

    // With nothing to wind back, Ctrl+Z is left alone: the app did not do this thing, so the
    // app's key handling says so rather than swallowing a keystroke for a history that is empty.
    expect(pressCombo('KeyZ', { ctrlKey: true })).toBe(false);
    expect(pressCombo('KeyZ', { ctrlKey: true, shiftKey: true })).toBe(false);

    await madeANote(board);
    expect(pressCombo('KeyZ', { ctrlKey: true })).toBe(true);
  });

  it('TC-19 does not undo twice while a note is being written in', async () => {
    const board = await mountSticky();
    const id = await doubleClickBoard(board, { x: 0, y: 0 });

    // The note is open for typing, and it was made a moment ago - so there are two steps in the
    // history, and the one nearer the top is the typing.
    doubleClick(board.element(id), centreOnScreen(board, board.object(id)));
    await flushFrames();
    const editor = board.editor();
    for (const char of 'one') {
      typeInto(editor, char);
    }
    await flushFrames();
    expect(board.object(id).text).toBe('one');

    // One press inside the editor. The keystroke is taken from the browser, because the browser's
    // own undo of a textarea would wind the words back behind the document and the two would never
    // agree again.
    expect(pressKeyIn(editor, 'z', { ctrlKey: true })).toBe(true);
    await flushFrames();

    // Exactly one step went back: the typing. Both the editor and the board answer Ctrl+Z, and
    // they answer it from the one history - so the test that matters is that the note's creation,
    // which is the step underneath, is still there. Were the press handled twice over, once by the
    // editor and once by the window, the note itself would be gone.
    expect(board.object(id).text).toBe('');
    expect(board.noteCount()).toBe(1);
    expect(board.editorOrNull()).not.toBeNull();

    // The same key with Shift goes the other way in the same history, and again only one step.
    expect(pressKeyIn(editor, 'z', { ctrlKey: true, shiftKey: true })).toBe(true);
    await flushFrames();
    expect(board.object(id).text).toBe('one');
    expect(board.noteCount()).toBe(1);
  });
});

describe('nothing to undo is not an error', () => {
  it('an empty history undoes nothing, by button and by key', async () => {
    const board = await mountSticky();
    const writes = countWrites(board.doc);
    const before = JSON.stringify(snapshot(board.doc));

    // The button is disabled, so a browser would not deliver the click at all; jsdom does, which is
    // what makes this the test of the handler behind the button and not only of the button.
    expect(isDisabled(undoButton(board))).toBe(true);
    fireEvent.click(undoButton(board));
    await flushFrames();

    // And the shortcut, which is the other way to ask for the same nothing.
    pressCombo('KeyZ', { ctrlKey: true });
    pressCombo('KeyY', { ctrlKey: true });
    pressCombo('KeyZ', { ctrlKey: true, shiftKey: true });
    await flushFrames();

    expect(board.noteCount()).toBe(0);
    expect(JSON.stringify(snapshot(board.doc))).toBe(before);
    expect(writes()).toBe(0);
    expect(isDisabled(undoButton(board))).toBe(true);
    expect(isDisabled(redoButton(board))).toBe(true);
  });

  it('a history wound all the way back does nothing more', async () => {
    const board = await mountSticky();
    await madeANote(board);
    const writes = countWrites(board.doc);

    clickUndo(board);
    await flushFrames();
    expect(isDisabled(undoButton(board))).toBe(true);
    const empty = JSON.stringify(snapshot(board.doc));

    // A handful more presses at the bottom of the stack.
    clickUndo(board);
    clickUndo(board);
    pressCombo('KeyZ', { ctrlKey: true });
    await flushFrames();

    expect(JSON.stringify(snapshot(board.doc))).toBe(empty);
    // One write for the note, one for taking it back, and nothing since.
    expect(writes()).toBe(1);
  });
});

describe('a board that cannot be written on (TC-20)', () => {
  it('TC-20 keeps the buttons quiet on a board that could not be loaded', async () => {
    const board = await mountSticky(boardOf(noteSeeds(2)), { boardId: 'b1' });
    const provider: FakeWebsocketProvider = theProvider();
    provider.socketOpens();
    provider.sync();
    await flushFrames();

    // Something this person made, so there IS a step - and then the board stops being knowable.
    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrames();
    expect(isDisabled(undoButton(board))).toBe(false);
    const notes = board.noteCount();
    const writes = countWrites(board.doc);

    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    await flushFrames();

    // Story 4's edit lock covers undo, because undo is a write: the buttons go disabled with
    // everything else, and pressing them - by mouse or by key - changes nothing.
    expect(isDisabled(undoButton(board))).toBe(true);
    expect(isDisabled(redoButton(board))).toBe(true);
    fireEvent.click(undoButton(board));
    fireEvent.click(redoButton(board));
    pressCombo('KeyZ', { ctrlKey: true });
    pressCombo('KeyZ', { ctrlKey: true, shiftKey: true });
    await flushFrames();

    expect(board.noteCount()).toBe(notes);
    expect(writes()).toBe(0);

    // And when the board comes back, the step that was there is still there.
    provider.socketOpens();
    provider.sync();
    await flushFrames();
    expect(isDisabled(undoButton(board))).toBe(false);
    clickUndo(board);
    await flushFrames();
    expect(board.noteCount()).toBe(notes - 1);
  });
});

describe('a field that is not a note (TC-21)', () => {
  it('TC-21 leaves Ctrl+Z to whatever field the keystroke was typed into', async () => {
    const board = await mountSticky();
    await madeANote(board);
    const writes = countWrites(board.doc);

    // There is something to undo, so a shortcut that reached past the field would be noticed.
    expect(isDisabled(undoButton(board))).toBe(false);

    // The share dialog's link field is the one the story names, and it belongs to the page around
    // the board rather than to the board - so the field here is a plain input sitting on the same
    // page, which is all the board's key handling is ever told: a keydown whose target is an input.
    const field = document.createElement('input');
    field.setAttribute('data-testid', 'share-link');
    document.body.appendChild(field);
    try {
      field.focus();

      // Both directions of the shortcut, typed into the field: the board does not act, and does
      // not even take the keystroke, because a field's own undo is the browser's business.
      expect(pressKeyIn(field, 'z', { ctrlKey: true })).toBe(false);
      expect(pressKeyIn(field, 'z', { ctrlKey: true, shiftKey: true })).toBe(false);
      expect(pressKeyIn(field, 'y', { ctrlKey: true })).toBe(false);
      await flushFrames();

      expect(board.noteCount()).toBe(1);
      expect(writes()).toBe(0);
      expect(isDisabled(undoButton(board))).toBe(false);

      // And so is every other board shortcut pressed in the same field, including the ones that do
      // not write: the guard is "this keystroke belongs to a field", said before the board is asked
      // anything at all, and it holds for Select all as much as for Undo.
      expect(pressKeyIn(field, 'a', { ctrlKey: true })).toBe(false);
      expect(board.noteCount()).toBe(1);
    } finally {
      field.remove();
    }
  });
});
