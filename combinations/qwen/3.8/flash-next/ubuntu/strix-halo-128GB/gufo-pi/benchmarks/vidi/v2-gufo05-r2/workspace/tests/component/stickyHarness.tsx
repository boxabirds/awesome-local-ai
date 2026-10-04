import { act } from '@testing-library/react';
import type * as Y from 'yjs';

import { createSticky, getStickyText } from '../../src/shared/board-model';
import {
  fireKey,
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';

export { fireKey, firePointer, flushFrames, readCamera, surface };

/** Render the real app and return its live board document. */
export function renderApp(): Y.Doc {
  renderBoard();
  return readBoardDoc();
}

/** Create a note through the model (selects nothing). */
export function seedSticky(doc: Y.Doc, at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at);
  });
  flushFrames();
  return id;
}

/** Seed a note that already contains `text`. */
export function seedNoteWithText(
  doc: Y.Doc,
  text: string,
  at: { x: number; y: number } = { x: 0, y: 0 },
): string {
  const id = seedSticky(doc, at);
  act(() => {
    getStickyText(doc, id)?.insert(0, text);
  });
  flushFrames();
  return id;
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

export function textareaFor(id: string): HTMLTextAreaElement | null {
  const el = noteEl(id).querySelector('textarea');
  return el as HTMLTextAreaElement | null;
}

/** Short press (down + up at the same point) selects a note. */
export function clickNote(id: string, at = { x: 100, y: 100 }): void {
  const el = noteEl(id);
  firePointer(el, 'pointerdown', at.x, at.y);
  firePointer(el, 'pointerup', at.x, at.y);
  flushFrames();
}

export function dragNote(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const el = noteEl(id);
  firePointer(el, 'pointerdown', from.x, from.y);
  firePointer(el, 'pointermove', to.x, to.y);
  flushFrames();
}

export function dblClickNote(id: string, at = { x: 100, y: 100 }): void {
  const el = noteEl(id);
  const event = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  flushFrames();
}

/** Double-click empty board space at a screen point. */
export function dblClickSurface(at: { x: number; y: number }): void {
  const event = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    surface().dispatchEvent(event);
  });
  flushFrames();
}

/** Replace a textarea's value the way a browser paste/type would, then input. */
export function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  flushFrames();
}

/** Dispatch a keydown on a specific element (bubbles to window). */
export function pressKeyOn(el: EventTarget, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
  flushFrames();
}
