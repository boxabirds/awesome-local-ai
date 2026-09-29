// Shared helpers for ui-component tests (jsdom).
//
// - ResizeObserver is not implemented in jsdom; the mock records instances so
//   tests can drive the measured viewport size (1280x800 fixture).
// - requestAnimationFrame is faked via vi.useFakeTimers(); flushRaf() advances
//   one frame so rAF-coalesced camera updates render.

import { act, render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';

export const TEST_VIEWPORT_WIDTH = 1280;
export const TEST_VIEWPORT_HEIGHT = 800;

type Entry = { contentRect: { width: number; height: number } };

export class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  private readonly callback: (entries: Entry[]) => void;

  constructor(callback: (entries: Entry[]) => void) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  fire(width: number, height: number): void {
    act(() => {
      this.callback([{ contentRect: { width, height } }]);
    });
  }
}

export function installResizeObserverMock(): void {
  ResizeObserverMock.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

/**
 * Render the app at `path` (default: a board URL, so the board mounts as in
 * stories 1–4) and give the viewport its fixture size (1280x800). The path is
 * pushed before render; story 5's App is a route switch, so tests that need
 * the home / not-found pages pass the path explicitly.
 */
export async function renderApp(path: string = `/b/${MOCK_BOARD_ID}`): Promise<RenderResult> {
  window.history.pushState(null, '', path);
  const result = render(<App />);
  // Story 5: BoardPage checks the board's existence before mounting the
  // board (the mock resolves it); flush the 0-delay check under act so the
  // board is up when the test body runs. (Component tests use fake timers.)
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  const observer = ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1];
  if (observer !== undefined) observer.fire(TEST_VIEWPORT_WIDTH, TEST_VIEWPORT_HEIGHT);
  return result;
}

/** The board id used by renderApp's default path (valid 22-char code). */
export const MOCK_BOARD_ID = 'mockboardid1234567890a';

/** Advance one fake frame so a pending rAF camera update renders. */
export function flushRaf(): Promise<void> {
  return act(async () => {
    vi.advanceTimersByTime(16);
  });
}

export function viewportEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (el === null) throw new Error('board viewport not found');
  return el;
}

/** The world layer's inline transform, i.e. the rendered camera. */
export function worldTransform(container: HTMLElement): string {
  const el = container.querySelector<HTMLElement>('[data-testid="board-world"]');
  if (el === null) throw new Error('world layer not found');
  return el.style.transform;
}

export function expectedTransform(cam: Pick<Camera, 'x' | 'y' | 'zoom'>): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

/** jsdom has no PointerEvent constructor; React dispatches by event type. */
export function pointerEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
}

// UI interactions wrapped in act() so React state updates flush under fake
// timers (the scheduler cannot run its scheduled tasks while time is frozen).

export function dispatch(el: Element, event: Event): void {
  act(() => {
    el.dispatchEvent(event);
  });
}

export function click(el: Element): void {
  dispatch(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function keyOn(el: Element, key: string): void {
  dispatch(el, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

export function windowKey(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

export function inputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function drag(container: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const el = viewportEl(container);
  el.dispatchEvent(pointerEvent('pointerdown', from.x, from.y));
  el.dispatchEvent(pointerEvent('pointermove', to.x, to.y));
  el.dispatchEvent(pointerEvent('pointerup', to.x, to.y));
}
