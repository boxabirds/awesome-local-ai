import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { panBy, screenToWorld, zoomAt, type Camera } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { BoardHarness, INITIAL_CAMERA, applyToCamera, flushFrame } from './harness';
import {
  WHEEL_DELTA_MODE_LINE_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const POINTER = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };

let latest: CameraApi | undefined;

function renderBoard(children?: ReactNode) {
  render(<BoardHarness onApi={(api) => (latest = api)}>{children}</BoardHarness>);
  return {
    board: screen.getByTestId('board'),
    world: screen.getByTestId('board-world'),
    camera: () => {
      if (latest === undefined) throw new Error('camera API not captured');
      return latest;
    },
  };
}

function transformOf(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

function pointerDown(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { ...POINTER, clientX: x, clientY: y });
}

function pointerMove(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerMove(el, { ...POINTER, clientX: x, clientY: y });
}

function pointerUp(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerUp(el, { ...POINTER, clientX: x, clientY: y });
}

beforeEach(() => {
  latest = undefined;
});

describe('viewport.input — drag to pan', () => {
  it('TC-13 moves the board exactly with the pointer through Idle -> Panning -> Idle', async () => {
    const { board, world, camera } = renderBoard();
    expect(board.getAttribute('data-panning')).toBe('false');
    expect(world.style.transform).toBe(transformOf(INITIAL_CAMERA));

    pointerDown(board, 400, 300);
    expect(board.getAttribute('data-panning')).toBe('true');

    pointerMove(board, 600, 400);
    await flushFrame();

    const expected = panBy(INITIAL_CAMERA, 200, 100);
    expect(camera().camera).toEqual(expected);
    expect(world.style.transform).toBe(transformOf(expected));

    pointerUp(board, 600, 400);
    expect(board.getAttribute('data-panning')).toBe('false');

    // Idle: further movement of the pointer (buttons released) does nothing.
    pointerMove(board, 10, 10);
    await flushFrame();
    expect(camera().camera).toEqual(expected);
  });

  it('TC-14 keeps the camera where it was when the drag is interrupted, and ignores later moves', async () => {
    const { board, camera } = renderBoard();
    pointerDown(board, 400, 300);
    pointerMove(board, 500, 350);
    await flushFrame();
    const frozen = camera().camera;
    expect(frozen).toEqual(panBy(INITIAL_CAMERA, 100, 50));

    fireEvent.pointerCancel(board, { ...POINTER, clientX: 500, clientY: 350 });
    expect(board.getAttribute('data-panning')).toBe('false');

    pointerMove(board, 900, 900);
    await flushFrame();
    expect(camera().camera).toEqual(frozen);
  });

  it('ends the drag on lostpointercapture', async () => {
    const { board, camera } = renderBoard();
    pointerDown(board, 400, 300);
    pointerMove(board, 500, 350);
    await flushFrame();
    const frozen = camera().camera;

    fireEvent(board, new Event('lostpointercapture', { bubbles: true }));
    expect(board.getAttribute('data-panning')).toBe('false');

    pointerMove(board, 900, 900);
    await flushFrame();
    expect(camera().camera).toEqual(frozen);
  });

  it('TC-29 ignores a click without movement (camera unchanged, hint not dismissed)', async () => {
    const { board, camera } = renderBoard();
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();

    pointerDown(board, 400, 300);
    pointerUp(board, 400, 300);
    await flushFrame();

    expect(camera().camera).toEqual(INITIAL_CAMERA);
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();
  });

  it('ignores presses on board content rather than empty board space', async () => {
    const { board, camera } = renderBoard(
      <div data-testid="object" style={{ position: 'absolute', left: 10, top: 10, width: 20, height: 20 }} />,
    );
    const object = screen.getByTestId('object');
    fireEvent.pointerDown(object, { ...POINTER, clientX: 400, clientY: 300 });
    expect(board.getAttribute('data-panning')).toBe('false');
    pointerMove(board, 600, 400);
    await flushFrame();
    expect(camera().camera).toEqual(INITIAL_CAMERA);
  });
});

describe('viewport.input — wheel', () => {
  it('TC-15 pans by a plain wheel delta and swallows the event', async () => {
    const { board, camera } = renderBoard();
    const event = new WheelEvent('wheel', { deltaY: 100, deltaX: 0, cancelable: true, bubbles: true });

    board.dispatchEvent(event);
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    expect(camera().camera.y).toBeCloseTo(INITIAL_CAMERA.y + 100 / INITIAL_CAMERA.zoom, 6);
    expect(camera().camera.x).toBeCloseTo(INITIAL_CAMERA.x, 6);
    expect(camera().camera.zoom).toBe(INITIAL_CAMERA.zoom);
  });

  it('TC-15 pans horizontally with a trackpad wheel delta', async () => {
    const { board, camera } = renderBoard();
    const event = new WheelEvent('wheel', { deltaY: 0, deltaX: 60, cancelable: true, bubbles: true });

    board.dispatchEvent(event);
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    expect(camera().camera.x).toBeCloseTo(INITIAL_CAMERA.x + 60, 6);
  });

  it('converts line-mode wheel deltas to pixels', async () => {
    const { board, camera } = renderBoard();
    const event = new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true, bubbles: true });

    board.dispatchEvent(event);
    await flushFrame();

    expect(camera().camera.y).toBeCloseTo(INITIAL_CAMERA.y + 3 * WHEEL_DELTA_MODE_LINE_PX, 6);
  });

  it('TC-16 zooms around the pointer with Ctrl + wheel and swallows the event', async () => {
    const { board, camera } = renderBoard();
    const pointer = { x: 300, y: 200 };
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
      cancelable: true,
      bubbles: true,
    });

    board.dispatchEvent(event);
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    const factor = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    const expected = zoomAt(INITIAL_CAMERA, pointer, factor);
    expect(camera().camera.zoom).toBeGreaterThan(1);
    expect(camera().camera.zoom).toBeCloseTo(expected.zoom, 10);
    // The board point under the pointer did not move.
    const before = screenToWorld(INITIAL_CAMERA, pointer);
    const after = screenToWorld(camera().camera, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('does not zoom past ZOOM_MAX with a huge Ctrl + wheel delta', async () => {
    const { board, camera } = renderBoard();
    board.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100000, ctrlKey: true, cancelable: true, bubbles: true }),
    );
    await flushFrame();
    expect(camera().camera.zoom).toBe(ZOOM_MAX);
  });
});

describe('viewport.input — Safari gesture', () => {
  it('TC-17 doubles the zoom on gesturechange and swallows the event', async () => {
    const { board, camera } = renderBoard();
    const event = new Event('gesturechange', { cancelable: true, bubbles: true });
    Object.assign(event, { scale: 2, rotation: 0, clientX: 300, clientY: 200 });

    board.dispatchEvent(event);
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    expect(camera().camera.zoom).toBeCloseTo(2, 10);
  });

  it('TC-17 clamps at ZOOM_MAX when the gesture scale is enormous', async () => {
    const { board, camera } = renderBoard();
    for (const scale of [2, 8, 100]) {
      const event = new Event('gesturechange', { cancelable: true, bubbles: true });
      Object.assign(event, { scale, rotation: 0, clientX: 300, clientY: 200 });
      board.dispatchEvent(event);
    }
    await flushFrame();
    expect(camera().camera.zoom).toBe(ZOOM_MAX);
  });
});

describe('viewport.input — keyboard shortcuts', () => {
  function pressKey(key: string, init: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
    window.dispatchEvent(event);
    return event;
  }

  it('TC-18 zooms in, zooms out and resets with Ctrl + = / - / 0, swallowing each key', async () => {
    const { camera } = renderBoard();

    expect(pressKey('=', { ctrlKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(camera().camera.zoom).toBe(ZOOM_STEP_FACTOR);

    expect(pressKey('-', { ctrlKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(camera().camera.zoom).toBe(1);

    // Zooming around the centre moves the camera away from the standard view.
    await applyToCamera(camera(), (api) => api.setCamera({ x: 12345, y: -54321, zoom: 3 }));
    expect(camera().camera).toEqual({ x: 12345, y: -54321, zoom: 3 });

    expect(pressKey('0', { ctrlKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(camera().camera).toEqual(INITIAL_CAMERA);
  });

  it('supports the Cmd equivalents and ignores plain keys', async () => {
    const { camera } = renderBoard();

    expect(pressKey('=', { metaKey: true }).defaultPrevented).toBe(true);
    await flushFrame();
    expect(camera().camera.zoom).toBe(ZOOM_STEP_FACTOR);

    expect(pressKey('=').defaultPrevented).toBe(false);
    expect(pressKey('=', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    await flushFrame();
    expect(camera().camera.zoom).toBe(ZOOM_STEP_FACTOR);
  });
});

describe('viewport.input — controls own their own wheel gestures (TC-30)', () => {
  it('TC-30 a Ctrl + wheel over the zoom control neither reaches the board nor is suppressed', async () => {
    const onZoomIn = vi.fn();
    const { camera } = renderBoard(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    let reached = false;
    const listener = () => {
      reached = true;
    };
    document.addEventListener('wheel', listener);

    const controls = screen.getByTestId('zoom-controls');
    const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    controls.dispatchEvent(event);
    await flushFrame();

    document.removeEventListener('wheel', listener);

    expect(reached).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(camera().camera).toEqual(INITIAL_CAMERA);
  });
});
