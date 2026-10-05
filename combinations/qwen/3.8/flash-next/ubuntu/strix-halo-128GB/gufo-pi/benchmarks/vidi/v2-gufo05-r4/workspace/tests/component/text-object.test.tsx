/**
 * Story 9 component tests: free text as an object on the board (`text.object`).
 *
 * What is under test is the small set of things a piece of text does that no other object
 * on this board does:
 *
 *   - it is edited in place, with Enter meaning a newline and Escape meaning "done, and
 *     leave it selected" (`text.edit`);
 *   - the box it occupies is a measurement of its own words, written by whoever changed
 *     them (`text.auto_width`) — so these tests inject a measurer of known arithmetic,
 *     because jsdom has no fonts and a test that measured nothing would assert nothing;
 *   - it is resized in width only, and joins a group resize without losing its font
 *     (`text.fixed_width`);
 *   - an empty one is not left behind (`text.empty_delete`), and one deleted underneath the
 *     typist stays deleted (`text.remote_delete`);
 *   - its words and its box are one undo step (`text.undo`).
 *
 * Text is seeded the way another client's write would arrive, and edited through the real
 * editor, so the writes being asserted are the ones the application makes.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import {
  boardObjects,
  createSticky,
  deleteObjects,
  objectBounds,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, type TextSnapshot } from '../../src/shared/objects/text';
import { setTextMeasurer } from '../../src/client/objects/textLayout';
import { screenToWorld, worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  doubleClick,
  fireInput,
  fireKey,
  firePointer,
  flushCameraFrame,
  flushFrames,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  textEditor,
  textToolbar,
  textSizeButton,
  viewportElement
} from './harness';

/** One line of the default size, which is what a text with nothing in it holds. */
const ONE_LINE = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

/**
 * A measurer with arithmetic jsdom cannot argue with: every character is half its font
 * size wide, so "abc" at 20 px is 30 units. Space counts the same as a letter, which makes
 * the wrapping below readable as sums.
 */
const MEASURER = (text: string, fontPx: number): number => text.length * fontPx * 0.5;

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
  setTextMeasurer(MEASURER);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setTextMeasurer(null);
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** Put a text on the board, holding `content`, the way another client's write would. */
function seedText(board: BoardFixture, at: Point, content = ''): string {
  let id = '';
  act(() => {
    id = createText(board.doc, at)!;
    if (content !== '') getTextContent(board.doc, id)!.insert(0, content);
  });
  return id;
}

function textSnapshot(board: BoardFixture, id: string): TextSnapshot {
  const object = board.objects().find((candidate) => candidate.id === id);
  if (!object || object.type !== 'text') throw new Error(`text ${id} is not on the board`);
  return object as TextSnapshot;
}

function textElement(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`text ${id} is not on screen`);
  return element;
}

/** The screen point in the middle of an object, as the camera sees it. */
function screenPointOf(object: ObjectSnapshot): Point {
  const bounds = objectBounds(object);
  return worldToScreen(testCamera(), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

/** Click an object: press and release without moving. */
async function clickObject(board: BoardFixture, id: string, shift = false): Promise<void> {
  const point = screenPointOf(textSnapshot(board, id));
  const element = textElement(board, id);
  firePointer(element, 'pointerdown', point.x, point.y, { shiftKey: shift });
  firePointer(element, 'pointerup', point.x, point.y, { shiftKey: shift });
  await flushFrames();
}

/** Press on an element, move in steps, and release — a real drag. */
async function drag(target: Element, from: Point, to: Point, steps = 4): Promise<void> {
  firePointer(target, 'pointerdown', from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      target,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
    await flushFrames();
  }
  firePointer(target, 'pointerup', to.x, to.y);
  await flushFrames();
}

/** Open a text's editor the way a visitor does: double-click it. */
async function editText(board: BoardFixture, id: string): Promise<HTMLTextAreaElement> {
  const point = screenPointOf(textSnapshot(board, id));
  doubleClick(textElement(board, id), point.x, point.y);
  const editor = textEditor(board.root);
  if (!editor) throw new Error(`text ${id} did not open for editing`);
  return editor;
}

function handle(root: HTMLElement, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-vidi6="resize-handle"][data-handle="${name}"]`);
}

/** The handles the selection offers, in the order the overlay draws them. */
function handlesShown(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-vidi6="resize-handle"]')).map(
    (element) => element.dataset.handle ?? ''
  );
}

/** The height of `lines` lines at one of the four sizes. */
function heightFor(size: keyof typeof TEXT_SIZES, lines: number): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT * lines;
}

describe('editing free text (text.edit)', () => {
  it('TC-19: the caret starts at the end, Enter is a newline, Escape ends and keeps it selected', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 0, y: 0 }, 'Went well');
    await flushCameraFrame();

    const editor = await editText(board, id);
    expect(editor.value).toBe('Went well');
    // The caret at the end, and the focus: text placed and then edited should continue
    // where it left off rather than select everything or start at the front.
    expect(editor.selectionStart).toBe('Went well'.length);
    expect(document.activeElement).toBe(editor);

    // Enter is left to the browser, which puts a newline in. Anything that swallowed this
    // key would turn a two-line note into two pieces of text.
    const enter = fireKey('Enter', { target: editor });
    expect(enter.defaultPrevented).toBe(false);
    expect(textEditor(board.root)).not.toBeNull();

    // jsdom inserts no character for a synthetic key, so the newline arrives the way the
    // component sees it: as the value the browser ended up with.
    fireInput(editor, 'Went well\nand did not');
    expect(textSnapshot(board, id).text).toBe('Went well\nand did not');
    // Two lines at M: the height is the lines, not a box the user set.
    expect(textSnapshot(board, id).height).toBeCloseTo(heightFor('M', 2), 6);
    // and the width is the longer of the two lines ("and did not", 11 characters at half
    // their font size each).
    expect(textSnapshot(board, id).width).toBeCloseTo(11 * TEXT_SIZES.M * 0.5, 6);

    fireKey('Escape', { target: editor });
    expect(textEditor(board.root)).toBeNull();
    // Escape ends editing *and* leaves it selected, which is how the size toolbar is
    // reached after typing (`text.size`).
    expect(textElement(board, id).dataset.selected).toBe('true');
    expect(textToolbar(textElement(board, id))).not.toBeNull();
  });

  it('TC-20: Escape with nothing typed leaves no text behind', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 0, y: 0 });
    await flushCameraFrame();

    const editor = await editText(board, id);
    fireKey('Escape', { target: editor });

    // An empty text is not content, and a board littered with invisible click targets is
    // worse than one that admits nothing happened.
    expect(board.objects()).toHaveLength(0);
    expect(board.root.querySelector(`[data-object-id="${id}"]`)).toBeNull();
    // Nothing is selected, so no outline and no toolbar are left floating there.
    expect(board.root.querySelector('[data-vidi6="selection-overlay"]')).toBeNull();
  });

  it('TC-21: the toolbar offers the four sizes, and picking one keeps the top-left', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 40, y: 60 }, 'Heading');
    await flushCameraFrame();
    await clickObject(board, id);

    const toolbar = textToolbar(textElement(board, id));
    expect(toolbar).not.toBeNull();
    const shown = ['S', 'M', 'L', 'XL'].map((size) => [
      size,
      textSizeButton(toolbar!, size)?.getAttribute('aria-pressed') === 'true'
    ]);
    expect(shown.map(([, pressed]) => pressed)).toEqual([false, true, false, false]);

    const before = textSnapshot(board, id);
    act(() => {
      textSizeButton(toolbar!, 'XL')!.click();
    });

    const after = textSnapshot(board, id);
    expect(after.size).toBe('XL');
    // The first letter stays where it was: a heading that jumped somewhere else as it grew
    // would be a heading you had to hunt for.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Bigger font, bigger box: one line, at the XL line height.
    expect(after.height).toBeCloseTo(heightFor('XL', 1), 6);
    expect(textElement(board, id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    // The size is now stated on the button that set it.
    expect(textSizeButton(textElement(board, id), 'XL')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the box of free text (text.fixed_width)', () => {
  it('TC-22: one text selected offers its two side handles and no others', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 0, y: 0 }, 'Wrap me at a width I choose');
    await flushCameraFrame();
    await clickObject(board, id);

    // Height follows the words, so a handle that set it would be undone by the next
    // measurement. Width is the only thing here worth dragging.
    expect(handlesShown(board.root).sort()).toEqual(['e', 'w']);
    expect(handle(board.root, 'n')).toBeNull();
    expect(handle(board.root, 'se')).toBeNull();
  });

  it('TC-23: in a mixed selection all the handles show, and a group resize leaves the font alone', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 100, y: 100 }, 'Heading!');
    let note = '';
    act(() => {
      note = createSticky(board.doc, { x: 400, y: 400 });
    });
    await flushCameraFrame();

    await clickObject(board, id);
    const noteElement = board.root.querySelector<HTMLElement>(`[data-object-id="${note}"]`)!;
    const notePoint = worldToScreen(testCamera(), { x: 400, y: 400 });
    firePointer(noteElement, 'pointerdown', notePoint.x, notePoint.y, { shiftKey: true });
    firePointer(noteElement, 'pointerup', notePoint.x, notePoint.y, { shiftKey: true });
    await flushFrames();

    // The box being dragged is the group's, and a sticky note inside it can be resized in
    // every direction, so all eight handles show.
    expect(handlesShown(board.root).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);

    const before = textSnapshot(board, id);
    const corner = handle(board.root, 'nw')!;
    // Drag the top-left corner outwards: everything in the selection moves away from the
    // bottom-right, which stays where it is.
    const anchor = worldToScreen(testCamera(), { x: 400, y: 400 });
    await drag(corner, anchor, { x: anchor.x - 60, y: anchor.y - 60 });

    const after = textSnapshot(board, id);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    // Proportionally moved, not stretched: the size preset is the only thing that decides
    // how big the letters are, and a handle is not a size.
    expect(after.size).toBe('M');
    // ...and it kept the width of its words rather than the width the group was stretched
    // to, because an auto-width box is a measurement and not a wish. The height is still
    // one line at M: a scaled note scales, text re-wraps.
    expect(after.width).toBeCloseTo('Heading!'.length * TEXT_SIZES.M * 0.5, 6);
    expect(after.width).not.toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(heightFor('M', 1), 6);
  });
});

describe('free text going away (text.empty_delete, text.remote_delete)', () => {
  it('TC-24: text deleted by somebody else while being typed in closes the editor and stays gone', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 0, y: 0 }, 'Shared sentence');
    await flushCameraFrame();

    const editor = await editText(board, id);
    fireInput(editor, 'Shared sentence, added to');

    // Another person deletes it while you are mid-sentence.
    act(() => {
      deleteObjects(board.doc, [id]);
    });
    await flushFrames();

    // The editor is gone — no textarea left typing into a text that is not there.
    expect(textEditor(board.root)).toBeNull();
    expect(board.root.querySelector(`[data-object-id="${id}"]`)).toBeNull();
    // The text is not put back: an object nobody deleted is the worst kind of ghost, and a
    // late blur or unmount write must not resurrect one.
    act(() => {
      editor.dispatchEvent(new FocusEvent('blur'));
    });
    await flushFrames();
    expect(board.objects().find((object) => object.id === id)).toBeUndefined();
    expect(board.objects()).toHaveLength(0);
  });

  it('TC-25: one undo puts back the words and the box together', async () => {
    const board = await renderBoard();
    fireKey('T');
    const screen = { x: 200, y: 150 };
    const world = screenToWorld(testCamera(), screen);
    const viewport = viewportElement(board.root);
    firePointer(viewport, 'pointerdown', screen.x, screen.y);
    firePointer(viewport, 'pointerup', screen.x, screen.y);
    await flushCameraFrame();

    const id = board.objects().find((object) => object.type === 'text')!.id;
    const created = textSnapshot(board, id);
    expect(created.x).toBeCloseTo(world.x, 6);
    // Before anything was typed, the box is the narrowest possible and one line tall.
    expect(created.width).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 6);
    expect(created.height).toBeCloseTo(heightFor('M', 1), 6);

    const editor = textEditor(board.root)!;
    fireInput(editor, 'A heading worth undoing');
    const typed = textSnapshot(board, id);
    expect(typed.width).toBeGreaterThan(created.width);
    expect(typed.text).toBe('A heading worth undoing');

    // One Ctrl+Z — the editor is open, so it is the editor's own undo, which runs the
    // board's history rather than the textarea's private one.
    fireKey('z', { ctrlKey: true, target: editor });
    await flushFrames();

    const undone = textSnapshot(board, id);
    expect(undone.text).toBe('');
    // The box went back with the words, in the same step: a box left at the width of words
    // that are no longer there is a lie about what is on the board.
    expect(undone.width).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 6);
    expect(undone.height).toBeCloseTo(heightFor('M', 1), 6);
  });
});

describe('free text and the other objects', () => {
  it('a text is drawn in the text font, at its size, with the stored box', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 20, y: 30 }, 'Plain words');
    await flushCameraFrame();

    const element = textElement(board, id);
    expect(element.dataset.objectType).toBe('text');
    expect(element.dataset.size).toBe('M');
    expect(element.dataset.widthMode).toBe('auto');
    expect(element.textContent).toContain('Plain words');
    // No background, no colour of its own: the box is transparent and the words are ink.
    expect(element.style.background).toBe('');
    expect(element.style.border).toBe('');
    expect(element.style.fontFamily).toContain('Inter');
  });

  it('a text with no words still has a box to click', async () => {
    const board = await renderBoard();
    const id = seedText(board, { x: 0, y: 0 });
    await flushCameraFrame();

    // Not invisible to the pointer: an object with nothing in it is still being edited, and
    // clicking it goes back into that edit rather than clearing it away.
    await clickObject(board, id);
    expect(textElement(board, id).dataset.selected).toBe('true');
    expect(textSnapshot(board, id).width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    expect(textSnapshot(board, id).height).toBe(ONE_LINE);
  });
});

