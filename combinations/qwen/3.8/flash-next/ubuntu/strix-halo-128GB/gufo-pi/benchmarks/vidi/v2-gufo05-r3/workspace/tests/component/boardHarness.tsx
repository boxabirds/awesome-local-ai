import { afterEach, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';

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
