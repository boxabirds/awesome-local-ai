import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';
import type { BoardTestHooks } from '../../src/client/canvas/testHooks';

/** The viewport size jsdom reports; the board fills the window. */
export const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/** The camera of a freshly loaded board: 100% with the world origin centred. */
export const homeCamera = (): Camera => ({
  x: -window.innerWidth / 2,
  y: -window.innerHeight / 2,
  zoom: 1,
});

export const testHooks = (): BoardTestHooks => {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not installed (MODE is not "test")');
  return hooks;
};

export const readCamera = (): Camera => testHooks().getCamera();

export const setCamera = (camera: Camera): void => {
  act(() => {
    testHooks().setCamera(camera);
  });
};

/** Camera updates are coalesced with requestAnimationFrame; flush them. */
export const advanceFrame = (): void => {
  act(() => {
    vi.advanceTimersByTime(32);
  });
};

/** Mount the app with fake timers so rAF-batched camera updates are deterministic. */
export const renderBoard = (element: ReactElement = <App />) => {
  vi.useFakeTimers();
  const utils = render(element);
  advanceFrame();
  return utils;
};

/** Dispatch a cancellable wheel event (React's onWheel is passive; ours is native). */
export const dispatchWheel = (target: Element, init: WheelEventInit): WheelEvent => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** Dispatch a Safari-style gesture event with the given scale. */
export const dispatchGesture = (
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: { x: number; y: number },
): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  target.dispatchEvent(event);
  return event;
};

/** Numbers inside a CSS `transform` value, e.g. `scale(z) translate(tx px, ty px)`. */
export const transformNumbers = (transform: string): number[] =>
  (transform.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/** Numbers inside a CSS `background-position` value. */
export const backgroundPositionNumbers = (element: Element): { x: number; y: number } => {
  const raw =
    (element as HTMLElement).style.backgroundPosition ||
    getComputedStyle(element).backgroundPosition;
  const numbers = (raw.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  return { x: numbers[0] ?? 0, y: numbers[1] ?? 0 };
};

/** Grid spacing in screen pixels, read from the rendered background-size. */
export const backgroundSpacingPixels = (element: Element): number => {
  const raw = (element as HTMLElement).style.backgroundSize || '';
  return Number((raw.match(/-?\d*\.?\d+/) ?? ['0'])[0]);
};
