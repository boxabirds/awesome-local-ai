import { act, fireEvent, screen, within } from '@testing-library/react';
import type * as Y from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { createSticky, getStickyText } from '../../src/shared/board-model';

/** The live board document, exposed by <App/> in test mode. */
export function boardDoc(): Y.Doc {
  const d = (window as unknown as { __vidi6Board?: Y.Doc }).__vidi6Board;
  if (!d) throw new Error('board doc test hook missing (render <App/> first)');
  return d;
}

export function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}
export function world(): HTMLElement {
  return screen.getByTestId('world-layer');
}
export function noteCount(): number {
  return screen.queryAllByRole('group', { name: 'Sticky note' }).length;
}
export function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`sticky-note-${id}`);
}
export function textEl(id: string): HTMLElement {
  return within(noteEl(id)).getByTestId('sticky-note-text');
}

export function readCamera(): Camera {
  const d = world().dataset;
  return { x: Number(d.x), y: Number(d.y), zoom: Number(d.zoom) };
}

/** Create a note straight through the model so the snapshot renders it. */
export function createNote(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(boardDoc(), { x, y });
  });
  return id;
}

/** Seed a note's text through the model. */
export function seedText(id: string, text: string): void {
  act(() => {
    getStickyText(boardDoc(), id)?.insert(0, text);
  });
}

export function pointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    el,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

export function doubleClick(el: Element, x = 0, y = 0): void {
  fireEvent(
    el,
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

/** Press a note and release without moving: selects it. */
export function clickNote(id: string): void {
  const el = noteEl(id);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

export function windowKey(key: string): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Dispatch a keydown on a specific element (bubbles to window). */
export function keyOn(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Set a textarea's value and fire `input` (our editor listens to onInput). */
export function inputInto(el: HTMLElement, value: string): void {
  const ta = el as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value } });
}

/** Click a swatch / toolbar button by accessible name. */
export function clickByRole(name: string): void {
  const btn = screen.getByRole('button', { name });
  fireEvent(
    btn,
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  fireEvent.click(btn);
}

export function noteSelected(id: string): boolean {
  return noteEl(id).getAttribute('data-selected') === 'true';
}
