/**
 * Story 2 component tests: creating, selecting, moving, recolouring and deleting
 * sticky notes, driven through the real component tree in jsdom.
 *
 * Each test gets its own `Y.Doc`, so assertions are made against what the board
 * actually stored (`snapshot(doc)`) as well as against the screen.
 */

import { cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { screenToWorld } from '../../src/client/canvas/camera';
import { deleteObject, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  CENTRE,
  clickElement,
  doubleClick,
  fireInput,
  fireKey,
  firePointer,
  flushCameraFrame,
  flushFrames,
  noteSwatch,
  noteToolbar,
  setTestCamera,
  stickyEditor,
  stickyNote,
  stickyNotes,
  stickyToolButton,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  viewportElement
} from './harness';

interface BoardFixture {
  doc: Y.Doc;
  result: RenderResult;
  root: HTMLElement;
  /** The document's notes, bottom to top. */
  notes(): readonly StickySnapshot[];
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return {
    doc,
    result,
    root: result.container,
    notes: () => snapshot(doc)
  };
}

/** Where a screen point lands in world units, as the board sees it. */
function worldPoint(x: number, y: number): { x: number; y: number } {
  return screenToWorld(testCamera(), { x, y });
}

/** Convert a #rrggbb colour to the rgb() form the DOM reports back. */
function rgb(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** A new note, made by double-clicking empty board space, left ready for typing. */
function createNote(board: BoardFixture, x: number, y: number): HTMLElement {
  doubleClick(viewportElement(board.root), x, y);
  return stickyNote(board.root, stickyNotes(board.root).length - 1);
}

/** Stop typing in the note being edited, keeping it selected (Escape). */
function stopEditing(board: BoardFixture): void {
  const editor = stickyEditor(board.root);
  if (editor) fireKey('Escape', { target: editor });
}

/** Replace the text of the note being edited. */
function typeText(board: BoardFixture, text: string): void {
  const editor = stickyEditor(board.root);
  if (!editor) throw new Error('no note is being edited');
  fireInput(editor, text);
}

/** Press, move in steps and release, letting the per-frame writes land. */
async function dragNote(
  note: HTMLElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  firePointer(note, 'pointerdown', fromX, fromY);
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      note,
      'pointermove',
      fromX + ((toX - fromX) * step) / steps,
      fromY + ((toY - fromY) * step) / steps
    );
    await flushFrames();
  }
  firePointer(note, 'pointerup', toX, toY);
  await flushFrames();
}

/** Select a note with a press that does not move. */
function selectNote(board: BoardFixture, index: number): HTMLElement {
  const note = stickyNote(board.root, index);
  firePointer(note, 'pointerdown', 100, 100);
  firePointer(note, 'pointerup', 100, 100);
  return note;
}

/** Click on empty board space (ends editing, clears the selection). */
function clickBoard(board: BoardFixture, x: number, y: number): void {
  firePointer(viewportElement(board.root), 'pointerdown', x, y);
  firePointer(viewportElement(board.root), 'pointerup', x, y);
}

async function setZoom(zoom: number): Promise<void> {
  await setTestCamera({ ...testCamera(), zoom });
}

describe('creating a sticky note (sticky.create)', () => {
  it('TC-34: the tool button adds one note to an empty board', async () => {
    const board = await renderBoard();
    expect(stickyNotes(board.root)).toHaveLength(0);

    clickElement(stickyToolButton(board.root));

    expect(board.notes()).toHaveLength(1);
    // A note from the tool is ready for typing straight away.
    expect(stickyEditor(board.root)).not.toBeNull();
  });

  it('TC-35: a double-click on the board creates a note centred on that spot', async () => {
    const board = await renderBoard();

    createNote(board, 400, 300);

    const [note] = board.notes();
    const centre = worldPoint(400, 300);
    expect(note.x).toBe(centre.x - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(centre.y - STICKY_SIZE_WORLD / 2);
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');
    expect(stickyEditor(board.root)).not.toBeNull();
  });

  it('TC-36: a double-click on a note edits it instead of making another one', async () => {
    const board = await renderBoard();
    const note = createNote(board, 400, 300);
    stopEditing(board);
    expect(board.notes()).toHaveLength(1);

    doubleClick(note, 400, 300);

    expect(board.notes()).toHaveLength(1);
    expect(stickyEditor(board.root)).not.toBeNull();
  });

  it('TC-37: notes created one after another keep their own text', async () => {
    const board = await renderBoard();

    createNote(board, 300, 300);
    typeText(board, 'Deploying on Fridays');
    clickBoard(board, 1150, 720); // ends editing

    createNote(board, 800, 500);
    typeText(board, ' scared the team');
    stopEditing(board);

    const texts = board.notes().map((note) => note.text);
    expect(texts).toEqual(['Deploying on Fridays', ' scared the team']);
  });

  it('a note from the tool lands in the middle of what is on screen, however far the board has moved', async () => {
    const board = await renderBoard();
    // The design test: wander a million units away, then press the button.
    await setTestCamera({ x: 1_000_000, y: 1_000_000, zoom: 1 });

    clickElement(stickyToolButton(board.root));

    const [note] = board.notes();
    expect(note.x).toBe(1_000_000 + CENTRE.x - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(1_000_000 + CENTRE.y - STICKY_SIZE_WORLD / 2);
  });
});

describe('selecting and moving a sticky note', () => {
  it('TC-18: a click selects a note and a click on the board clears it', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);

    selectNote(board, 0);
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');

    clickBoard(board, 60, 720);
    expect(stickyNote(board.root, 0).dataset.selected).toBe('false');
  });

  it('TC-19: pressing without moving selects the note and does not move it', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const before = board.notes()[0];

    const note = selectNote(board, 0);

    expect(board.notes()[0]).toMatchObject({ x: before.x, y: before.y, color: before.color });
    expect(note.dataset.selected).toBe('true');
    expect(note.dataset.interaction).toBe('idle');
  });

  it('TC-20: at 100% a note follows the pointer exactly', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const before = board.notes()[0];

    await dragNote(stickyNote(board.root, 0), 400, 300, 520, 360);

    expect(board.notes()[0].x).toBeCloseTo(before.x + 120, 6);
    expect(board.notes()[0].y).toBeCloseTo(before.y + 60, 6);
  });

  it('TC-21: at 50% the same 120 px drag moves the note 240 world units', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    await setZoom(0.5);
    const before = board.notes()[0];

    await dragNote(stickyNote(board.root, 0), 400, 300, 520, 300);

    expect(board.notes()[0].x).toBeCloseTo(before.x + 240, 6);
  });

  it('a note dragged at 400% moves a quarter of the pointer distance', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    await setZoom(4);
    const before = board.notes()[0];

    await dragNote(stickyNote(board.root, 0), 400, 300, 300, 300);

    expect(board.notes()[0].x).toBeCloseTo(before.x - 25, 6);
  });

  it('TC-22: movement shorter than the drag threshold is not a drag', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const before = board.notes()[0];
    const note = stickyNote(board.root, 0);

    firePointer(note, 'pointerdown', 400, 300);
    firePointer(note, 'pointermove', 400 + DRAG_THRESHOLD_PX - 1, 300);
    await flushFrames();
    firePointer(note, 'pointerup', 400 + DRAG_THRESHOLD_PX - 1, 300);

    expect(board.notes()[0]).toMatchObject({ x: before.x, y: before.y });
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');
    expect(stickyNote(board.root, 0).dataset.interaction).toBe('idle');
  });

  it('TC-23: dragging a note does not pan the board', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const camera = testCamera();

    await dragNote(stickyNote(board.root, 0), 400, 300, 200, 180);

    expect(testCamera()).toEqual(camera);
  });

  it('TC-24: an interrupted drag leaves the note where it was last drawn', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const note = stickyNote(board.root, 0);

    const before = board.notes()[0];
    firePointer(note, 'pointerdown', 400, 300);
    firePointer(note, 'pointermove', 460, 300);
    await flushFrames();
    const midway = { ...board.notes()[0] };
    expect(midway.x).toBeCloseTo(before.x + 60, 6);

    firePointer(note, 'pointercancel', 900, 900);

    expect(board.notes()[0]).toMatchObject({ x: midway.x, y: midway.y });
    expect(stickyNote(board.root, 0).dataset.interaction).toBe('idle');
  });

  it('TC-25: a dragged note ends up in front of the one it is dropped on', async () => {
    const board = await renderBoard();
    // Two notes overlapping; the second is created on top of the first.
    createNote(board, 400, 300);
    stopEditing(board);
    createNote(board, 560, 300);
    stopEditing(board);
    const [bottom, top] = board.notes().map((note) => note.id);

    await dragNote(stickyNote(board.root, 0), 350, 300, 520, 300);

    expect(board.notes().map((note) => note.id)).toEqual([top, bottom]);
  });

  it('a dragged note stays selected and its text stays put', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    typeText(board, 'keep me');
    stopEditing(board);

    await dragNote(stickyNote(board.root, 0), 400, 300, 500, 340);

    expect(board.notes()[0].text).toBe('keep me');
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');
  });
});

describe('the floating toolbar (note.toolbar, sticky.recolour, sticky.delete)', () => {
  it('TC-26: the toolbar appears over the selected note only', async () => {
    const board = await renderBoard();
    createNote(board, 300, 300);
    stopEditing(board);
    createNote(board, 900, 600);
    stopEditing(board);
    expect(noteToolbar(stickyNote(board.root, 0))).toBeNull();

    selectNote(board, 0);

    const toolbar = noteToolbar(stickyNote(board.root, 0));
    expect(toolbar).not.toBeNull();
    expect(noteToolbar(stickyNote(board.root, 1))).toBeNull();
    // Six named colours and one bin.
    expect(toolbar!.querySelectorAll('[data-vidi6="note-swatch"]')).toHaveLength(6);
    expect(toolbar!.querySelector('[aria-label="Delete note"]')).not.toBeNull();
  });

  it('TC-27: choosing a colour recolours the note and keeps it selected', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    typeText(board, 'blue idea');
    stopEditing(board);
    const id = board.notes()[0].id;

    clickElement(noteSwatch(stickyNote(board.root, 0), 'blue')!);

    expect(board.notes()).toHaveLength(1);
    expect(board.notes()[0]).toMatchObject({ id, color: 'blue', text: 'blue idea' });
    const note = stickyNote(board.root, 0);
    expect(note.dataset.color).toBe('blue');
    expect(note.style.background).toBe(rgb(STICKY_COLORS.blue));
    expect(note.dataset.selected).toBe('true');
  });

  it('the swatch of the current colour is marked as the one in use', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const note = selectNote(board, 0);

    expect(noteSwatch(note, 'yellow')!.getAttribute('aria-pressed')).toBe('true');
    expect(noteSwatch(note, 'violet')!.getAttribute('aria-pressed')).toBe('false');

    clickElement(noteSwatch(note, 'violet')!);

    const toolbar = noteToolbar(stickyNote(board.root, 0))!;
    expect(toolbar.querySelector('[aria-pressed="true"]')!.getAttribute('data-color')).toBe('violet');
  });

  it('TC-28: the bin deletes the note and its text with it', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    typeText(board, 'throw me away');
    stopEditing(board);
    const note = stickyNote(board.root, 0);

    clickElement(note.querySelector('[data-vidi6="note-delete"]')!);

    expect(board.notes()).toHaveLength(0);
    expect(stickyNotes(board.root)).toHaveLength(0);
  });

  it('the bin also works while the note is being typed in', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    typeText(board, 'half typed');
    // The toolbar is hidden while typing, so delete through the keyboard instead.
    stopEditing(board);
    clickElement(stickyNote(board.root, 0).querySelector('[data-vidi6="note-delete"]')!);

    expect(board.notes()).toHaveLength(0);
    expect(stickyEditor(board.root)).toBeNull();
  });

  it('TC-29: Delete removes the selected note; with nothing selected it does nothing', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');

    fireKey('Delete');

    expect(board.notes()).toHaveLength(0);
    // Nothing is selected now, so the same key is a no-op rather than an error.
    fireKey('Delete');
    expect(board.notes()).toHaveLength(0);
  });

  it('TC-29: Backspace removes the selected note too', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);

    fireKey('Backspace');

    expect(board.notes()).toHaveLength(0);
  });

  it('keys pressed while typing a note do not delete it', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    typeText(board, 'text with backspace');

    const editor = stickyEditor(board.root)!;
    fireKey('Backspace', { target: editor });
    fireKey('Delete', { target: editor });

    expect(board.notes()).toHaveLength(1);
    expect(board.notes()[0].text).toBe('text with backspace');
    expect(stickyEditor(board.root)).not.toBeNull();
  });

  it('keys on a toolbar button do not delete the note it belongs to', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const swatch = noteSwatch(selectNote(board, 0), 'green')!;

    fireKey('Delete', { target: swatch });
    fireKey('Backspace', { target: swatch });

    expect(board.notes()).toHaveLength(1);
    expect(board.notes()[0].color).toBe('yellow');
  });

  it('a note deleted mid-drag ignores the rest of that drag', async () => {
    const board = await renderBoard();
    createNote(board, 400, 300);
    stopEditing(board);
    const note = stickyNote(board.root, 0);
    const id = note.dataset.noteId!;

    // Press down on the note, then it disappears from under the pointer.
    firePointer(note, 'pointerdown', 400, 300);
    deleteObject(board.doc, id);
    firePointer(note, 'pointermove', 500, 340);
    await flushFrames();
    firePointer(note, 'pointerup', 500, 340);

    expect(board.notes()).toHaveLength(0);
    // Nothing was left behind to move or select.
    expect(stickyNotes(board.root)).toHaveLength(0);
  });
});
