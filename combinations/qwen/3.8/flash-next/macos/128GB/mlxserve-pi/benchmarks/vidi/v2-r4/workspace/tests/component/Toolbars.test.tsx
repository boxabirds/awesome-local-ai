import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld, type Size } from '../../src/client/canvas/camera';
import { SHORT_PHRASE } from '../fixtures/texts';

/**
 * Component tests for the two toolbars: the Sticky note tool creates where the
 * user is looking, the colour swatches recolour without losing anything, and the
 * bin deletes. All of it against a real `Y.Doc`.
 */

const VIEW: Size = { width: window.innerWidth, height: window.innerHeight };

const board = () => screen.getByTestId('board-viewport');
const note = () => screen.getByTestId('sticky-note');
const notes = () => screen.queryAllByTestId('sticky-note');
const noteFor = (noteId: string) => {
  const el = notes().find((element) => element.dataset.noteId === noteId);
  if (!el) throw new Error(`no note ${noteId} on the board`);
  return el;
};
const noteToolbar = () => within(screen.getByTestId('note-toolbar'));

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

const stickyTool = () => screen.getByRole('button', { name: /^Sticky note$/ });
const swatch = (colour: string) =>
  screen.getByRole('button', { name: new RegExp(`^${colour} colour$`) });
const bin = () => screen.getByRole('button', { name: /^Delete note$/ });

/** Selects a note the way a user does: press and release on its body. */
function selectNote(target: HTMLElement, clientX = 340, clientY = 240, pointerId = 1) {
  fireEvent.pointerDown(target, { clientX, clientY, button: 0, pointerId });
  fireEvent.pointerUp(target, { clientX, clientY, button: 0, pointerId });
  flushFrame();
}

let doc: Y.Doc;
let id: string;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
  doc = new Y.Doc();
  id = createSticky(doc, { x: 300, y: 200 });
});

afterEach(() => {
  vi.useRealTimers();
  doc.destroy();
});

describe('sticky.toolbar — the Sticky note tool', () => {
  it('TC-28 the button creates one note in the middle of the screen and opens it for typing', () => {
    // The note made in beforeEach is not on this board: this one starts empty.
    const empty = new Y.Doc();
    render(<App doc={empty} />);
    flushFrame();
    expect(notes()).toHaveLength(0);

    fireEvent.click(stickyTool());
    flushFrame();

    expect(notes()).toHaveLength(1);
    const created = snapshot(empty)[0];
    // The middle of the screen is world 0,0 at the starting camera.
    expect(created.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(created.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(created.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note().dataset.selected).toBe('true');
    expect(screen.getByTestId('sticky-textarea')).toBe(document.activeElement);
    empty.destroy();
  });

  it('the button says what it does and what else does the same thing', () => {
    renderBoard();
    const tool = stickyTool();
    expect(tool.getAttribute('title')).toBe('Sticky note – or double-click the board');
  });

  it('double-clicking board space creates a note there and opens it for typing', () => {
    const empty = new Y.Doc();
    render(<App doc={empty} />);
    flushFrame();

    fireEvent.doubleClick(board(), { clientX: 400, clientY: 300, button: 0, pointerId: 9 });
    flushFrame();

    expect(notes()).toHaveLength(1);
    // The note is centred on the point that was double-clicked.
    const world = screenToWorld(camera(), { x: 400, y: 300 });
    const created = snapshot(empty)[0];
    expect(created.x).toBe(world.x - STICKY_SIZE_WORLD / 2);
    expect(created.y).toBe(world.y - STICKY_SIZE_WORLD / 2);
    expect(screen.getByTestId('sticky-textarea')).toBe(document.activeElement);
    empty.destroy();
  });

  it('clicking the tool does not move the board and does not select anything else', () => {
    renderBoard();
    const before = camera();
    selectNote(note());
    expect(note().dataset.selected).toBe('true');

    fireEvent.click(stickyTool());
    flushFrame();

    expect(camera()).toEqual(before);
    expect(notes()).toHaveLength(2);
    // The new note is the selected one; the old note is not.
    const [first, second] = notes();
    const selected = [first, second].filter((el) => el.dataset.selected === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.noteId).not.toBe(id);
  });

  it('the tool creates in the middle of the part of the board now on screen', () => {
    renderBoard();
    // Pan the board far away first.
    fireEvent.pointerDown(board(), { clientX: 500, clientY: 400, button: 0, pointerId: 7 });
    fireEvent.pointerMove(board(), { clientX: 200, clientY: 300, pointerId: 7 });
    flushFrame();
    fireEvent.pointerUp(board(), { clientX: 200, clientY: 300, pointerId: 7 });
    flushFrame();

    fireEvent.click(stickyTool());
    flushFrame();

    const expected = screenToWorld(camera(), {
      x: VIEW.width / 2,
      y: VIEW.height / 2,
    });
    const created = snapshot(doc).find((object) => object.id !== id);
    expect(created).toBeDefined();
    expect(created?.x).toBeCloseTo(expected.x - STICKY_SIZE_WORLD / 2, 6);
    expect(created?.y).toBeCloseTo(expected.y - STICKY_SIZE_WORLD / 2, 6);
  });
});

describe('sticky.toolbar — colours and the bin', () => {
  it('TC-27 the Pink swatch recolours the note and keeps its text, place and selection', () => {
    act(() => {
      getStickyText(doc, id)?.insert(0, SHORT_PHRASE);
    });
    renderBoard();
    selectNote(note());
    const before = snapshot(doc)[0];

    fireEvent.click(swatch('Pink'));
    flushFrame();

    expect(snapshot(doc)[0].color).toBe('pink');
    expect(snapshot(doc)[0].text).toBe(SHORT_PHRASE);
    expect(snapshot(doc)[0].x).toBe(before.x);
    expect(snapshot(doc)[0].y).toBe(before.y);
    expect(snapshot(doc)[0].z).toBe(before.z);
    expect(note().dataset.selected).toBe('true');
    expect(note().dataset.color).toBe('pink');
    expect(note().style.backgroundColor).toBe('rgb(244, 143, 177)');
  });

  it('the swatch of the colour the note has is the pressed one, and each has six to choose from', () => {
    renderBoard();
    selectNote(note());
    expect(Object.keys(STICKY_COLORS)).toHaveLength(6);
    expect(swatch('Yellow').getAttribute('aria-pressed')).toBe('true');
    expect(swatch('Pink').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(swatch('Violet'));
    flushFrame();
    expect(swatch('Violet').getAttribute('aria-pressed')).toBe('true');
    expect(swatch('Yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('a swatch is named, not only coloured', () => {
    renderBoard();
    selectNote(note());
    expect(swatch('Green').getAttribute('title')).toBe('Green colour');
    expect(noteToolbar().getAllByRole('button')).toHaveLength(7); // six colours and a bin
  });

  it('TC-29 the bin deletes the note and clears the selection', () => {
    const other = createSticky(doc, { x: 700, y: 500 });
    renderBoard();
    selectNote(noteFor(id));
    expect(noteFor(id).dataset.selected).toBe('true');

    fireEvent.click(bin());
    flushFrame();

    expect(snapshot(doc).map((object) => object.id)).toEqual([other]);
    expect(notes()).toHaveLength(1);
    // What is left is not selected: the board is back to nothing selected.
    const survivor = noteFor(other);
    expect(survivor.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('clicking the toolbar leaves the note selected, because the click is the toolbar’s', () => {
    renderBoard();
    selectNote(note());

    fireEvent.pointerDown(screen.getByTestId('note-toolbar'), {
      clientX: 340,
      clientY: 120,
      button: 0,
      pointerId: 8,
    });
    flushFrame();

    expect(note().dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('the toolbar is above the note and keeps its size on screen at any zoom', () => {
    renderBoard();
    selectNote(note());
    expect(screen.getByTestId('note-toolbar-anchor').style.transform).toBe('scale(1)');

    // Move the camera the way the tests do elsewhere: zoom to 200%.
    act(() => {
      window.__vidi6?.setCamera({ x: camera().x, y: camera().y, zoom: 2 });
    });
    flushFrame();

    expect(camera().zoom).toBe(2);
    expect(screen.getByTestId('note-toolbar-anchor').style.transform).toBe('scale(0.5)');
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });
});
