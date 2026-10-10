import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as Y from 'yjs';

import { BoardContents } from '../../../src/client/board/BoardContents';
import { BoardSession } from '../../../src/client/pages/BoardPage';
import { CameraProvider } from '../../../src/client/canvas/CameraProvider';
import {
  createSticky,
  getStickyText,
  objectBounds,
  objectSnapshots,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import type { StickyColor } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';
import type { Point } from '../../../src/client/canvas/camera';

/** The size `ResizeObserverStub` reports, so it is also the board area size. */
export const VIEWPORT_SIZE = { width: 1200, height: 800 };

/** A well-formed board address, for the tests that mount a board session. */
export const COMPONENT_BOARD_ID = 'componentboard00000000';

/**
 * The board as the app renders it — the board session, and not the whole app.
 *
 * Which page an address is, and whether the board behind it exists, are the
 * router's and the board page's own tests (TC-19 to TC-21): a viewport test that
 * mounted the app would spend its assertions on the existence check and still
 * know nothing about the viewport.
 */
export function renderBoard(): void {
  render(<BoardSession boardId={COMPONENT_BOARD_ID} />);
}

/**
 * The story 2 board with an injected document: the same tree `App` renders,
 * so tests can seed and inspect the `Y.Doc` directly (as another client
 * would) around the interaction under test.
 */
export function renderStickyBoard(doc: Y.Doc): void {
  render(
    <CameraProvider>
      <BoardContents doc={doc} />
    </CameraProvider>,
  );
}

/**
 * Create a note through the model; returns its id. `x`/`y` are the top-left
 * (the model centres a note on the point it gets, so it is offset here).
 */
export function seedSticky(
  doc: Y.Doc,
  opts: { x?: number; y?: number; text?: string; color?: StickyColor } = {},
): string {
  return doc.transact(() => {
    const created = createSticky(doc, {
      x: (opts.x ?? 400) + STICKY_SIZE_WORLD / 2,
      y: (opts.y ?? 300) + STICKY_SIZE_WORLD / 2,
    });
    if (typeof created !== 'string') throw new Error('seedSticky: non-finite point');
    if (opts.text !== undefined) getStickyText(doc, created)?.insert(0, opts.text);
    if (opts.color !== undefined) setStickyColor(doc, created, opts.color);
    return created;
  });
}

export function readNotes(doc: Y.Doc): StickySnapshot[] {
  return [...snapshot(doc)];
}

export function readNote(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((note) => note.id === id);
}

export function textOf(doc: Y.Doc, id: string): string {
  return getStickyText(doc, id)?.toString() ?? '';
}

/** The rendered note element for a model id. */
export function noteById(id: string): HTMLElement {
  const element = document.querySelector(`[data-note-id="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no note element for ${id}`);
  return element;
}

/** Jump the camera through the test hooks `useCamera` installs. */
export function setCamera(camera: Camera): void {
  const api = window.__vidi6;
  if (!api) throw new Error('test hooks are not installed');
  act(() => api.setCamera(camera));
}

export function viewportElement(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function gridElement(): HTMLElement {
  return screen.getByTestId('board-grid');
}

export function worldElement(): HTMLElement {
  return screen.getByTestId('board-world');
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-percent').textContent ?? '';
}

export function hintElement(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

export function isPanning(): boolean {
  return viewportElement().dataset.panning === 'true';
}

const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;

function numbers(value: string): number[] {
  return (value.match(NUMBER) ?? []).map(Number);
}

/** The camera the world layer transform renders. */
export function readCamera(): Camera {
  const [zoom, translateX, translateY] = numbers(worldElement().style.transform);
  return { x: -translateX, y: -translateY, zoom };
}

/** Grid geometry as the viewport renders it (CSS pixels). */
export function readGrid(): { spacing: number; offsetX: number; offsetY: number } {
  const style = gridElement().style;
  const [spacing] = numbers(style.backgroundSize);
  const [offsetX, offsetY] = numbers(style.backgroundPosition);
  return { spacing, offsetX, offsetY };
}

/** Await one animation frame, so coalesced camera updates land. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    // React state updates queued by the frame callback.
    await Promise.resolve();
  });
}

export function pointerEvent(kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', target: Element, point: Point, extra: Record<string, unknown> = {}): void {
  const fire = fireEvent[kind as keyof typeof fireEvent] as unknown as (el: Element, init: object) => void;
  fire(target, { pointerId: 1, button: 0, clientX: point.x, clientY: point.y, ...extra });
}

/** Dispatch a wheel event and hand it back so `defaultPrevented` can be read. */
export function dispatchWheel(
  target: Element,
  init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number; deltaMode?: number },
): Event {
  const event = new globalThis.WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a Safari gesture event (jsdom has no GestureEvent). */
export function dispatchGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  init: { scale?: number; clientX?: number; clientY?: number },
): Event {
  const event = new globalThis.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    scale: init.scale ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Dispatch a keydown event and hand it back so `defaultPrevented` can be read. */
export function dispatchKey(
  init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  target: Element = document.body,
): Event {
  const event = new globalThis.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/* -------------------------------------------------------------------------- *
 * Story 7: selecting, moving and resizing objects.                           *
 *                                                                            *
 * A pointer in these tests is given in viewport coordinates, and the camera   *
 * is normally set to its origin at zoom 1 first, so those numbers are also    *
 * world units. Points are put into the middle of the object under them, so    *
 * what a test says about a delta is what the board stores.                    *
 * -------------------------------------------------------------------------- */

/** Put a note on a rendered board, and let the screen hear about it. */
export function addNote(
  doc: Y.Doc,
  opts: { x?: number; y?: number; text?: string; color?: StickyColor } = {},
): string {
  let id = '';
  act(() => {
    id = seedSticky(doc, opts);
  });
  return id;
}

/** Where a note's middle is on the screen, which is where a press should land. */
export function centreOfNote(doc: Y.Doc, id: string): Point {
  const note = readNote(doc, id);
  if (!note) throw new Error(`no note ${id}`);
  return { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 };
}

/** The middle of any object, generic types included. */
export function centreOfObject(doc: Y.Doc, id: string): Point {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`no object ${id}`);
  const bounds = objectBounds(object);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** Press, and hold: the object is under the pointer, which has not moved. */
export function press(target: Element, point: Point, extra: Record<string, unknown> = {}): void {
  pointerEvent('pointerDown', target, point, extra);
}

/** …and let go in the same place it was pressed. */
export function releaseAt(target: Element, point: Point, extra: Record<string, unknown> = {}): void {
  pointerEvent('pointerUp', target, point, extra);
}

/**
 * Press, pull the pointer away by `delta`, and release: a drag. `extra` goes on
 * every event, so `{ shiftKey: true }` is Shift held for the whole gesture.
 * Whether the board wrote anything is left to a frame flush and the caller.
 */
export function drag(
  target: Element,
  from: Point,
  delta: Point,
  extra: Record<string, unknown> = {},
): void {
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  pointerEvent('pointerDown', target, from, extra);
  pointerEvent('pointerMove', target, to, extra);
  pointerEvent('pointerUp', target, to, extra);
}

/** A press and release on a note's middle: a click on it. */
export function clickNote(
  doc: Y.Doc,
  id: string,
  { shift = false }: { shift?: boolean } = {},
): void {
  const point = centreOfNote(doc, id);
  const extra = shift ? { shiftKey: true } : {};
  press(noteById(id), point, extra);
  releaseAt(noteById(id), point, extra);
}

/** Every object the board is drawing an outline around, in document order. */
export function selectedElements(): HTMLElement[] {
  return [...document.querySelectorAll('[data-selected="true"]')] as HTMLElement[];
}

/** Their ids, sorted, so a test can say what is selected without order noise. */
export function selectedIds(): string[] {
  return selectedElements()
    .map((element) => element.dataset.noteId ?? element.dataset.boxId ?? element.dataset.objectId ?? '')
    .filter((id) => id !== '')
    .sort();
}

/** What the board says how many objects it has, whatever their types. */
export function objectSizes(doc: Y.Doc, id: string): { x: number; y: number; width: number; height: number } {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`no object ${id}`);
  const bounds = objectBounds(object);
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}
