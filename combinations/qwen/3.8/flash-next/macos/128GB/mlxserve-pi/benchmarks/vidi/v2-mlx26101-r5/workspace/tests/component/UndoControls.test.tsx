/**
 * The two controls, and who is allowed to use them (story 8, TC-18 to TC-21).
 *
 * Everything here is checked on the real board through the buttons and the keyboard, because that is
 * where the promise lives: a person presses a key and the last thing they did comes back — or the board
 * refuses, and says why on the button. The history itself is never looked at: the buttons' enabled state
 * is the only window these tests have into it, which is the same window the person has.
 *
 * The last describe block is the case that is easy to get wrong and hard to notice. A keystroke that
 * belongs to somebody else's interface — a link field, a note being typed into — must not be spent
 * undoing the board, and a keystroke that the board *has* taken must not be left to the browser, which
 * would rewind this screen and nobody else's.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SharePanel } from '../../src/client/share/SharePanel';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { FakeProvider } from './helpers/fake-provider';
import {
  act,
  board,
  doubleClick,
  nextFrame,
  pointer,
  renderBoard,
  settle,
  type as typeIntoNote,
  VIEWPORT,
  type BoardFixture,
} from './harness';

/** A board id, so the page in the last block really has a board to share. */
const BOARD_ID = 'boardboardboardboard01';

/* ------------------------------------------------------------------ controls */

function undoButton(): HTMLElement {
  return screen.getByTestId('undo');
}

function redoButton(): HTMLElement {
  return screen.getByTestId('redo');
}

const disabled = (element: HTMLElement): boolean => element.hasAttribute('disabled');

/** A press, a release and the click they make, on anything that is not the board surface. */
async function tap(target: HTMLElement, point = { x: 0, y: 0 }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await act(async () => {
    fireEvent.click(target);
    await nextFrame();
  });
}

interface Modifiers {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

/** Fires a chord at the window; returns whether the browser was left with it. */
function press(key: string, modifiers: Modifiers = {}): boolean {
  return fireEvent.keyDown(window, {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: false,
  });
}

/** A chord, and whatever the board did about it once the document has settled. */
async function chord(key: string, modifiers: Modifiers = {}): Promise<boolean> {
  const leftToTheBrowser = press(key, modifiers);
  await settle();
  return leftToTheBrowser;
}

/** Presses Undo — and says so when there was nothing for it to do. */
async function undo(): Promise<void> {
  if (disabled(undoButton())) throw new Error('Undo was disabled');
  await tap(undoButton());
}

async function redo(): Promise<void> {
  if (disabled(redoButton())) throw new Error('Redo was disabled');
  await tap(redoButton());
}

/** Where a note is, leaving out what the selection happens to be saying about it. */
function where(fx: BoardFixture, id: string): { x: number; y: number; z: number; color: string } {
  const box = fx.noteBox(id);
  return { x: box.x, y: box.y, z: box.z, color: box.color };
}

function el(fx: BoardFixture, id: string): HTMLElement {
  const found = fx.objectEl(id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

/** Picks a note up and puts it down somewhere else, which is the cheapest step a test can make. */
async function moved(fx: BoardFixture, id: string, dx = 200, dy = 100): Promise<void> {
  const from = fx.screenOf(id);
  await fx.dragObject(id, from, { x: from.x + dx, y: from.y + dy });
}

describe('TC-18 — the two buttons say what there is to take back', () => {
  it('starts with neither of them able to do anything', () => {
    renderBoard();

    // A board nobody has done anything on has nothing to undo and nothing to redo.
    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('says what each one does, and how to ask for it without the mouse', () => {
    renderBoard();

    expect(undoButton().getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().getAttribute('title')).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    expect(undoButton().getAttribute('aria-label')).toBe('Undo');
    expect(redoButton().getAttribute('aria-label')).toBe('Redo');
  });

  it('enables Undo for the work just done and keeps Redo dark', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);

    // The note is on the board because this person put it there, so that is the thing Undo offers back.
    expect(disabled(undoButton())).toBe(false);
    expect(disabled(redoButton())).toBe(true);

    await undo();
    expect(fx.notes()).toHaveLength(0);
    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(false);

    // And the round trip ends where it began, with Redo dark again.
    await redo();
    expect(fx.notes()).toHaveLength(1);
    expect(fx.noteBox(id).x).toBe(-100);
    expect(disabled(undoButton())).toBe(false);
    expect(disabled(redoButton())).toBe(true);
  });

  it('does nothing at all when they are clicked with nothing to do', async () => {
    const fx = renderBoard();
    let writes = 0;
    fx.doc().on('update', () => {
      writes += 1;
    });

    await tap(undoButton());
    await tap(redoButton());

    // A disabled button is disabled: not a transaction, not a surprise on somebody else's screen.
    expect(writes).toBe(0);
    expect(fx.notes()).toHaveLength(0);
  });

  it('walks back through one person’s actions in order, and forward again', async () => {
    const fx = renderBoard();
    const first = await fx.create(-200, 0);
    const second = await fx.create(200, 0, 'blue');
    const homes = { a: where(fx, first), b: where(fx, second) };

    await moved(fx, first, 0, 200);

    // The move comes back first, because it happened last — and the note created before it is untouched.
    await undo();
    expect(where(fx, first)).toEqual(homes.a);
    expect(where(fx, second)).toEqual(homes.b);

    // The next step back is the two notes being made: they were made one after the other, inside one
    // burst, so the history is right to have called them one thing the person did.
    await undo();
    expect(fx.notes()).toHaveLength(0);

    // Forward again, in the order they were done.
    await redo();
    expect(fx.notes()).toHaveLength(2);
    expect(where(fx, second)).toEqual(homes.b);
    await redo();
    expect(where(fx, first).y).toBe(homes.a.y + 200);
  });
});

describe('TC-19 — the keyboard chords', () => {
  it('takes all five chords and leaves none of them to the browser', async () => {
    const fx = renderBoard();
    const kept = await fx.create(-400, 0);
    const dragged = await fx.create(0, 0);
    const home = where(fx, dragged);
    const keptHome = where(fx, kept);

    // One step to walk: a note picked up and put down somewhere else. The two creations under it are a
    // step of their own, and the walk leaves them alone until it asks for them.
    await moved(fx, dragged, 200, 0);
    expect(where(fx, dragged).x).toBe(home.x + 200);

    // Ctrl+Z — back.
    expect(await chord('z', { ctrl: true }), 'Ctrl+Z was left to the browser').toBe(false);
    expect(where(fx, dragged).x).toBe(home.x);
    expect(fx.notes()).toHaveLength(2);

    // Cmd+Z — back again, past the drag to the two notes being made.
    expect(await chord('z', { meta: true }), 'Cmd+Z was left to the browser').toBe(false);
    expect(fx.notes()).toHaveLength(0);

    // Ctrl+Shift+Z — forward: both notes, because both were made in one burst.
    expect(await chord('z', { ctrl: true, shift: true })).toBe(false);
    expect(fx.notes()).toHaveLength(2);
    expect(where(fx, dragged).x).toBe(home.x);
    expect(where(fx, kept)).toEqual(keptHome);

    // Ctrl+Y — forward again, on the chord people on Windows were taught first: the drag.
    expect(await chord('y', { ctrl: true })).toBe(false);
    expect(where(fx, dragged).x).toBe(home.x + 200);

    // Cmd+Shift+Z — forward, and there is nothing further forward. The chord is still the board's to
    // take, and it does nothing with it: the note stays, the browser gets nothing, no dialog appears.
    expect(await chord('z', { meta: true, shift: true })).toBe(false);
    expect(where(fx, dragged).x).toBe(home.x + 200);
    expect(fx.notes()).toHaveLength(2);
    expect(disabled(undoButton())).toBe(false);
    expect(disabled(redoButton())).toBe(true);
  });

  it('is the same board whether the step was taken back by key or by button', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const home = where(fx, id);

    await chord('z', { ctrl: true });
    expect(fx.notes()).toHaveLength(0);
    await redo();
    expect(where(fx, id)).toEqual(home);

    await undo();
    expect(fx.notes()).toHaveLength(0);
    await chord('z', { ctrl: true, shift: true });
    expect(where(fx, id)).toEqual(home);
  });

  it('takes a chord pressed on a toolbar button as a keystroke for the board', async () => {
    // A focused *button* is not a text field. A board whose toolbar swallowed Ctrl+Z would be a board
    // whose keyboard had stopped working, in the one place people look for it.
    const fx = renderBoard();
    const id = await fx.create(0, 0);

    undoButton().focus();
    expect(await chord('z', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(0);
    expect(fx.objectEl(id)).toBeNull();
  });

  it('spends one chord on one step, however far back the person wants to go', async () => {
    const fx = renderBoard();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) ids.push(await fx.create(index * 220 - 330, 0));

    // Four notes, made one after another in one burst: one chord takes all four back, because the
    // person made them without pausing, and a chord is one step.
    expect(await chord('z', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(0);

    // Nothing further back: the chord is still the board's to take — a board you can write on owns
    // Ctrl+Z, whatever its history is holding — and it does nothing with it. The board stays empty.
    expect(await chord('z', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(0);

    // Forward again, all four at once.
    expect(await chord('y', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(4);
  });
});

describe('TC-20 — a board the room cannot read has nothing to take back', () => {
  /** The board, the room, and the two answers the room gives. */
  function aBoard(): { fx: BoardFixture; loadFails(): Promise<void>; boardArrives(): Promise<void> } {
    const provider = new FakeProvider();
    const fx = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });

    const emit = async (what: () => void): Promise<void> => {
      await act(async () => {
        what();
        await nextFrame();
      });
    };

    return {
      fx,
      loadFails: () => emit(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED)),
      boardArrives: async () => {
        await emit(() => {
          provider.emitStatus('connected');
          provider.emitSync(true);
        });
      },
    };
  }

  it('disables both buttons, says why on each of them, and refuses the keyboard', async () => {
    const { fx, loadFails } = aBoard();
    const id = await fx.create(0, 0);
    const home = where(fx, id);

    await loadFails();

    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    // The reason is on the button: a control that stops working in silence is a bug report.
    expect(undoButton().getAttribute('title')).toContain("couldn't be loaded");
    expect(redoButton().getAttribute('title')).toContain("couldn't be loaded");

    // The history still holds the note that was made. The chords are left to the browser, which has
    // nothing to do with them, and the board does not move.
    expect(await chord('z', { ctrl: true }), 'a board that cannot write took a chord anyway').toBe(true);
    expect(await chord('z', { ctrl: true, shift: true })).toBe(true);
    expect(await chord('y', { ctrl: true })).toBe(true);
    expect(where(fx, id)).toEqual(home);
    expect(fx.notes()).toHaveLength(1);

    // And clicking them is the same thing: no-ops, not half-applications.
    await tap(undoButton());
    await tap(redoButton());
    expect(where(fx, id)).toEqual(home);
    expect(fx.notes()).toHaveLength(1);
  });

  it('gives the shortcuts back the moment the board arrives', async () => {
    const { fx, loadFails, boardArrives } = aBoard();
    const id = await fx.create(0, 0);
    const home = where(fx, id);

    await loadFails();
    expect(disabled(undoButton())).toBe(true);

    await boardArrives();

    expect(disabled(undoButton())).toBe(false);
    expect(undoButton().getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(await chord('z', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(0);

    // The step was never lost, only held: the note comes back.
    await chord('z', { ctrl: true, shift: true });
    expect(where(fx, id)).toEqual(home);
  });

  it('is not undone by a chord, pressed however many times, while it is locked', async () => {
    const { fx, loadFails } = aBoard();
    const id = await fx.create(0, 0);

    await loadFails();
    let writes = 0;
    fx.doc().on('update', () => {
      writes += 1;
    });

    for (let press = 0; press < 10; press += 1) {
      await chord('z', { ctrl: true });
      await chord('z', { ctrl: true, shift: true });
      await chord('y', { ctrl: true });
    }

    expect(writes, 'nothing was written to a board the room cannot read').toBe(0);
    expect(fx.noteBox(id).x).toBe(-100);
    expect(disabled(undoButton())).toBe(true);
  });

  it('holds its silence while the board is locked and a note is being typed into', async () => {
    // The locked board closes an open editor; a chord pressed afterwards is not the editor's and not
    // the board's either, and goes nowhere.
    const { fx, loadFails } = aBoard();
    const id = await fx.create(0, 0);
    doubleClick(el(fx, id), fx.screenOf(id));
    await settle();
    expect(fx.selection().editingId).toBe(id);

    await loadFails();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();

    expect(await chord('z', { ctrl: true })).toBe(true);
    expect(fx.notes()).toHaveLength(1);
    expect(disabled(undoButton())).toBe(true);
  });
});

describe('TC-21 — a keystroke that belongs somewhere else is spent nowhere', () => {
  it('leaves Ctrl+Z to the share link field and does not touch the board', async () => {
    const fx = renderBoard();
    // The share panel belongs to the board's page, and carries a text field with a browser undo in it.
    render(<SharePanel boardId={BOARD_ID} origin="http://localhost:5173" copy={async () => undefined} />);

    const id = await fx.create(0, 0);
    const home = where(fx, id);
    await moved(fx, id, 200, 0);
    const movedTo = where(fx, id);
    expect(movedTo.x).toBe(home.x + 200);

    await tap(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link-field');

    // Ctrl+Z with the caret in the link field: the field's own business. The board leaves it, and the
    // note stays where it was put.
    expect(fireEvent.keyDown(field, { key: 'z', ctrlKey: true })).toBe(
      true,
    );
    await settle();
    expect(where(fx, id)).toEqual(movedTo);
    expect(disabled(undoButton()), 'the step is still there to be had').toBe(false);

    // Out of the field and on to the board, and the same chord is the board's again — one step, the
    // note still there, only somewhere else now.
    expect(await chord('z', { ctrl: true })).toBe(false);
    expect(fx.notes()).toHaveLength(1);
    expect(where(fx, id).x).toBe(home.x);
  });

  it('lets the note editor answer for Ctrl+Z while a note is open', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const home = where(fx, id);

    await moved(fx, id, 200, 0);
    doubleClick(el(fx, id), fx.screenOf(id));
    await settle();
    await typeIntoNote('hello');
    const editor = fx.textArea();

    // The board does not see this one, and the note does not move: the editor holds the keystroke, and
    // takes it out of the browser's hands, because the board's history is the one with authority here.
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(false);
    await settle();
    expect(fx.textArea().value).toBe('');
    expect(where(fx, id).x).toBe(home.x + 200);
    expect(fx.notes()).toHaveLength(1);
    expect(fx.selection().editingId).toBe(id);
  });

  it('does not let a chord pressed in the board’s own surface go missing', async () => {
    // The board surface is not a text field either: Ctrl+Z pulled from the middle of the canvas works.
    const fx = renderBoard();
    await fx.create(0, 0);

    fireEvent.keyDown(board(), { key: 'z', ctrlKey: true });
    await settle();
    expect(fx.notes()).toHaveLength(0);
  });
});
