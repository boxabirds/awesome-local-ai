import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHEEL_ZOOM_SENSITIVITY, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  panBy,
  resetCamera,
  screenToWorld,
  zoomAt,
} from '../../src/client/canvas/camera';
import {
  BoardHarness,
  TEST_VIEWPORT,
  cleanup,
  flushFrame,
  makeEvent,
  resetBoardForTests,
  transformOf,
  transformScale,
} from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
  resetBoardForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Dispatch a native event inside act so React state updates are flushed. */
function fire(target: EventTarget, type: string, props: Record<string, unknown>): Event {
  const event = makeEvent(type, props);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

describe('viewport.input (TC-13 to TC-18, TC-29, TC-30)', () => {
  it('TC-13 pointer drag pans the board and the state machine goes Idle -> Panning -> Idle', () => {
    render(<BoardHarness />);
    const vp = viewport();
    const world = worldLayer();

    // Idle: no panning class.
    expect(vp.className).not.toContain('is-panning');

    fire(vp, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 50,
    });
    // Panning: grabbing hand.
    expect(vp.className).toContain('is-panning');

    fire(vp, 'pointermove', { pointerId: 1, clientX: 300, clientY: 150 });
    flushFrame();

    const expected = panBy(resetCamera(TEST_VIEWPORT), 200, 100);
    expect(world.style.transform).toBe(transformOf(expected));

    fire(vp, 'pointerup', { pointerId: 1, clientX: 300, clientY: 150 });
    // Idle again.
    expect(vp.className).not.toContain('is-panning');
  });

  it('TC-14 a drag interrupted by pointercancel keeps the camera; later moves are ignored', () => {
    render(<BoardHarness />);
    const vp = viewport();
    const world = worldLayer();

    fire(vp, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 50,
    });
    fire(vp, 'pointermove', { pointerId: 1, clientX: 300, clientY: 150 });
    flushFrame();

    const atCancel = world.style.transform;
    expect(atCancel).toBe(transformOf(panBy(resetCamera(TEST_VIEWPORT), 200, 100)));

    fire(vp, 'pointercancel', { pointerId: 1 });
    flushFrame();
    expect(world.style.transform).toBe(atCancel);

    // A later move with no active drag must not move the board.
    fire(vp, 'pointermove', { pointerId: 1, clientX: 500, clientY: 500 });
    flushFrame();
    expect(world.style.transform).toBe(atCancel);
  });

  it('TC-15 a plain wheel scroll pans the board and the event is defaultPrevented', () => {
    render(<BoardHarness />);
    const world = worldLayer();

    const event = fire(viewport(), 'wheel', {
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      clientX: 0,
      clientY: 0,
    });
    flushFrame();

    // Scroll down: content moves up, i.e. camera y increases by 100/zoom.
    const expected = panBy(resetCamera(TEST_VIEWPORT), 0, -100);
    expect(world.style.transform).toBe(transformOf(expected));
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-16 a Ctrl wheel zooms and the event is defaultPrevented', () => {
    render(<BoardHarness />);
    const world = worldLayer();

    const event = fire(viewport(), 'wheel', {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    flushFrame();

    // factor = exp(-deltaY * S) = exp(1); the world point under the pointer
    // is invariant, so check both the zoom and that invariance.
    const factor = Math.exp(-(-100) * WHEEL_ZOOM_SENSITIVITY);
    expect(transformScale(world.style.transform)).toBeCloseTo(factor, 9);
    expect(event.defaultPrevented).toBe(true);

    const base = resetCamera(TEST_VIEWPORT);
    const before = screenToWorld(base, { x: 300, y: 200 });
    const after = screenToWorld(zoomAt(base, { x: 300, y: 200 }, factor), { x: 300, y: 200 });
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('TC-17 a Safari pinch (gesturechange) zooms by the scale ratio and is defaultPrevented', () => {
    render(<BoardHarness />);
    const world = worldLayer();

    const event = fire(viewport(), 'gesturechange', {
      scale: 2,
      clientX: 300,
      clientY: 200,
    });
    flushFrame();

    expect(transformScale(world.style.transform)).toBeCloseTo(2, 9);
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-18 Ctrl/Cmd + = / - / 0 zoom in, zoom out and reset, each defaultPrevented', () => {
    render(<BoardHarness />);
    const world = worldLayer();
    const label = screen.getByTestId('zoom-label');
    const base = resetCamera(TEST_VIEWPORT);

    const e1 = fire(window, 'keydown', { key: '=', ctrlKey: true });
    flushFrame();
    expect(transformScale(world.style.transform)).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(label.textContent).toBe('125%');
    expect(e1.defaultPrevented).toBe(true);

    const e2 = fire(window, 'keydown', { key: '-', ctrlKey: true });
    flushFrame();
    expect(transformScale(world.style.transform)).toBe(1);
    expect(label.textContent).toBe('100%');
    expect(e2.defaultPrevented).toBe(true);

    const e3 = fire(window, 'keydown', { key: '0', ctrlKey: true });
    flushFrame();
    expect(world.style.transform).toBe(transformOf(base));
    expect(e3.defaultPrevented).toBe(true);
  });

  it('TC-29 a click without moving leaves the camera unchanged and the hint visible', () => {
    render(<BoardHarness />);
    const vp = viewport();
    const world = worldLayer();

    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    fire(vp, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 50,
    });
    fire(vp, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });
    flushFrame();

    expect(world.style.transform).toBe(transformOf(resetCamera(TEST_VIEWPORT)));
    expect(screen.queryByTestId('navigation-hint')).toBeTruthy();
  });

  it('TC-30 a Ctrl wheel over the zoom controls does not zoom the board or suppress the default', () => {
    render(<BoardHarness />);
    const world = worldLayer();
    const controls = screen.getByTestId('zoom-controls');

    const event = fire(controls, 'wheel', {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 1200,
      clientY: 760,
    });
    flushFrame();

    expect(world.style.transform).toBe(transformOf(resetCamera(TEST_VIEWPORT)));
    expect(event.defaultPrevented).toBe(false);
  });
});
