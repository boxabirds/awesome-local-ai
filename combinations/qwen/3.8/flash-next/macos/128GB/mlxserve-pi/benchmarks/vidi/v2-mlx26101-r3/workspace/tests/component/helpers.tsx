import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Camera, Size } from '../../src/client/canvas/camera';
import { setObservedSize } from './resizeObserver';

/** The board size reported by the ResizeObserver stub. */
export const VIEWPORT: Size = { width: 1280, height: 800 };

export interface BoardReadout extends Camera {
  readonly transform: string;
}

/** Let coalesced camera updates (one per animation frame) reach the DOM. */
export async function flushFrames(count = 1): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
  }
}

export interface MountedBoard {
  readonly board: HTMLElement;
  readonly world: HTMLElement;
  camera(): BoardReadout;
  gridStyle(): { size: string; position: string };
  resize(size: Size): Promise<void>;
}

/** Render the app, sized by the ResizeObserver stub, and settle the first frame. */
export async function mountBoard(): Promise<MountedBoard> {
  setObservedSize(VIEWPORT);
  const view = render(<App />);
  await flushFrames();
  const board = view.getByTestId('board-viewport');
  const world = view.getByTestId('world-layer');

  const camera = (): BoardReadout => {
    const raw = world.getAttribute('data-camera');
    if (raw === null) {
      throw new Error('world layer is missing its camera readout');
    }
    const [x, y, zoom] = raw.split(',').map(Number) as [number, number, number];
    return { x, y, zoom, transform: world.style.transform };
  };

  const gridStyle = (): { size: string; position: string } => {
    const grid = view.container.querySelector<HTMLElement>('.board-grid');
    if (grid === null) {
      throw new Error('grid layer is missing');
    }
    return { size: grid.style.backgroundSize, position: grid.style.backgroundPosition };
  };

  const resize = async (size: Size): Promise<void> => {
    setObservedSize(size);
    await flushFrames();
  };

  return { board, world, camera, gridStyle, resize };
}

/** Drag on empty board space from one screen point to another. */
export function drag(board: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, pointerId = 1): void {
  fireEvent.pointerDown(board, {
    pointerId,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(board, {
    pointerId,
    pointerType: 'mouse',
    buttons: 1,
    clientX: to.x,
    clientY: to.y,
  });
  fireEvent.pointerUp(board, {
    pointerId,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: to.x,
    clientY: to.y,
  });
}

export function wheel(board: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  board.dispatchEvent(event);
  return event;
}

export function gesture(type: string, init: { scale: number; clientX?: number; clientY?: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  return event;
}

export function dispatch(container: Element | Window, event: Event): void {
  container.dispatchEvent(event);
}

export function hint(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}
