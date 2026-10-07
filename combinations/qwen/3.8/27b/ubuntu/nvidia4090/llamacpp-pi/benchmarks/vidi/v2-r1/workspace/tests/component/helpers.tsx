// Shared helpers for story 2 component tests: render the real <App />,
// create notes through the model, and drive pointer interactions.

import { render, fireEvent, type RenderResult } from '@testing-library/react';
import { act } from 'react';
import { App } from '../../src/client/App';
import {
  createSticky,
  deleteObject,
  getStickyText,
} from '../../src/shared/board-model';
import type { Vidi6NoteInfo, Vidi6TestHooks } from '../../src/client/testHooks';

export function renderApp(): RenderResult {
  return render(<App />);
}

export function hooks(): Vidi6TestHooks {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks not installed (import.meta.env.MODE !== "test")');
  return h;
}

/** Create a note through the model; returns its id. */
export function addNote(x = 0, y = 0): string {
  let id = '';
  act(() => {
    id = createSticky(hooks().doc, { x, y }) ?? '';
  });
  if (!id) throw new Error('createSticky failed');
  return id;
}

export function note(id: string): Vidi6NoteInfo | undefined {
  return hooks().getNotes().find((n) => n.id === id);
}

export function noteText(id: string): string | null {
  return getStickyText(hooks().doc, id)?.toString() ?? null;
}

/** Delete a note through the model (used to simulate a mid-interaction
 *  deletion, e.g. by another client in story 3). */
export function removeNote(id: string): void {
  act(() => {
    deleteObject(hooks().doc, id);
  });
}

/** A press (pointerdown + pointerup at the same point). */
export function click(el: Element, x = 10, y = 10): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

/**
 * Start a drag: pointerdown at (0,0), a sequence of pointer moves up to
 * (dx, dy). Returns the note's screen element.
 */
export function dragTo(el: Element, dx: number, dy: number, steps = 3): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
  for (let i = 1; i <= steps; i += 1) {
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: (dx * i) / steps,
      clientY: (dy * i) / steps,
      bubbles: true,
    });
  }
}

export function pointerUp(el: Element, x: number, y: number): void {
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

/** Let pending requestAnimationFrame callbacks (throttled drags) flush. */
export async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** Type into the focused editor (fires the input event React reads). */
export function typeIntoEditor(el: Element, value: string): void {
  fireEvent.input(el, { target: { value } });
}
