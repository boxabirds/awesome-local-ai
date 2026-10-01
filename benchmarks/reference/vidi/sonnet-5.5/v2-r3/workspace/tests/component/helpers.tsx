import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

export const viewport = () => screen.getByTestId('board-viewport');
export const notes = () => screen.queryAllByRole('group', { name: 'Sticky note' });

export function flush() {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

/** Double-click empty board space; returns the created note element. */
export function createByDblClick(x = 400, y = 300) {
  const before = new Set(notes());
  fireEvent.doubleClick(viewport(), { clientX: x, clientY: y });
  const created = notes().find((n) => !before.has(n));
  if (!created) throw new Error('no note created');
  return created;
}

export function press(el: Element, x = 0, y = 0, pointerId = 1) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId });
}
export function moveTo(el: Element, x: number, y: number, pointerId = 1) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId });
}
export function release(el: Element, x = 0, y = 0, pointerId = 1) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId });
}

/** Click a note (press + release without movement), then click-away to end editing from creation. */
export function clickNote(el: Element) {
  press(el, 10, 10);
  release(el, 10, 10);
}

export function clickEmptyBoard(x = 5, y = 5) {
  fireEvent.pointerDown(viewport(), { clientX: x, clientY: y, button: 0, pointerId: 9 });
  fireEvent.pointerUp(viewport(), { clientX: x, clientY: y, pointerId: 9 });
}
