/**
 * Helpers for the story 7 component tests: selecting, marqueeing, dragging and resizing the board.
 *
 * Two rules run through this file.
 *
 * **Coordinates go through the camera.** Every screen point a test presses on is computed from a rect in
 * board units with `worldToScreen`, so a test says "the bottom-right corner of this note" rather than a
 * magic pixel, and stays true if the board ever opens framed somewhere else. The one exception is the
 * place a note is *created*, which is given in screen points because that is what a double-click is.
 *
 * **The pointer is released on the window.** A gesture installs its listeners on the window, like a real
 * drag that leaves the note it started on, so the moves and the release are fired there. What a test
 * asserts afterwards is read from the document, through `objects()`, because the document is what the
 * product promises and a pixel on a screen in jsdom is not.
 */
import { expect } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import * as Y from 'yjs';

import { snapshot } from '../../../src/shared/board-model';
import type { ObjectSnapshot } from '../../../src/shared/board-model';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import type { Handle, Point, Rect } from '../../../src/shared/geometry';
import { createLockbox, LOCKBOX_TYPE } from '../../fixtures/lockbox';
import { createTestbox, TESTBOX_MIN_SIZE_WORLD, TESTBOX_TYPE } from '../../fixtures/testbox';
import {
  camera,
  doc,
  doubleClickBoard,
  hasTextarea,
  noteElementById,
  pointerDown,
  pointerEvent,
  renderBoard,
  somebodyElse,
  surface,
  textarea,
  typeText,
} from './stickyBoard';

// Re-exported so a story 7 test imports the whole vocabulary of a gesture from one file.
export {
  camera as cameraOf,
  doc,
  hasTextarea,
  noteElementById,
  renderBoard,
  somebodyElse,
  surface,
  pointerDown,
  pointerEvent,
  screenToWorld,
  textarea,
  worldToScreen,
};
export { LOCKBOX_TYPE, TESTBOX_MIN_SIZE_WORLD, TESTBOX_TYPE };
export type { Handle };

/**
 * A pointer event aimed at the window rather than at an element.
 *
 * A drag that leaves the note it started on — which is every drag worth testing — is heard by the
 * listeners the gesture put on the window, and only a pointer event aimed at the window or at an element
 * inside it reaches them by bubbling. Firing on the window is the honest version: it is where the
 * product listens, so it is where the test writes.
 */
function onWindow(type: string, at: Point, init: PointerEventInit = {}): void {
  fireEvent(window, pointerEvent(type, at.x, at.y, init));
}

/**
 * A pointer move aimed at the window.
 *
 * Exported for the one thing `drag` cannot do: be held open. A gesture that something else happens in
 * the middle of — a colleague deletes an object, a second pointer appears — has to be stopped halfway
 * through, and the only honest way to stop it is to leave the pointer down.
 */
export function moveWindow(at: Point, init: PointerEventInit = {}): void {
  onWindow('pointermove', at, init);
}

/** Let go, at the window. The other half of a gesture held open. */
export function upWindow(at: Point, init: PointerEventInit = {}): void {
  onWindow('pointerup', at, { buttons: 0, ...init });
}

/**
 * The pointer was taken away by something else — a system gesture, a window losing focus, a second
 * finger that won. Whatever the reason, a gesture in flight is given up and must not select or move.
 */
export function cancelWindow(at: Point, init: PointerEventInit = {}): void {
  onWindow('pointercancel', at, { buttons: 0, ...init });
}

/** The four corners of an object as the board would draw them, in screen pixels. */
export function screenRect(object: ObjectSnapshot): Rect {
  const origin = worldToScreen(camera(), { x: object.x, y: object.y });
  return { x: origin.x, y: origin.y, width: object.width, height: object.height };
}

/** A point on an object's box: its middle, or one of the eight handles around it. */
export function pointOn(object: ObjectSnapshot, where: 'centre' | Handle = 'centre'): Point {
  const box = screenRect(object);
  if (where === 'centre') return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return handlePoint(box, where);
}

/** Where a handle sits, given a box in screen pixels. */
export function handlePoint(box: Rect, handle: Handle): Point {
  return {
    x: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2,
    y: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2,
  };
}

/** Every object on the board, of every type, as the document holds it. */
export function objects(d: Y.Doc = doc()): ObjectSnapshot[] {
  return [...snapshot(d)];
}

export function objectById(id: string): ObjectSnapshot {
  const found = objects().find((object) => object.id === id);
  if (!found) throw new Error(`no object with id ${id} on the board`);
  return found;
}

interface Placed {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Put a testbox on the board. The board knows the type because the fixture registered itself. */
export function addTestbox(options: Placed = {}): string {
  let id = '';
  act(() => {
    id = createTestbox(doc(), options);
  });
  return id;
}

/** The same, for the type that cannot be resized. */
export function addLockbox(options: Placed = {}): string {
  let id = '';
  act(() => {
    id = createLockbox(doc(), options);
  });
  return id;
}

/**
 * Put an object of a type nothing has registered onto the board.
 *
 * This is what a board looks like when a later story has written something into it and this build is
 * opened afterwards: the bytes are there, and nothing in here knows what they mean.
 */
export function addUnknownType(id: string, x: number, y: number): void {
  act(() => {
    const objects = doc().getMap<Y.Map<unknown>>('objects');
    doc().transact(() => {
      const object = new Y.Map<unknown>();
      object.set('type', 'unobtanium');
      object.set('x', x);
      object.set('y', y);
      object.set('width', 120);
      object.set('height', 120);
      object.set('z', 1);
      object.set('createdAt', 1_600_000_000_000);
      objects.set(id, object);
    }, 'test-fixture');
  });
}

/** The whole selection, the way the keyboard does it. */
export function selectAll(): void {
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
}

export function pressEscape(target: Window | Document | Node = window): void {
  fireEvent.keyDown(target, { key: 'Escape' });
}

/** The objects the board reports as selected, in board order. */
export function selectedObjects(): ObjectSnapshot[] {
  const ids = outlinedIds();
  return objects().filter((object) => ids.includes(object.id));
}

/** The ids with an outline drawn round them, which is what the board says is selected. */
export function outlinedIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="selection-outline"]')).map(
    (element) => element.dataset.objectId ?? '',
  );
}

/** The selection bar's words, or null when there is no bar. */
export function selectionText(): string | null {
  const element = screen.queryByTestId('selection-count');
  return element === null ? null : (element.textContent ?? '');
}

/** What the live region has said, or null when there is nothing to say. */
export function liveText(): string | null {
  const element = screen.queryByTestId('selection-live');
  return element === null ? null : (element.textContent ?? '');
}

export function deleteSelectionButton(): HTMLElement | null {
  return screen.queryByLabelText('Delete selection');
}

/** The accessible names of the handles that are on the board right now. */
export function handleLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="resize-handle-"]')).map(
    (element) => element.getAttribute('aria-label') ?? '',
  );
}

export function marqueeVisible(): boolean {
  return screen.queryByTestId('marquee') !== null;
}

export function selectionBarVisible(): boolean {
  return screen.queryByTestId('selection-bar') !== null;
}

export function noteToolbarVisible(): boolean {
  return screen.queryByTestId('note-toolbar') !== null;
}

/**
 * Drag on the board, from one screen point to another, releasing on the window.
 *
 * `target` is where the press lands — a note, a handle, the empty surface — because that is the only
 * thing that decides what the drag means. The moves are stepped, because a single jump would let a
 * gesture that never crossed the drag threshold look exactly like one that did.
 */
export function drag(
  target: Element,
  from: Point,
  to: Point,
  steps = 3,
  init: PointerEventInit = {},
): void {
  pointerDown(target, from.x, from.y, init);
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    moveWindow({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }, init);
  }
  upWindow(to, init);
}

/** Drag a whole object by its middle. */
export function dragObject(id: string, dx: number, dy: number, init: PointerEventInit = {}): void {
  const object = objectById(id);
  const start = pointOn(object, 'centre');
  drag(noteElementById(id), start, { x: start.x + dx, y: start.y + dy }, 3, init);
}

/** Drag a resize handle of the selection's bounding box. */
export function dragHandle(handle: Handle, dx: number, dy: number, init: PointerEventInit = {}): void {
  const element = screen.getByTestId(`resize-handle-${handle}`);
  const box = boundingBoxOnScreen();
  const start = handlePoint(box, handle);
  drag(element, start, { x: start.x + dx, y: start.y + dy }, 3, init);
}

/** The bounding box the overlay is drawing, in screen pixels, read back from the DOM. */
export function boundingBoxOnScreen(): Rect {
  const element = screen.getByTestId('selection-bounds');
  const style = element.style;
  return {
    x: Number.parseFloat(style.left),
    y: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
}

/**
 * Draw a selection rectangle across empty board space and let go.
 *
 * The press carries Shift, because that is what tells the viewport to draw a rectangle rather than move
 * the board; the moves carry it too, which is what a real Shift-drag does and what stops a stray pan if
 * the rectangle ends and the pointer is still down.
 */
export function marquee(from: Point, to: Point, surface: HTMLElement): void {
  const steps = 3;
  pointerDown(surface, from.x, from.y, { shiftKey: true });
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    moveWindow({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }, {
      shiftKey: true,
    });
  }
  upWindow(to, { shiftKey: true });
}

/** The same rectangle, given the board-unit box it is supposed to enclose. */
export function marqueeAround(box: Rect, surface: HTMLElement): void {
  marquee({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, surface);
}

/** A box a little bigger than an object, so the object is certainly inside it. */
export function around(object: ObjectSnapshot, padding = 20): Rect {
  const box = screenRect(object);
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

/** A screen point at the middle of the board area, where a double-click puts a note. */
export const MIDDLE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

/**
 * Put a sticky note down at a screen point and leave it selected but not being typed in.
 *
 * The id is found by diffing the board rather than by counting notes, because the board reports objects
 * in stacking order and a note raised above another is not the last one in the list.
 */
export async function placeNote(at: Point = MIDDLE, text = ''): Promise<string> {
  const before = new Set(objects().map((object) => object.id));
  await doubleClickBoard(at.x, at.y);
  const added = objects().filter((object) => !before.has(object.id));
  if (added.length !== 1) throw new Error(`a double-click should have created one object, made ${added.length}`);
  if (text) typeText(text);
  // Escape inside the text closes the typing and leaves the note selected, which is the state a test
  // wants to be in when it starts selecting things: something chosen, and nobody holding a caret.
  fireEvent.keyDown(textarea(), { key: 'Escape' });
  await waitFor(() => expect(hasTextarea()).toBe(false));
  return added[0].id;
}

/**
 * Press an object and let go without moving: a selection.
 *
 * The release is on the window, as it is for a drag, because the gesture is listening there and a press
 * that never becomes a gesture must still leave the selection correct — which is the part of a click
 * that a test of "clicking selects" should be exercising.
 */
export function pressNote(id: string, init: PointerEventInit = {}): void {
  const at = pressOn(id, init);
  upWindow(at, init);
}

/**
 * Press an object and leave the pointer down, returning the point it was pressed at.
 *
 * The pair to use with {@link moveWindow} and {@link upWindow} when a test needs to ask a question in
 * the middle of a gesture rather than only before and after it.
 */
export function pressOn(id: string, init: PointerEventInit = {}): Point {
  const at = pointOn(objectById(id), 'centre');
  pointerDown(noteElementById(id), at.x, at.y, init);
  return at;
}

/**
 * Start a selection rectangle and leave the pointer down.
 *
 * A test that wants to ask a question *while the rectangle is being drawn* — is it on the screen, where
 * is its edge, has the board panned — uses this and then `endMarquee`; a test that only cares what ends
 * up selected uses {@link marquee}, which is shorter and says less.
 */
export function beginMarquee(from: Point, to: Point, where: Element = surface()): void {
  pointerDown(where, from.x, from.y, { shiftKey: true });
  moveWindow({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { shiftKey: true });
  moveWindow(to, { shiftKey: true });
}

/** Let go of a rectangle that {@link beginMarquee} started. */
export function endMarquee(to: Point): void {
  upWindow(to, { shiftKey: true });
}

/** The board's own zoom-out keystroke, which is how a test changes zoom without inventing a way. */
export function zoomOutByKeyboard(): void {
  fireEvent.keyDown(window, { key: '-', ctrlKey: true });
}

/**
 * Press Escape while a rectangle is being drawn.
 *
 * It is sent to the document, because that is where the rectangle's own listener is waiting and where a
 * real keystroke arrives on its way to the window. A test that sent it to the window instead would skip
 * the rectangle entirely and find the board's Escape, which empties the selection — a different question,
 * and the one this helper exists to keep out of the answer.
 */
export function escapeDuringMarquee(): void {
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  });
}
