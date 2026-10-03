// tools.active_tool component tests (story 10, TC-22, TC-23e, TC-31).
//
// Which tool the tab is holding is this client's own state, so every assertion here is
// about what the rail shows pressed, what the surface says a click would do, and — the
// part that matters — what the keyboard is allowed to touch. Story 10 adds two tool
// letters to a board that already had two, and the one way that goes wrong is a letter
// that means two things: 's' as the Shape tool and 's' as the letter Dana is typing into
// a shape's label. Everything runs on the real board with the real window listeners, so
// the guard is tested as a person meets it.

import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { deleteObjects, objectSnapshots } from '../../src/shared/board-model';
import { TYPING_BURST_MS } from '../../src/client/board/typingGuard';
import { createShape } from '../../src/shared/objects/shape';
import {
  boardDoc,
  createNote,
  doubleClick,
  editorEl,
  keyOn,
  noteCount,
  noteEl,
  pointer,
  renderBoard,
  textObjectIds,
  windowKey,
} from './helpers';
import { lastProvider, resetProviderStub } from './y-websocket-stub';

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' });
const shapeBtn = () => screen.getByRole('button', { name: 'Shape (S)' });
const connectorBtn = () => screen.getByRole('button', { name: 'Connector (L)' });

function pressed(el: HTMLElement): boolean {
  return el.getAttribute('aria-pressed') === 'true';
}

/** What the rail says is held, by its pressed state rather than by any internal state. */
function heldTool(): string {
  for (const [name, el] of [
    ['select', selectBtn()],
    ['text', textBtn()],
    ['shape', shapeBtn()],
    ['connector', connectorBtn()],
  ] as const) {
    if (pressed(el)) return name;
  }
  return 'none';
}

/** How many objects of any type the board holds. */
function objects(): number {
  return objectSnapshots(boardDoc()).length;
}

/**
 * The id of a shape the test asked the model to draw, or a failure that names the thing
 * that actually went wrong. The model can refuse, and a test that passed null downstream
 * would fail on an assertion about an element instead.
 */
function created(id: string | null): string {
  if (id === null) throw new Error('the model refused to create it');
  return id;
}

/**
 * Draw a shape through the model, inside `act`, so the board has rendered it by the time
 * the test goes looking for its element. The board re-renders from the document observer,
 * and an unwrapped write leaves the element unmounted.
 */
function drawShape(x: number, y: number): string {
  let id: string | null = null;
  act(() => {
    id = createShape(boardDoc(), { at: { x, y } }, 'local-tab');
  });
  return created(id);
}

/** Press a sticky note and release: selects it (story 7's gesture). */
function clickSticky(id: string): void {
  const el = noteEl(id);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

describe('tools.active_tool', () => {
  beforeEach(() => {
    resetProviderStub();
  });

  // TC-22 / TC-23e: both new tools are reached by a letter, and both let go the same
  // way — one key back to Select, and nothing at all left behind on the board.
  it('TC-23e S and L hold a tool; V and Escape put it down', () => {
    renderBoard();
    expect(heldTool()).toBe('select');

    windowKey('s');
    expect(heldTool()).toBe('shape');
    expect(pressed(connectorBtn())).toBe(false);
    windowKey('Escape');
    expect(heldTool()).toBe('select');

    windowKey('l');
    expect(heldTool()).toBe('connector');
    windowKey('v');
    expect(heldTool()).toBe('select');

    // Uppercase is the same key, and a letter nothing names is not a shortcut.
    windowKey('S');
    expect(heldTool()).toBe('shape');
    windowKey('L');
    expect(heldTool()).toBe('connector');
    windowKey('q');
    expect(heldTool()).toBe('connector');

    // Escape returns to Select and creates nothing: not a shape, not an arrow, not a
    // text object. A tool is a mode, not a pending write.
    const before = objects();
    windowKey('s');
    windowKey('Escape');
    windowKey('l');
    windowKey('Escape');
    expect(objects()).toBe(before);
    expect(objects()).toBe(0);
  });

  // TC-22: holding a tool and pressing Escape leaves the board as it was. Escape belongs
  // to two hooks at once — the tools' (put the tool down) and story 7's (put the selection
  // down) — and the two together must still never destroy anything: deleting is Delete's
  // job and nothing else's.
  it('TC-22b Escape drops the tool and takes nothing off the board', () => {
    renderBoard();
    const id = drawShape(0, 0);
    clickStickyShape(id);
    expect(screen.getByTestId(`shape-${id}`).getAttribute('data-selected')).toBe('true');

    windowKey('s');
    expect(heldTool()).toBe('shape');
    windowKey('Escape');
    expect(heldTool()).toBe('select');
    windowKey('l');
    windowKey('Escape');
    expect(heldTool()).toBe('select');
    expect(objects()).toBe(1);
    expect(screen.getByTestId(`shape-${id}`)).toBeTruthy();
  });

  // TC-31: a letter that is being typed is not a shortcut. This is the case the whole
  // guard exists for: the label editor takes the same keys the tools take.
  it('TC-31 typing a tool letter into an editor types the letter', async () => {
    renderBoard();
    const note = createNote(10, 10);
    clickSticky(note);
    doubleClick(noteEl(note));
    expect(editorEl()).toBeTruthy();

    // The caret is in the text: these are letters of a word, not requests for tools.
    for (const key of ['s', 'l', 'v', 't']) {
      keyOn(editorEl(), key);
    }
    expect(heldTool()).toBe('select');
    expect(textObjectIds()).toHaveLength(0);
    expect(noteCount()).toBe(1);

    // Out of the burst and the same letters mean tools again: the guard is a hedge
    // against a word being chopped into commands, not a ban on the letters.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TYPING_BURST_MS + 20));
    });
    windowKey('s');
    expect(heldTool()).toBe('shape');
    const shape = drawShape(400, 0);
    doubleClickShape(shape);
    const label = editorEl();
    keyOn(label, 'l');
    keyOn(label, 'v');
    expect(heldTool()).toBe('shape');
    windowKey('s');

    // A modifier chord is not a letter either — Cmd+S is the browser's save dialog and
    // Cmd+L its address bar, both of which must survive holding a tool.
    windowKey('s', { metaKey: true });
    windowKey('l', { ctrlKey: true });
    expect(heldTool()).toBe('shape');
    // Escape still gets out, even though letters are currently owned by the field.
    keyOn(label, 'Escape');
    expect(heldTool()).toBe('shape');
    windowKey('v');
    expect(heldTool()).toBe('select');
  });

  // TC-31's other half, the one that happens for real: the field is deleted out from
  // under the person typing in it (story 2), and the rest of their keystrokes land on a
  // board with focus on nothing. Those characters are still their text.
  it('TC-31b a burst aimed at a shape label that vanished switches no tool', async () => {
    renderBoard();
    const shape = drawShape(0, 0);
    doubleClickShape(shape);
    expect(editorEl()).toBeTruthy();

    // A character the label field swallowed, then a colleague deletes the shape.
    keyOn(editorEl(), 'w');
    act(() => {
      deleteObjects(boardDoc(), [shape]);
    });
    await act(async () => {});
    expect(objects()).toBe(0);

    // The rest of the word belongs to a shape that is gone: no tool, no object.
    windowKey('s');
    windowKey('l');
    expect(heldTool()).toBe('select');
    expect(objects()).toBe(0);

    // A moment later the person has plainly stopped typing, and now the board does
    // take the shortcut: this is a burst guard, not a ban.
    await new Promise((resolve) => setTimeout(resolve, TYPING_BURST_MS + 20));
    windowKey('s');
    expect(heldTool()).toBe('shape');
  });

  // A board that could not be loaded cannot hold a tool that would draw on it, but it
  // must still take the key that stops everything.
  it('TC-23f a board that cannot be edited ignores S and L and still takes V', () => {
    renderBoard();
    act(() => lastProvider()!.emitClose(CLOSE_BOARD_LOAD_FAILED));

    expect(shapeBtn()).toHaveProperty('disabled', true);
    expect(connectorBtn()).toHaveProperty('disabled', true);

    windowKey('s');
    expect(heldTool()).toBe('select');
    windowKey('l');
    expect(heldTool()).toBe('select');
    // The rail cannot be clicked into either.
    act(() => {
      shapeBtn().click();
      connectorBtn().click();
    });
    expect(heldTool()).toBe('select');

    // V only ever stops something, so it is always available.
    windowKey('v');
    expect(heldTool()).toBe('select');
    // And N still creates nothing on a board that is not really there.
    windowKey('n');
    expect(noteCount()).toBe(0);
  });

  // The rail says which kind a click will draw, and remembering it is the tool's job
  // (shape.menu) — not of the board, the document or the other person's screen.
  it('TC-22c the Shape button shows the kind menu with the kind that will be drawn', () => {
    renderBoard();
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull();

    windowKey('s');
    const menu = screen.getByTestId('shape-kind-menu');
    expect(menu).toBeTruthy();
    expect(
      screen.getByRole('menuitemradio', { name: 'Rectangle' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Ellipse' }).getAttribute('aria-checked'),
    ).toBe('false');

    // Picking a kind keeps the tool held: the menu is how the next shape is chosen.
    act(() => {
      screen.getByRole('menuitemradio', { name: 'Diamond' }).click();
    });
    expect(heldTool()).toBe('shape');
    expect(
      screen.getByRole('menuitemradio', { name: 'Diamond' }).getAttribute('aria-checked'),
    ).toBe('true');

    // Leaving the tool puts the menu away.
    windowKey('Escape');
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull();
    expect(objects()).toBe(0);
  });

  // N is a story 2 action that lives on the tool hook now; it must survive the move.
  it('TC-22d N still creates a sticky note, whatever tool is held', () => {
    renderBoard();
    windowKey('n');
    expect(noteCount()).toBe(1);
    expect(heldTool()).toBe('select');

    windowKey('s');
    windowKey('n');
    expect(noteCount()).toBe(2);
    // Creating a note leaves the Shape tool held: the note was an action, not a mode.
    expect(heldTool()).toBe('shape');
  });
});

/** Press a shape and release: selects it, the way every other object is selected. */
function clickStickyShape(id: string): void {
  const el = screen.getByTestId(`shape-${id}`);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

/** Double-click a shape: opens its label editor (shape.label). */
function doubleClickShape(id: string): void {
  const el = screen.getByTestId(`shape-${id}`);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
  doubleClick(el);
}
