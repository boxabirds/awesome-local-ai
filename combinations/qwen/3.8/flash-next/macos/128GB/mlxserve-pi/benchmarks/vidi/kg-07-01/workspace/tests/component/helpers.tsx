import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshot } from '../../src/shared/board-model';

export const FRAME_MS = 16;

export function renderBoard() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const utils = render(<BoardViewport />);
  const viewport = screen.getByTestId('board-viewport');
  const world = screen.getByTestId('board-world');
  return { ...utils, viewport, world };
}

export function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.getCamera();
}

export function setCamera(cam: Camera) {
  act(() => window.__vidi6!.setCamera(cam));
}

/** Advance one animation frame so batched camera updates render. */
export function nextFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export function pointer(el: Element, type: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, pointerId = 1) {
  const init = { clientX: x, clientY: y, pointerId, button: 0, buttons: type === 'up' ? 0 : 1 };
  act(() => {
    if (type === 'down') fireEvent.pointerDown(el, init);
    if (type === 'move') fireEvent.pointerMove(el, init);
    if (type === 'up') fireEvent.pointerUp(el, init);
    if (type === 'cancel') fireEvent.pointerCancel(el, init);
  });
}

/** Dispatches an event and returns whether the default was prevented. */
export function dispatchPrevented(target: EventTarget, event: Event): boolean {
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Renders the whole app on a fresh (or given) real Y.Doc, with animation frames under test control. */
export function renderApp(doc: Y.Doc = new Y.Doc()) {
  // Only frames are faked: Testing Library's async helpers (user-event) need a real setTimeout.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const utils = render(<App doc={doc} />);
  const viewport = screen.getByTestId('board-viewport');
  return { ...utils, doc, viewport };
}

export function noteElements(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not rendered`);
  return el;
}

export function note(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

/** Press and release on an element without moving: a click as the note and board see it. */
export function press(el: Element, x = 10, y = 10) {
  pointer(el, 'down', x, y);
  pointer(el, 'up', x, y);
}

export function key(k: string, target: EventTarget = document.activeElement ?? document.body) {
  return dispatchPrevented(target, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** Counts Y.Doc update events while `fn` runs. */
export function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const onUpdate = () => n++;
  doc.on('update', onUpdate);
  try {
    fn();
  } finally {
    doc.off('update', onUpdate);
  }
  return n;
}
