import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { flushFrames } from './helpers';
import {
  clickAt,
  clickRedo,
  clickUndo,
  doubleClick,
  isDisabled,
  mountSticky,
  moveTo,
  pasteInto,
  press,
  pressCombo,
  release,
  typeInto,
  type MountedSticky,
} from './helpers/sticky';
import {
  chooseTextSize,
  chooseTool,
  deleteTextViaBar,
  endEditing,
  placeText,
  pressOn as pressOnBoard,
  pressedSize,
  remoteChange,
  shiftClickOn,
  sizeButtons,
  textElement,
  textEditor,
  textEditorOrNull,
  textElements,
  textOf,
  textToolbar,
  textToolbarOrNull,
  typeText,
  watchBoxWrites,
} from './helpers/text';
import { createSticky, deleteObjects, snapshot } from '../../src/shared/board-model';
import { getTextContent, setTextSize } from '../../src/shared/objects/text';
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import type { Handle } from '../../src/shared/geometry';

/**
 * A text object on the board (text.object at component level): being typed into, being sized, being
 * resized, being taken away by somebody else, and being taken back by undo.
 *
 * Two things about a text object decide most of what these tests can say, and both come from the
 * words being the object rather than sitting inside it. The first is that the box is a measurement:
 * the height is always the number of lines, so the handles are on the sides only, and a height that
 * a resize hands over is thrown away and measured again. The second is that empty text does not
 * exist: an object left with nothing in it is removed the moment typing ends - which makes Escape a
 * test of two quite different things depending on whether anything was typed, and is where about half
 * of these tests are pointed.
 *
 * The board is the real app with a real `Y.Doc`, so every assertion is against the document. The
 * measurer is the one the app builds, which in jsdom has no canvas to measure against and so counts
 * characters instead of looking at them: `GREETING` at the middle size is ninety units wide, and one
 * line of the middle size is twenty-six units tall.
 */

vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** The camera the app starts with: world (0, 0) in the middle of a 1280 x 800 board. */
const CAMERA: Point = { x: -640, y: -400 };

/** Nine characters at twenty pixels, measured by counting: ninety units, one line, twenty-six tall. */
const GREETING = 'Went well';
const GREETING_WIDTH = 90;
const LINE_M = Math.round(TEXT_SIZES.M * 1.3);

/** A world point as the screen draws it; the board fills the emulated window. */
function at(world: Point): Point {
  return { x: world.x - CAMERA.x, y: world.y - CAMERA.y };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(board: MountedSticky, id: string): Box {
  const object = board.object(id);
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

function union(...boxes: Box[]): Box {
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function pointOf(box: Box, where: Handle): Point {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  switch (where) {
    case 'nw':
      return { x: box.x, y: box.y };
    case 'n':
      return { x: centre.x, y: box.y };
    case 'ne':
      return { x: right, y: box.y };
    case 'e':
      return { x: right, y: centre.y };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: centre.x, y: bottom };
    case 'sw':
      return { x: box.x, y: bottom };
    case 'w':
      return { x: box.x, y: centre.y };
  }
}

/** Press a handle and drag it: press where it is drawn, move, and let go where it stopped. */
async function dragHandle(board: MountedSticky, handle: Handle, box: Box, delta: Point): Promise<void> {
  const knob = board.handle(handle);
  const from = at(pointOf(box, handle));
  press(knob, from);
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  moveTo(window, { x: from.x + 4, y: from.y });
  moveTo(window, to);
  await flushFrames();
  release(window, to);
  await flushFrames();
}

/** Press an object in the middle and carry it somewhere else. */
async function dragObject(board: MountedSticky, id: string, delta: Point): Promise<void> {
  const box = boxOf(board, id);
  const from = at({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  press(board.element(id), from);
  moveTo(window, { x: from.x + 8, y: from.y });
  moveTo(window, { x: from.x + delta.x, y: from.y + delta.y });
  await flushFrames();
  release(window, { x: from.x + delta.x, y: from.y + delta.y });
  await flushFrames();
}

/** Press on an object where it is drawn: it is selected, and only it. See `helpers/text`. */
async function pressOn(board: MountedSticky, id: string): Promise<void> {
  await pressOnBoard(board, id);
}

/** Add a second object to the selection, the way Shift says. */
async function shiftOn(board: MountedSticky, id: string): Promise<void> {
  await shiftClickOn(board, id);
}

/** Ctrl + A, as a keyboard sends it: everything on the board, whatever it is. */
async function selectAll(board: MountedSticky): Promise<void> {
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
  await flushFrames();
  expect(board.outlineCount()).toBe(snapshot(board.doc).length);
}

/** A key pressed on the board rather than in a field; tells whether anything took it. */
function key(keyName: string, options: { shiftKey?: boolean } = {}): boolean {
  return fireEvent.keyDown(window, { key: keyName, ...options });
}

/** A text object with words in it, made the way a person makes one, and left selected. */
async function textWith(board: MountedSticky, text: string, where: Point): Promise<string> {
  const id = await emptyText(board, where);
  if (text !== '') {
    typeText(board, text);
    await flushFrames();
  }
  await endEditing(board);
  return id;
}

/** An empty text object, still being typed into: which is the state it is born in. */
async function emptyText(board: MountedSticky, where: Point): Promise<string> {
  await chooseTool(board, 'text');
  return placeText(board, where);
}

/** A note whose top-left corner is at the given world point - `createSticky` centres on its point. */
function noteAt(board: MountedSticky, x: number, y: number): string {
  return createSticky(board.doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
}

/** The four sizes as the bar labels them. */
function sizeNames(board: MountedSticky): string[] {
  return sizeButtons(board).map((button) => button.dataset.size ?? '');
}

/** `console.error` and `console.warn`, so a test can say what the board printed to nobody. */
function spyOnErrors(): { read(): string[]; stop(): void } {
  const seen: string[] = [];
  const error = console.error;
  const warn = console.warn;
  console.error = (...args: unknown[]): void => {
    seen.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]): void => {
    seen.push(args.map(String).join(' '));
  };
  return {
    read: () => [...seen],
    stop: () => {
      console.error = error;
      console.warn = warn;
    },
  };
}

describe('text.object: typing into it (TC-19)', () => {
  it('TC-19: going back into a text puts the caret at the end of what is there', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });

    // The object kept the selection when Escape ended the typing, and it is the thing the keyboard is
    // pointed at - which is what makes Enter, a key that means nothing to a board, mean "write in
    // this" here.
    key('Enter');
    await flushFrames();

    const editor = textEditor(board);
    expect(editor).toBe(document.activeElement);
    expect(editor.value).toBe(GREETING);
    // At the *end*, because a person going back into a sentence is going back to add to it, and a
    // caret that landed in front of the first letter would type a new word into the middle of the old.
    expect(editor.selectionStart).toBe(GREETING.length);
    expect(editor.selectionEnd).toBe(GREETING.length);
    expect(editor.getAttribute('aria-label')).toBe('Text');
    // Still the same object, in the same place, with the same words: editing writes nothing.
    expect(board.object(id)).toMatchObject({ type: 'text', text: GREETING, size: 'M' });
    expect(textElement(board, id).dataset.selected).toBe('true');
  });

  it('TC-19b: Enter inside the words is a newline, not the end of editing', async () => {
    const board = await mountSticky();
    const id = await textWith(board, 'one', { x: 120, y: 60 });
    await pressOn(board, id);
    key('Enter');
    await flushFrames();

    // The key is left to the field, which is the only thing on the board that knows how to put a
    // newline into text. Had the component taken it, this would be the end of editing, and the
    // newline would be nowhere at all.
    expect(fireEvent.keyDown(textEditor(board), { key: 'Enter' })).toBe(true);
    await flushFrames();
    expect(textEditorOrNull(board)).not.toBeNull();

    // What the field does with it, then: two lines, and a box tall enough for two lines.
    typeInto(textEditor(board), '\ntwo');
    await flushFrames();
    expect(textOf(board, id).text).toBe('one\ntwo');
    expect(board.object(id).height).toBe(2 * LINE_M);
    expect(textElement(board, id).dataset.height).toBe(String(2 * LINE_M));
  });

  it('TC-19c: Escape ends the typing and keeps the words, and the object that holds them', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    typeText(board, GREETING);
    await flushFrames();

    fireEvent.keyDown(textEditor(board), { key: 'Escape' });
    await flushFrames();

    expect(textEditorOrNull(board)).toBeNull();
    expect(board.object(id).text).toBe(GREETING);
    // Selected, and shown as selected: Escape means "I have finished writing", not "I did not write
    // that". The selection is what makes the size buttons appear and gives Delete something to eat.
    expect(board.outlinedIds()).toEqual([id]);
    expect(textElement(board, id).dataset.selected).toBe('true');
    expect(textToolbarOrNull(board)).not.toBeNull();
    // The words are drawn as words now, not as the field they were typed in.
    expect(textElement(board, id).querySelector('.text-object__text')?.textContent).toBe(GREETING);
  });

  it('TC-19d: a double-click on the words opens them, and makes no note', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });

    doubleClick(textElement(board, id), at({ x: 130, y: 70 }));
    await flushFrames();

    expect(textEditor(board).value).toBe(GREETING);
    expect(board.noteCount()).toBe(0);
    // The caret is at the end here too: however the field is opened, the person opening it is going
    // to carry on at the end of it.
    expect(textEditor(board).selectionStart).toBe(GREETING.length);
  });

  it('TC-19e: Enter opens one text, and nothing when the key has more than one to choose from', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    noteAt(board, -300, -200);
    await flushFrames();
    await selectAll(board);

    // Two objects, one of them a text: which would Enter open? There is no answer, so the key does
    // nothing rather than guessing - and a guess here would be a field nobody meant to open.
    expect(key('Enter')).toBe(true);
    await flushFrames();
    expect(textEditorOrNull(board)).toBeNull();
    expect(board.editorOrNull()).toBeNull();

    // One of them, alone, is unambiguous, and opens.
    await pressOn(board, id);
    key('Enter');
    await flushFrames();
    expect(textEditor(board).value).toBe(GREETING);
  });

  it('TC-19f: a text being typed into cannot be joined by a second one', async () => {
    const board = await mountSticky();
    const first = await emptyText(board, { x: 120, y: 60 });
    typeText(board, GREETING);
    await flushFrames();

    // While the field is open the Text tool is one keystroke away, and a click on the board would
    // make a second object - but the field has the keyboard, so T is a letter.
    expect(pressCombo('KeyT')).toBe(false);
    await flushFrames();
    expect(textEditorOrNull(board)).not.toBeNull();
    expect(textElements(board)).toHaveLength(1);
    expect(board.object(first).text).toBe(GREETING);
  });
});

describe('text.object: text that is not there (TC-20)', () => {
  it('TC-20: Escape with nothing typed takes the object away with it', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    expect(board.object(id).text).toBe('');

    fireEvent.keyDown(textEditor(board), { key: 'Escape' });
    await flushFrames();

    // Gone, from everywhere: not an empty object sitting at the spot the pointer was, selectable by a
    // marquee and invisible, which is how a board would end up full of nothing.
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(textElements(board)).toHaveLength(0);
    expect(board.outlinedIds()).toEqual([]);
    expect(board.barOrNull()).toBeNull();
    // And the keyboard has nowhere to go: Delete on an empty board is not a delete.
    expect(key('Delete')).toBe(true);
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it('TC-20b: words typed and then deleted back to nothing are the same nothing', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    typeText(board, 'a heading that was a mistake');
    await flushFrames();
    expect(boxOf(board, id).width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

    // The field's own way of emptying itself: replace everything with nothing, as select-all and a
    // keystroke does.
    pasteInto(textEditor(board), '');
    await flushFrames();
    expect(board.object(id).text).toBe('');

    fireEvent.keyDown(textEditor(board), { key: 'Escape' });
    await flushFrames();

    expect(snapshot(board.doc)).toHaveLength(0);
    expect(textElements(board)).toHaveLength(0);
    // The width it had grown into went with it: there is no object left to be the wrong size.
    expect(board.doc.getMap('objects').get(id)).toBeUndefined();
  });

  it('TC-20c: a space is a character, and a heading made of one stays on the board', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    typeText(board, ' ');
    await flushFrames();

    fireEvent.keyDown(textEditor(board), { key: 'Escape' });
    await flushFrames();

    // Empty means *no characters*, which is a different thing from "no letters": a line somebody left
    // between two paragraphs, or a gap they are holding open, is text they put there. The same line
    // story 2 draws for a note, for the same reason - deleting what a person typed is not what Escape
    // means.
    expect(board.object(id).text).toBe(' ');
    expect(textElements(board)).toHaveLength(1);
    expect(board.outlinedIds()).toEqual([id]);
  });

  it('TC-20d: and an object that is not empty is left where it was when the typing ends', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 0, y: 0 });

    expect(snapshot(board.doc)).toHaveLength(1);
    expect(board.object(id).text).toBe(GREETING);
    expect(textOf(board, id)).toMatchObject({ widthMode: 'auto', size: 'M' });
  });
});

describe('text.object: the four sizes (TC-21)', () => {
  it('TC-21: the bar offers S, M, L and XL with the current size pressed, and XL resizes it', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const before = board.object(id);

    const bar = textToolbar(board);
    expect(sizeNames(board)).toEqual(['S', 'M', 'L', 'XL']);
    expect(pressedSize(board)).toBe('M');
    expect(bar.getAttribute('data-board-ui')).toBe('');
    expect(sizeButtons(board).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Small (S)',
      'Medium (M)',
      'Large (L)',
      'Extra large (XL)',
    ]);

    await chooseTextSize(board, 'XL');

    const after = board.object(id);
    expect(textOf(board, id).size).toBe('XL');
    // Position is not part of a size change: a heading that moved when its letters got bigger would
    // be a heading that moved out from under the thing it was labelling.
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    // ...and the box got the room the bigger letters need: the same one line, measured at XL.
    expect(after.height).toBe(Math.round(TEXT_SIZES.XL * 1.3));
    expect(after.width).toBe(Math.ceil(GREETING.length * TEXT_SIZES.XL * 0.5));
    expect(after.width).toBeGreaterThan(before.width);
    // The bar now says the size the document says it is.
    expect(pressedSize(board)).toBe('XL');
    expect(textElement(board, id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
  });

  it('TC-21b: the bar follows the document, not the other way round', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });

    await chooseTextSize(board, 'S');
    expect(pressedSize(board)).toBe('S');
    expect(board.object(id).height).toBe(Math.round(TEXT_SIZES.S * 1.3));

    // Somebody else changed it. The bar is a reading of the object, so it reads the new size: a bar
    // that kept showing the size this person last pressed would be a bar lying about the board.
    remoteChange(board, () => setTextSize(board.doc, id, 'L'));
    await flushFrames();

    expect(pressedSize(board)).toBe('L');
    expect(textElement(board, id).dataset.textSize).toBe('L');
  });

  it('TC-21c: one text gets the size bar; two objects get the bar that counts', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    expect(textToolbarOrNull(board)).not.toBeNull();

    // A second text, selected instead of the first: still one object, still a size to ask about.
    const second = await textWith(board, 'What to change', { x: 400, y: 60 });
    expect(pressedSize(board)).toBe('M');

    // Both of them: now "what size?" has two answers, so the bar stops asking it and counts instead.
    await shiftOn(board, id);
    expect(textToolbarOrNull(board)).toBeNull();
    expect(board.barText()).toBe('2 selected');

    // One of them again, and the questions come back - which is what says the bar is a reading of the
    // selection and not a property of the screen.
    await pressOn(board, second);
    expect(pressedSize(board)).toBe('M');

    // A sticky note has its own toolbar and no sizes to choose, which is the negative that says this
    // bar belongs to text objects and not to whatever is selected.
    const note = noteAt(board, -300, -200);
    await flushFrames();
    clickAt(board.element(note), at({ x: -200, y: -100 }));
    await flushFrames();
    expect(textToolbarOrNull(board)).toBeNull();
    expect(board.toolbarOrNull()).not.toBeNull();
  });

  it('TC-21d: the bar deletes the text it is attached to, and nothing else', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const kept = await textWith(board, 'kept', { x: 400, y: 60 });
    await pressOn(board, id);

    await deleteTextViaBar(board);

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([kept]);
    expect(textElements(board)).toHaveLength(1);
    expect(board.outlinedIds()).toEqual([]);
    // Undo brings it back, because deleting from a bar is a change to the board like any other.
    clickUndo(board);
    await flushFrames();
    expect(board.object(id).text).toBe(GREETING);
  });

  it('TC-21e: the size and the room it needed are written together', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const writes = watchBoxWrites(board, id);

    await chooseTextSize(board, 'L');
    writes.stop();

    // The box the bigger letters need, and only that: never a box written for a size the object does
    // not have, which is what a person would see as words spilling out of their own outline. That the
    // size and the box are one *step* is TC-25c, which measures it the way a person does - with undo.
    expect(writes.keys()).toEqual([
      `width=${Math.ceil(GREETING.length * TEXT_SIZES.L * 0.5)}`,
      `height=${Math.round(TEXT_SIZES.L * 1.3)}`,
    ]);
    expect(board.object(id)).toMatchObject({ size: 'L' });
  });
});

describe('text.object: the handles it has (TC-22)', () => {
  it('TC-22: a text on its own is offered the two sides, and nothing else', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });

    expect(board.handleList().map((handle) => handle.dataset.handle)).toEqual(['e', 'w']);
    // The outline and the handles are drawn around the box the words came to, which is the other half
    // of why there is no top and no bottom: there is no height a person could drag that a line of
    // text would agree to be.
    expect(board.outlinedIds()).toEqual([id]);
    expect(boxOf(board, id)).toEqual({ x: 120, y: 60, width: GREETING_WIDTH, height: LINE_M });
    expect(isDisabled(board.handle('e'))).toBe(false);
  });

  it('TC-22b: dragging a side gives the words a width of their own, and the height follows', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    expect(textOf(board, id).widthMode).toBe('auto');

    // Inwards by forty: the longest line no longer fits across, so the words break into two lines and
    // the box gets taller by itself.
    await dragHandle(board, 'e', boxOf(board, id), { x: -40, y: 0 });

    const after = board.object(id);
    expect(textOf(board, id).widthMode).toBe('fixed');
    expect(after.width).toBe(50);
    expect(after.height).toBe(2 * LINE_M);
    expect(board.handleList().map((handle) => handle.dataset.handle)).toEqual(['e', 'w']);
  });

  it('TC-22c: a side handle cannot make a text narrower than the product allows', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });

    // The west side dragged a hundred and forty units to the *right*, past the forty-unit floor (the
    // box is ninety across, so the edge would have to stop forty short of the far side), and released
    // with the pointer far behind where the edge can go.
    await dragHandle(board, 'w', boxOf(board, id), { x: 60, y: 0 });

    // The drag stopped at the floor instead of running on into nothing: the words are still there, in
    // the narrowest box the product sells.
    expect(board.object(id).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(board.object(id).text).toBe(GREETING);
  });

  it('TC-22d: a note in the selection brings all eight handles back', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const note = noteAt(board, -300, -200);
    await flushFrames();
    await shiftOn(board, note);

    // Something in the selection can be made taller, so the handles that make things taller appear.
    expect(board.handleList().map((handle) => handle.dataset.handle)).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);

    // And back to the text alone, and they go away again: the handles describe the selection, not the
    // object underneath them.
    await pressOn(board, id);
    expect(board.handleList()).toHaveLength(2);
  });
});

describe('text.object: resized alongside a note (TC-23)', () => {
  it('TC-23: the group scales, the text moves with it, and its letters stay the size they are', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 0, y: 0 });
    const note = noteAt(board, -300, -200);
    await flushFrames();
    await selectAll(board);

    const text = boxOf(board, id);
    const selection = union(boxOf(board, note), text);
    expect(selection).toEqual({ x: -300, y: -200, width: 390, height: 226 });

    // One and a half times as big, both ways, by dragging the bottom-right of the whole selection.
    // A note is in the selection, and a note keeps its proportions, so the two axes are tied together
    // here - which is also why this drag is chosen to be even-handed.
    await dragHandle(board, 'se', selection, { x: 195, y: 113 });

    const after = boxOf(board, id);
    // The text is where the same place in the same arrangement now is: three hundred units into a box
    // that is a half again as wide. Position scales, because that is the one thing a resize is
    // entitled to change about a heading.
    expect(after.x).toBeCloseTo(150, 6);
    expect(after.y).toBeCloseTo(100, 6);
    // Its size does not: no amount of dragging a corner is a decision about how big the letters of a
    // heading are, and there are four buttons for that instead.
    expect(after.width).toBe(text.width);
    expect(after.height).toBe(text.height);
    expect(textOf(board, id).size).toBe('M');
    // The note took the scaling, as a note does.
    expect(board.object(note).width).toBeCloseTo(300, 6);
  });

  it('TC-23b: words with a width somebody wrote down scale that width, and re-measure their height', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 0, y: 0 });
    // A width a person dragged to is a decision, so scaling the group scales it. Fifty wide, and two
    // lines tall because the sentence no longer fits across fifty units.
    await dragHandle(board, 'e', boxOf(board, id), { x: -40, y: 0 });
    expect(boxOf(board, id)).toEqual({ x: 0, y: 0, width: 50, height: 2 * LINE_M });
    const note = noteAt(board, -300, -200);
    await flushFrames();
    await selectAll(board);

    // The selection is three hundred and fifty across and two hundred and fifty-two down, so a drag
    // of a hundred and seventy-five by a hundred and twenty-six makes it exactly half again as big.
    const before = boxOf(board, id);
    const selection = union(boxOf(board, note), before);
    expect(selection).toEqual({ x: -300, y: -200, width: 350, height: 252 });
    await dragHandle(board, 'se', selection, { x: 175, y: 126 });

    const after = boxOf(board, id);
    // Half again as wide, and half again as far into the arrangement: the width the handle was dragged
    // to is a size of the words, and sizes of the words scale when the words are scaled.
    expect(after).toMatchObject({ x: 150, y: 100, width: 75 });
    // Never the height that came out of the scale, which would have been seventy-eight: at seventy-
    // five units the sentence still comes to two lines, and the number of lines is what the height is.
    expect(after.height).toBe(2 * LINE_M);
    expect(textOf(board, id).size).toBe('M');
  });

  it('TC-23c: a text alone, dragged in the middle, is moved and never resized', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 0, y: 0 });
    const before = boxOf(board, id);

    await dragObject(board, id, { x: 60, y: 40 });

    expect(boxOf(board, id)).toEqual({ x: 60, y: 40, width: before.width, height: before.height });
  });
});

describe('text.object: taken away by somebody else (TC-24)', () => {
  it('TC-24: deleted while it is being typed into, the field goes with it and nothing is written back', async () => {
    const board = await mountSticky();
    const errors = spyOnErrors();
    const id = await emptyText(board, { x: 120, y: 60 });
    typeText(board, 'a heading half written');
    await flushFrames();
    expect(textEditor(board).value).toBe('a heading half written');

    // Another screen deletes this object, here, now, while the field is open and has the keyboard.
    remoteChange(board, () => deleteObjects(board.doc, [id]));
    await flushFrames();

    // The field is gone, the board is still standing, and the object did not come back - which is the
    // failure this case is really about: a component that wrote its last measurement to an object that
    // no longer exists would have recreated it as an empty shell on the board.
    expect(textEditorOrNull(board)).toBeNull();
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(textElements(board)).toHaveLength(0);
    expect(board.outlinedIds()).toEqual([]);
    expect(errors.read()).toEqual([]);
    errors.stop();

    // And the keystrokes that were on their way have nowhere to go: nothing is written afterwards.
    key('a');
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it('TC-24b: a text that gains words from another screen while open keeps being typed into', async () => {
    const board = await mountSticky();
    const id = await textWith(board, 'one', { x: 120, y: 60 });
    await pressOn(board, id);
    key('Enter');
    await flushFrames();

    // Somebody else added to the same words. The object is still there, so the field stays: it is the
    // object going away that ends editing, not the text changing underneath it.
    remoteChange(board, () => {
      getTextContent(board.doc, id)?.insert(3, ' of them');
    });
    await flushFrames();

    expect(textEditorOrNull(board)).not.toBeNull();
    expect(board.object(id).text).toBe('one of them');
    // The field shows what the document holds, not what it held when the field was opened.
    expect(textEditor(board).value).toBe('one of them');
    expect(document.activeElement).toBe(textEditor(board));
  });

  it('TC-24c: a remote delete of one of two selected texts leaves the other one selected', async () => {
    const board = await mountSticky();
    const first = await textWith(board, GREETING, { x: 0, y: 0 });
    const second = await textWith(board, 'kept', { x: 300, y: 0 });
    await pressOn(board, first);
    await shiftOn(board, second);
    expect(board.outlinedIds()).toHaveLength(2);

    remoteChange(board, () => deleteObjects(board.doc, [first]));
    await flushFrames();

    // The selection loses what is gone and keeps what is not, exactly as it does for a note. A
    // selection that held on to an id that is no longer on the board would be a bar showing buttons
    // for an object nothing can find.
    expect(board.outlinedIds()).toEqual([second]);
    expect(pressedSize(board)).toBe('M');
    expect(snapshot(board.doc)).toHaveLength(1);
  });
});

describe('text.object: undo (TC-25)', () => {
  it('TC-25: one press takes back the words and the box they made together', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    const created = boxOf(board, id);
    expect(created).toEqual({ x: 120, y: 60, width: TEXT_MIN_WIDTH_WORLD, height: LINE_M });

    typeText(board, GREETING);
    await flushFrames();
    expect(boxOf(board, id).width).toBe(GREETING_WIDTH);
    expect(board.object(id).text).toBe(GREETING);

    clickUndo(board);
    await flushFrames();

    // Words and box, together, in one press: a history that undid the sentence and left the box
    // ninety units wide would leave a heading that had been erased but was still the size of itself.
    expect(board.object(id).text).toBe('');
    expect(boxOf(board, id)).toEqual(created);
    // The object itself is the press before that: making it was a different thing to do.
    clickUndo(board);
    await flushFrames();
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it('TC-25b: and one press puts both back', async () => {
    const board = await mountSticky();
    const id = await emptyText(board, { x: 120, y: 60 });
    typeText(board, GREETING);
    await flushFrames();
    const typed = boxOf(board, id);

    clickUndo(board);
    await flushFrames();
    expect(snapshot(board.doc)).toHaveLength(1);

    clickRedo(board);
    await flushFrames();

    expect(board.object(id).text).toBe(GREETING);
    expect(boxOf(board, id)).toEqual(typed);
  });

  it('TC-25c: a size change and the room it needed are one step too', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const before = board.object(id);
    expect(before).toMatchObject({ size: 'M', width: GREETING_WIDTH, height: LINE_M });

    await chooseTextSize(board, 'XL');
    expect(board.object(id)).toMatchObject({ size: 'XL', height: Math.round(TEXT_SIZES.XL * 1.3) });

    clickUndo(board);
    await flushFrames();

    // Back to size M with the box that was measured for M, in one press - and not to XL in a box
    // measured for M, which is what a history of separate writes would leave after one press.
    expect(board.object(id)).toEqual(before);
  });

  it('TC-25d: undoing a width dragged from a handle gives back the width the words asked for', async () => {
    const board = await mountSticky();
    const id = await textWith(board, GREETING, { x: 120, y: 60 });
    const before = boxOf(board, id);

    await dragHandle(board, 'e', before, { x: -40, y: 0 });
    expect(textOf(board, id).widthMode).toBe('fixed');

    clickUndo(board);
    await flushFrames();

    // The width, the mode and the height it had re-measured at that width, all of it back: one thing
    // was done, and one press undoes it.
    expect(boxOf(board, id)).toEqual(before);
    expect(textOf(board, id).widthMode).toBe('auto');
  });
});
