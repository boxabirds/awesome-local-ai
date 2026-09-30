import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Board } from '../../src/client/board/Board';
import type { Camera } from '../../src/client/canvas/camera';

export const FRAME_MS = 16;

export function useFakeFrames() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
}

/** Flush the requestAnimationFrame-coalesced camera update. */
export function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

/** A well-formed board id for tests that render the board directly. */
export const TEST_BOARD_ID = 'AbCdEfGhIjKlMnOpQr_-09';

/** Renders the stories 1–4 board (what BoardPage shows once the board exists). */
export function renderApp(boardId = TEST_BOARD_ID) {
  const utils = render(<Board boardId={boardId} />);
  const viewport = screen.getByTestId('board-viewport');
  return { ...utils, viewport };
}

export function readCamera(viewport: HTMLElement): Camera {
  return {
    x: Number(viewport.dataset.cameraX),
    y: Number(viewport.dataset.cameraY),
    zoom: Number(viewport.dataset.cameraZoom),
  };
}

/** The App's board document, via the test-mode hook. */
export function boardDoc() {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.doc;
}

/** Runs a board-model call against the App's document inside act(). */
export function model<T>(fn: (doc: import('yjs').Doc) => T): T {
  let result: T;
  act(() => {
    result = fn(boardDoc());
  });
  return result!;
}

export function noteElements(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not rendered`);
  return el;
}

export function noteToolbar(): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: 'Note' });
}

/** Press and release on an element at one point (a click with no movement). */
export function press(el: Element, at = { clientX: 100, clientY: 100 }, pointerId = 1) {
  fireEvent.pointerDown(el, { pointerId, button: 0, ...at });
  fireEvent.pointerUp(el, { pointerId, ...at });
}

export function keyDown(target: EventTarget, key: string) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}
