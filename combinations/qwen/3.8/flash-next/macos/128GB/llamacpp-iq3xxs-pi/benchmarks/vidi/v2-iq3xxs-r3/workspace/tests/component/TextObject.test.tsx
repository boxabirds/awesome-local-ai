/**
 * TC-19 to TC-25 (story 9, `text.object`): a text object on the board — typed
 * into, sized, resized, deleted from behind, and taken back.
 *
 * The board is the one the app renders and everything in it is the app's own: the
 * object comes from the model, the typing goes through the real editor, the size
 * comes from the toolbar above the object, and the handles are the ones
 * `SelectionOverlay` draws. That last pair matters here more than anywhere else in
 * the suite: story 9's promise (`text.consistent`) is that text is an object like
 * any other, so the test that would catch a special case is the one that goes
 * through the same selection code a note uses and finds text in it.
 *
 * The camera is parked at the origin at zoom 1, so a point in the viewport is the
 * same numbers in the world. Widths are not asserted to the unit except where a
 * drag *chose* one: jsdom has no canvas, so the measurer falls back on its
 * estimate, and what a real measurement is worth is settled in the browser (TC-26)
 * and in the layout tests (TC-07 and up).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import { DEFAULT_TEXT_SIZE, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import type { TextSize } from '../../src/shared/config';
import { deleteObjects, LOCAL_ORIGIN, objectSnapshots } from '../../src/shared/board-model';
import { setTextSize, TEXT_SIZE_NAMES } from '../../src/shared/objects/text';
import {
  addNote,
  centreOfNote,
  clickNote,
  dispatchKey,
  drag,
  noteById,
  objectSizes,
  pointerEvent,
  press,
  releaseAt,
  renderStickyBoard,
  selectedIds,
  setCamera,
} from './helpers/board';
import { readObjectEntry, seedText, textIdsOf } from './helpers/text-board';

/** The histories this file created, so their observers go with the board. */
const created: UndoController[] = [];

/**
 * The board with nothing on it yet, and the camera where the numbers are simple.
 * With `undo` the test holds the history, because the assertion is about how many
 * steps the board put into it — and a step is only visible from there.
 */
function startBoard(options: { undo?: boolean } = {}): { doc: YDoc; undo?: UndoController } {
  const doc = new Doc();
  const undo = options.undo ? createUndo(doc) : undefined;
  if (undo) created.push(undo);
  renderStickyBoard(doc, undo ? { undo } : {});
  act(() => setCamera({ x: 0, y: 0, zoom: 1 }));
  return { doc, undo };
}

afterEach(() => {
  cleanup();
  created.length = 0;
});

/** Put a text on the board the way another screen would: no origin, one transaction. */
function addText(
  doc: YDoc,
  at: { x: number; y: number },
  text = '',
  size?: TextSize,
): string {
  let id = '';
  act(() => {
    id = seedText(doc, { x: at.x, y: at.y, text, size });
  });
  return id;
}

/** The object element the board is drawing. */
function textElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (!element) throw new Error(`the board is not drawing text ${id}`);
  return element;
}

/** The words as the board renders them, not as the document holds them. */
function wordsOf(id: string): string {
  const layer = textElement(id).querySelector<HTMLElement>('[data-testid="text-content"]');
  if (!layer) throw new Error('the text has no words rendered into it');
  return layer.textContent ?? '';
}

/** The words as the document holds them. */
function contentOf(doc: YDoc, id: string): string {
  return String(readObjectEntry(doc, id).text ?? '');
}

/**
 * The board's record for a text, in the shape these tests measure against. A text
 * object *has* a box, a size and a width mode; a record missing any of them is not
 * a text this board drew, so the tests say so instead of comparing with `undefined`.
 */
function snapshotOf(doc: YDoc, id: string): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly size: TextSize;
  readonly widthMode: 'auto' | 'fixed';
} {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (
    !object ||
    typeof object.width !== 'number' ||
    typeof object.height !== 'number' ||
    object.size === undefined ||
    object.widthMode === undefined
  ) {
    throw new Error(`no text object ${id} on the board`);
  }
  return {
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    size: object.size,
    widthMode: object.widthMode,
  };
}

/** A press and release on a text's middle: a click on it. */
function clickText(doc: YDoc, id: string): void {
  const bounds = objectSizes(doc, id);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  press(textElement(id), point);
  releaseAt(textElement(id), point);
}

/** The field typed into. */
function editor(): HTMLTextAreaElement {
  const area = screen.getByTestId('text-editor');
  if (!(area instanceof HTMLTextAreaElement)) throw new Error('the text field is not a textarea');
  return area;
}

/** Select the text, then open it for typing the way story 7 opens a selected object. */
function editText(doc: YDoc, id: string): HTMLTextAreaElement {
  clickText(doc, id);
  dispatchKey({ key: 'Enter' });
  return editor();
}

function type(text: string): void {
  fireEvent.change(editor(), { target: { value: text } });
}

/**
 * A text that arrived from another screen carries the box *that* screen measured,
 * and this one has never measured it — which is right (`text.height`: nobody
 * re-measures what somebody else's characters produced) but leaves a test comparing
 * a minimum box against a measured one. So the object is given one local change to
 * answer: the size goes to S and straight back to what it was, in one transaction,
 * which leaves the text exactly as it was and leaves its box measured here.
 */
function measureHere(doc: YDoc, id: string): void {
  act(() => {
    doc.transact(() => {
      setTextSize(doc, id, 'S');
      setTextSize(doc, id, DEFAULT_TEXT_SIZE);
    }, LOCAL_ORIGIN);
  });
}

/** A press on the board area, away from every object: letting go of the selection. */
function clickEmptyBoard(): void {
  const point = { x: 10, y: 700 };
  const surface = screen.getByTestId('board-grid');
  pointerEvent('pointerDown', surface, point);
  pointerEvent('pointerUp', surface, point);
}

describe('typing into a text on the board (TC-19)', () => {
  it('TC-19: the caret opens at the end, Enter is a character, and Escape leaves the text selected', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Retro');
    clickText(doc, id);
    expect(selectedIds()).toEqual([id]);
    expect(textElement(id).dataset.selected).toBe('true');

    dispatchKey({ key: 'Enter' });
    const area = editor();
    expect(document.activeElement).toBe(area); // focused as it mounts
    expect(area.selectionStart).toBe('Retro'.length); // caret after what is already there
    expect(area.selectionEnd).toBe('Retro'.length);
    // No toolbar while the words are being typed, as with a note.
    expect(screen.queryByTestId('text-toolbar')).toBeNull();

    // Enter is one of the words, not a way out of the field: nothing about a text
    // object submits, dismisses, or hides behind a single line.
    const newline = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    expect(area.dispatchEvent(newline)).toBe(true); // its default action was left alone

    type('Retro\nWent well');
    expect(contentOf(doc, id)).toBe('Retro\nWent well');

    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(contentOf(doc, id)).toBe('Retro\nWent well'); // kept
    expect(wordsOf(id)).toBe('Retro\nWent well'); // and rendered
    expect(textElement(id).dataset.selected).toBe('true'); // ends selected, as a note does
  });

  it('a press outside the text ends the edit, and the text is not unmade by having been typed into', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Retro');
    editText(doc, id);
    type('Retro!');
    expect(contentOf(doc, id)).toBe('Retro!');

    clickEmptyBoard();

    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(contentOf(doc, id)).toBe('Retro!');
    expect(textIdsOf(doc)).toEqual([id]); // typing into it never made it, so it stays
    expect(selectedIds()).toEqual([]); // and letting go of the field lets go of it
  });

  it('text nobody typed into is not left on the board either', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 });
    const area = editText(doc, id);
    expect(contentOf(doc, id)).toBe('');
    fireEvent.keyDown(area, { key: 'Escape' });
    // `text.empty`: an empty text is not an object.
    expect(textIdsOf(doc)).toEqual([]);
    expect(selectedIds()).toEqual([]);
  });
});

describe('the toolbar above one selected text (TC-21)', () => {
  it('TC-21: four sizes with the current one pressed, and XL leaves the text where it is', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Went well');
    const before = snapshotOf(doc, id);
    expect(before.size).toBe(DEFAULT_TEXT_SIZE);
    expect(Math.round(before.height)).toBe(Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT));

    clickText(doc, id);
    expect(screen.getByTestId('text-toolbar').isConnected).toBe(true);
    for (const name of TEXT_SIZE_NAMES) {
      expect(screen.getByTestId(`text-size-${name}`).getAttribute('aria-pressed')).toBe(
        String(name === 'M'),
      );
    }

    act(() => {
      fireEvent.click(screen.getByTestId('text-size-XL'));
    });

    const after = snapshotOf(doc, id);
    expect(after.size).toBe('XL');
    // A size is not a move (`text.size`).
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // And the box follows the bigger letters, because the text re-measured its own
    // new height in the same change (`text.height`).
    expect(after.height).toBeGreaterThan(before.height);
    expect(textElement(id).dataset.size).toBe('XL');
    expect(textElement(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
  });

  it('the delete on that toolbar takes the text away and the selection with it', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Went well');
    clickText(doc, id);
    act(() => {
      fireEvent.click(screen.getByTestId('text-delete'));
    });
    expect(textIdsOf(doc)).toEqual([]);
    expect(selectedIds()).toEqual([]);
  });
});

describe('handles on text (`sel.resize`, `text.fixed_width`, `text.font`)', () => {
  it('TC-22: one selected text has two handles, on its side edges', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Went well');
    clickText(doc, id);

    // Only the side edges: a top or bottom handle would promise a height this kind
    // of object does not own.
    const handles = screen.getAllByTestId(/^handle-/);
    expect(handles.map((handle) => handle.getAttribute('data-handle'))).toEqual(['w', 'e']);

    // A note, in the same code, keeps all eight.
    const note = addNote(doc, { x: 800, y: 200 });
    clickEmptyBoard();
    const point = centreOfNote(doc, note);
    press(noteById(note), point);
    releaseAt(noteById(note), point);
    expect(screen.getAllByTestId(/^handle-/)).toHaveLength(8);
  });

  it('TC-23: text beside a note has all eight, and scaling the box moves the text without touching its letters', () => {
    const { doc } = startBoard();
    // Below the note's top edge on purpose: the box grows from its top-left, so
    // this text is carried by the growth rather than sitting on the anchor.
    const id = addText(doc, { x: 100, y: 200 }, 'Went well');
    const note = addNote(doc, { x: 400, y: 100 });
    measureHere(doc, id);
    clickText(doc, id);
    clickNote(doc, note, { shift: true });
    // `sel.multi_type`: a box around a text and a note is a box, and has the
    // handles a box has.
    expect(screen.getAllByTestId(/^handle-/)).toHaveLength(8);

    const text = objectSizes(doc, id);
    const sticky = objectSizes(doc, note);
    const right = Math.max(text.x + text.width, sticky.x + sticky.width);
    const bottom = Math.max(text.y + text.height, sticky.y + sticky.height);
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), { x: right, y: bottom }, {
      x: 60,
      y: 60,
    });

    const grown = snapshotOf(doc, id);
    const grownNote = objectSizes(doc, note);
    // The note took the box’s growth, as it always has.
    expect(grownNote.width).toBeGreaterThan(sticky.width);
    expect(grownNote.height).toBeGreaterThan(sticky.height);
    // A text that never chose a width is moved by the group and keeps the width its
    // words asked for (`text.group`) — and its letters are never scaled, which is
    // what `text.font` refuses above everything else.
    expect(grown.width).toBe(text.width);
    expect(grown.height).toBe(text.height);
    expect(grown.size).toBe(DEFAULT_TEXT_SIZE);
    expect(grown.y).toBeGreaterThan(text.y);
    expect(textElement(id).style.fontSize).toBe(`${TEXT_SIZES.M}px`);
  });

  it('a drag of the side handle gives the text a width it chose for itself', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 100, y: 100 }, 'Went well');
    clickText(doc, id);
    const before = snapshotOf(doc, id);
    drag(
      screen.getByRole('button', { name: 'Resize right' }),
      { x: before.x + before.width, y: before.y + before.height / 2 },
      { x: 120, y: 0 },
    );

    const after = snapshotOf(doc, id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width + 120, 6);
    expect(after.x).toBe(before.x);
    expect(after.size).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe('a text taken away while it is being typed into (TC-24)', () => {
  it('TC-24: the field goes with it, and nothing is written back or recreated', () => {
    const { doc } = startBoard();
    const id = addText(doc, { x: 300, y: 200 }, 'Retro');
    const area = editText(doc, id);
    type('Retro meeting');

    // Somebody else’s hand, on the same document the board is drawing from.
    act(() => {
      deleteObjects(doc, [id]);
    });

    expect(screen.queryByTestId('text-editor')).toBeNull(); // the field is gone
    expect(document.querySelector(`[data-text-id="${id}"]`)).toBeNull(); // and the object with it
    expect(textIdsOf(doc)).toEqual([]);
    // A field that unmounts writes nothing on its way out, so the delete stands:
    // no re-created text, and no characters brought back.
    act(() => {
      fireEvent.blur(area);
    });
    expect(textIdsOf(doc)).toEqual([]);
    expect(selectedIds()).toEqual([]);
  });
});

describe('undo inside the text (TC-25)', () => {
  it('TC-25: one undo takes back what was typed and the box those characters needed', () => {
    const { doc, undo } = startBoard({ undo: true });
    if (!undo) throw new Error('no history to watch');
    const id = addText(doc, { x: 300, y: 200 });
    const area = editText(doc, id);
    const before = objectSizes(doc, id); // the box before the first character

    // Long enough that it cannot fit on one line at this size, so the box that
    // grows with it has a second line to grow for.
    const LONG = 'Went well '.repeat(12);
    type(LONG);
    expect(contentOf(doc, id)).toBe(LONG);
    expect(objectSizes(doc, id).width).toBeGreaterThan(before.width);
    expect(objectSizes(doc, id).height).toBeGreaterThan(before.height);

    fireEvent.keyDown(area, { key: 'z', ctrlKey: true });

    // Not only the characters: the width and height they caused go in the same
    // step, because they were written in the same one (`undo.capture`).
    const back = objectSizes(doc, id);
    expect(contentOf(doc, id)).toBe('');
    expect(back.width).toBe(before.width);
    expect(back.height).toBe(before.height);
    // Still being typed into, and not deleted: undo is not leaving it empty
    // (`text.empty` waits for the edit to end).
    expect(textIdsOf(doc)).toEqual([id]);

    fireEvent.keyDown(area, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(contentOf(doc, id)).toBe(LONG);
    expect(objectSizes(doc, id).width).toBeGreaterThan(before.width);
  });
});
