import { act, render } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { App } from '../../../src/client/App';
import { screenToWorld, worldToScreen, type Camera } from '../../../src/client/canvas/camera';
import { setWindowSize, VIEWPORT_FIXTURE } from '../setup';

export { setWindowSize };

export { VIEWPORT_FIXTURE };

export const ORIGIN_MARKER_SIZE_PX = 16;

/**
 * Render the real app so input handlers, camera state and controls are all wired,
 * then wait for the board to centre itself on its starting point (the first camera
 * change, which happens one animation frame after mount).
 */
export async function renderBoard(): Promise<void> {
  render(<App />);
  await vi.waitFor(() => {
    const cam = readCamera();
    if (cam.x !== -VIEWPORT_FIXTURE.width / 2 || cam.y !== -VIEWPORT_FIXTURE.height / 2) {
      throw new Error(`board has not centred itself yet: ${JSON.stringify(cam)}`);
    }
  });
  await flushFrames();
}

export function viewportElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="viewport"]');
  if (!element) throw new Error('viewport is not mounted');
  return element;
}

export function worldLayerElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="world-layer"]');
  if (!element) throw new Error('world layer is not mounted');
  return element;
}

export function zoomLabel(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="zoom-label"]');
  if (!element) throw new Error('zoom label is not mounted');
  return element;
}

export function buttonByLabel(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!element) throw new Error(`no button with aria-label "${label}"`);
  return element;
}

export function resetButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    'button[data-testid="reset-view"]',
  );
  if (!element) throw new Error('no Reset view button');
  return element;
}

/** The camera as rendered in the DOM. */
export function readCamera(): Camera {
  const element = viewportElement();
  const x = Number(element.dataset.cameraX);
  const y = Number(element.dataset.cameraY);
  const zoom = Number(element.dataset.cameraZoom);
  if (![x, y, zoom].every(Number.isFinite)) {
    throw new Error(`camera attributes are not numbers: ${element.outerHTML.slice(0, 200)}`);
  }
  return { x, y, zoom };
}

export function boardState(): string {
  return viewportElement().dataset.state ?? '';
}

export function worldTransform(): string {
  return worldLayerElement().style.transform;
}

/**
 * Camera updates are coalesced to one per animation frame; flush it and let React
 * re-render before asserting.
 */
export async function flushFrames(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

export async function waitForCamera(expected: (cam: Camera) => boolean): Promise<Camera> {
  let cam: Camera = readCamera();
  await vi.waitFor(() => {
    cam = readCamera();
    if (!expected(cam)) throw new Error(`camera still ${JSON.stringify(cam)}`);
  });
  return cam;
}

export function expectCameraCloseTo(actual: Camera, expected: Camera, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.zoom).toBeCloseTo(expected.zoom, digits);
}

/** Where the origin marker (and therefore the board's starting point) appears on screen. */
export function markerScreenPosition(cam: Camera): { x: number; y: number } {
  return worldToScreen(cam, { x: 0, y: 0 });
}

interface PointerOptions {
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch';
}

function dispatchPointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  options: PointerOptions = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  viewportElement().dispatchEvent(event);
  return event;
}

export function pointerDown(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointerdown', x, y, options);
}

export function pointerMove(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointermove', x, y, options);
}

export function pointerUp(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointerup', x, y, options);
}

export function pointerCancel(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointercancel', x, y, options);
}

/** Drag the board by (dx, dy) screen pixels, in steps, the way a mouse does. */
export async function dragBoard(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 4,
): Promise<void> {
  pointerDown(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    pointerMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await flushFrames();
  }
  pointerUp(to.x, to.y);
  await flushFrames();
}

export interface WheelResult {
  defaultPrevented: boolean;
}

export function wheel(
  options: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
  at: { x: number; y: number } = { x: VIEWPORT_FIXTURE.width / 2, y: VIEWPORT_FIXTURE.height / 2 },
  target: EventTarget = viewportElement(),
): WheelResult {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  });
  target.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

/** Safari's pinch gesture events, which jsdom does not implement. */
export function safariGesture(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  at: { x: number; y: number },
): { defaultPrevented: boolean } {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: at.x, clientY: at.y });
  viewportElement().dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

/**
 * The world point currently under a screen point, and where that same world point
 * lands after a camera change. Used to assert zoom keeps the pointer's spot fixed.
 */
/** The world point that a screen point currently points at. */
export function worldPointAt(cam: Camera, at: { x: number; y: number }): { x: number; y: number } {
  return screenToWorld(cam, at);
}

/** Where that world point is drawn after the camera changed. */
export function screenPointOf(cam: Camera, world: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(cam, world);
}
