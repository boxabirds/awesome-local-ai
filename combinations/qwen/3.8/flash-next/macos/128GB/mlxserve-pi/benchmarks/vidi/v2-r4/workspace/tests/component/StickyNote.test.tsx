import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { StickyNote } from '../../src/client/objects/StickyNote';
import {
  createSticky,
  deleteObject,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * Component tests for sticky note interaction: press, drag, select, keyboard
 * delete, double-click and a note that vanishes mid-gesture, all against a real
 * `Y.Doc` so the document is the thing being asserted.
 */

const board = () => screen.getByTestId('board-viewport');
const note = () => screen.getByTestId('sticky-note');
const notes = () => screen.queryAllByTestId('sticky-note');
const noteToolbar = () => screen.queryByTestId('note-toolbar');
const editor = () => screen.queryByTestId('sticky-textarea');

const box = (el: HTMLElement) => ({
  x: Number(el.dataset.x),
  y: Number(el.dataset.y),
  z: Number(el.dataset.z),
});

/** The camera through story 1's test hook, to prove a note never pans the board. */
function camera() {
  const hook = window.__vidi6;
  if (!hook) throw new Error('expected the test camera hook to be installed in test mode');
  return hook.getCamera();
}

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

function renderBoard() {
  render(<App doc={doc} />);
  flushFrame();
}

function press(clientX: number, clientY: number, pointerId = 1) {
  fireEvent.pointerDown(note(), { clientX, clientY, button: 0, pointerId });
}

function moveTo(clientX: number, clientY: number, pointerId = 1) {
  fireEvent.pointerMove(note(), { clientX, clientY, button: 0, pointerId });
  flushFrame();
}

function release(clientX: number, clientY: number, pointerId = 1) {
  fireEvent.pointerUp(note(), { clientX, clientY, button: 0, pointerId });
  flushFrame();
}

let doc: Y.Doc;
let id: string;
/** Where the note's top-left is, taken from the document rather than assumed. */
let start: StickySnapshot;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
  doc = new Y.Doc();
  id = createSticky(doc, { x: 300, y: 200 });
  start = snapshot(doc)[0];
});

afterEach(() => {
  vi.useRealTimers();
  doc.destroy();
});

describe('sticky.interaction — selecting', () => {
  it('TC-18 a press and release without moving selects the note and shows its toolbar', () => {
    renderBoard();
    expect(note().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();

    press(340, 240);
    expect(note().dataset.dragging).toBe('false');
    release(340, 240);

    expect(note().dataset.selected).toBe('true');
    expect(noteToolbar()).not.toBeNull();
    // The note has not moved, and the document holds one unchanged note.
    expect(box(note())).toEqual({ x: start.x, y: start.y, z: start.z });
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-19 a move of two pixels is less than the threshold: still Selected and the note has not moved', () => {
    renderBoard();
    press(340, 240);
    moveTo(340 + DRAG_THRESHOLD_PX - 1, 240);
    expect(note().dataset.dragging).toBe('false');
    expect(box(note())).toEqual({ x: start.x, y: start.y, z: start.z });

    release(340 + DRAG_THRESHOLD_PX - 1, 240);
    expect(note().dataset.selected).toBe('true');
    expect(snapshot(doc)[0].x).toBe(start.x);
  });

  it('TC-20 a move of exactly the threshold starts Dragging and leaves the camera where it was', () => {
    renderBoard();
    const before = camera();
    press(340, 240);
    moveTo(340 + DRAG_THRESHOLD_PX, 240);

    expect(note().dataset.dragging).toBe('true');
    expect(camera()).toEqual(before);
    expect(snapshot(doc)[0].x).toBe(start.x + DRAG_THRESHOLD_PX);

    release(340 + DRAG_THRESHOLD_PX, 240);
    expect(note().dataset.dragging).toBe('false');
    expect(note().dataset.selected).toBe('true');
    expect(camera()).toEqual(before);
  });

  it('TC-21 pointercancel in the middle of a drag leaves the note Selected at its last position', () => {
    renderBoard();
    press(340, 240);
    moveTo(380, 240);
    fireEvent.pointerCancel(note(), { clientX: 380, clientY: 240, button: 0, pointerId: 1 });
    flushFrame();

    expect(note().dataset.dragging).toBe('false');
    expect(note().dataset.selected).toBe('true');
    expect(snapshot(doc)[0].x).toBe(start.x + 40);
    expect(noteToolbar()).not.toBeNull();
  });

  it('TC-22 clicking empty board space unselects the note and removes its toolbar', () => {
    renderBoard();
    press(340, 240);
    release(340, 240);
    expect(noteToolbar()).not.toBeNull();

    fireEvent.pointerDown(board(), { clientX: 900, clientY: 600, button: 0, pointerId: 2 });
    flushFrame();

    expect(note().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
    // The note itself is untouched.
    expect(box(note())).toEqual({ x: start.x, y: start.y, z: start.z });
  });

  it('a drag that starts on the note text moves the note and does not pan the board', () => {
    renderBoard();
    const before = camera();
    const text = screen.getByTestId('sticky-text');
    fireEvent.pointerDown(text, { clientX: 340, clientY: 240, button: 0, pointerId: 3 });
    moveTo(400, 240, 3);
    release(400, 240, 3);

    expect(snapshot(doc)[0].x).toBe(start.x + 60);
    expect(camera()).toEqual(before);
  });
});

describe('sticky.interaction — keyboard', () => {
  it('TC-25 Delete removes the selected note', () => {
    renderBoard();
    press(340, 240);
    release(340, 240);

    fireEvent.keyDown(window, { key: 'Delete', bubbles: true, cancelable: true });
    flushFrame();

    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-25 Backspace removes the selected note', () => {
    renderBoard();
    press(340, 240);
    release(340, 240);

    fireEvent.keyDown(window, { key: 'Backspace', bubbles: true, cancelable: true });
    flushFrame();

    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    renderBoard();
    fireEvent.keyDown(window, { key: 'Enter', bubbles: true, cancelable: true });
    flushFrame();

    expect(editor()).toBeNull();
    expect(notes()).toHaveLength(1);
  });

  it('TC-35 double-clicking an existing note edits that note and does not create another', () => {
    act(() => {
      getStickyText(doc, id)?.insert(0, 'existing');
    });
    renderBoard();

    fireEvent.doubleClick(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 4 });
    flushFrame();

    expect(notes()).toHaveLength(1);
    expect(editor()).not.toBeNull();
    expect((editor() as HTMLTextAreaElement).value).toBe('existing');
    expect(note().dataset.selected).toBe('true');
  });

  it('notes can be reached with the keyboard and are labelled', () => {
    renderBoard();
    expect(note().getAttribute('tabindex')).toBe('0');
    expect(note().getAttribute('aria-label')).toBe('Sticky note');
    expect(note().getAttribute('role')).toBe('group');
  });
});

describe('sticky.interaction — a note that disappears', () => {
  it('TC-37 a note deleted from the model while dragging disappears and is not recreated', () => {
    renderBoard();
    press(340, 240);
    moveTo(380, 240);
    expect(note().dataset.dragging).toBe('true');

    act(() => {
      deleteObject(doc, id);
    });
    flushFrame();

    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toEqual([]);
    expect(noteToolbar()).toBeNull();
  });

  it('TC-37 a note deleted from the model while being edited closes the editor and is not recreated', () => {
    renderBoard();
    press(340, 240);
    release(340, 240);
    fireEvent.doubleClick(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 5 });
    expect(editor()).not.toBeNull();

    act(() => {
      deleteObject(doc, id);
    });
    flushFrame();

    expect(editor()).toBeNull();
    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-37 a drag on a note whose id is no longer in the document ends quietly', () => {
    // The note element is still on screen when someone else's delete arrives:
    // every further write is rejected and the drag stops by itself.
    const ghost: StickySnapshot = { ...start, id: 'already-gone' };
    const onSelect = vi.fn();
    render(
      <StickyNote
        note={ghost}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onSelect={onSelect}
        onStartEdit={vi.fn()}
        onEndEdit={vi.fn()}
      />,
    );
    const el = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(el, { clientX: 340, clientY: 240, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 380, clientY: 240, button: 0, pointerId: 1 });
    flushFrame();

    expect(el.dataset.dragging).toBe('false');

    fireEvent.pointerUp(el, { clientX: 380, clientY: 240, button: 0, pointerId: 1 });
    flushFrame();

    // The interaction ends silently: no selection of an id that is gone, and no
    // write of any kind.
    expect(onSelect).not.toHaveBeenCalled();
    // The document still holds only the note that is really there, unmoved.
    expect(snapshot(doc)).toEqual([start]);
  });
});

describe('sticky.note — drawing', () => {
  it('a note is placed by its centre, filled with its colour and raised by z', () => {
    renderBoard();
    const el = note();
    expect(el.style.left).toBe(`${start.x}px`);
    expect(el.style.top).toBe(`${start.y}px`);
    expect(el.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.backgroundColor).toBe('rgb(255, 245, 157)');
    expect(el.style.zIndex).toBe(String(start.z));
    expect(start.x).toBe(300 - STICKY_SIZE_WORLD / 2);
    expect(el.dataset.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('an empty note shows no placeholder and no fade', () => {
    renderBoard();
    expect(screen.getByTestId('sticky-text').textContent).toBe('');
    expect(screen.queryByTestId('sticky-fade')).toBeNull();
  });

  it('the text shown is the text in the document', () => {
    renderBoard();
    act(() => {
      getStickyText(doc, id)?.insert(0, 'retro item');
    });
    flushFrame();
    expect(screen.getByTestId('sticky-text').textContent).toBe('retro item');
    // Writing the text did not move the note.
    expect(box(note())).toEqual({ x: start.x, y: start.y, z: start.z });
  });
});
