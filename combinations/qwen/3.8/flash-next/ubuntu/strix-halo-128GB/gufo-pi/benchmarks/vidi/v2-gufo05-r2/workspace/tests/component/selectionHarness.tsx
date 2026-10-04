/**
 * Helpers for story 7's component tests: a real board with objects at known
 * places, and the pointer described in *board* units.
 *
 * Selection, the marquee and a resize are all about where things are on the board,
 * so every helper here takes board coordinates and converts them through the camera
 * the page is actually using (`readCamera` reads it off the world layer). A test can
 * then say "drag from the middle of note b to 40 units right of where it started"
 * without knowing how the viewport is centred, and it stays true if the camera or
 * the default zoom changes.
 */

import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';

import {
  createSticky,
  objectBounds,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';
// The test-only object type registers itself on import.
import { TESTBOX_TYPE } from '../fixtures/testbox';

export { fireKey, firePointer, flushFrames, surface } from './boardHarness';

/** Render the board and hand back its live document. */
export function renderSelection(): Y.Doc {
  renderBoard();
  return readBoardDoc();
}

/** A sticky note whose *top-left* is `rect.x, rect.y` (creation centres a note). */
export function seedNote(doc: Y.Doc, at: Point): string {
  let id = '';
  act(() => {
    id = createSticky(doc, {
      x: at.x + STICKY_SIZE_WORLD / 2,
      y: at.y + STICKY_SIZE_WORLD / 2,
    });
  });
  flushFrames();
  return id;
}

/**
 * An object of the test-only type, at exactly this rect. Written straight into the
 * shared document — a type belongs to a later story, so the product has no creator
 * for it, and the board model has to be exercised through the same reads and writes
 * a real type would use.
 */
export function seedBox(doc: Y.Doc, rect: Rect): string {
  const id = crypto.randomUUID();
  act(() => {
    doc.transact(() => {
      const box = new Y.Map<unknown>();
      box.set('type', TESTBOX_TYPE);
      box.set('x', rect.x);
      box.set('y', rect.y);
      box.set('width', rect.width);
      box.set('height', rect.height);
      box.set('z', 1);
      box.set('createdAt', 0);
      doc.getMap<Y.Map<unknown>>('objects').set(id, box);
    });
  });
  flushFrames();
  return id;
}

/** Remove objects the way another person does: no local origin, no selection. */
export function deleteRemotely(doc: Y.Doc, ids: readonly string[]): void {
  act(() => {
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      for (const id of ids) objects.delete(id);
    });
  });
  flushFrames();
}

export function objectsOf(doc: Y.Doc): readonly ObjectSnapshot[] {
  return objectSnapshots(doc);
}

export function boxOf(doc: Y.Doc, id: string): Rect {
  const object = objectsOf(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return objectBounds(object);
}

/** Every object's box, for asserting on a whole group at once. */
export function boxesOf(doc: Y.Doc, ids: readonly string[]): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const id of ids) out[id] = boxOf(doc, id);
  return out;
}

/** What this page has selected, in creation order. */
export function selectionIds(): string[] {
  const ids = window.__vidi6?.selectedIds?.();
  if (!ids) throw new Error('window.__vidi6.selectedIds missing: MODE must be "test"');
  return [...ids].sort();
}

export function objectEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!el) throw new Error(`object ${id} is not rendered`);
  return el;
}

/** The one selection outline, or null when nothing is selected. */
export function overlayEl(): HTMLElement | null {
  return screen.queryByTestId('selection-overlay');
}

/** The outline's box, read from the DOM in board units (it lives in the world layer). */
export function overlayRect(): Rect | null {
  const el = overlayEl();
  if (!el) return null;
  const { left, top, width, height } = el.style;
  return {
    x: Number.parseFloat(left),
    y: Number.parseFloat(top),
    width: Number.parseFloat(width),
    height: Number.parseFloat(height),
  };
}

export function handleEl(handle: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-resize-handle="${handle}"]`);
}

export function selectionBar(): HTMLElement | null {
  return screen.queryByTestId('selection-bar');
}

/**
 * Screen coordinates of a board point, under the camera the page is using. A probe
 * that mounts the gesture hook without a viewport has no camera to read, and board
 * units are screen units there (zoom 1, no pan).
 */
export function toScreen(world: Point): Point {
  if (!document.querySelector('[data-testid="board-world"]')) return world;
  return worldToScreen(readCamera(), world);
}

type Modifiers = { shift?: boolean; ctrl?: boolean; meta?: boolean };

/**
 * A pointer gesture in board units: press, move, release. `steps` spreads the move
 * so a test can cross the drag threshold the way a hand does.
 */
export function dragWorld(
  el: Element,
  from: Point,
  to: Point,
  options: { modifiers?: Modifiers; release?: boolean; steps?: number } = {},
): void {
  const a = toScreen(from);
  const b = toScreen(to);
  firePointer(el, 'pointerdown', a.x, a.y, options.modifiers);
  const steps = options.steps ?? 2;
  for (let i = 1; i <= steps; i += 1) {
    firePointer(
      el,
      'pointermove',
      a.x + ((b.x - a.x) * i) / steps,
      a.y + ((b.y - a.y) * i) / steps,
      options.modifiers,
    );
  }
  if (options.release !== false) {
    firePointer(el, 'pointerup', b.x, b.y, options.modifiers);
  }
  flushFrames();
}

/** Shift + drag over empty board space: the marquee. */
export function dragMarquee(
  from: Point,
  to: Point,
  options: { modifiers?: Modifiers; release?: boolean } = {},
): void {
  dragWorld(surface(), from, to, {
    modifiers: { shift: true, ...options.modifiers },
    release: options.release,
  });
}

/** The centre of an object, in board units. */
export function centreOf(box: Rect): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press and release without moving: a click on an object. */
export function clickObject(id: string, modifiers: Modifiers = {}): void {
  const el = objectEl(id);
  firePointer(el, 'pointerdown', 100, 100, modifiers);
  firePointer(el, 'pointerup', 100, 100, modifiers);
  flushFrames();
}
