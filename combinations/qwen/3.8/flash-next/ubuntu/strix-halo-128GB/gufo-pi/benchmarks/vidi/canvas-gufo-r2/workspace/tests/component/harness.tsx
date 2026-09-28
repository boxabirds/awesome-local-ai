import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';

/**
 * Shared helpers for the jsdom component tests.
 *
 * The board coalesces camera writes into one animation frame, so tests fake
 * timers and advance a frame to observe the resulting render.
 */
export function startFakeFrames(): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
}

export function stopFakeFrames(): void {
  vi.useRealTimers();
}

/** Let pending camera updates render. */
export function flushFrames(count = 2): void {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
}

export interface BoardHarness {
  board: HTMLElement;
  world: HTMLElement;
  camera(): Camera;
  worldTransform(): string;
  zoomLabel(): string;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): void;
}

export function renderBoard(): BoardHarness {
  render(<App />);
  flushFrames();
  const board = screen.getByTestId('board');
  const world = screen.getByTestId('board-world');
  return {
    board,
    world,
    camera: () => ({
      x: Number(board.dataset.cameraX),
      y: Number(board.dataset.cameraY),
      zoom: Number(board.dataset.cameraZoom),
    }),
    worldTransform: () => String(world.style.transform),
    zoomLabel: () => screen.getByTestId('zoom-percent').textContent ?? '',
    drag: (from, to) => {
      fireEvent.pointerDown(board, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
      flushFrames();
      fireEvent.pointerMove(board, { pointerId: 1, clientX: to.x, clientY: to.y });
      flushFrames();
      fireEvent.pointerUp(board, { pointerId: 1, clientX: to.x, clientY: to.y });
      flushFrames();
    },
  };
}

/** Dispatch a cancelable event with extra (non-standard) properties attached. */
export function dispatchBoardEvent(
  target: HTMLElement,
  type: string,
  props: Record<string, unknown> = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
