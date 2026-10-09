/**
 * Helpers for story 7's component tests: multi-selection, the marquee, the transform
 * gesture and the selection keyboard.
 *
 * Everything is driven through the same DOM the tests use for sticky notes
 * (`fixtures/board`), and the objects are the test-only `testbox` type — a plain resizable
 * rectangle with no proportions of its own, which is what lets a test show a handle
 * changing width without height (TC-24) in a way no sticky note could.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { objectSnapshots, deleteObject, type ObjectSnapshot } from '../../../src/shared/board-model';
import { handleLabel, type Handle, type Rect } from '../../../src/shared/geometry';
import { createTestbox, TESTBOX_TYPE, type TestboxRect } from '../../fixtures/testbox';
import {
  boardDoc,
  flushFrames,
  readCamera,
  screenPointOf,
  viewportElement,
} from './board';

export { createTestbox, TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../../fixtures/testbox';
export { testboxSnapshot } from '../../fixtures/testbox';

/**
 * Where the three seeded boxes are, in world units. The board opens centred on its starting
 * point, which shows world x −640…640 and y −400…400 at 100% zoom (`VIEWPORT_FIXTURE`), so
 * these land at screen (60–260, 50–250), (300–500, 50–250) and (60–260, 290–490): an L with
 * room to draw a marquee around one of them and empty space everywhere else.
 */
export const BOX_SEED: readonly TestboxRect[] = [
  { x: -580, y: -350, width: 200, height: 200 },
  { x: -340, y: -350, width: 200, height: 200 },
  { x: -580, y: -110, width: 200, height: 200 },
];

/**
 * A stretch of empty board, in *screen* pixels: away from the seeded boxes (which sit at
 * screen x 60–500, y 50–490), away from the note a toolbar button creates at the centre of
 * the viewport, and away from the zoom controls, the toolbar and the first-use hint.
 */
export const EMPTY_SCREEN = { x: 900, y: 620 };

interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------------- *
 * Seeding and reading objects
 * ------------------------------------------------------------------------ */

/** Write testboxes into the live document and wait for the board to draw them. */
export async function seedBoxes(
  rects: readonly TestboxRect[] = BOX_SEED,
): Promise<string[]> {
  const ids = rects.map((rect) => createTestbox(boardDoc(), rect));
  await vi.waitFor(() => {
    if (objectSnapshots(boardDoc()).length !== rects.length) {
      throw new Error(`board has not drawn ${rects.length} boxes yet`);
    }
  });
  await flushFrames();
  return ids;
}

/** Every object in the document, of every type. */
export function objectsInDoc(): readonly ObjectSnapshot[] {
  return objectSnapshots(boardDoc());
}

export function objectInDoc(id: string): ObjectSnapshot {
  const found = objectsInDoc().find((object) => object.id === id);
  if (!found) throw new Error(`no object with id ${id} in the document`);
  return found;
}

export function objectRect(id: string): Rect {
  const object = objectInDoc(id);
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

export function objectPositions(): Array<{ id: string; x: number; y: number }> {
  return objectsInDoc().map((object) => ({ id: object.id, x: object.x, y: object.y }));
}

/** Delete an object through the document, the way another browser would. */
export async function remoteDelete(id: string): Promise<void> {
  act(() => {
    deleteObject(boardDoc(), id);
  });
  await flushFrames();
}

/* ------------------------------------------------------------------------- *
 * The DOM
 * ------------------------------------------------------------------------ */

export function boxElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-object-type="${TESTBOX_TYPE}"][data-note-id="${id}"]`,
  );
  if (!element) throw new Error(`no testbox element for id ${id}`);
  return element;
}

/** Any object the board drew, by id — a sticky note or a testbox, either one. */
export function objectElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`no element for object ${id}`);
  return element;
}

/** Every object the board drew, of every type it knows. */
export function objectElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'));
}

/** The ids the board is currently drawing as selected. */
export function selectedIds(): string[] {
  return objectElements()
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '')
    .sort();
}

export function selectionBarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="selection-bar"]');
}

export function selectionCountText(): string | null {
  const element = document.querySelector<HTMLElement>('[data-testid="selection-count"]');
  return element ? element.textContent : null;
}

export function selectionCountIsLive(): boolean {
  const element = document.querySelector<HTMLElement>('[data-testid="selection-count"]');
  return element?.getAttribute('aria-live') === 'polite';
}

export function deleteSelectionButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    '[data-testid="selection-bar"] button[aria-label="Delete selection"]',
  );
  if (!element) throw new Error('no Delete selection button');
  return element;
}

export function selectionBoxElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="selection-box"]');
}

/** The bounding box the overlay drew, in world units. */
export function selectionBoxWorld(): Rect | null {
  const element = selectionBoxElement();
  if (!element) return null;
  const { boxX, boxY, boxWidth, boxHeight } = element.dataset;
  return {
    x: Number(boxX),
    y: Number(boxY),
    width: Number(boxWidth),
    height: Number(boxHeight),
  };
}

/** The 8 resize handles, by the position the design says each one is labelled with. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handleElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-handle]'));
}

export function handleElement(handle: Handle): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-handle="${handle}"], [aria-label="${handleLabel(handle)}"]`,
  );
  if (!element) throw new Error(`no resize handle for ${handleLabel(handle)}`);
  return element;
}

export function marqueeElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="marquee"]');
}

export function marqueeWorld(): Rect | null {
  const element = marqueeElement();
  if (!element) return null;
  return {
    x: Number(element.style.left.replace('px', '')),
    y: Number(element.style.top.replace('px', '')),
    width: Number(element.dataset.marqueeWidth),
    height: Number(element.dataset.marqueeHeight),
  };
}

/* ------------------------------------------------------------------------- *
 * Pointers
 * ------------------------------------------------------------------------ */

export function shiftPointerDown(at: Point): void {
  dispatchOn(viewportElement(), 'pointerdown', at, { shiftKey: true });
}

export function shiftPointerMove(at: Point): void {
  dispatchOn(viewportElement(), 'pointermove', at, { shiftKey: true });
}

export function shiftPointerUp(at: Point): void {
  dispatchOn(viewportElement(), 'pointerup', at, { shiftKey: true });
}

export function shiftPointerCancel(at: Point): void {
  dispatchOn(viewportElement(), 'pointercancel', at, { shiftKey: true });
}

/** A plain press on empty board space (no Shift): the pan or the clearing click. */
export function plainPointerDown(at: Point): void {
  dispatchOn(viewportElement(), 'pointerdown', at);
}

export function plainPointerMove(at: Point): void {
  dispatchOn(viewportElement(), 'pointermove', at);
}

export function plainPointerUp(at: Point): void {
  dispatchOn(viewportElement(), 'pointerup', at);
}

/** Shift+drag across empty board space: the marquee. */
export async function shiftDrag(from: Point, to: Point, steps = 3): Promise<void> {
  shiftPointerDown(from);
  for (let step = 1; step <= steps; step += 1) {
    shiftPointerMove({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await flushFrames();
  }
}

/** Where an object's centre is on screen right now (read from the document). */
export function objectCentreOnScreen(id: string): Point {
  const rect = objectRect(id);
  return screenPointOf(readCamera(), {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
}

/** Where a world point is on screen right now. */
export function worldOnScreen(world: Point): Point {
  return screenPointOf(readCamera(), world);
}

/**
 * A real browser focuses what it pressed, between the press and the release — objects are
 * focusable so that Tab reaches them. jsdom only does it when asked, so the press helpers
 * ask: the board has to cope with a focus that arrives *because* of the press it has just
 * handled, or the focus handler throws away the rest of the selection.
 */
function focusPressed(element: HTMLElement): void {
  element.focus();
}

/** Press and release on an object: a plain click that selects it alone. */
export async function clickObject(id: string): Promise<void> {
  const element = objectElement(id);
  const at = objectCentreOnScreen(id);
  pointerDownOn(element, at);
  focusPressed(element);
  await flushFrames();
  pointerUpOn(element, at);
  await flushFrames();
}

/** Shift+click: add this object to the selection, or take it back out of it. */
export async function shiftClickObject(id: string): Promise<void> {
  const element = objectElement(id);
  const at = objectCentreOnScreen(id);
  pointerDownOn(element, at, true);
  focusPressed(element);
  await flushFrames();
  pointerUpOn(element, at);
  await flushFrames();
}

/**
 * Focus an object without pressing it, which is what Tab does — and the only way an object
 * gets selected by the keyboard.
 */
export async function focusObject(id: string): Promise<void> {
  const element = objectElement(id);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  element.focus();
  await flushFrames();
}

function dispatchOn(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  at: Point,
  options: { shiftKey?: boolean } = {},
): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      shiftKey: options.shiftKey ?? false,
    }),
  );
}

export function pointerDownOn(element: Element, at: Point, shiftKey = false): void {
  dispatchOn(element, 'pointerdown', at, { shiftKey });
}

export function pointerUpOn(element: Element, at: Point): void {
  dispatchOn(element, 'pointerup', at);
}

export function pointerMoveOn(element: Element, at: Point, shiftKey = false): void {
  dispatchOn(element, 'pointermove', at, { shiftKey });
}

export function pointerCancelOn(element: Element, at: Point): void {
  dispatchOn(element, 'pointercancel', at);
}

/**
 * Press an object, move by (dx, dy) screen pixels — past the drag threshold on the first
 * step unless `underThreshold` — and release. Returns nothing; read the document after.
 */
export async function dragObject(
  id: string,
  delta: { x: number; y: number },
  options: { steps?: number } = {},
): Promise<void> {
  const element = objectElement(id);
  const from = objectCentreOnScreen(id);
  const steps = options.steps ?? 3;
  pointerDownOn(element, from);
  focusPressed(element);
  for (let step = 1; step <= steps; step += 1) {
    pointerMoveOn(element, {
      x: from.x + (delta.x * step) / steps,
      y: from.y + (delta.y * step) / steps,
    });
    await flushFrames();
  }
  pointerUpOn(element, { x: from.x + delta.x, y: from.y + delta.y });
  await flushFrames();
}

/**
 * Press one of the selection's handles and drag it. `steps` counts the moves; the last one
 * lands at the requested delta, and the pointer is released there.
 */
export async function dragHandle(
  handle: Handle,
  delta: Point,
  options: { steps?: number; shift?: boolean } = {},
): Promise<void> {
  const element = handleElement(handle);
  const from = { x: elementLeft(element), y: elementTop(element) };
  const steps = options.steps ?? 3;
  const shift = options.shift ?? false;
  pointerDownOn(element, from);
  for (let step = 1; step <= steps; step += 1) {
    pointerMoveOn(
      element,
      {
        x: from.x + (delta.x * step) / steps,
        y: from.y + (delta.y * step) / steps,
      },
      shift,
    );
    await flushFrames();
  }
  pointerUpOn(element, { x: from.x + delta.x, y: from.y + delta.y });
  await flushFrames();
}

/**
 * Where a handle sits on screen. jsdom does not lay anything out, so `getBoundingClientRect`
 * is all zeros; the overlay positions handles in screen pixels through `style.left/top`,
 * which is what this reads.
 */
function elementLeft(element: HTMLElement): number {
  return Number(element.style.left.replace('px', ''));
}

function elementTop(element: HTMLElement): number {
  return Number(element.style.top.replace('px', ''));
}

/* ------------------------------------------------------------------------- *
 * Keys
 * ------------------------------------------------------------------------ */

export interface KeyOptions {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  target?: EventTarget;
}

/**
 * Press a key on the board, and report whether the board prevented the browser's own
 * behaviour (scrolling for the arrows, the browser's select-all for Ctrl+A).
 */
export function pressCombo(key: string, options: KeyOptions = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrl ?? false,
    metaKey: options.meta ?? false,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
  });
  (options.target ?? window).dispatchEvent(event);
  return event.defaultPrevented;
}

/** Press a key and let the board react. Returns whether it was prevented. */
export async function pressBoardKey(key: string, options: KeyOptions = {}): Promise<boolean> {
  const prevented = pressCombo(key, options);
  await flushFrames();
  return prevented;
}

/** Wait until the board's selection is the given ids. */
export async function waitForSelected(ids: readonly string[]): Promise<void> {
  const expected = [...ids].sort();
  await vi.waitFor(() => {
    const actual = selectedIds();
    if (actual.join(',') !== expected.join(',')) {
      throw new Error(`selection is ${actual.join(',') || '(empty)'}, expected ${expected.join(',')}`);
    }
  });
}
