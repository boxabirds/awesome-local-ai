import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import { screenToWorld } from '../../src/client/canvas/camera';
import { renderBoard } from './harness';

/** The initial camera is the standard view: origin centred, 100% zoom. */
const INITIAL_CAMERA = { x: -640, y: -400, zoom: 1 };

// Camera updates are coalesced with requestAnimationFrame; each test uses
// fake timers and flushes the pending frame by advancing 16ms inside act.
afterEach(() => {
  vi.useRealTimers();
});

/** Flush the coalesced camera update (one animation frame). */
function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

/**
 * Dispatch an event and return it. (fireEvent returns dispatchEvent's
 * boolean, not the event, so build it with createEvent first.)
 */
function fireAndKeep(
  target: Element | Window,
  init: Record<string, unknown>,
  kind: 'wheel' | 'keydown',
): Event {
  const event = kind === 'wheel' ? createEvent.wheel(target, init) : createEvent.keyDown(target, init);
  fireEvent(target, event);
  return event;
}

describe('viewport.input (BoardViewport)', () => {
  it('TC-13: dragging moves the board exactly and cycles Idle -> Panning -> Idle', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    expect(readCamera()).toEqual(INITIAL_CAMERA);
    expect(viewport.style.cursor).toBe('grab'); // Idle

    fireEvent.pointerDown(viewport, { clientX: 400, clientY: 300 });
    expect(viewport.style.cursor).toBe('grabbing'); // Panning

    // Drag 200 right, 100 down: the board content moves exactly that far.
    fireEvent.pointerMove(viewport, { clientX: 600, clientY: 400 });
    flushFrame();
    expect(readCamera()).toEqual({ x: -840, y: -500, zoom: 1 });
    expect(viewport.style.cursor).toBe('grabbing'); // still Panning

    fireEvent.pointerUp(viewport, { clientX: 600, clientY: 400 });
    expect(viewport.style.cursor).toBe('grab'); // Idle
    expect(readCamera()).toEqual({ x: -840, y: -500, zoom: 1 });
  });

  it('TC-14: pointercancel mid-drag freezes the camera at the cancel point; later moves are ignored', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    fireEvent.pointerDown(viewport, { clientX: 400, clientY: 300 });
    fireEvent.pointerMove(viewport, { clientX: 500, clientY: 350 });
    flushFrame();
    const cameraAtCancel = readCamera();
    expect(cameraAtCancel).toEqual({ x: -740, y: -450, zoom: 1 });

    fireEvent.pointerCancel(viewport, { clientX: 500, clientY: 350 });
    expect(readCamera()).toEqual(cameraAtCancel);

    // The drag is over: further pointer moves must not move the board.
    fireEvent.pointerMove(viewport, { clientX: 900, clientY: 900 });
    flushFrame();
    expect(readCamera()).toEqual(cameraAtCancel);
  });

  it('TC-15: a plain wheel pans in the scroll direction and is defaultPrevented', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    const event = fireAndKeep(viewport, { clientX: 100, clientY: 100, deltaX: 0, deltaY: 100 }, 'wheel');
    expect(event.defaultPrevented).toBe(true);

    flushFrame();
    // Scrolling down moves content up: camera y increases by 100/zoom.
    expect(readCamera()).toEqual({ x: -640, y: -300, zoom: 1 });
  });

  it('TC-15b: a plain wheel with deltaX pans horizontally and is defaultPrevented', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    const event = fireAndKeep(viewport, { clientX: 100, clientY: 100, deltaX: 60, deltaY: 0 }, 'wheel');
    expect(event.defaultPrevented).toBe(true);

    flushFrame();
    // Scrolling right moves content left: camera x increases by 60/zoom.
    expect(readCamera()).toEqual({ x: -580, y: -400, zoom: 1 });
  });

  it('TC-16: a Ctrl wheel zooms in around the pointer and is defaultPrevented', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    const event = fireAndKeep(
      viewport,
      { clientX: 300, clientY: 200, deltaX: 0, deltaY: -100, ctrlKey: true },
      'wheel',
    );
    expect(event.defaultPrevented).toBe(true);

    flushFrame();
    const camera = readCamera();
    expect(camera.zoom).toBeGreaterThan(1);

    // The world point under the pointer stayed at the same screen position.
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(INITIAL_CAMERA, pointer);
    const after = screenToWorld(camera, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-17: a Safari gesturechange with scale 2 doubles the zoom (clamped) and is defaultPrevented', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const viewport = getByTestId('board-viewport');

    const start = new Event('gesturestart', { cancelable: true, bubbles: true });
    viewport.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    const change = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.assign(change, { scale: 2, clientX: 100, clientY: 100 });
    viewport.dispatchEvent(change);
    expect(change.defaultPrevented).toBe(true);

    flushFrame();
    expect(readCamera().zoom).toBe(2);
  });

  it('TC-18: Ctrl+= , Ctrl+- and Ctrl+0 step in, step out and reset; each is defaultPrevented', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();

    const zoomIn = fireAndKeep(window, { key: '=', ctrlKey: true }, 'keydown');
    expect(zoomIn.defaultPrevented).toBe(true);
    flushFrame();
    expect(readCamera().zoom).toBeCloseTo(1.25, 12);

    const zoomOut = fireAndKeep(window, { key: '-', ctrlKey: true }, 'keydown');
    expect(zoomOut.defaultPrevented).toBe(true);
    flushFrame();
    expect(readCamera().zoom).toBe(1);

    // Pan away, then Ctrl+0 returns to the standard view.
    fireAndKeep(getByTestId('board-viewport'), { deltaX: 0, deltaY: 300 }, 'wheel');
    flushFrame();
    expect(readCamera().y).toBe(-100);

    const reset = fireAndKeep(window, { key: '0', ctrlKey: true }, 'keydown');
    expect(reset.defaultPrevented).toBe(true);
    flushFrame();
    expect(readCamera()).toEqual(INITIAL_CAMERA);
  });

  it('TC-29: a click without moving leaves the camera unchanged and does not dismiss the hint', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard({ withHint: true });
    const viewport = getByTestId('board-viewport');

    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    fireEvent.pointerDown(viewport, { clientX: 400, clientY: 300 });
    fireEvent.pointerUp(viewport, { clientX: 400, clientY: 300 });
    flushFrame();

    expect(readCamera()).toEqual(INITIAL_CAMERA);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
  });

  it('TC-30: a Ctrl wheel over the zoom controls does not zoom the board and is not suppressed', () => {
    vi.useFakeTimers();
    const { getByTestId, readCamera } = renderBoard();
    const controls = getByTestId('zoom-controls');

    const event = fireAndKeep(
      controls,
      { clientX: 1200, clientY: 700, deltaX: 0, deltaY: -100, ctrlKey: true },
      'wheel',
    );
    flushFrame();

    expect(readCamera()).toEqual(INITIAL_CAMERA);
    // The board did not claim this event, so the browser default is intact.
    expect(event.defaultPrevented).toBe(false);
  });
});
