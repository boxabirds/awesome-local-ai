import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, initDoc } from '../../src/shared/board-model';

export const FRAME_MS = 20;

export function flush() {
  act(() => { vi.advanceTimersByTime(FRAME_MS); });
}

export function pointer(type: string, el: Element, x: number, y: number) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

export function viewport() {
  return screen.getByTestId('board-viewport');
}

export function notes() {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function cameraTransform() {
  return screen.getByTestId('world-layer').style.transform;
}

/** Renders the app over a real doc seeded with notes centred at the given world points. */
export function renderApp(centres: Array<{ x: number; y: number }> = []) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = centres.map((c) => createSticky(doc, c));
  render(<App doc={doc} />);
  return { doc, ids };
}

export function click(el: Element, x = 0, y = 0) {
  pointer('pointerdown', el, x, y);
  pointer('pointerup', el, x, y);
}
