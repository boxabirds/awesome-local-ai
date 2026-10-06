/**
 * Component tests for the keys a board answers when a *selection* is in front of it (design
 * capability `sel.keyboard`, TC-27 to TC-31): select-all, the two nudge steps, and the Delete key that
 * has to know when it is being asked to delete an object and when it is being asked to delete a letter.
 *
 * The interesting part of all three is that the board is not the only thing that wants these keys.
 * Ctrl+A belongs to the browser as much as to the board; an arrow key scrolls the page when nothing is
 * selected; Backspace deletes a character in a field and an object outside one. Every one of those
 * boundaries is a `preventDefault` that is either there or not there, so the tests read the return
 * value of the dispatched event — false means the board took the key, true means it left it alone.
 *
 * Positions are read from the `data-*` attributes React renders from the document, as everywhere else
 * in this suite: jsdom has no layout, and the document is the thing two people are agreeing about.
 */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deleteObject } from '../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { registerTestBox, testboxFields } from '../fixtures/testbox';
import { FakeProvider } from './helpers/fake-provider';
import {
  act,
  board,
  click,
  nextFrame,
  noteText,
  pressKey,
  renderedCamera,
  renderBoard,
  setInput,
  VIEWPORT,
  type BoardFixture,
} from './harness';

/** Selects everything the way a Windows keyboard does, and says whether the board took the key. */
function controlA(): boolean {
  return pressKey('a', 'ctrlKey');
}

/**
 * A key pressed on the page with no modifier held: what a person actually does with an arrow key and
 * with Delete. The return value is whether the key was left alone — true is "the browser still has it".
 */
function plainKey(name: string, shift = false): boolean {
  return fireEvent.keyDown(document.body, { key: name, shiftKey: shift });
}

/** Opens the object's own editing surface, and says whether the board took the key. */
function enter(): boolean {
  return fireEvent.keyDown(document.body, { key: 'Enter' });
}

/** A board whose load failed: readable, and nothing more. */
async function readOnlyBoard(): Promise<BoardFixture> {
  const provider = new FakeProvider();
  const fx = renderBoard(VIEWPORT, { boardId: 'keyboard-test', connect: { provider } });
  const a = await fx.create(0, 0);
  await act(async () => {
    provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
    await nextFrame();
  });
  await select(fx, a);
  return fx;
}

/** Counts the transactions the document makes while the body runs: one key must be one update. */
async function writesDuring(fx: BoardFixture, body: () => Promise<void>): Promise<number> {
  let writes = 0;
  const listen = () => {
    writes += 1;
  };
  fx.doc().on('update', listen);
  await body();
  fx.doc().off('update', listen);
  return writes;
}

/** A press on an object that selects it, at the place on the screen the camera says it is. */
async function select(fx: BoardFixture, id: string): Promise<void> {
  await click(fx.objectEl(id) ?? board(), fx.screenOf(id));
}

/** A press on an object that selects it, at the place on the screen the camera says it is. */
describe('TC-27 select all', () => {
  it('takes every object on the board, of every type it can draw, in one key', async () => {
    registerTestBox();
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(600, 0);
    await fx.seedObject('box-1', testboxFields(0, 600, 1));

    // Ctrl+A is the browser's own select-all; the board has to say plainly that it took it.
    expect(controlA()).toBe(false);
    await act(nextFrame);

    expect(fx.selection().ids).toEqual(new Set([a, b, 'box-1']));
    expect(fx.barText()).toBe('3 selected');
    // And the browser's own select-all did not happen alongside the board's: no page text is
    // selected, so there is nothing for a subsequent copy to paste the board into.
    expect(window.getSelection()?.toString() ?? '').toBe('');
  });

  it('selects what is there rather than what fits on the screen', async () => {
    const fx = renderBoard();
    const near = await fx.create(0, 0);
    // Four screens away, and drawn nowhere near the viewport: select-all does not ask the camera.
    const far = await fx.create(5000, 4000);

    expect(controlA()).toBe(false);
    await act(nextFrame);

    expect(fx.selection().ids).toEqual(new Set([near, far]));
  });

  it('leaves an object this build cannot draw out of the selection', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    // A type nobody ever registered: the document holds it, the board keeps it, and no keyboard on
    // this board can put it in a selection it cannot move or draw.
    await fx.seedObject('from-a-later-story', { type: 'whiteboard', x: 0, y: 0, width: 10, height: 10, z: 1 });

    expect(controlA()).toBe(false);
    await act(nextFrame);

    expect(fx.selection().ids).toEqual(new Set([a]));
  });

  it('answers the Mac chord as well as the Windows one', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);

    expect(pressKey('a', 'metaKey')).toBe(false);
    await act(nextFrame);

    expect(fx.selection().ids).toEqual(new Set([a]));
  });

  it('TC-28 says nothing when there is nothing to select, and takes no key with it', async () => {
    const fx = renderBoard();

    // An empty board: select-all selects nothing, which is the answer the design asks for. It is not
    // an error, and the browser keeps its own select-all because the board has no opinion.
    expect(() => controlA()).not.toThrow();
    await act(nextFrame);

    expect(fx.selection().size).toBe(0);
    expect(fx.selection().editingId).toBeNull();
    expect(fx.barEl()).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  it('TC-28 leaves the chord alone when every object on the board is undrawable', async () => {
    const fx = renderBoard();
    await fx.seedObject('from-a-later-story', { type: 'whiteboard', x: 0, y: 0, width: 10, height: 10, z: 1 });

    expect(controlA()).toBe(true);
    await act(nextFrame);

    expect(fx.selection().size).toBe(0);
  });

  it('replaces a selection rather than adding to it, and writes no document', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(600, 0);
    await select(fx, a);
    expect(fx.selection().ids).toEqual(new Set([a]));

    const writes = await writesDuring(fx, async () => {
      controlA();
      await act(nextFrame);
    });

    expect(fx.selection().ids).toEqual(new Set([a, b]));
    // Selecting is a local fact about the screen: nobody else is told about it, ever.
    expect(writes).toBe(0);
  });
});

describe('TC-29 nudging a selection with the arrow keys', () => {
  it('moves the selection one world unit, and leaves the page alone', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    const before = fx.boundsOf(a);
    const camera = renderedCamera();
    const scroll = window.scrollY;

    // The page would scroll if the board did not take the key: a board that steals it and then moves
    // nothing is worse than a page that scrolls.
    expect(plainKey('ArrowRight')).toBe(false);
    await act(nextFrame);

    expect(fx.boundsOf(a)).toMatchObject({ x: before.x + NUDGE_STEP_WORLD, y: before.y });
    // Nothing about the *view* changed: the arrow moves the object, and panning is the pointer's job.
    expect(renderedCamera()).toEqual(camera);
    expect(window.scrollY).toBe(scroll);
  });

  it('moves the whole selection together, in one update per key', async () => {
    registerTestBox();
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(600, 0);
    await fx.seedObject('box-1', testboxFields(0, 600, 1));
    await select(fx, a);
    await fx.shiftClick(b);
    await fx.shiftClick('box-1');
    const before = [fx.boundsOf(a), fx.boundsOf(b), fx.boundsOf('box-1')];

    const writes = await writesDuring(fx, async () => {
      expect(plainKey('ArrowDown')).toBe(false);
      await act(nextFrame);
    });

    const after = [fx.boundsOf(a), fx.boundsOf(b), fx.boundsOf('box-1')];
    for (const [index, start] of before.entries()) {
      expect(after[index]).toMatchObject({ x: start.x, y: start.y + NUDGE_STEP_WORLD });
    }
    // One key, one transaction: a colleague watching sees a note and a box cross the board together,
    // not three objects arrive one after another.
    expect(writes).toBe(1);
  });

  it('takes the large step when Shift is held, the other way up on the y axis', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    const before = fx.boundsOf(a);

    expect(plainKey('ArrowUp', true)).toBe(false);
    await act(nextFrame);

    expect(fx.boundsOf(a)).toMatchObject({ x: before.x, y: before.y - NUDGE_LARGE_STEP_WORLD });
  });

  it('counts each key rather than each frame, so two people nudging arrive in one place', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    const before = fx.boundsOf(a).x;

    // Five keys in a row, none of them awaited: a person holding an arrow down. Each key writes the
    // position the object *is* (from the snapshot it was given) rather than the position the document
    // happened to hold when the key was pressed, so the answer is five steps and not four, or six, or
    // whatever a race would have made of it.
    for (let key = 0; key < 5; key += 1) {
      plainKey('ArrowRight');
    }
    await act(nextFrame);

    expect(fx.boundsOf(a).x).toBe(before + NUDGE_STEP_WORLD * 5);
  });

  it('leaves the arrow keys to the page when nothing is selected', async () => {
    const fx = renderBoard();

    // Story 1's rule: a board you have selected nothing on scrolls like the page it is on.
    expect(plainKey('ArrowRight')).toBe(true);
    expect(plainKey('ArrowUp')).toBe(true);
    await act(nextFrame);

    expect(fx.selection().size).toBe(0);
  });

  it('refuses to nudge a board it cannot write to', async () => {
    const fx = await readOnlyBoard();
    const a = (fx.objects()[0] as { id: string }).id;
    const before = fx.boundsOf(a);

    // A board that failed to load is a board you may look at and arrange nothing on. The arrow keys
    // go back to being arrow keys — the page scrolls, as it did before there was ever a selection —
    // and the note stays where the last good moment left it.
    expect(plainKey('ArrowRight')).toBe(true);
    await act(nextFrame);

    expect(fx.boundsOf(a).x).toBe(before.x);
    expect(fx.selection().size).toBe(1);
  });
});

describe('TC-30 the Delete key when a letter is being deleted instead', () => {
  it('leaves Backspace to the text, and the object, alone', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    await act(async () => {
      expect(enter()).toBe(false);
      await nextFrame();
    });
    const editor = screen.getByTestId('sticky-editor');
    await setInput('hello');

    // Inside the editor, Backspace is a letter, not an object. The board is not even consulted: the
    // key reaches the field as if the board were not there, and the note is still there afterwards.
    expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(true);
    await act(nextFrame);

    await setInput('hell');
    expect(fx.objects()).toHaveLength(1);
    // What Backspace did is the field's business: the letter went, the note stayed, and the field is
    // still open on it.
    expect(noteText(fx, a)).toBe('hell');
    expect(fx.selection().editingId).toBe(a);
  });

  it('does not delete the object it is editing when Delete is pressed inside the text', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    await act(async () => {
      enter();
      await nextFrame();
    });
    const editor = screen.getByTestId('sticky-editor');

    expect(fireEvent.keyDown(editor, { key: 'Delete' })).toBe(true);
    await act(nextFrame);

    expect(fx.objects()).toHaveLength(1);
    expect(fx.objectEl(a)).not.toBeNull();
  });

  it('answers no keys of its own while an object is open for editing', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);
    await act(async () => {
      enter();
      await nextFrame();
    });

    // Somebody is writing in that object. The board stands back from every key it has an opinion
    // about, select-all included: Ctrl+A belongs to the text now, and the selection the person had
    // when they sat down to write is the selection they get up with.
    expect(controlA()).toBe(true);
    await act(nextFrame);

    expect(fx.selection().ids).toEqual(new Set([a]));
    expect(fx.selection().editingId).toBe(a);
    expect(fx.objects()).toHaveLength(1);
  });
});

describe('TC-31 Delete with a selection', () => {
  it('removes every selected object in one update and leaves nothing selected', async () => {
    registerTestBox();
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(600, 0);
    await fx.seedObject('box-1', testboxFields(0, 600, 1));
    const untouched = await fx.create(0, 600);
    await select(fx, a);
    await fx.shiftClick(b);
    await fx.shiftClick('box-1');

    const writes = await writesDuring(fx, async () => {
      expect(plainKey('Delete')).toBe(false);
      await act(nextFrame);
    });

    expect(fx.objects().map((object) => object.id)).toEqual([untouched]);
    expect(fx.objectEl(a)).toBeNull();
    expect(fx.objectEl('box-1')).toBeNull();
    expect(fx.selection().size).toBe(0);
    expect(fx.barEl()).toBeNull();
    expect(fx.overlayEl()).toBeNull();
    // Three objects gone in one update: nobody watching sees a board emptying itself one object at a
    // time, and nobody watching sees the two remaining objects change order.
    expect(writes).toBe(1);
  });

  it('answers Backspace the same way, because half the keyboards have no Delete key', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await select(fx, a);

    expect(plainKey('Backspace')).toBe(false);
    await act(nextFrame);

    expect(fx.objects()).toHaveLength(0);
    expect(fx.selection().size).toBe(0);
  });

  it('deletes an object that has been deleted already without making a scene', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(600, 0);
    await select(fx, a);
    await fx.shiftClick(b);

    // Somebody else gets there first, and then this person presses Delete on a selection that the
    // board has already shrunk.
    await act(async () => {
      deleteObject(fx.doc(), a);
      await nextFrame();
    });
    expect(fx.selection().ids).toEqual(new Set([b]));

    expect(plainKey('Delete')).toBe(false);
    await act(nextFrame);

    expect(fx.objects()).toHaveLength(0);
    expect(fx.selection().size).toBe(0);
  });

  it('leaves the key alone when the selection is empty and the object types nothing back', async () => {
    const fx = renderBoard();

    expect(plainKey('Delete')).toBe(true);
    expect(plainKey('Backspace')).toBe(true);
    await act(nextFrame);

    expect(fx.objects()).toHaveLength(0);
  });
});
