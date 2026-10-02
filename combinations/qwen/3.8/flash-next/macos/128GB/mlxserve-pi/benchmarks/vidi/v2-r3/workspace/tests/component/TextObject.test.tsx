import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObjects, objectBounds, snapshotAll } from '../../src/shared/board-model';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import {
  applyRemote,
  createNote,
  createTextObject,
  dragBy,
  editorOf,
  flushFrame,
  noteCount,
  noteEl,
  openTextEditor,
  peerOf,
  peerText,
  pressOn,
  releaseOn,
  renderBoard,
  setTextObjectText,
  shiftPressOn,
  shiftReleaseOn,
  textCount,
  textData,
  textEl,
  typeIntoText,
} from './helpers';

/**
 * TC-19 to TC-25: one text object, from its first letter to its last.
 *
 * What is under test is the object's own behaviour: what typing writes, what an
 * emptied object does when it is finished with, what the four sizes and the two
 * width modes change, which handles it is given, and what happens when somebody
 * else deletes it or types into it while it is open here.
 */

const START = 'Kickoff';

let doc: Doc;
let id: string;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
  id = createTextObject(doc, 200, 120);
  setTextObjectText(doc, id, START);
  flushFrame();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SIZE_NAME: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

function display(): HTMLElement {
  return within(textEl(id)).getByTestId('text-display');
}

function toolbar(): HTMLElement {
  return screen.getByTestId('text-toolbar');
}

function overlay(): HTMLElement {
  return screen.getByTestId('selection-overlay');
}

function handle(side: 'w' | 'e' | 'n' | 's' | 'nw' | 'ne' | 'sw' | 'se'): HTMLElement {
  return within(overlay()).getByTestId(`resize-handle-${side}`);
}

/** The object, selected, its toolbar and handles on the board. */
function selectIt(): void {
  pressOn(textEl(id), 210, 130);
  releaseOn(textEl(id), 210, 130);
  flushFrame();
}

function pressSize(size: TextSize): void {
  fireEvent.click(within(toolbar()).getByRole('button', { name: `${SIZE_NAME[size]} text` }));
  flushFrame();
}

function pressMode(): void {
  fireEvent.click(within(toolbar()).getByRole('button', { name: 'Fixed width' }));
  flushFrame();
}

describe('typing into a text object', () => {
  it('TC-19 writes the letters into the document and shows them', () => {
    const editor = openTextEditor(id);
    typeIntoText(id, 'sprint');
    flushFrame();

    expect(textData(doc, id)!.text).toBe('sprint');
    expect(display().textContent).toBe('sprint');
    expect(editor.value).toBe('sprint');
  });

  it('TC-19 keeps a newline typed into it, on the board and in the document', () => {
    const editor = openTextEditor(id);
    fireEvent.input(editor, { target: { value: 'two\nlines' } });
    flushFrame();

    expect(textData(doc, id)!.text).toBe('two\nlines');
    expect(display().textContent).toBe('two\nlines');
    // Two lines of text is a box two lines tall, and Enter is not a way out of
    // editing: the editor is still open.
    expect(textData(doc, id)!.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(editorOf(id)).toBeTruthy();
  });

  it('TC-20 removes the object when it is emptied and the editing ends', () => {
    openTextEditor(id);
    typeIntoText(id, '');
    flushFrame();
    expect(textData(doc, id)).toBeDefined();

    fireEvent.keyDown(editorOf(id), { key: 'Escape' });
    flushFrame();

    expect(textCount()).toBe(0);
    expect(textData(doc, id)).toBeUndefined();
  });

  it('TC-20 removes an object that was never typed into, the same way', () => {
    // The object the Text tool placed and nobody wrote in is a point that was
    // tried, not a thing on the board.
    const empty = createTextObject(doc, 40, 40);
    flushFrame();
    openTextEditor(empty);
    fireEvent.keyDown(editorOf(empty), { key: 'Escape' });
    flushFrame();
    expect(textData(doc, empty)).toBeUndefined();
  });

  it('TC-20 removes the object with Delete as surely as with an empty escape', () => {
    selectIt();
    fireEvent.keyDown(window, { key: 'Delete' });
    flushFrame();

    expect(textCount()).toBe(0);
    expect(textData(doc, id)).toBeUndefined();
  });

  it('leaves a sticky note standing when its text is emptied, which is story 2', () => {
    const note = createNote(doc, 10, 10);
    flushFrame();
    fireEvent.doubleClick(noteEl(note), { clientX: 100, clientY: 100 });
    const textarea = noteEl(note).querySelector<HTMLTextAreaElement>('textarea')!;
    fireEvent.input(textarea, { target: { value: '' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    flushFrame();
    expect(noteEl(note)).toBeTruthy();
    expect(noteCount()).toBe(1);
  });
});

describe('the size of a text object', () => {
  it('TC-21 gives each of the four sizes its own letters, its own box and the same corner', () => {
    openTextEditor(id);
    typeIntoText(id, 'Sizes');
    flushFrame();

    const box: Partial<Record<TextSize, { width: number; height: number }>> = {};
    for (const size of ['S', 'M', 'L', 'XL'] as TextSize[]) {
      pressSize(size);
      const stored = textData(doc, id)!;
      expect(stored.size).toBe(size);
      expect(textEl(id).dataset.size).toBe(size);
      expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES[size]}px`);
      // The corner it was held by does not move when the letters get bigger.
      expect(stored.x).toBe(200);
      expect(stored.y).toBe(120);
      expect(
        within(toolbar()).getByRole('button', { name: `${SIZE_NAME[size]} text` }),
      ).toHaveAttribute('aria-pressed', 'true');
      box[size] = { width: stored.width, height: stored.height };
    }

    // Bigger letters, a wider box and a taller one: the box follows the text.
    expect(box.L!.width).toBeGreaterThan(box.S!.width);
    expect(box.L!.height).toBeGreaterThan(box.S!.height);
    expect(box.XL!.width).toBeGreaterThan(box.L!.width);
    // One line of XL text is one line of XL text tall.
    expect(box.XL!.height).toBeCloseTo(Math.round(TEXT_SIZES.XL * TEXT_LINE_HEIGHT * 100) / 100, 2);
  });

  it('TC-21 opens with size M pressed, the size a new object is made at', () => {
    selectIt();
    expect(within(toolbar()).getByRole('button', { name: 'Medium text' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const size of ['S', 'L', 'XL'] as TextSize[]) {
      expect(within(toolbar()).getByRole('button', { name: `${SIZE_NAME[size]} text` })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });
});

describe('the width of a text object', () => {
  const LONG = 'The quick brown fox jumps over the lazy dog and keeps on running for a while';

  it('gives the text room up to the widest line it is allowed, and no more', () => {
    setTextObjectText(doc, id, LONG);
    flushFrame();
    const auto = textData(doc, id)!;
    expect(auto.widthMode).toBe('auto');
    expect(auto.width).toBeLessThanOrEqual(600);
    // A line of M text this long does not fit in one line: it is wrapped.
    expect(auto.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('takes a width of its own from a side handle, and the height follows', () => {
    setTextObjectText(doc, id, LONG);
    flushFrame();
    const auto = { ...textData(doc, id)! };
    selectIt();

    // The east handle dragged outwards: more room to the line, and the text that
    // was wrapped into two lines is now in one.
    dragBy(handle('e'), 400, 0);
    flushFrame();
    const wider = textData(doc, id)!;
    expect(wider.widthMode).toBe('fixed');
    expect(wider.width).toBeGreaterThan(auto.width);
    expect(wider.height).toBeLessThan(auto.height);
    expect(wider.x).toBe(auto.x);
    expect(wider.y).toBe(auto.y);
    expect(wider.text).toBe(LONG);
    expect(within(toolbar()).getByRole('button', { name: 'Fixed width' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('will not be dragged past the narrowest width it is allowed', () => {
    selectIt();
    const before = textData(doc, id)!;
    expect(before.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

    // Dragged straight through the words and out the other side.
    dragBy(handle('e'), -4000, 0);
    flushFrame();
    const pinned = textData(doc, id)!;
    expect(pinned.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(pinned.widthMode).toBe('fixed');
    // The words are all still there, one to a line now.
    expect(pinned.text).toBe(START);
    expect(pinned.height).toBeGreaterThanOrEqual(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('is held by the edge the handle was not dragged from, when the left handle moves', () => {
    const before = textData(doc, id)!;
    expect(before.width).toBeLessThan(600);
    selectIt();

    // The west handle dragged further off: more room, and the right-hand edge of
    // the box does not move, because the person is holding the other one.
    dragBy(handle('w'), -100, 0);
    flushFrame();
    const wider = textData(doc, id)!;
    expect(wider.width).toBeGreaterThan(before.width);
    expect(wider.widthMode).toBe('fixed');
    expect(wider.x + wider.width).toBeCloseTo(before.x + before.width, 6);
    expect(wider.y).toBe(before.y);
    expect(wider.height).toBe(before.height);
  });

  it('is given a width by the toolbar and hands it back to the text again', () => {
    setTextObjectText(doc, id, LONG);
    flushFrame();
    const auto = { ...textData(doc, id)! };
    selectIt();

    pressMode();
    expect(textData(doc, id)!.widthMode).toBe('fixed');
    expect(textEl(id).dataset.mode).toBe('fixed');
    // The width the text measured for itself is the width it is held at.
    expect(textData(doc, id)!.width).toBe(auto.width);

    // Half the room, by the handle: the same words, in more lines.
    dragBy(handle('e'), -300, 0);
    flushFrame();
    const narrow = textData(doc, id)!;
    expect(narrow.width).toBeLessThan(auto.width);
    expect(narrow.height).toBeGreaterThan(auto.height);
    expect(narrow.text).toBe(LONG);

    pressMode();
    const back = { ...textData(doc, id)! };
    expect(back.widthMode).toBe('auto');
    expect(back.width).toBe(auto.width);
    expect(back.height).toBe(auto.height);
  });
});

describe('the handles a text object is given', () => {
  it('TC-22 is given the two side handles and no others', () => {
    selectIt();

    expect(handle('w')).toBeTruthy();
    expect(handle('e')).toBeTruthy();
    for (const absent of ['n', 's', 'nw', 'ne', 'sw', 'se'] as const) {
      expect(within(overlay()).queryByTestId(`resize-handle-${absent}`)).toBeNull();
    }
  });

  it('TC-22 leaves a sticky note with its eight handles', () => {
    const note = createNote(doc, 0, 0);
    flushFrame();
    pressOn(noteEl(note), 100, 100);
    releaseOn(noteEl(note), 100, 100);
    flushFrame();

    for (const side of ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'] as const) {
      expect(within(overlay()).getByTestId(`resize-handle-${side}`)).toBeTruthy();
    }
  });

  it('TC-23 gives back all eight handles in a mixed selection, and resizes the group without resizing its letters', () => {
    const note2 = createNote(doc, 600, 400);
    flushFrame();
    const textBefore = textData(doc, id)!;
    const noteWidthBefore = objectBounds(snapshotAll(doc).find((entry) => entry.id === note2)!).width;
    selectIt();
    shiftPressOn(noteEl(note2), 610, 410);
    shiftReleaseOn(noteEl(note2), 610, 410);
    flushFrame();

    // Nobody's own shape fits both, so the selection keeps the frame it always
    // had rather than pretending the note has no top or bottom.
    for (const side of ['n', 'e', 's', 'w'] as const) {
      expect(within(overlay()).getByTestId(`resize-handle-${side}`)).toBeTruthy();
    }

    // The corner drag does scale the group: the note is wider, and it moved with
    // it. The text object in the same group keeps the letters it has — no drag of
    // a group makes anybody's font bigger — and the box its own text decided.
    dragBy(within(overlay()).getByTestId('resize-handle-se'), 300, 300);
    flushFrame();
    const moved = textData(doc, id)!;
    expect(moved.size).toBe('M');
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(moved.width).toBe(textBefore.width);
    expect(moved.height).toBe(textBefore.height);
    // The note is what the drag was resizing.
    expect(objectBounds(snapshotAll(doc).find((entry) => entry.id === note2)!).width).toBeGreaterThan(
      noteWidthBefore,
    );
  });
});

describe('somebody else at the same text object', () => {
  it('TC-24 lets the other person delete it, and does not bring it back', () => {
    const editor = openTextEditor(id);
    typeIntoText(id, 'typing while');
    flushFrame();
    expect(editorOf(id)).toBeTruthy();

    const peer = peerOf(doc);
    expect(() => {
      deleteObjects(peer, [id]);
      applyRemote(doc, peer);
    }).not.toThrow();
    flushFrame();

    // The editor went with the object.
    expect(document.querySelector(`[data-text-id="${id}"]`)).toBeNull();
    expect(textCount()).toBe(0);

    // And the keystroke the person was already on the way to make, landing on a
    // board that has no such object, makes no object: it stays deleted.
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.keyDown(window, { key: 'Enter' });
    flushFrame();
    expect(textCount()).toBe(0);
    expect(textData(doc, id)).toBeUndefined();
    expect(noteCount()).toBe(0);
    void editor;
  });

  it('TC-24 shows the other person letter without dropping this person caret', () => {
    const editor = openTextEditor(id);
    editor.setSelectionRange(2, 2);

    const peer = peerOf(doc);
    peerText(peer, id).insert(0, 'X');
    applyRemote(doc, peer);
    flushFrame();

    expect(textData(doc, id)!.text).toBe(`X${START}`);
    expect(display().textContent).toBe(`X${START}`);
    const after = editorOf(id);
    expect(after.value).toBe(`X${START}`);
    // The caret is not thrown to the start or the end of the text: it keeps the
    // distance from the end it had, which is where the next letter belongs.
    expect(after.value.length - after.selectionStart).toBe(START.length - 2);
    expect(after.selectionStart).toBeGreaterThan(0);
  });

  it('TC-25 takes the text and the box it made back in one Undo, and gives them back in one Redo', () => {
    const before = { ...textData(doc, id)! };
    const editor = openTextEditor(id);
    typeIntoText(id, `${START} and the rest of the afternoon`);
    flushFrame();
    const typed = textData(doc, id)!;
    expect(typed.width).toBeGreaterThan(before.width);

    // Ctrl+Z inside the object is the board's undo and not the textarea's: the
    // letters and the box they were measured into are one step, and they go
    // together.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    flushFrame();
    const back = textData(doc, id)!;
    expect(back.text).toBe(before.text);
    expect(back.width).toBe(before.width);
    expect(back.height).toBe(before.height);

    fireEvent.keyDown(editorOf(id), { key: 'y', ctrlKey: true });
    flushFrame();
    expect(textData(doc, id)!.text).toBe(`${START} and the rest of the afternoon`);
  });

  it('TC-25 undoes one size press as one step, the box it measured with it', () => {
    openTextEditor(id);
    typeIntoText(id, 'One step');
    flushFrame();
    const before = { ...textData(doc, id)! };

    pressSize('XL');
    expect(textData(doc, id)!.size).toBe('XL');

    // The undo is asked for inside the object, which is where the person typing
    // is: the object takes Ctrl+Z for the board's history rather than letting
    // the textarea undo the typing by itself and keep the letters on screen that
    // the document no longer has.
    fireEvent.keyDown(editorOf(id), { key: 'z', ctrlKey: true });
    flushFrame();
    const back = textData(doc, id)!;
    expect(back.size).toBe(before.size);
    expect(back.width).toBe(before.width);
    expect(back.height).toBe(before.height);
  });

  it('TC-25 brings a deleted object back through Undo and takes it away again through Redo', () => {
    selectIt();
    fireEvent.keyDown(window, { key: 'Delete' });
    flushFrame();
    expect(textCount()).toBe(0);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrame();
    expect(textData(doc, id)).toBeDefined();
    expect(textData(doc, id)!.text).toBe(START);

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    flushFrame();
    expect(textData(doc, id)).toBeUndefined();
  });

  it('leaves everything else on the board alone while it is at it', () => {
    const note = createNote(doc, 900, 900);
    flushFrame();
    setTextObjectText(doc, id, 'still here');
    flushFrame();

    expect(textEl(id).dataset.textLength).toBe('10');
    expect(noteCount()).toBe(1);
    expect(noteEl(note)).toBeTruthy();
    expect(textCount()).toBe(1);
  });
});
