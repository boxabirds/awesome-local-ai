import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../src/shared/config';
import {
  expectedTransform,
  flushRaf,
  installResizeObserverMock,
  pointerEvent,
  renderApp,
  viewportEl,
  worldTransform,
} from './helpers';

// Home camera after the 1280x800 fixture size: 100% centred on the origin.
const HOME = { x: -640, y: -400, zoom: 1 };

function key(type: string, keyName: string, modifiers: { ctrlKey?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key: keyName,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  window.dispatchEvent(event);
  return event;
}

function wheel(
  target: HTMLElement,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  } = {},
): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('viewport.input (BoardViewport)', () => {
  it('TC-13 drag pans the board exactly and cycles Idle -> Panning -> Idle', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    expect(worldTransform(container)).toBe(expectedTransform(HOME));
    expect(el.getAttribute('data-panning')).toBe('false');

    act(() => {
      el.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    });
    expect(el.getAttribute('data-panning')).toBe('true');

    act(() => {
      el.dispatchEvent(pointerEvent('pointermove', 300, 200));
    });
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform({ x: -840, y: -500, zoom: 1 }));

    act(() => {
      el.dispatchEvent(pointerEvent('pointerup', 300, 200));
    });
    expect(el.getAttribute('data-panning')).toBe('false');
    expect(worldTransform(container)).toBe(expectedTransform({ x: -840, y: -500, zoom: 1 }));
  });

  it('TC-14 pointercancel mid-drag freezes the camera; later moves are ignored', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);

    el.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    el.dispatchEvent(pointerEvent('pointermove', 200, 150));
    await flushRaf();
    const atCancel = worldTransform(container);
    expect(atCancel).toBe(expectedTransform({ x: -740, y: -450, zoom: 1 }));

    el.dispatchEvent(pointerEvent('pointercancel', 200, 150));
    el.dispatchEvent(pointerEvent('pointermove', 400, 300));
    await flushRaf();
    expect(worldTransform(container)).toBe(atCancel);
  });

  it('TC-15 a plain wheel pans and is always prevented', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    const event = wheel(el, { deltaX: 0, deltaY: 100 });
    expect(event.defaultPrevented).toBe(true);
    await flushRaf();
    // Content moves opposite to the scroll: camera y += 100 / zoom.
    expect(worldTransform(container)).toBe(expectedTransform({ x: -640, y: -300, zoom: 1 }));
  });

  it('TC-16 a Ctrl wheel zooms around the pointer and is prevented', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    const event = wheel(el, { deltaX: 0, deltaY: -100, clientX: 300, clientY: 200, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await flushRaf();
    const zoom = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    // World point under the pointer: (300 - 640, 200 - 400) = (-340, -200).
    const cam = { x: -340 - 300 / zoom, y: -200 - 200 / zoom, zoom };
    expect(worldTransform(container)).toBe(expectedTransform(cam));
  });

  it('TC-17 a Safari gesturechange zooms by the scale ratio and is prevented', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    const event = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(event, { scale: 2, clientX: 300, clientY: 200 });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform({ x: -490, y: -300, zoom: 2 }));
  });

  it('TC-18 Ctrl+= / Ctrl+- / Ctrl+0 step, unstep and reset (all prevented)', async () => {
    const { container } = await renderApp();

    const plus = key('keydown', '=', { ctrlKey: true });
    expect(plus.defaultPrevented).toBe(true);
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform({ x: -512, y: -320, zoom: 1.25 }));

    const minus = key('keydown', '-', { ctrlKey: true });
    expect(minus.defaultPrevented).toBe(true);
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform(HOME));

    const zero = key('keydown', '0', { ctrlKey: true });
    expect(zero.defaultPrevented).toBe(true);
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform(HOME));
  });

  it('TC-29 a click without moving leaves the camera and the hint untouched', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    expect(container.querySelector('[data-testid="nav-hint"]')).not.toBeNull();

    el.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    el.dispatchEvent(pointerEvent('pointerup', 100, 100));
    await flushRaf();

    expect(worldTransform(container)).toBe(expectedTransform(HOME));
    expect(container.querySelector('[data-testid="nav-hint"]')).not.toBeNull();
  });

  it('TC-30 a Ctrl wheel over the zoom controls does not zoom the board', async () => {
    const { container } = await renderApp();
    const controls = container.querySelector<HTMLElement>('[data-testid="zoom-controls"]');
    if (controls === null) throw new Error('zoom controls not found');
    wheel(controls, { deltaY: -100, clientX: 1200, clientY: 700, ctrlKey: true });
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform(HOME));
  });

  it('a plain Ctrl/Cmd-free wheel with deltaX pans horizontally', async () => {
    const { container } = await renderApp();
    const el = viewportEl(container);
    const event = wheel(el, { deltaX: -80, deltaY: 0 });
    expect(event.defaultPrevented).toBe(true);
    await flushRaf();
    // panBy(-deltaX, -deltaY): scrolling left moves content right (camera x -= 80).
    expect(worldTransform(container)).toBe(expectedTransform({ x: -720, y: -400, zoom: 1 }));
  });

  it('drag only starts when pressing on the viewport/grid itself', async () => {
    const { container } = await renderApp();
    const world = container.querySelector('[data-testid="board-world"]');
    if (world === null) throw new Error('world layer not found');
    world.dispatchEvent(pointerEvent('pointerdown', 100, 100));
    world.dispatchEvent(pointerEvent('pointermove', 300, 200));
    await flushRaf();
    expect(worldTransform(container)).toBe(expectedTransform(HOME));
  });
});
