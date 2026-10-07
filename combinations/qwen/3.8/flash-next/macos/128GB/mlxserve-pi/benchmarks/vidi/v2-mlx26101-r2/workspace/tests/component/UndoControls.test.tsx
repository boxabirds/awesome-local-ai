/**
 * The two buttons, the three shortcuts, and who is allowed to use them
 * (`tests/component/UndoControls.test.tsx`, PRD `undo.controls`, TC-18 to TC-21).
 *
 * Four things these tests hold the interface to:
 *
 * - **The buttons say what is available** (TC-18). A greyed-out Undo means "there is
 *   nothing of yours to undo", which is the sentence this PRD exists because nobody
 *   could work out before. `disabled` is the real attribute - so the state is in the
 *   accessibility tree as well as on the screen - and `aria-disabled` is written
 *   beside it so it is in the markup too.
 * - **Every spelling of the shortcut works** (TC-19): Ctrl+Z and Cmd+Z undo,
 *   Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo, each refusing the browser's own undo -
 *   which is the difference between a shortcut and a page that also walks its form
 *   history back.
 * - **A board that will not take edits will not take an undo either** (TC-20): the
 *   room could not load this board, so there is nothing this tab is allowed to change,
 *   and the two buttons go grey with the rest of them.
 * - **The shortcuts belong to the board and nowhere else** (TC-21): Ctrl+Z in the
 *   share-link field is that field's own business, and a board that swallowed it would
 *   have broken the undo of an ordinary text input.
 *
 * Most of this is driven through the real board with its real history, because a button
 * whose state is a stack length is only worth testing against a stack. Where the point
 * is the state on its own - the buttons rendered from a stated `canUndo`/`canRedo`, and
 * a keystroke that must not reach a controller at all - the fake is the honest tool, and
 * those two cases use one.
 *
 * Two things every test here keeps straight, because getting them wrong is the easy way
 * to write a test that proves nothing:
 *
 * - A note made from the toolbar is a step. Notes that are simply *there* to be looked
 *   at come from `seed`, which puts them on the board the way they get there in real
 *   life when you join - an update from elsewhere, with an origin that is not this
 *   tab's, so the history starts empty and what the buttons report is this person's own
 *   work alone.
 * - Each test renders its own board, since two boards in one document means the first
 *   `[data-testid="undo-button"]` in the page belongs to a board the test is not
 *   driving.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  REDO_BUTTON_TOOLTIP,
  UndoButtons,
  UNDO_BUTTON_TOOLTIP,
} from '../../src/client/board/UndoButtons.js';
import type { UseUndoResult } from '../../src/client/board/useUndo.js';
import { SharePanel } from '../../src/client/share/SharePanel.js';
import { newBoardId } from '../../src/shared/board-id.js';
import { createSticky, initDoc, type WorldPoint } from '../../src/shared/board-model.js';
import {
  boardDoc,
  clickStickyButton,
  countDocumentWrites,
  docNotes,
  flushFrames,
  keydown,
  noteElement,
  noteScreenCentre,
  pressNote,
  renderBoard,
} from './helpers.js';
import { FakeLink, failToLoad } from './fake-link.js';

/* ------------------------------------------------------------- local helpers */

/** The origin of something that arrived from somewhere else. */
const FOREIGN: unique symbol = Symbol('vidi6-seeded-before-this-tab');

function button(testId: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`the page has no ${testId}`);
  return found;
}

const undoButton = (): HTMLButtonElement => button('undo-button');
const redoButton = (): HTMLButtonElement => button('redo-button');

/** What the two buttons are offering this person right now. */
const offered = (): { undo: boolean; redo: boolean } => ({
  undo: !undoButton().disabled,
  redo: !redoButton().disabled,
});

const clickUndo = (): void => {
  fireEvent.click(undoButton());
  flushFrames();
};
const clickRedo = (): void => {
  fireEvent.click(redoButton());
  flushFrames();
};

/** How many objects the board holds. */
const notes = (): number => docNotes().length;

/**
 * A note that was already on the board when this tab arrived, put there the way a note
 * gets onto a board somebody else is looking at: an update from another document, with
 * an origin that is not this tab's. Nothing to undo, whatever the screen holds.
 */
function seed(at: WorldPoint): string {
  const doc = boardDoc();
  const elsewhere = new Y.Doc();
  initDoc(elsewhere);
  const id = createSticky(elsewhere, at);
  if (typeof id !== 'string') throw new Error('the model refused to make a note');
  // Inside `act`, so React has rendered the note that arrived by the time the test
  // goes on to point at it.
  act(() => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(elsewhere, Y.encodeStateVector(doc)), FOREIGN);
  });
  flushFrames();
  return id;
}

/** Notes that were already there, far enough apart to be clicked one at a time. */
const seedNotes = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => seed({ x: (index - count / 2) * 300, y: 0 }));

/** The textarea of the note being typed into. */
function editorElement(): HTMLTextAreaElement {
  const found = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"]');
  if (!found) throw new Error('no note is being edited');
  return found;
}

/**
 * A note this tab made: the toolbar's own button, then Escape from the keyboard inside
 * the editor the button opened. The creation is the step, one thing this person did
 * however much the interface got ready on the way.
 */
function makeNote(): string {
  clickStickyButton();
  fireEvent.keyDown(editorElement(), { key: 'Escape' });
  flushFrames();
  const id = docNotes().at(-1)?.id;
  if (!id) throw new Error('the toolbar button made no note');
  return id;
}

/** Some notes, one after another: `count` steps in this tab's history. */
function makeNotes(count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) ids.push(makeNote());
  return ids;
}

/** Where an object is, as one comparable string - or 'gone' once it is not there. */
function positionOf(id: string): string {
  const found = docNotes().find((object) => object.id === id);
  return found ? `${found.x},${found.y}` : 'gone';
}

/** Select a note with the pointer, the way a person does before typing. */
const selectNote = (index = 0): void => {
  pressNote(noteScreenCentre(index), noteElement(index));
};

/* ---- TC-18: an empty history looks like an empty history, and says so ---- */

describe('the two buttons, and what they report (TC-18)', () => {
  it('disables both of them while there is nothing of this person’s to undo', () => {
    renderBoard();
    // Three objects on the board, and no undo yet: this person has done nothing, and
    // the buttons say so.
    seedNotes(3);
    expect(notes()).toBe(3);
    expect(offered()).toEqual({ undo: false, redo: false });
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    // A disabled button is not an attempt: the document is not touched at all.
    const { writes } = countDocumentWrites();
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    flushFrames();
    expect(writes()).toBe(0);
    expect(notes()).toBe(3);
  });

  it('says in its tooltip which shortcut it answers to', () => {
    renderBoard();
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    expect(undoButton().title).toBe(UNDO_BUTTON_TOOLTIP);
    expect(redoButton().title).toBe(REDO_BUTTON_TOOLTIP);
    expect(undoButton().getAttribute('aria-label')).toBe('Undo');
    expect(redoButton().getAttribute('aria-label')).toBe('Redo');
  });

  it('lights Undo for the first thing I do and Redo for the first thing I undo', () => {
    renderBoard();
    expect(offered()).toEqual({ undo: false, redo: false });

    fireEvent.click(button('create-sticky-button'));
    flushFrames();
    expect(offered()).toEqual({ undo: true, redo: false });
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    clickUndo();
    expect(offered()).toEqual({ undo: false, redo: true });

    clickRedo();
    expect(offered()).toEqual({ undo: true, redo: false });
  });

  it('counts an undone delete as something that happened', () => {
    renderBoard();
    const id = seed({ x: 0, y: 0 });
    selectNote();
    keydown('Delete');
    expect(notes()).toBe(0);
    expect(offered()).toEqual({ undo: true, redo: false });

    clickUndo();
    expect(notes()).toBe(1);
    expect(positionOf(id)).not.toBe('gone');
  });

  it('forgets the thing I had just undone as soon as I do something new', () => {
    renderBoard();
    const first = seed({ x: 0, y: 0 });
    selectNote();
    keydown('Delete');
    clickUndo();
    // The note is back and the delete is in the redo: that delete was the only thing
    // this tab had done, so there is nothing further left to undo.
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: false, redo: true });

    // Something new, done through the board rather than written behind its back.
    const second = makeNote();
    expect(offered()).toEqual({ undo: true, redo: false });

    // A Redo that is not there is not a button that does something else by accident:
    // clicking it leaves the board exactly as it is - both notes still there, the one
    // I had undone and brought back not deleted a second time.
    const { writes } = countDocumentWrites();
    fireEvent.click(redoButton());
    flushFrames();
    expect(writes()).toBe(0);
    expect(docNotes().map((object) => object.id)).toEqual([first, second]);
  });

  it('renders exactly the state it is given, and hands the clicks back', () => {
    // The buttons on their own, from a stated state: `disabled` and `aria-disabled`
    // move together, and a click goes to this tab's controller and nowhere else.
    cleanup();
    const undo = vi.fn();
    const redo = vi.fn();
    const state = (over: Partial<UseUndoResult> = {}): UseUndoResult => ({
      canUndo: false,
      canRedo: false,
      undo,
      redo,
      ...over,
    });

    render(<UndoButtons {...state()} />);
    expect(button('undo-button').disabled).toBe(true);
    expect(button('redo-button').disabled).toBe(true);
    expect(button('undo-button').getAttribute('aria-disabled')).toBe('true');
    expect(button('redo-button').getAttribute('aria-disabled')).toBe('true');
    // A disabled button swallows the click: the controller is not asked.
    fireEvent.click(button('undo-button'));
    fireEvent.click(button('redo-button'));
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();

    cleanup();
    render(<UndoButtons {...state({ canUndo: true })} />);
    expect(button('undo-button').disabled).toBe(false);
    expect(button('undo-button').getAttribute('aria-disabled')).toBe('false');
    expect(button('redo-button').disabled).toBe(true);
    fireEvent.click(button('undo-button'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    cleanup();
    render(<UndoButtons {...state({ canRedo: true })} />);
    expect(button('redo-button').disabled).toBe(false);
    fireEvent.click(button('redo-button'));
    expect(redo).toHaveBeenCalledTimes(1);
    // The undo mock was called once, in the state above, and not again here.
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('shows the state of this person’s history, not of the board', () => {
    renderBoard();
    // Somebody else's work, arriving while I watch: the board fills up and changes
    // colour, and there is still nothing of mine to undo.
    seedNotes(2);
    expect(offered()).toEqual({ undo: false, redo: false });

    // My own note, and one thing to undo - the two things that arrived are not in it.
    makeNote();
    expect(offered()).toEqual({ undo: true, redo: false });
    clickUndo();
    expect(notes()).toBe(2);
    expect(offered()).toEqual({ undo: false, redo: true });
  });
});

/* --------------- TC-19: every spelling of the shortcut, and the browser's own */

describe('the shortcuts (TC-19)', () => {
  it('undoes with Ctrl+Z, refusing the browser’s undo', () => {
    renderBoard();
    seedNotes(1);
    selectNote();
    keydown('Delete');
    expect(notes()).toBe(0);

    const event = keydown('z', { ctrl: true });
    expect(notes()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('undoes with Cmd+Z, refusing the browser’s undo', () => {
    renderBoard();
    seedNotes(1);
    selectNote();
    keydown('Delete');

    const event = keydown('z', { meta: true });
    expect(notes()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('redoes with Ctrl+Shift+Z, refusing the browser’s undo', () => {
    renderBoard();
    makeNote();
    keydown('z', { ctrl: true });
    expect(notes()).toBe(0);

    const event = keydown('z', { ctrl: true, shift: true });
    expect(notes()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('redoes with Cmd+Shift+Z, refusing the browser’s undo', () => {
    renderBoard();
    makeNote();
    keydown('z', { meta: true });
    expect(notes()).toBe(0);

    const event = keydown('z', { meta: true, shift: true });
    expect(notes()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('redoes with Ctrl+Y, refusing the browser’s undo', () => {
    renderBoard();
    makeNote();
    keydown('z', { ctrl: true });
    expect(notes()).toBe(0);

    const event = keydown('y', { ctrl: true });
    expect(notes()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('walks back through three steps and forward through all three', () => {
    renderBoard();
    makeNotes(3);
    expect(notes()).toBe(3);

    keydown('z', { ctrl: true });
    expect(notes()).toBe(2);
    keydown('z', { ctrl: true });
    expect(notes()).toBe(1);
    // The last note goes while nothing at all is selected, and comes back: undo is not
    // a service only a selection can ask for.
    keydown('z', { ctrl: true });
    expect(notes()).toBe(0);
    expect(offered()).toEqual({ undo: false, redo: true });

    keydown('y', { ctrl: true });
    expect(notes()).toBe(1);
    keydown('z', { ctrl: true, shift: true });
    expect(notes()).toBe(2);
    keydown('z', { meta: true, shift: true });
    expect(notes()).toBe(3);
    expect(offered()).toEqual({ undo: true, redo: false });
  });

  it('undoes a nudge, which is a step of its own', () => {
    renderBoard();
    const id = seed({ x: 0, y: 0 });
    selectNote();
    const started = positionOf(id);

    keydown('ArrowRight');
    const nudged = positionOf(id);
    expect(nudged).not.toBe(started);

    keydown('z', { ctrl: true });
    expect(positionOf(id)).toBe(started);
    expect(offered()).toEqual({ undo: false, redo: true });
    keydown('y', { ctrl: true });
    expect(positionOf(id)).toBe(nudged);
  });

  it('leaves a plain z alone', () => {
    renderBoard();
    seedNotes(1);
    // No modifier, no editor open: a 'z' at the board is a key on the board, not a
    // shortcut, and it is not swallowed on the way past.
    const event = keydown('z');
    expect(event.defaultPrevented).toBe(false);
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: false, redo: false });
  });

  it('leaves Alt+Z alone, which is somebody else’s shortcut', () => {
    renderBoard();
    seedNotes(1);
    const event = keydown('z', { ctrl: true, alt: true });
    expect(event.defaultPrevented).toBe(false);
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: false, redo: false });
  });

  it('takes back a whole drag, and the make that came before it separately', () => {
    renderBoard();
    const id = seed({ x: 0, y: 0 });
    const started = positionOf(id);
    const note = noteElement(0);
    const at = noteScreenCentre(0);

    fireEvent.pointerDown(note, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();
    for (let frame = 1; frame <= 8; frame += 1) {
      fireEvent.pointerMove(note, {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 1,
        clientX: at.x + frame * 6,
        clientY: at.y + frame * 3,
      });
      flushFrames();
    }
    fireEvent.pointerUp(note, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: at.x + 48,
      clientY: at.y + 24,
    });
    flushFrames();

    const dragged = positionOf(id);
    expect(dragged).not.toBe(started);
    expect(offered()).toEqual({ undo: true, redo: false });

    keydown('z', { ctrl: true });
    expect(positionOf(id)).toBe(started);
    expect(offered()).toEqual({ undo: false, redo: true });
  });
});

/* -------------- TC-20: a board the room would not load undoes nothing */

describe('a board that will not take edits (TC-20)', () => {
  it('greys both buttons and ignores every shortcut once the load has failed', () => {
    const link = new FakeLink();
    renderBoard(link);
    const id = makeNote();
    // This tab did make a note, so its history is not empty - and then the room said
    // it could not load this board.
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: true, redo: false });

    failToLoad(link);
    flushFrames();

    // Both buttons, whatever the history holds: a board that cannot be edited cannot
    // be undone either (PRD `undo.controls`, `undo.not_editable`).
    expect(offered()).toEqual({ undo: false, redo: false });
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    const { writes } = countDocumentWrites();
    // None of the five spellings is spent on a history that is not allowed to write,
    // and none of them is taken away from the browser either.
    expect(keydown('z', { ctrl: true }).defaultPrevented).toBe(false);
    expect(keydown('z', { meta: true }).defaultPrevented).toBe(false);
    expect(keydown('z', { ctrl: true, shift: true }).defaultPrevented).toBe(false);
    expect(keydown('z', { meta: true, shift: true }).defaultPrevented).toBe(false);
    expect(keydown('y', { ctrl: true }).defaultPrevented).toBe(false);
    flushFrames();
    expect(writes()).toBe(0);
    expect(notes()).toBe(1);
    expect(positionOf(id)).not.toBe('gone');

    // And the buttons being disabled means clicking them is not an attempt either.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    flushFrames();
    expect(writes()).toBe(0);
  });

  it('keeps undo while the board is merely unreachable', () => {
    const link = new FakeLink();
    renderBoard(link);
    makeNotes(2);
    keydown('z', { ctrl: true });
    expect(offered()).toEqual({ undo: true, redo: true });

    // The socket dropping is not the room refusing the board: work done here is still
    // this person's own and still comes back (story 4's rule).
    link.emit('disconnected', false);
    flushFrames();
    expect(offered()).toEqual({ undo: true, redo: true });
    keydown('z', { ctrl: true });
    expect(notes()).toBe(0);

    // The load failure is the other thing, and it takes the two buttons away.
    failToLoad(link);
    flushFrames();
    expect(offered()).toEqual({ undo: false, redo: false });
    const { writes } = countDocumentWrites();
    keydown('z', { ctrl: true });
    flushFrames();
    expect(writes()).toBe(0);
    expect(notes()).toBe(0);
  });
});

/* ------------------ TC-21: Ctrl+Z in somebody else's text field */

describe('Ctrl+Z outside the board (TC-21)', () => {
  it('does not touch the board while the share-link field has the keyboard', () => {
    renderBoard();
    makeNote();
    expect(offered()).toEqual({ undo: true, redo: false });

    // The real share panel in the same document as the real board: opened, with the
    // keyboard in its link field - which is where a person who has just copied a link
    // and changed their mind actually is.
    act(() => {
      render(<SharePanel boardId={newBoardId()} />);
    });
    fireEvent.click(button('share-button'));
    flushFrames();
    const field = document.querySelector<HTMLInputElement>('[data-testid="share-link"]');
    if (!field) throw new Error('the share panel shows no link field');
    field.focus();
    expect(document.activeElement).toBe(field);

    // The keystroke belongs to the field: the board spends no step on it, and does not
    // take the event away from the browser, whose own undo of the field's text is the
    // one that should run. `fireEvent` answers `false` once someone prevents it.
    expect(fireEvent.keyDown(field, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(field, { key: 'y', ctrlKey: true })).toBe(true);
    flushFrames();
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: true, redo: false });

    // Ignored rather than merely consumed: the same key at the board still has its
    // step to take back.
    keydown('z', { ctrl: true });
    expect(notes()).toBe(0);
  });

  it('does not touch the board while an ordinary input has the keyboard', () => {
    renderBoard();
    makeNote();
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-testid', 'somebodys-input');
    document.body.appendChild(input);
    input.focus();

    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'y', ctrlKey: true })).toBe(true);
    flushFrames();
    expect(notes()).toBe(1);
    expect(offered()).toEqual({ undo: true, redo: false });
    input.remove();
  });

  it('leaves a note being typed into to its own editor, which is the same history', () => {
    renderBoard();
    // The toolbar's button makes a note and opens it for typing. The board's window
    // shortcut is not the one that answers here: the editor takes the key and calls the
    // same controller, so exactly one step comes back and the note itself stays.
    clickStickyButton();
    const textarea = editorElement();
    const typed = 'typing into the note';
    fireEvent.input(textarea, { target: { value: typed } });
    flushFrames();
    expect(notes()).toBe(1);

    // The editor refuses the browser's undo, and the board's history takes the key.
    expect(fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })).toBe(false);
    flushFrames();
    expect(notes()).toBe(1);
    expect(textarea.value).toBe('');
    expect(offered()).toEqual({ undo: true, redo: true });

    // One step was undone, not two: the next one is the note itself.
    clickUndo();
    expect(notes()).toBe(0);
  });
});
