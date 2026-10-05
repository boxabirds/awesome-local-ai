/**
 * Shared helpers for the jsdom component tests.
 *
 * jsdom has no layout and no pointer capture, so the board area is reported as
 * a fixed laptop viewport and gestures are dispatched as real events
 * (PointerEvent/WheelEvent/KeyboardEvent) through React's root listener.
 */

import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { Camera, Size } from '../../src/client/canvas/camera';

export const VIEWPORT_SIZE: Size = { width: 1280, height: 800 };
export const CENTRE = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };

/** The size jsdom pretends the board area has; change it with resizeBoardArea. */
let boardAreaSize: Size = { ...VIEWPORT_SIZE };

function rectFor(size: Size): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: size.width,
    bottom: size.height,
    width: size.width,
    height: size.height,
    toJSON: () => ({})
  } as DOMRect;
}

/** Make every element report the board area size, as real layout would. */
export function stubViewportGeometry(): void {
  boardAreaSize = { ...VIEWPORT_SIZE };
  Element.prototype.getBoundingClientRect = () => rectFor(boardAreaSize);
}

const observers = new Set<ResizeObserverStub>();

/** A ResizeObserver that reports the current size as soon as it observes. */
class ResizeObserverStub implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.callback([{ target, contentRect: rectFor(boardAreaSize) } as unknown as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {
    observers.delete(this);
  }
  trigger(): void {
    this.callback(
      [{ target: document.body, contentRect: rectFor(boardAreaSize) } as unknown as ResizeObserverEntry],
      this
    );
  }
}

export function stubResizeObserver(): void {
  observers.clear();
  class TrackedResizeObserver extends ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      observers.add(this);
    }
  }
  vi.stubGlobal('ResizeObserver', TrackedResizeObserver);
}

/** Grow or shrink the board area, as dragging a browser window would. */
export async function resizeBoardArea(size: Size): Promise<void> {
  boardAreaSize = size;
  await act(async () => {
    for (const observer of [...observers]) observer.trigger();
  });
}

/** The camera the board is currently showing (test hook, installed in test mode). */
export function testCamera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('window.__vidi6 test hooks are not installed');
  return hooks.getCamera();
}

/** Jump the camera somewhere without dragging a million pixels. */
export async function setTestCamera(camera: Camera): Promise<void> {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('window.__vidi6 test hooks are not installed');
  hooks.setCamera(camera);
  await flushCameraFrame();
}

/** Let the requestAnimationFrame-coalesced camera update land. */
export async function flushCameraFrame(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
}

/** Run a synchronous interaction inside React's act(). */
export function interact(fn: () => void): void {
  act(() => {
    fn();
  });
}

interface PointerOptions {
  pointerId?: number;
  button?: number;
  shiftKey?: boolean;
}

/** Dispatch a pointer event (jsdom supports PointerEvent). */
export function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  clientX: number,
  clientY: number,
  options: PointerOptions = {}
): Event {
  const init = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    buttons: type === 'pointerdown' ? 1 : type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    isPrimary: true,
    pointerType: 'mouse',
    shiftKey: options.shiftKey ?? false
  };
  const event = new PointerEvent(type, init);
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

interface WheelOptions {
  ctrlKey?: boolean;
  metaKey?: boolean;
  deltaMode?: number;
}

export function fireWheel(
  target: Element,
  clientX: number,
  clientY: number,
  deltaX: number,
  deltaY: number,
  options: WheelOptions = {}
): Event {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaX,
    deltaY,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false
  });
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Safari's GestureEvent does not exist outside Safari; fake its few fields. */
export function fireGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  clientX?: number,
  clientY?: number
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, rotation: 0 });
  if (clientX !== undefined && clientY !== undefined) {
    Object.assign(event, { clientX, clientY });
  }
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function fireKey(key: string, options: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false
  });
  interact(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Read the world layer's CSS transform, which is how the board is positioned. */
export function worldTransform(container: HTMLElement): string {
  const world = container.querySelector<HTMLElement>('[data-vidi6="world"]');
  if (!world) throw new Error('world layer not found');
  return world.style.transform;
}

/** The transform string the board is expected to render for a camera. */
export function expectedWorldTransform(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

/** Grid background geometry, which is how the dot grid is positioned. */
export function gridBackground(container: HTMLElement): { size: string; position: string } {
  const viewport = container.querySelector<HTMLElement>('[data-vidi6="viewport"]');
  if (!viewport) throw new Error('viewport not found');
  return { size: viewport.style.backgroundSize, position: viewport.style.backgroundPosition };
}

export function viewportElement(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>('[data-vidi6="viewport"]');
  if (!viewport) throw new Error('viewport not found');
  return viewport;
}

export function byTestId(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}
