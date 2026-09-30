// Shared driver for story 8's full-board component tests.
//
// Copied in spirit from `Selection.test.tsx`: everything runs against the real
// `<Board>`, the fake provider hands back the very `Y.Doc` the board made, and the
// screen is driven with pointer and keyboard events rather than by calling the
// controller. Undo and redo are therefore exercised the way a person uses them —
// through the shortcut and the buttons — and read back from the document.
//
// The test file that imports this must `vi.mock('y-websocket', …)` with the fake
// provider first (a hoisted mock belongs to the test file, not to a module).

import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import * as Y from 'yjs';
import { Board } from '../../../src/client/board/Board';
import { render } from '@testing-library/react';
import {
  createSticky,
  objectBounds,
  snapshotObjects,
} from '../../../src/shared/board-model';
import type { BoardObject } from '../../../src/shared/board-model';
import type { Rect, } from '../../../src/shared/geometry';
import type { Camera, Point } from '../../../src/client/canvas/camera';
import { worldToScreen } from '../../../src/client/canvas/camera';
import { FakeWebsocketProvider } from './fake-provider';
import { dispatchPointer, VIEWPORT } from './events';

/** A board id of its own so parallel files in one project never collide. */
export const BOARD_ID = 'undo-board-under-test';

/** World origin sits at the window centre until the camera is measured. */
const IDLE_CAMERA: Camera = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 };

export const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

/** Let a capture window close before doing something that must be its own step. */
export const settleBeyondCaptureWindow = (): void => {
  act(() => {
    vi.advanceTimersByTime(600);
  });
};

/** The document the board itself created (the fake provider holds a reference). */
export const doc = (): Y.Doc => FakeWebsocketProvider.last().doc as Y.Doc;

const camera = (): Camera => window.__vidi6?.getCamera() ?? IDLE_CAMERA;
export const screenOfPoint = (world: Point): Point => worldToScreen(camera(), world);

const viewport = (): HTMLElement => screen.getByTestId('board-viewport');
const press = (element: Element, at: Point, shift = false): Event =>
  dispatchPointer(element, 'pointerdown', at.x, at.y, { shiftKey: shift });
const moveTo = (at: Point, shift = false): Event =>
  dispatchPointer(window, 'pointermove', at.x, at.y, { shiftKey: shift });
const release = (at: Point): Event => dispatchPointer(window, 'pointerup', at.x, at.y);
const cancelPointer = (at: Point): Event =>
  dispatchPointer(window, 'pointercancel', at.x, at.y);

/** Open the board and let it sync, so the board is editable. */
export function open(): void {
  render(<Board boardId={BOARD_ID} />);
  act(() => {
    FakeWebsocketProvider.last().markSynced();
  });
  flush();
}

/** A note whose centre is the world point (x, y), created before the edit under test. */
export function makeNote(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(doc(), { x, y });
  });
  flush();
  return id;
}

export function boxOf(id: string): Rect {
  const object: BoardObject | undefined = snapshotObjects(doc()).find(
    (candidate) => candidate.id === id,
  );
  if (!object) throw new Error(`"${id}" is not in the document`);
  return objectBounds(object);
}

export function centre(id: string): Point {
  const bounds = boxOf(id);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export const noteElements = (): HTMLElement[] =>
  screen.queryAllByTestId('sticky-note') as HTMLElement[];

export const noteElement = (id: string): HTMLElement => {
  const found = (screen.queryAllByTestId('sticky-note') as HTMLElement[]).find(
    (element) => element.dataset.id === id,
  );
  if (!found) throw new Error(`no note "${id}" on the screen`);
  return found;
};

/** The colour a note currently has, read back from the document. */
export const colorOf = (id: string): string => {
  const object: BoardObject | undefined = snapshotObjects(doc()).find(
    (candidate) => candidate.id === id,
  );
  if (!object || !('color' in object)) throw new Error(`no colour for "${id}"`);
  return object.color as string;
};

/** Press, travel across the drag threshold, land, let go: a real move gesture. */
export function drag(el: Element, from: Point, to: Point, shift = false): void {
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  press(el, start, shift);
  moveTo({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, shift);
  moveTo(end, shift);
  release(end);
  flush();
}

/**
 * One continuous gesture of `frames` intermediate moves: press, many moves (each
 * advanced a frame of fake time), then release. The whole path is a single step.
 */
export function dragSlow(el: Element, from: Point, to: Point, frames: number): void {
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  press(el, start);
  for (let step = 1; step <= frames; step += 1) {
    const t = step / frames;
    moveTo({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    advance(16);
  }
  release(end);
  flush();
}

/** The same gesture, ended by a pointercancel partway: keeps what it applied. */
export function dragCancelled(el: Element, from: Point, to: Point): void {
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  press(el, start);
  moveTo({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  cancelPointer(end);
  flush();
}

/** Shift-drag a box over the board: a marquee selection. */
export function marquee(from: Point, to: Point): void {
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  dispatchPointer(viewport(), 'pointerdown', start.x, start.y, { shiftKey: true });
  dispatchPointer(viewport(), 'pointermove', (start.x + end.x) / 2, (start.y + end.y) / 2, {
    shiftKey: true,
  });
  dispatchPointer(viewport(), 'pointermove', end.x, end.y, { shiftKey: true });
  dispatchPointer(viewport(), 'pointerup', end.x, end.y, { shiftKey: true });
  flush();
}

/** Let the fake clock run `ms`, as a real pause between two actions. */
export const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** Double-click empty board: makes a note and opens its editor. */
export function doubleClickEmpty(at: Point): void {
  const spot = screenOfPoint(at);
  const vp = viewport();
  dispatchPointer(vp, 'pointerdown', spot.x, spot.y);
  dispatchPointer(vp, 'pointerup', spot.x, spot.y);
  dispatchPointer(vp, 'pointerdown', spot.x, spot.y);
  dispatchPointer(vp, 'pointerup', spot.x, spot.y);
  fireEvent.doubleClick(vp, { clientX: spot.x, clientY: spot.y });
  flush();
}

/** Double-click an existing note: opens its editor. */
export function openNoteEditor(id: string): void {
  const el = noteElement(id);
  const spot = screenOfPoint(centre(id));
  dispatchPointer(el, 'pointerdown', spot.x, spot.y);
  dispatchPointer(el, 'pointerup', spot.x, spot.y);
  dispatchPointer(el, 'pointerdown', spot.x, spot.y);
  dispatchPointer(el, 'pointerup', spot.x, spot.y);
  fireEvent.doubleClick(el, { clientX: spot.x, clientY: spot.y });
  flush();
}

/** The open text editor, if one is open. */
export const editor = (): HTMLTextAreaElement =>
  screen.getByTestId('sticky-note-text') as HTMLTextAreaElement;

/** Type into the open editor by setting its value, the way `input` reports it. */
export function typeInto(text: string): void {
  fireEvent.input(editor(), { target: { value: text } });
  flush();
}

/** Escape closes the editor. */
export function pressEscape(): void {
  fireEvent.keyDown(editor(), { key: 'Escape' });
  flush();
}

// --- undo / redo, driven like a person does ----------------------------------

const boardKey = (init: Record<string, unknown>): void => {
  fireEvent.keyDown(document.body, init);
};

/** The board-level Undo shortcut (the page, unfocused). */
export const pressUndo = (): void => boardKey({ key: 'z', ctrlKey: true });
export const pressUndoCmd = (): void => boardKey({ key: 'z', metaKey: true });
export const pressRedo = (): void =>
  boardKey({ key: 'z', ctrlKey: true, shiftKey: true });
export const pressRedoCmd = (): void =>
  boardKey({ key: 'z', metaKey: true, shiftKey: true });
export const pressRedoY = (): void => boardKey({ key: 'y', ctrlKey: true });

/** The same shortcuts while the caret is in the open editor. */
export const editorUndo = (): void => {
  fireEvent.keyDown(editor(), { key: 'z', ctrlKey: true });
};

export { FakeWebsocketProvider, VIEWPORT };
