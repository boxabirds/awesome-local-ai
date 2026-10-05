import { afterEach, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import type { Point } from '../../src/client/canvas/camera';
import App from '../../src/client/App';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import type { UndoController } from '../../src/client/board/undo';

export const VIEWPORT = { width: 1280, height: 800 };

/**
 * jsdom has no layout, so every element measures 0x0. Sticky-note tests need a
 * real viewport size (the camera centres the world origin in it), so the
 * viewport's `getBoundingClientRect` is stubbed before render.
 */
export function stubViewportSize(size: { width: number; height: number } = VIEWPORT): void {
  const original = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList?.contains('board-viewport')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          width: size.width,
          height: size.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return original.call(this);
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
  });
}

/** Create one sticky note through the model (the only way content appears). */
export function seedSticky(
  doc: Y.Doc,
  at: { x: number; y: number } = { x: 0, y: 0 },
  options: { color?: StickyColor; text?: string } = {},
): string {
  const id = createSticky(doc, at, options.color);
  if (options.text) getStickyText(doc, id)?.insert(0, options.text);
  return id;
}

/** Render the whole app wired to a given document. */
export function renderBoard(doc: Y.Doc) {
  return render(<App doc={doc} />);
}

export function noteEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

export function boardSurface(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-board-surface]');
  if (!el) throw new Error('board surface is not rendered');
  return el;
}

export function worldLayer(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.world-layer');
  if (!el) throw new Error('world layer is not rendered');
  return el;
}

export function textarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>('[data-sticky-textarea]');
}

/** Screen-space press + release on a note (a click, no movement). */
export function clickNote(el: HTMLElement, x = 20, y = 20): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}

/** Press on empty board space and release (a click that clears selection). */
export function clickSurface(el: HTMLElement, x = 600, y = 400): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 2 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, button: 0, pointerId: 2 });
}

// --- Story 7 helpers -------------------------------------------------------

/** Shift+press and release on an object: add it to, or remove it from, the set. */
export function shiftClickAt(el: HTMLElement, x = 20, y = 20): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: true });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: true });
}

export interface DragSteps {
  shiftKey?: boolean;
  /** Pointer events to send between the ends (default: one step past the middle). */
  steps?: Point[];
  /** Stop before the release: the caller ends the gesture itself. */
  hold?: boolean;
}

/**
 * Press at `from`, move through `steps`, release at `to` — all in screen pixels
 * on the given element. The transform gesture listens on `window`, and these
 * events bubble there, which is exactly how a real drag reaches it.
 */
export function dragOn(
  el: HTMLElement,
  from: Point,
  to: Point,
  options: DragSteps = {},
): void {
  const steps = options.steps ?? [
    { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    to,
  ];
  const init = { button: 0, pointerId: 3, ...(options.shiftKey ? { shiftKey: true } : {}) };
  fireEvent.pointerDown(el, { ...init, clientX: from.x, clientY: from.y });
  for (const step of steps) {
    fireEvent.pointerMove(el, { ...init, clientX: step.x, clientY: step.y });
  }
  if (!options.hold) {
    fireEvent.pointerUp(el, { ...init, clientX: to.x, clientY: to.y });
  }
}

/** Shift+drag on the board surface: the marquee. */
export function marqueeOn(
  el: HTMLElement,
  from: Point,
  to: Point,
  options: { hold?: boolean } = {},
): void {
  dragOn(el, from, to, { shiftKey: true, hold: options.hold });
}

/**
 * The ids currently showing a selection outline, sorted.
 *
 * Sorted because DOM order is *creation* order, and notes created inside one
 * millisecond fall back to their id — a test comparing to the order it happened
 * to create them in would be comparing the wrong thing. Selection is a set.
 */
export function selectedIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-selected="true"]')]
    .map((el) => el.dataset.noteId ?? el.dataset.testboxId ?? '')
    .filter(Boolean)
    .sort();
}

/**
 * A second document standing in for another person: the same handshake a
 * provider performs, so the change arrives as an incoming transaction whose
 * origin is not `LOCAL_ORIGIN`. Shared with the unit tests (`tests/peerDoc.ts`).
 */
export { withPeer } from '../peerDoc';

/**
 * Run `fn`, then make sure the change it made cannot merge with the step before
 * or after it (`undo.boundaries`).
 *
 * The capture window can only be closed by the history itself: yjs ignores a
 * transaction whose origin is not tracked, so an empty "boundary" transaction
 * from a test origin does nothing. The helper therefore takes the controller the
 * test created and calls `boundary()` on both sides of the action.
 */
export function undoBoundary(history: UndoController, fn?: () => void): void {
  history.boundary();
  try {
    fn?.();
  } finally {
    history.boundary();
  }
}
