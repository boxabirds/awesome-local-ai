import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import { vi } from 'vitest';

export const POINTER_ID = 1;

/** Renders the whole app on a real Y.Doc the test can inspect and mutate. */
export function renderBoard(doc: Y.Doc = new Y.Doc()) {
  // Only animation frames are faked: Testing Library's async wrapper (used by
  // userEvent) needs a real setTimeout to settle.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const user = userEvent.setup();
  render(<App doc={doc} />);
  return { doc, user };
}

export function notes(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function noteEl(id: string): HTMLElement {
  const el = notes().find((n) => n.dataset.id === id);
  if (el === undefined) throw new Error(`note ${id} not rendered`);
  return el;
}

export function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function model(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

export function pointer(el: HTMLElement, type: PointerKind, p: Point): void {
  fireEvent[type](el, { clientX: p.x, clientY: p.y, pointerId: POINTER_ID, button: 0, buttons: 1 });
}

/** Press and release on an element without moving. */
export function click(el: HTMLElement, p: Point = { x: 10, y: 10 }): void {
  pointer(el, 'pointerDown', p);
  pointer(el, 'pointerUp', p);
  fireEvent.click(el, { clientX: p.x, clientY: p.y });
}

export function countUpdates(doc: Y.Doc): { count: number } {
  const state = { count: 0 };
  doc.on('update', () => {
    state.count += 1;
  });
  return state;
}

export function editor(): HTMLTextAreaElement | null {
  return screen.queryByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement | null;
}

export function inAct(fn: () => void): void {
  act(fn);
}
