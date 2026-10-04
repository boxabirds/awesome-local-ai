import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { flushFrames } from './helpers';
import {
  centreOnScreen,
  clickAt,
  doubleClick,
  mountSticky,
  shiftPress,
  typeInto,
  type MountedSticky,
} from './helpers/sticky';
import { createSticky, OBJECTS_MAP, snapshot } from '../../src/shared/board-model';
import { createTestbox, TESTBOX_TYPE } from '../fixtures/testbox';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * The four things the keyboard says about a selection (TC-27 to TC-31): select all, clear, nudge,
 * delete.
 *
 * Two of these tests are about a key the app did *not* take. A keyboard shortcut is not only the
 * thing it does - it is also the thing it stops the page from doing: arrows scroll, Ctrl+A selects
 * the words of the interface, Backspace leaves a text field. So each test reads the return value of
 * firing the event, which is false exactly when the app called `preventDefault`, and says which way
 * the key should have gone. A shortcut that forgets to take its key works right up until someone
 * uses it on a board long enough to scroll.
 *
 * The negative half of this is TC-30: a person typing into a note who presses Backspace means their
 * text, and nothing else. The one thing this story must never do is delete an object because it
 * mistook typing for commanding.
 */

const A = { x: -400, y: -100 };
const B = { x: -100, y: -100 };
const C = { x: 300, y: 200 };

/** Where a note is, read off the document rather than off the screen. */
function at(board: MountedSticky, id: string): { x: number; y: number } {
  const object = board.object(id);
  return { x: object.x, y: object.y };
}

/** How many changes the document was asked to make since this was created. */
function writeCounter(doc: Y.Doc): () => number {
  let writes = 0;
  doc.on('update', () => {
    writes += 1;
  });
  return () => writes;
}

/**
 * A key pressed inside a field, as a browser sends it: the keydown starts on the field and bubbles
 * up to the window, where the board's shortcuts live. As above, the return value says who took it.
 */
function keyIn(field: HTMLElement, key: string): boolean {
  return fireEvent.keyDown(field, { key });
}

/**
 * A key pressed on the page, with the modifiers the user held. Returns what the browser would have
 * done with it: false means the app took the key.
 */
function pressKey(key: string, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {}): boolean {
  return fireEvent.keyDown(window, {
    key,
    shiftKey: modifiers.shift === true,
    ctrlKey: modifiers.ctrl === true,
    metaKey: modifiers.meta === true,
  });
}

/** Select everything the way the keyboard does. */
function selectAllKey(): boolean {
  return pressKey('a', { ctrl: true });
}

/** Press a note, which selects it and nothing else. */
function select(board: MountedSticky, id: string): void {
  clickAt(board.element(id), centreOnScreen(board, board.object(id)));
}

/** Open a note for typing, the way a person does: double-click it, then type. */
async function startTyping(board: MountedSticky, id: string, text: string): Promise<void> {
  const object = board.object(id);
  doubleClick(board.element(id), centreOnScreen(board, object));
  await flushFrames();
  typeInto(board.editor(), text);
  await flushFrames();
}

/** Is this note drawn as selected? Read off the element, not out of the app's state. */
function isSelected(board: MountedSticky, id: string): boolean {
  return board.element(id).dataset.selected === 'true';
}

describe('sel.keyboard: select all (TC-27, TC-28)', () => {
  let board: MountedSticky;
  let ids: string[] = [];

  beforeEach(async () => {
    board = await mountSticky();
    ids = [A, B, C].map((point) => createSticky(board.doc, point));
    await flushFrames();
  });

  it('TC-27: Ctrl+A takes every object on the board, and takes the key with it', async () => {
    // A second object type is in on this: "all" means everything on the board, not every sticky.
    const box = createTestbox(board.doc, { x: -100, y: 300, width: 100, height: 100 });
    await flushFrames();

    expect(selectAllKey()).toBe(false);
    await flushFrames();

    expect(board.outlinedIds().sort()).toEqual([...ids, box].sort());
    expect(board.barText()).toBe('4 selected');
    // The key was taken, so the browser never got to select the words of the interface with it.
    expect(window.getSelection()?.toString() ?? '').toBe('');
  });

  it('TC-27b: Cmd+A does the same thing, because a Mac says Cmd', async () => {
    expect(pressKey('a', { meta: true })).toBe(false);
    await flushFrames();

    expect(board.outlinedIds().sort()).toEqual([...ids].sort());
  });

  it('TC-27c: select all replaces the selection, and does not add to it', async () => {
    select(board, ids[0]!);
    await flushFrames();
    expect(board.outlinedIds()).toEqual([ids[0]]);

    selectAllKey();
    await flushFrames();

    // The note that was already selected is still selected - it is part of all - and so is
    // everything else. A select-all that added would be a select-all that never finished.
    expect(board.outlinedIds().sort()).toEqual([...ids].sort());
    expect(board.barText()).toBe('3 selected');
  });

  it('TC-27d: an object this app has no drawing for is not part of "all"', async () => {
    // A frame, from a story that has not been written yet: readable by the document, invisible to
    // this app. Selecting what cannot be drawn would put handles on nothing.
    const foreign = new Y.Map<unknown>();
    foreign.set('type', 'frame');
    foreign.set('x', 0);
    foreign.set('y', 0);
    foreign.set('width', 100);
    foreign.set('height', 100);
    foreign.set('z', 9);
    board.doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).set('frame-1', foreign);
    await flushFrames();

    selectAllKey();
    await flushFrames();

    expect(board.outlinedIds().sort()).toEqual([...ids].sort());
    expect(board.barText()).toBe('3 selected');
  });

  it('TC-27e: while a note is being typed into, Ctrl+A belongs to the text', async () => {
    await startTyping(board, ids[0]!, 'Hello');

    // The key is left to the text field, which is where the browser's select-all should land.
    expect(keyIn(board.editor(), 'a')).toBe(true);
    await flushFrames();

    // No other note joined the selection, and the document was not asked to do anything.
    expect(isSelected(board, ids[1]!)).toBe(false);
    expect(isSelected(board, ids[2]!)).toBe(false);
    expect(board.object(ids[0]!).text).toBe('Hello');
  });

});

describe('sel.keyboard: select all on a board of its own (TC-28)', () => {
  it('TC-28: on a board with nothing on it, select all selects nothing and is not an error', async () => {
    // The boundary: "all" of nothing. The app answers honestly - an empty selection - rather than
    // treating the key as something that went wrong.
    const board = await mountSticky();
    await flushFrames();

    expect(selectAllKey()).toBe(false);
    await flushFrames();

    expect(board.outlinedIds()).toEqual([]);
    expect(board.outlineCount()).toBe(0);
    expect(board.boundsOrNull()).toBeNull();
    expect(board.barOrNull()).toBeNull();

    // And the empty selection stays empty when the other commands are given it.
    expect(pressKey('ArrowRight')).toBe(true);
    pressKey('Delete');
    await flushFrames();
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it('TC-28b: the object types there are - and only those - are what select all takes', async () => {
    const board = await mountSticky();
    const notes = [A, B].map((point) => createSticky(board.doc, point));
    const box = createTestbox(board.doc, { x: 0, y: 0, width: 100, height: 100 });
    await flushFrames();

    selectAllKey();
    await flushFrames();

    expect(board.outlinedIds().sort()).toEqual([...notes, box].sort());
    // One box on the board, however many markings the selection draws over it.
    expect(board.elementsOf(TESTBOX_TYPE)).toHaveLength(1);
    expect(board.barText()).toBe('3 selected');
  });
});

describe('sel.keyboard: nudging (TC-29)', () => {
  let board: MountedSticky;
  let ids: string[] = [];
  let writes: () => number;

  beforeEach(async () => {
    board = await mountSticky();
    ids = [A, B].map((point) => createSticky(board.doc, point));
    await flushFrames();
    writes = writeCounter(board.doc);
  });

  /** Select both notes and remember where they were. */
  async function selectBoth(): Promise<Map<string, { x: number; y: number }>> {
    select(board, ids[0]!);
    shiftPress(board.element(ids[1]!), centreOnScreen(board, board.object(ids[1]!)));
    await flushFrames();
    return new Map(ids.map((id) => [id, at(board, id)]));
  }

  it('TC-29: ArrowRight moves the selection by one nudge step, and no further', async () => {
    const before = await selectBoth();
    const seen = writes();

    expect(pressKey('ArrowRight')).toBe(false);
    await flushFrames();

    for (const id of ids) {
      expect(at(board, id)).toEqual({ x: before.get(id)!.x + NUDGE_STEP_WORLD, y: before.get(id)!.y });
    }
    // The arrow was taken: the page under it would have scrolled, and `preventDefault` is what stops
    // it. (jsdom never scrolls, so the key being taken is the thing this can prove here - the e2e
    // case TC-34 is the one that measures the page.)
    expect(window.scrollY).toBe(0);
    // One nudge of two objects is one change to the document, not two.
    expect(writes()).toBe(seen + 1);
  });

  it('TC-29b: Shift+ArrowUp moves it back by the large step', async () => {
    const before = await selectBoth();

    expect(pressKey('ArrowUp', { shift: true })).toBe(false);
    await flushFrames();

    for (const id of ids) {
      expect(at(board, id)).toEqual({
        x: before.get(id)!.x,
        y: before.get(id)!.y - NUDGE_LARGE_STEP_WORLD,
      });
    }
  });

  it('TC-29c: each arrow points the way the objects go', async () => {
    const cases: readonly [string, number, number][] = [
      ['ArrowLeft', -1, 0],
      ['ArrowRight', 1, 0],
      ['ArrowUp', 0, -1],
      ['ArrowDown', 0, 1],
    ];
    const before = await selectBoth();

    for (const [key, dx, dy] of cases) {
      const from = at(board, ids[0]!);
      pressKey(key);
      await flushFrames();
      expect(at(board, ids[0]!)).toEqual({ x: from.x + dx * NUDGE_STEP_WORLD, y: from.y + dy * NUDGE_STEP_WORLD });
    }

    // Four nudges, added up: each was measured from where the note was, so they accumulate.
    expect(at(board, ids[0]!)).toEqual({
      x: before.get(ids[0]!)!.x - NUDGE_STEP_WORLD + NUDGE_STEP_WORLD,
      y: before.get(ids[0]!)!.y - NUDGE_STEP_WORLD + NUDGE_STEP_WORLD,
    });
  });

  it('TC-29d: nudges add up in the document, one transaction per key press', async () => {
    const before = await selectBoth();
    const seen = writes();

    for (let press = 0; press < 5; press += 1) {
      pressKey('ArrowRight');
      await flushFrames();
    }

    expect(at(board, ids[0]!).x).toBe(before.get(ids[0]!)!.x + 5 * NUDGE_STEP_WORLD);
    expect(at(board, ids[1]!).x).toBe(before.get(ids[1]!)!.x + 5 * NUDGE_STEP_WORLD);
    expect(writes()).toBe(seen + 5);
  });

  it('TC-29e: an arrow with nothing selected is left alone, and moves nothing', async () => {
    const seen = writes();

    // No selection: the key is not the board's to take. Arrows keep scrolling.
    expect(pressKey('ArrowRight')).toBe(true);
    expect(pressKey('ArrowUp', { shift: true })).toBe(true);
    await flushFrames();

    expect(writes()).toBe(seen);
    expect(board.outlinedIds()).toEqual([]);
  });

  it('TC-29f: only what was selected is nudged', async () => {
    const third = createSticky(board.doc, C);
    await flushFrames();
    const before = ids.map((id) => at(board, id));
    const thirdWas = at(board, third);

    select(board, ids[0]!);
    await flushFrames();
    pressKey('ArrowDown');
    await flushFrames();

    expect(at(board, ids[0]!)).toEqual({ x: before[0]!.x, y: before[0]!.y + NUDGE_STEP_WORLD });
    expect(at(board, ids[1]!)).toEqual(before[1]);
    expect(at(board, third)).toEqual(thirdWas);
  });

  it('TC-29g: a note that was being typed in is nudged once the typing is over', async () => {
    await startTyping(board, ids[0]!, 'Hi');
    const typed = at(board, ids[0]!);

    // Typing ends with Escape, which lets go of the selection as well as of the text - so the note
    // has to be chosen again before the arrows have anything of theirs to move.
    keyIn(board.editor(), 'Escape');
    await flushFrames();
    expect(board.editorOrNull()).toBeNull();

    select(board, ids[0]!);
    await flushFrames();
    pressKey('ArrowRight');
    await flushFrames();

    expect(at(board, ids[0]!)).toEqual({ x: typed.x + NUDGE_STEP_WORLD, y: typed.y });
    expect(board.object(ids[0]!).text).toBe('Hi');
  });
});

describe('sel.keyboard: delete (TC-30, TC-31)', () => {
  let board: MountedSticky;
  let ids: string[] = [];
  let writes: () => number;

  beforeEach(async () => {
    board = await mountSticky();
    ids = [A, B, C].map((point) => createSticky(board.doc, point));
    await flushFrames();
    writes = writeCounter(board.doc);
  });

  it('TC-30: Backspace while typing edits the text and leaves every object where it was', async () => {
    await startTyping(board, ids[0]!, 'Hello');
    const seen = writes();
    const positions = ids.map((id) => at(board, id));

    // The key belongs to the text field. It is left alone, which is what "false" would mean here.
    expect(keyIn(board.editor(), 'Backspace')).toBe(true);
    await flushFrames();

    // Nothing was deleted, nothing was written: the Backspace never reached the board.
    expect(writes()).toBe(seen);
    expect(board.notes().map((note) => note.id)).toEqual(ids);
    expect(ids.map((id) => at(board, id))).toEqual(positions);
    // Still the same note, still open, still holding the text that was typed into it.
    expect(board.editorOrNull()).not.toBeNull();
    expect(board.object(ids[0]!).text).toBe('Hello');
    // And a note that is not selected is not deleted either, however many Backspaces arrive.
    keyIn(board.editor(), 'Backspace');
    keyIn(board.editor(), 'Backspace');
    await flushFrames();
    expect(board.notes()).toHaveLength(3);
  });

  it('TC-30b: while typing, select all and Delete both belong to the text', async () => {
    await startTyping(board, ids[0]!, 'Hello');
    const seen = writes();

    keyIn(board.editor(), 'a');
    keyIn(board.editor(), 'Delete');
    await flushFrames();

    expect(writes()).toBe(seen);
    expect(board.notes()).toHaveLength(3);
    // The other notes were never brought into the selection by either key.
    expect(isSelected(board, ids[1]!)).toBe(false);
    expect(isSelected(board, ids[2]!)).toBe(false);
    expect(board.object(ids[0]!).text).toBe('Hello');
  });

  it.each(['Delete', 'Backspace'])('TC-31: %s removes everything selected, and the selection goes too', async (key) => {
    select(board, ids[0]!);
    shiftPress(board.element(ids[1]!), centreOnScreen(board, board.object(ids[1]!)));
    await flushFrames();
    expect(board.barText()).toBe('2 selected');

    expect(pressKey(key)).toBe(false);
    await flushFrames();

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([ids[2]]);
    // Empty selection: no outlines, no bounding box, no bar.
    expect(board.outlinedIds()).toEqual([]);
    expect(board.boundsOrNull()).toBeNull();
    expect(board.barOrNull()).toBeNull();
    expect(board.handleList()).toHaveLength(0);
  });

  it('TC-31b: Delete leaves what was not selected', async () => {
    // All three selected, then the third left out by clicking it with Shift held.
    selectAllKey();
    await flushFrames();
    shiftPress(board.element(ids[2]!), centreOnScreen(board, board.object(ids[2]!)));
    await flushFrames();
    expect(board.barText()).toBe('2 selected');

    const kept = at(board, ids[2]!);
    pressKey('Delete');
    await flushFrames();

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([ids[2]]);
    expect(at(board, ids[2]!)).toEqual(kept);
  });

  it('TC-31c: select all and Delete between them empty a board of every type', async () => {
    createTestbox(board.doc, { x: 0, y: 0, width: 100, height: 100 });
    await flushFrames();

    selectAllKey();
    await flushFrames();
    expect(board.barText()).toBe('4 selected');
    pressKey('Delete');
    await flushFrames();

    expect(snapshot(board.doc)).toHaveLength(0);
    expect(board.elementsOf('sticky')).toHaveLength(0);
    expect(board.elementsOf(TESTBOX_TYPE)).toHaveLength(0);
    // Nothing left to delete, and the board does not mind being told so.
    const seen = writes();
    pressKey('Delete');
    await flushFrames();
    expect(writes()).toBe(seen);
  });

  it('TC-31d: a selection of one sticky is deleted by the keyboard at its own size', async () => {
    // The story 2 shape of this: one note, never resized, whose size is implicit in the document.
    select(board, ids[0]!);
    await flushFrames();
    expect(board.object(ids[0]!).width).toBe(STICKY_SIZE_WORLD);

    pressKey('Delete');
    await flushFrames();

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([ids[1], ids[2]]);
  });
});
