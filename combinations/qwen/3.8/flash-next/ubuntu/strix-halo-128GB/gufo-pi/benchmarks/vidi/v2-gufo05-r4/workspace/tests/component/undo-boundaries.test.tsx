/**
 * Story 8 component tests: undo step boundaries (`undo.boundaries`) — TC-14 to TC-17.
 *
 * These run the whole screen with a real `Y.Doc` and the real undo controller the screen
 * builds for itself, then drive genuine gestures and typing and reverse them through the
 * keyboard shortcut. That end-to-end shape is the point: what is under test is not the
 * undo manager in isolation (the unit tests cover that) but the wiring that makes one
 * drag, one resize or one editing session exactly one step — the `boundary()` calls
 * story 8 hangs off the story 7 gesture and off the text editor.
 *
 * The controller here runs on the wall clock, so the tests never rely on the capture
 * window merging things by luck; the boundaries are what separate the steps, and that is
 * exactly the behaviour these cases assert.
 */

import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, createSticky, objectBounds, type ObjectSnapshot, type StickySnapshot } from '../../src/shared/board-model';
import { worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  clickElement,
  doubleClick,
  fireInput,
  fireKey,
  firePointer,
  flushCameraFrame,
  flushFrames,
  noteSwatch,
  stickyEditor,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera
} from './harness';

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

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  object(id: string): ObjectSnapshot;
}

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const { container } = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return {
    doc,
    root: container,
    object: (id: string) => {
      const found = boardObjects(doc).find((candidate) => candidate.id === id);
      if (!found) throw new Error(`object ${id} is not on the board`);
      return found;
    }
  };
}

/** A note of a known stored size, so it renders with a predictable on-screen centre. */
function addNote(board: BoardFixture, centre: Point): string {
  let id = '';
  act(() => {
    id = createSticky(board.doc, centre);
  });
  return id;
}

function centreOf(board: BoardFixture, id: string): Point {
  const bounds = objectBounds(board.object(id));
  return worldToScreen(testCamera(), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

function positionOf(board: BoardFixture, id: string): Point {
  const bounds = objectBounds(board.object(id));
  return { x: bounds.x, y: bounds.y };
}

/** The note's text and colour, read off the sticky-specific fields of its snapshot. */
function stickyFields(board: BoardFixture, id: string): StickySnapshot {
  return board.object(id) as StickySnapshot;
}

function elementFor(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`object ${id} is not on screen`);
  return element;
}

/** Select a note by a press-release without moving it. */
function clickNote(board: BoardFixture, id: string): void {
  const element = elementFor(board, id);
  const point = centreOf(board, id);
  firePointer(element, 'pointerdown', point.x, point.y);
  firePointer(element, 'pointerup', point.x, point.y);
}

/**
 * Press a note, move it by a screen-space `delta` in `steps` frames, and release. The
 * camera is at zoom 1 in these tests, so a screen delta is also a board-unit delta.
 */
async function dragNoteBy(
  board: BoardFixture,
  id: string,
  delta: Point,
  steps: number,
  release: 'pointerup' | 'pointercancel' = 'pointerup'
): Promise<void> {
  const element = elementFor(board, id);
  const from = centreOf(board, id);
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  firePointer(element, 'pointerdown', from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    firePointer(element, 'pointermove', from.x + delta.x * (step / steps), from.y + delta.y * (step / steps));
    await flushFrames();
  }
  firePointer(element, release, to.x, to.y);
  await flushFrames();
}

/** Ctrl+Z as the board would receive it (a note is selected, no editor is open). */
function pressUndo(): void {
  fireKey('z', { ctrlKey: true });
}

describe('gesture and typing boundaries (undo.boundaries)', () => {
  it('TC-14: one long drag is a single undo step that restores every object to where it began', async () => {
    const board = await renderBoard();
    const id = addNote(board, { x: 0, y: 0 });
    const start = positionOf(board, id);

    // A 30-frame drag: many position writes, all one gesture.
    clickNote(board, id);
    await dragNoteBy(board, id, { x: 240, y: 160 }, 30);

    const moved = positionOf(board, id);
    expect(moved.x).toBeCloseTo(start.x + 240, 3);
    expect(moved.y).toBeCloseTo(start.y + 160, 3);

    // One undo returns it exactly to the start: had the 30 frames been 30 steps, one undo
    // would leave it partway. (A second undo here would reverse the note's own creation,
    // which is a legitimate separate step, so it is deliberately not taken.)
    pressUndo();
    const restored = positionOf(board, id);
    expect(restored.x).toBeCloseTo(start.x, 3);
    expect(restored.y).toBeCloseTo(start.y, 3);
  });

  it('TC-15: a colour change after a drag is a second, separate step', async () => {
    const board = await renderBoard();
    const id = addNote(board, { x: 0, y: 0 });
    const start = positionOf(board, id);

    clickNote(board, id);
    await dragNoteBy(board, id, { x: 200, y: 0 }, 10);
    const moved = positionOf(board, id);

    // Recolour through the note's own toolbar, a little later.
    clickNote(board, id);
    const swatch = noteSwatch(elementFor(board, id), 'blue');
    if (!swatch) throw new Error('the selected note shows no blue swatch');
    clickElement(swatch);
    expect(stickyFields(board, id).color).toBe('blue');

    // The first undo reverses only the colour; the move survives.
    pressUndo();
    expect(stickyFields(board, id).color).not.toBe('blue');
    expect(positionOf(board, id).x).toBeCloseTo(moved.x, 3);

    // The second undo reverses the move.
    pressUndo();
    expect(positionOf(board, id).x).toBeCloseTo(start.x, 3);
  });

  it('TC-16: Ctrl+Z inside the editor undoes the typing, not an earlier move', async () => {
    const board = await renderBoard();
    const id = addNote(board, { x: 0, y: 0 });
    const start = positionOf(board, id);

    // Move it first — its own step.
    clickNote(board, id);
    await dragNoteBy(board, id, { x: 150, y: 0 }, 8);
    const moved = positionOf(board, id);

    // Open it and type; the whole session is the newest step.
    doubleClick(elementFor(board, id), centreOf(board, id).x, centreOf(board, id).y);
    const editor = stickyEditor(board.root);
    if (!editor) throw new Error('double-click did not open the editor');
    fireInput(editor, 'hello');
    expect(stickyFields(board, id).text).toBe('hello');

    // Ctrl+Z lands inside the textarea and reverses only the typing.
    fireKey('z', { ctrlKey: true, target: editor });
    expect(stickyFields(board, id).text).toBe('');
    // The earlier move is untouched.
    expect(positionOf(board, id).x).toBeCloseTo(moved.x, 3);
    expect(moved.x).not.toBeCloseTo(start.x, 3);
  });

  it('TC-17: a cancelled drag is one step restoring the start position', async () => {
    const board = await renderBoard();
    const id = addNote(board, { x: 0, y: 0 });
    const start = positionOf(board, id);

    clickNote(board, id);
    await dragNoteBy(board, id, { x: 180, y: 120 }, 12, 'pointercancel');

    const afterCancel = positionOf(board, id);
    // The drag had begun, so the note ended somewhere it moved to; cancelling is still a
    // single recorded step that undo can reverse back to where the drag started.
    pressUndo();
    const restored = positionOf(board, id);
    expect(restored.x).toBeCloseTo(start.x, 3);
    expect(restored.y).toBeCloseTo(start.y, 3);
    void afterCancel;
  });
});
