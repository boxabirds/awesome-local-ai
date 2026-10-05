/**
 * The two buttons and the keys that answer the same command (TC-18 to TC-21).
 *
 * The story's fourth problem is that undo does not say what it can do, so most of this file is about the
 * disabled state: when it has to be true, when it has to be false, and that it is written down in the two
 * ways a browser and a screen reader both read (`disabled` and `aria-disabled`) rather than in a colour.
 * The rest is about the reach of the shortcut — that it answers on the board, answers inside a note, and
 * answers nowhere else, because a keystroke taken from a text field that is not a note is a keystroke taken
 * from the browser.
 *
 * Whether a keystroke was answered is read two ways, because each catches a different mistake: the return
 * value of `fireEvent.keyDown` says whether the board called `preventDefault` (it returns false when
 * something did), and the document says whether the command actually happened. A shortcut that prevented
 * without doing anything would pass the first and fail the second; one that undid the board while leaving
 * the browser's own undo in place would pass the second and fail the first.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createSticky } from '../../src/shared/board-model';
import { BoardPage } from '../../src/client/pages/BoardPage';
import type { BoardConnector } from '../../src/client/board/useBoardDoc';
import {
  noteElementById,
  objectById,
  objects,
  placeNote,
  pointOn,
  renderBoard,
  somebodyElse,
  textarea,
} from './helpers/selection';
import { BOARD_ID, boardExists } from './helpers/stickyBoard';

function undoButton(): HTMLButtonElement {
  return screen.getByTestId('undo') as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByTestId('redo') as HTMLButtonElement;
}

/**
 * Whether a button is saying there is nothing here.
 *
 * `disabled` is what keeps a keyboard off it; `aria-disabled` is what says so out loud. The board is drawn
 * for browsers that will not grey a button out by themselves, so both are needed and both are asserted.
 */
function isOff(button: HTMLButtonElement): boolean {
  return button.disabled && button.getAttribute('aria-disabled') === 'true';
}

function isOn(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

function idsOnBoard(): string[] {
  return objects().map((object) => object.id).sort();
}

function onBoard(id: string): boolean {
  return objects().some((object) => object.id === id);
}

/** The board's own keystrokes, sent where a person's would go: the window. */
function pressKey(init: Parameters<typeof fireEvent.keyDown>[1]): boolean {
  return fireEvent.keyDown(window, init);
}

/**
 * The same keystroke, sent to a field, which is how a test says where the caret was.
 *
 * A key event fired at a field reaches the board's window listener by bubbling, exactly as it does in a
 * browser, and arrives carrying the field as its target — which is the only thing the board reads to decide
 * whether the keystroke is its own.
 */
function pressKeyIn(field: Element, init: Parameters<typeof fireEvent.keyDown>[1]): boolean {
  return fireEvent.keyDown(field, init);
}

/** The undo chord as every platform has it. */
const UNDO_CHORDS = [
  { name: 'Ctrl+Z', init: { key: 'z', ctrlKey: true } },
  { name: 'Cmd+Z', init: { key: 'z', metaKey: true } },
];

const REDO_CHORDS = [
  { name: 'Ctrl+Shift+Z', init: { key: 'Z', ctrlKey: true, shiftKey: true } },
  { name: 'Cmd+Shift+Z', init: { key: 'Z', metaKey: true, shiftKey: true } },
  { name: 'Ctrl+Y', init: { key: 'y', ctrlKey: true } },
];

describe('the undo buttons', () => {
  it('TC-18: on a board nobody here has changed, both buttons say there is nothing to do', async () => {
    renderBoard();

    expect(isOff(undoButton())).toBe(true);
    expect(isOff(redoButton())).toBe(true);
  });

  it('TC-18b: a board whose only changes came from other people still has nothing for these buttons to do', async () => {
    renderBoard();

    // Four notes, made by four other people, arriving with nobody's local mark on them.
    somebodyElse((doc) => {
      for (const x of [100, 400, 700, 1000]) createSticky(doc, { x, y: 200 });
    });
    await waitFor(() => expect(objects()).toHaveLength(4));

    // The board is full of work and the history is empty, which is the whole of this story told in two
    // buttons: what a colleague did is not something this person can take back, and the buttons do not
    // pretend otherwise.
    expect(isOff(undoButton())).toBe(true);
    expect(isOff(redoButton())).toBe(true);

    // And pressing them changes nothing, rather than doing the nearest available thing.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(objects()).toHaveLength(4);
  });

  it('a button lights up for the thing it can do, and goes back to sleep when it has been done', async () => {
    renderBoard();
    expect(isOff(undoButton())).toBe(true);

    await placeNote({ x: 300, y: 300 });
    await waitFor(() => expect(isOn(undoButton())).toBe(true));
    // Undo has been done but nothing has been taken back, so there is nothing to redo.
    expect(isOff(redoButton())).toBe(true);

    fireEvent.click(undoButton());
    await waitFor(() => expect(isOff(undoButton())).toBe(true));
    await waitFor(() => expect(isOn(redoButton())).toBe(true));

    fireEvent.click(redoButton());
    await waitFor(() => expect(isOn(undoButton())).toBe(true));
    expect(isOff(redoButton())).toBe(true);
  });

  it('the buttons are named, and say where the shortcut is', async () => {
    renderBoard();

    expect(undoButton().getAttribute('aria-label')).toBe('Undo');
    expect(redoButton().getAttribute('aria-label')).toBe('Redo');
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });
});

describe('the undo shortcuts', () => {
  it('TC-19: every undo and redo chord is answered by the board, and by nobody else', async () => {
    renderBoard();
    const first = await placeNote({ x: 250, y: 250 });
    const second = await placeNote({ x: 650, y: 250 });

    // Each chord is pressed while there is something for it to do, so that "it was prevented" and "it was
    // answered" are both visible rather than one standing in for the other.
    expect(pressKey({ key: 'z', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(onBoard(second)).toBe(false));

    expect(pressKey({ key: 'z', metaKey: true })).toBe(false);
    await waitFor(() => expect(onBoard(first)).toBe(false));
    expect(idsOnBoard()).toEqual([]);

    // Three chords for the way back, and the board comes back the way it went: the first note first.
    expect(pressKey({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe(false);
    await waitFor(() => expect(onBoard(first)).toBe(true));

    expect(pressKey({ key: 'Z', metaKey: true, shiftKey: true })).toBe(false);
    await waitFor(() => expect(onBoard(second)).toBe(true));

    // Ctrl+Y is answered too — the board prevents it, which is the point on the platforms where the browser
    // would otherwise have its own use for it — and by now there is nothing left to redo, so it has nothing
    // to show. Both notes are back, which means the undo stack is full again: the history did not shrink by
    // being walked through, which is what a working redo is for.
    expect(pressKey({ key: 'y', ctrlKey: true })).toBe(false);
    expect(idsOnBoard()).toEqual([first, second].sort());
    expect(isOn(undoButton())).toBe(true);
    expect(isOff(redoButton())).toBe(true);
  });

  it('a chord pressed with nothing to undo is taken off the browser and does nothing else', async () => {
    renderBoard();

    for (const chord of [...UNDO_CHORDS, ...REDO_CHORDS]) {
      expect(pressKey(chord.init)).toBe(false);
    }
    expect(objects()).toEqual([]);
    expect(screen.getByTestId('board-root')).toBeInTheDocument();
  });

  it('TC-21: the chord belongs to an ordinary text field, not to the board', async () => {
    renderBoard();
    // Two notes on the board, so there is something for an undo to take back if the chord were hijacked; the
    // share panel is opened below, and its link field is where the keystroke goes instead.
    await placeNote({ x: 250, y: 250 });
    await placeNote({ x: 650, y: 250 });
    const board = idsOnBoard();

    // The share panel's link field: a text field the board drew, but not one the board writes to. It is
    // filled with the board's own address, which is the field the browser's undo belongs to.
    fireEvent.click(screen.getByTestId('share-button'));
    const link = screen.getByTestId('share-link') as HTMLInputElement;
    link.focus();

    for (const chord of [...UNDO_CHORDS, ...REDO_CHORDS]) {
      // Not prevented: inside a field the browser's own undo is the right answer, and it needs the key.
      expect(pressKeyIn(link, chord.init)).toBe(true);
    }

    // The board is exactly as it was. The controller was not called, which is the only way this test can
    // tell "not called" from "called and did nothing useful" — the two notes are still there.
    expect(idsOnBoard()).toEqual(board);
  });

  it('the chord is answered inside a note as the board, and not twice', async () => {
    renderBoard();
    const id = await placeNote({ x: 300, y: 300 });
    const before = objectById(id);

    // Open the note and write in it, then undo from inside it.
    const at = pointOn(objectById(id), 'centre');
    fireEvent.doubleClick(noteElementById(id), { clientX: at.x, clientY: at.y });
    await waitFor(() => expect(textarea()).toBeTruthy());
    textarea().value = 'hello';
    fireEvent.input(textarea());
    await waitFor(() => expect(objectById(id).text).toBe('hello'));

    expect(fireEvent.keyDown(textarea(), { key: 'z', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(objectById(id).text).toBe(''));

    // The note is where it always was, and the creation is still underneath the typing: the keystroke was
    // answered once, by the editor, and did not travel on to the board's own handler.
    expect(objectById(id).x).toBe(before.x);
    expect(objectById(id).y).toBe(before.y);
    expect(isOff(undoButton())).toBe(false);
  });

  it('TC-20: a board that could not be loaded has no undo in it, in either of the two ways in', async () => {
    const refused: BoardConnector = (_doc, _boardId, onState) => {
      onState('load_failed');
      return { destroy(): void {} };
    };
    render(<BoardPage id={BOARD_ID} connect={refused} check={boardExists} />);
    await waitFor(() => expect(objects()).toEqual([]));

    // Notes arrive from other people, so the board is not empty and there is something a mistaken undo
    // could have reached for.
    somebodyElse((doc) => {
      createSticky(doc, { x: 200, y: 200 });
      createSticky(doc, { x: 500, y: 200 });
    });
    await waitFor(() => expect(objects()).toHaveLength(2));
    const board = idsOnBoard();

    // Both buttons are off, whatever the history of the board itself happens to contain.
    expect(isOff(undoButton())).toBe(true);
    expect(isOff(redoButton())).toBe(true);

    // And the shortcuts are ignored: not prevented, so a browser that has an undo of its own somewhere else
    // keeps it, and above all nothing is written into a document that is about to be thrown away.
    for (const chord of [...UNDO_CHORDS, ...REDO_CHORDS]) {
      expect(pressKey(chord.init)).toBe(true);
    }
    expect(idsOnBoard()).toEqual(board);

    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(idsOnBoard()).toEqual(board);
  });
});
