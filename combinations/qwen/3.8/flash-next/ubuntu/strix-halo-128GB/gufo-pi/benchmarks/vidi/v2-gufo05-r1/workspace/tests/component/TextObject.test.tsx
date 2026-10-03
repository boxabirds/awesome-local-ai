/**
 * A piece of free text on the board, from the person's side (`text.object`).
 *
 * These tests mount the real board and behave like a person with a mouse: click where the
 * writing should start, type, press Enter, press Escape, drag a handle. What they check is
 * the part of story 9 that a unit test cannot reach — that the box, the caret, the toolbar
 * and the selection all describe the same object at the same moment.
 *
 * TC-19 typing into text: caret at the end, Enter makes a newline, Escape ends and keeps it selected
 * TC-20 Escape with nothing typed removes the object and the selection with it
 * TC-21 the toolbar's four sizes; XL keeps the position and does not move the text
 * TC-22 selecting one text offers only the east and west handles
 * TC-23 text plus a note offers all eight; the resize scales the arrangement, not the font
 * TC-24 text deleted by somebody else while being typed into: the editor goes, nothing comes back
 * TC-25 Ctrl+Z takes the typing and the box it wrote back as one step
 *
 * jsdom measures nothing (`tests/component/setup.ts`), so widths here are the estimate the
 * board falls back to. That is fine: the tests are about a box that follows the content, and
 * the estimate is a function of the content.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECTS_KEY, objectSnapshots } from '../../src/shared/board-model';
import { TEXT_SIZES } from '../../src/shared/config';
import { worldToScreen, type Point } from '../../src/client/canvas/camera';
import { createText, emptyTextBox, getText, type TextSnapshot } from '../../src/shared/objects/text';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

/** Any origin that is not this client's: what arrives from the room, and from a peer. */
const REMOTE = Symbol('test.remote');

const at = (board: StickyAppHandle, world: Point) => worldToScreen(board.camera(), world);

/** The text objects on the board, in document order. */
function texts(doc: Y.Doc): TextSnapshot[] {
  return objectSnapshots(doc)
    .filter((object) => object.type === 'text')
    .map((object) => object as TextSnapshot);
}

/**
 * Put a piece of text on the board, with content already in it.
 *
 * The content goes in as this client's own change, so the box is measured for it the way
 * it would be for anything typed here: tests then start from a box that describes its
 * words, which is what the person would be looking at.
 */
async function addText(
  board: StickyAppHandle,
  corner: Point,
  content = '',
): Promise<string> {
  const id = createText(board.doc, corner, 'someone');
  if (!id) throw new Error('the board refused to make text');
  // The object is mounted first, and its words come after: a box is measured when the
  // content changes under a client that is looking at it, which is what a person typing
  // into it does.
  await advanceFrames();
  if (content !== '') {
    board.doc.transact(() => {
      getText(board.doc, id)?.insert(0, content);
    }, LOCAL_ORIGIN);
  }
  await advanceFrames();
  return id;
}

function textElement(): HTMLElement {
  return screen.getByTestId('text-object');
}

function editor(): HTMLElement {
  return screen.getByTestId('text-editor');
}

/** Type into the field the way a browser does: change the DOM, then say so. */
async function typeInto(element: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    element.textContent = `${element.textContent ?? ''}${value}`;
    fireEvent.input(element);
  });
  await advanceFrames();
}

/** Press on the text and let go: a click that selects. */
async function clickText(board: StickyAppHandle, text: TextSnapshot): Promise<void> {
  const point = at(board, { x: text.x + 4, y: text.y + 4 });
  await board.press(textElement(), point.x, point.y);
  await board.release(point.x, point.y);
}

async function key(target: HTMLElement, name: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(target, { key: name, bubbles: true, cancelable: true });
  });
  await advanceFrames();
}

describe('text.object: writing into it', () => {
  it('TC-19 the caret starts at the end, Enter makes a newline, Escape leaves it selected', async () => {
    const board = await renderStickyApp();
    const id = await addText(board, { x: 100, y: 100 }, 'Hello');

    const inside = at(board, { x: 110, y: 110 });
    await board.doubleClick(textElement(), inside.x, inside.y);
    await advanceFrames();
    const field = editor();

    // The words that were already there are in the field, and the caret is after them:
    // a person opening a piece of text is adding to it, not rewriting it.
    expect(field.textContent).toBe('Hello');
    expect(document.activeElement).toBe(field);
    const caret = window.getSelection();
    expect(caret?.anchorNode).toBe(field.firstChild);
    expect(caret?.anchorOffset).toBe(5);

    // Enter is a newline, not "done" (`text.edit`): the board is a place for a heading
    // and a line under it.
    await key(field, 'Enter');
    await typeInto(field, 'x');
    expect(getText(board.doc, id)?.toString()).toBe('Hello\nx');

    // Escape closes the field and keeps the text selected: leaving an edit is not the
    // same as deselecting, and the toolbar should still be pointing at it.
    await key(field, 'Escape');
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(getText(board.doc, id)?.toString()).toBe('Hello\nx');
    expect(board.selectedIds()).toEqual([id]);
  });

  it('TC-20 Escape with nothing typed takes the object and the selection with it', async () => {
    const board = await renderStickyApp();
    // The Text tool, and a click where the person means to write.
    await board.pressKey('t');
    await board.clickEmpty(300, 240);
    await advanceFrames();

    const placed = texts(board.doc);
    expect(placed).toHaveLength(1);
    expect(board.selectedIds()).toEqual([placed[0]!.id]);
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    await key(editor(), 'Escape');
    await advanceFrames();

    // An empty box of text is not a thing on the board (`text.delete_empty`), and a
    // selection cannot describe an object that is not there.
    expect(texts(board.doc)).toHaveLength(0);
    expect(board.selectedIds()).toEqual([]);
  });

  it('typing keeps the box around the words, and does not move the object', async () => {
    const board = await renderStickyApp();
    const id = await addText(board, { x: 60, y: 70 });
    const before = texts(board.doc)[0]!;
    expect(before.height).toBeCloseTo(emptyTextBox().height, 3);

    await clickText(board, before);
    await board.pressKey('Enter');
    await advanceFrames();

    await typeInto(editor(), 'The quick brown fox jumps over the lazy dog, and then keeps going');
    const after = texts(board.doc).find((object) => object.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // More words than fit on one line: taller, and no wider than the maximum a box may
    // take before it starts wrapping (`text.autosize`).
    expect(after.height).toBeGreaterThan(before.height);
  });
});

describe('text.object: the toolbar', () => {
  it('TC-21 four sizes with the current one pressed, and XL leaves the object where it is', async () => {
    const board = await renderStickyApp();
    const id = await addText(board, { x: 80, y: 90 }, 'Heading');
    const before = texts(board.doc)[0]!;
    expect(before.size).toBe('M');

    await clickText(board, before);
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medium text' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    for (const name of ['Small text', 'Large text', 'Extra large text']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    }

    await act(async () => {
      screen.getByRole('button', { name: 'Extra large text' }).click();
    });
    await advanceFrames();

    const after = texts(board.doc).find((object) => object.id === id)!;
    expect(after.size).toBe('XL');
    // The top-left is the anchor: bigger words grow down and right, they do not slide
    // away from where they were put.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // And the box knows: the same words in a bigger font are taller.
    expect(after.height).toBeGreaterThan(before.height);
    // One line of XL: the height is the size times the line height, and nothing else
    // (`text.autosize`).
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * 1.3, 1);
  });

  it('the width toggle is pressed while the box measures itself, and fixes it when clicked', async () => {
    const board = await renderStickyApp();
    const id = await addText(board, { x: 40, y: 40 }, 'A line of text');
    const before = texts(board.doc)[0]!;
    expect(before.widthMode).toBe('auto');

    await clickText(board, before);
    const toggle = screen.getByRole('button', { name: 'Fit width' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      toggle.click();
    });
    await advanceFrames();

    const after = texts(board.doc).find((object) => object.id === id)!;
    expect(after.widthMode).toBe('fixed');
    // The width it had is the width it keeps: a person clicking this is not asking for
    // the text to jump.
    expect(after.width).toBeCloseTo(before.width, 3);
  });
});

describe('text.object: handles', () => {
  it('TC-22 a single text is resized sideways only', async () => {
    const board = await renderStickyApp();
    await addText(board, { x: 100, y: 100 }, 'Narrow');
    await clickText(board, texts(board.doc)[0]!);

    // Two, in the order the overlay lays them out: the box is made wider from either
    // side, and there is nothing to grab at the top or the bottom.
    expect(board.handles().map((handle) => handle.dataset.handle)).toEqual(['e', 'w']);
  });

  it('TC-23 with a note in the selection all eight are offered, and the font is left alone', async () => {
    const board = await renderStickyApp();
    const noteId = await board.addNote({ x: -300, y: 0 });
    const textId = await addText(board, { x: 100, y: 100 }, 'A line of text');

    await clickText(board, texts(board.doc).find((object) => object.id === textId)!);
    const notePoint = at(board, { x: -300, y: 0 });
    await board.press(board.note(0), notePoint.x, notePoint.y, { shift: true });
    await board.release(notePoint.x, notePoint.y);

    // The note is resized from eight places, so all eight appear: what each one does to
    // each object is the object's business.
    expect(board.handles()).toHaveLength(8);

    const before = {
      text: texts(board.doc).find((object) => object.id === textId)!,
      note: board.notes().find((note) => note.id === noteId)!,
    };

    // Drag the south-east corner of the whole selection outwards: the anchor is the
    // north-west corner, so everything moves away from it.
    const corner = board.handle('se')!;
    const from = { x: corner.getBoundingClientRect().left, y: corner.getBoundingClientRect().top };
    await board.press(corner, from.x, from.y);
    await board.moveTo(from.x + 200, from.y + 200);
    await board.release(from.x + 200, from.y + 200);
    await advanceFrames();

    const after = texts(board.doc).find((object) => object.id === textId)!;
    const noteAfter = board.notes().find((note) => note.id === noteId)!;

    // The note took the resize the way it always has.
    expect(noteAfter.width).toBeGreaterThan(before.note.width);
    // The text moved outward with the arrangement and got a wider column, because it is
    // in the selection like anything else.
    expect(after.x).toBeGreaterThan(before.text.x);
    expect(after.y).toBeGreaterThan(before.text.y);
    expect(after.width).toBeGreaterThan(before.text.width);
    // But the words themselves are the same size, and the same words: a resize moves
    // text and widens its column, it does not set type (`text.size`).
    expect(after.size).toBe('M');
    expect(after.text).toBe('A line of text');
    // And a column chosen by dragging is a column that is kept (`text.resize_width`).
    expect(after.widthMode).toBe('fixed');
  });
});

describe('text.object: other people, and history', () => {
  it('TC-24 text deleted by somebody else mid-edit leaves nothing behind', async () => {
    const board = await renderStickyApp();
    const id = await addText(board, { x: 120, y: 120 }, 'Being edited');
    const before = texts(board.doc)[0]!;
    await clickText(board, before);
    await board.pressKey('Enter');
    await advanceFrames();
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // The room deletes it: the same shape as any other delete, from the other side.
    board.doc.transact(() => {
      (board.doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).delete(id);
    }, REMOTE);
    await advanceFrames();

    // The editor is gone, no error was thrown on the way, and nothing re-created the
    // object — an editor that wrote on unmount would have put it back.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(texts(board.doc)).toHaveLength(0);
    expect(board.selectedIds()).toEqual([]);
    await advanceFrames();
    expect(texts(board.doc)).toHaveLength(0);
  });

  it('TC-25 Ctrl+Z takes the words and the box back together, in one step', async () => {
    const board = await renderStickyApp();
    // Through the tool, so the creation and the typing are separate steps as they are
    // in real use (`undo.steps`).
    await board.pressKey('t');
    await board.clickEmpty(300, 240);
    await advanceFrames();
    const id = texts(board.doc)[0]!.id;
    const box = emptyTextBox();

    // Two lines: taller than the empty box, and wrapping that the box has to know about.
    await typeInto(editor(), 'Four score and seven years ago\nupon this continent');
    const typed = texts(board.doc).find((object) => object.id === id)!;
    expect(typed.text).toBe('Four score and seven years ago\nupon this continent');
    expect(typed.height).toBeGreaterThan(box.height);
    expect(typed.width).toBeGreaterThan(box.width);

    // Ctrl+Z inside the field: the board's own shortcut handler stands down while a
    // person is typing, and the field takes it instead (`undo.typing`).
    await keyUndo(editor());
    await advanceFrames();

    const undone = texts(board.doc).find((object) => object.id === id);
    // One step back is one thing back: the words, and the box they had made, which was
    // written in the same capture window.
    expect(undone).toBeTruthy();
    expect(undone!.text).toBe('');
    expect(undone!.height).toBeCloseTo(box.height, 3);
    expect(undone!.width).toBeCloseTo(box.width, 3);
    // The object is still there to be written into — undoing the typing is not undoing
    // the decision to have text at that spot.
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // The step under it is the placement itself.
    await keyUndo(editor());
    await advanceFrames();
    expect(texts(board.doc)).toHaveLength(0);
  });
});

/** Ctrl+Z where the caret is. */
async function keyUndo(target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(target, { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  });
}
