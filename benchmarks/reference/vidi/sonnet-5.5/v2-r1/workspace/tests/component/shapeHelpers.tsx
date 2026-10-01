import { fireEvent, screen } from '@testing-library/react';

export const key = (k: string) => fireEvent.keyDown(window, { key: k });
export const layer = () => screen.getByTestId('shape-tool-layer');
export const shapes = () => [...document.querySelectorAll<HTMLElement>('[data-shape-object]')];
/** Camera origin of the app in jsdom: the board starts with its origin centred in the window. */
export const origin = () => ({ x: -window.innerWidth / 2, y: -window.innerHeight / 2 });

export function box(el: HTMLElement) {
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
}

export function drag(el: Element, from: [number, number], to: [number, number], opts: { shiftKey?: boolean } = {}) {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], pointerId: 1, button: 0, ...opts });
  fireEvent.pointerMove(el, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1, ...opts });
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1, ...opts });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1, ...opts });
}

export function drawShape(from: [number, number], to: [number, number], kindLabel = 'Rectangle') {
  key('s');
  fireEvent.click(screen.getByRole('button', { name: kindLabel }));
  drag(layer(), from, to);
}
