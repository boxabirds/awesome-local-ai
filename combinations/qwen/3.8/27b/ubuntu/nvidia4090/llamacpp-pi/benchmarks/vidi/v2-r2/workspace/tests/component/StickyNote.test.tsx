import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import {
  createSticky,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';

/** The initial camera: origin centred, 100% zoom (TEST_VIEWPORT 1280x800). */
const INITIAL_CAMERA = { x: -640, y: -400, zoom: 1 };

afterEach(() => {
  vi.useRealTimers();
});

/** Flush one animation frame (the rAF polyfill is a 16ms timeout). */
function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function createNote(utils: { doc: Parameters<typeof createSticky>[0] }, at = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(utils.doc, at);
  });
  return id;
}

/** Press + release without moving: selects the note. */
function selectNote(utils: ReturnType<typeof renderStickyBoard>): void {
  const note = utils.getByTestId('sticky-note');
  fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(note, { clientX: 640, clientY: 400, pointerId: 1 });
}

describe('ui-component: sticky note interaction (StickyNote)', () => {
  it('TC-18: press + release without moving selects the note (outline + note toolbar)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    createNote(utils);
    const note = utils.getByTestId('sticky-note');
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(utils.queryByTestId('note-toolbar')).toBeNull();

    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 640, clientY: 400, pointerId: 1 });

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(utils.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-19: a 2px press is still a click: it selects, but the note does not move', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const before = snapshot(utils.doc).find((o) => o.id === id)!;
    const note = utils.getByTestId('sticky-note');

    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 642, clientY: 400, pointerId: 1 });
    flushFrame();
    fireEvent.pointerUp(note, { clientX: 642, clientY: 400, pointerId: 1 });

    const after = snapshot(utils.doc).find((o) => o.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(note.getAttribute('data-selected')).toBe('true');
    // A press on a note never pans the board (sticky.no_pan).
    expect(utils.readCamera()).toEqual(INITIAL_CAMERA);
  });

  it('TC-20: a 3px move starts a drag: the note follows in world units, camera unchanged', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const note = utils.getByTestId('sticky-note');

    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 643, clientY: 400, pointerId: 1 });
    // The move is applied on the next frame (rAF throttling).
    flushFrame();

    const during = snapshot(utils.doc).find((o) => o.id === id)!;
    expect(during.x).toBe(-100 + 3);
    expect(during.y).toBe(-100);

    fireEvent.pointerUp(note, { clientX: 643, clientY: 400, pointerId: 1 });
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(utils.readCamera()).toEqual(INITIAL_CAMERA);
  });

  it('TC-21: pointercancel mid-drag: the note stays where it was last displayed and is selected', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const note = utils.getByTestId('sticky-note');

    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 660, clientY: 400, pointerId: 1 });
    flushFrame(); // now displayed at x = -100 + 20 = -80
    fireEvent.pointerMove(note, { clientX: 680, clientY: 400, pointerId: 1 }); // pending, not displayed
    fireEvent.pointerCancel(note, { pointerId: 1 });

    const after = snapshot(utils.doc).find((o) => o.id === id)!;
    expect(after.x).toBe(-80); // the last displayed position, not the pending one
    expect(note.getAttribute('data-selected')).toBe('true');
  });

  it('TC-22: clicking empty board space deselects and hides the note toolbar', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    createNote(utils);
    selectNote(utils);
    const note = utils.getByTestId('sticky-note');
    expect(utils.getByTestId('note-toolbar')).toBeTruthy();

    const viewport = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 600, pointerId: 2 });
    fireEvent.pointerUp(viewport, { clientX: 200, clientY: 600, pointerId: 2 });

    expect(note.getAttribute('data-selected')).toBe('false');
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-35: double-clicking a note edits it and never creates a second note', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const note = utils.getByTestId('sticky-note');

    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });

    const all = snapshot(utils.doc);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();
  });

  it('TC-36: Enter with nothing selected does nothing', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(snapshot(utils.doc)).toHaveLength(0);
    expect(utils.queryByTestId('sticky-textarea')).toBeNull();
  });

  it('TC-37: a note deleted while dragged: no exception, board state stays consistent', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const note = utils.getByTestId('sticky-note');

    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 660, clientY: 400, pointerId: 1 });
    act(() => {
      deleteObject(utils.doc, id);
    });
    // The in-flight rAF was cancelled on unmount; flushing is a no-op.
    flushFrame();

    expect(snapshot(utils.doc)).toHaveLength(0);
    expect(utils.queryByTestId('sticky-note')).toBeNull();
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-37b: a note deleted while editing: no exception, the editor unmounts', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils);
    const note = utils.getByTestId('sticky-note');

    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();
    act(() => {
      deleteObject(utils.doc, id);
    });

    expect(utils.queryByTestId('sticky-textarea')).toBeNull();
    expect(snapshot(utils.doc)).toHaveLength(0);
  });
});
