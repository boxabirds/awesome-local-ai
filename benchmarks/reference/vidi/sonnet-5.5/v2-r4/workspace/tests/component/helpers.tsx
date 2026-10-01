import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';

export function setupBoard(notes: { x: number; y: number }[] = []) {
  const doc = new Y.Doc();
  const ids = notes.map((p) => createSticky(doc, p));
  render(<App doc={doc} />);
  return { doc, ids };
}

export function noteEls(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function noteEl(i = 0): HTMLElement {
  return noteEls()[i];
}

export function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function worldTransform(): string {
  return screen.getByTestId('world-layer').style.transform;
}

export function pointerDown(el: Element, x = 100, y = 100) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
}
export function pointerMove(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function pointerUp(el: Element, x = 100, y = 100) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

export function click(el: Element, x = 100, y = 100) {
  pointerDown(el, x, y);
  pointerUp(el, x, y);
}

export function frame() {
  return act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

export function first(doc: Y.Doc) {
  return snapshot(doc)[0];
}
