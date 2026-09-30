// viewport.input: pointer drag, wheel/trackpad scroll, Ctrl+wheel and Safari
// gesture zoom, keyboard shortcuts, and the dot grid that travels with the
// board. Cases TC-13..TC-18, TC-29, TC-30.

import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { screen, fireEvent } from '@testing-library/react';
import {
  dragTo,
  flushFrames,
  gestureAt,
  gridGeometry,
  hintVisible,
  initialCamera,
  mode,
  pointerDown,
  pointerMove,
  pointerUp,
  pressKey,
  readCamera,
  renderBoard,
  useBoardTestLifecycle,
  wheelAt,
  worldTransform,
  zoomLabel,
} from './helpers';

useBoardTestLifecycle();

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

describe('board viewport input', () => {
  it('starts at 100% with the board start point centred', () => {
    renderBoard();
    expect(readCamera()).toEqual(initialCamera());
    expect(zoomLabel()).toBe('100%');
    expect(mode()).toBe('idle');
  });

  // TC-13: drag moves the board by exactly the pointer delta; Idle -> Panning -> Idle.
  it('TC-13 drags the board by exactly the pointer delta', () => {
    renderBoard();
    const before = readCamera();
    const gridBefore = gridGeometry();
    pointerDown({ x: 300, y: 300 });
    flushFrames();
    expect(mode()).toBe('panning');
    expect(viewportClassesPanning()).toBe(true);

    pointerMove({ x: 400, y: 350 });
    flushFrames();
    pointerMove({ x: 500, y: 400 });
    flushFrames();
    expect(readCamera().x).toBeCloseTo(before.x - 200, 6);
    expect(readCamera().y).toBeCloseTo(before.y - 100, 6);

    pointerUp({ x: 500, y: 400 });
    flushFrames();

    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 100, 6);
    expect(after.zoom).toBe(1);
    expect(mode()).toBe('idle');
    expect(viewportClassesPanning()).toBe(false);

    // the world layer is positioned with the camera
    const transform = worldTransform();
    expect(transform.scale).toBeCloseTo(after.zoom, 9);
    expect(transform.translateX).toBeCloseTo(-after.x, 6);
    expect(transform.translateY).toBeCloseTo(-after.y, 6);

    // the dot grid travels with the board: every dot moved by exactly the drag
    const spacing = GRID_SPACING_WORLD * after.zoom;
    expect(gridGeometry().spacing).toBeCloseTo(spacing, 9);
    expect(gridGeometry().offsetX).toBeCloseTo(modulo(gridBefore.offsetX + 200, spacing), 6);
    expect(gridGeometry().offsetY).toBeCloseTo(modulo(gridBefore.offsetY + 100, spacing), 6);
  });

  // TC-14: a drag interrupted by pointercancel leaves the board where it was.
  it('TC-14 freezes the camera at pointercancel and ignores later moves', () => {
    renderBoard();
    pointerDown({ x: 200, y: 200 });
    flushFrames();
    pointerMove({ x: 260, y: 240 });
    flushFrames();
    const frozen = readCamera();
    expect(frozen.x).toBeCloseTo(initialCamera().x - 60, 6);

    fireEvent.pointerCancel(viewportEl(), { pointerId: 1, clientX: 260, clientY: 240 });
    flushFrames();
    expect(mode()).toBe('idle');

    // a pointer that comes back must not move the board any more
    pointerMove({ x: 900, y: 700 });
    flushFrames();
    expect(readCamera()).toEqual(frozen);
  });

  // TC-15: a plain scroll moves the board in the scroll direction, both axes.
  it('TC-15 pans with a plain wheel scroll and prevents the page scrolling', () => {
    renderBoard();
    const before = readCamera();
    const event = wheelAt(viewportEl(), { deltaY: 100, clientX: 400, clientY: 300 });
    flushFrames();
    expect(event.defaultPrevented).toBe(true);
    const afterY = readCamera();
    // scroll down: content moves up, i.e. the camera moves down the board
    expect(afterY.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(afterY.x).toBeCloseTo(before.x, 6);
    expect(afterY.zoom).toBe(before.zoom);

    // scroll right: content moves left
    wheelAt(viewportEl(), { deltaX: 100, clientX: 400, clientY: 300 });
    flushFrames();
    expect(readCamera().x).toBeCloseTo(afterY.x + 100, 6);
  });

  it('TC-15b converts line and page wheel deltas to pixels', () => {
    renderBoard();
    const before = readCamera();
    wheelAt(viewportEl(), { deltaY: 2, deltaMode: 1, clientX: 200, clientY: 200 });
    flushFrames();
    expect(readCamera().y).toBeCloseTo(before.y + 2 * WHEEL_LINE_PX, 6);

    wheelAt(viewportEl(), { deltaY: 1, deltaMode: 2, clientX: 200, clientY: 200 });
    flushFrames();
    expect(readCamera().y).toBeCloseTo(before.y + 2 * WHEEL_LINE_PX + WHEEL_PAGE_PX, 6);
  });

  // TC-16: Ctrl/Cmd + wheel zooms the board around the pointer.
  it('TC-16 zooms around the pointer with a Ctrl wheel and prevents page zoom', () => {
    renderBoard();
    const before = readCamera();
    const point = { x: 300, y: 200 };
    const event = wheelAt(viewportEl(), { deltaY: -100, ctrlKey: true, clientX: point.x, clientY: point.y });
    flushFrames();
    expect(event.defaultPrevented).toBe(true);

    const after = readCamera();
    const factor = Math.exp(100 * WHEEL_ZOOM_SENSITIVITY);
    expect(after.zoom).toBeCloseTo(before.zoom * factor, 6);
    // the world point under the pointer did not move
    expect(screenToWorldish(after, point).x).toBeCloseTo(screenToWorldish(before, point).x, 6);
    expect(screenToWorldish(after, point).y).toBeCloseTo(screenToWorldish(before, point).y, 6);
  });

  // TC-17: Safari gesture events zoom the board and never the page.
  it('TC-17 doubles the zoom on a Safari gesturechange and prevents the default', () => {
    renderBoard();
    const before = readCamera();
    const point = { x: 300, y: 200 };
    const event = gestureAt(viewportEl(), 'gesturechange', 2, point);
    flushFrames();
    expect(event.defaultPrevented).toBe(true);
    const after = readCamera();
    expect(after.zoom).toBeCloseTo(before.zoom * 2, 6);
    expect(screenToWorldish(after, point)).toEqual(screenToWorldish(before, point));

    // successive gesturechange events zoom by the ratio between their scales
    const second = gestureAt(viewportEl(), 'gesturechange', 3, point);
    flushFrames();
    expect(second.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(after.zoom * (3 / 2), 6);
  });

  // TC-18: keyboard zoom steps and Reset view, each preventing the browser.
  it('TC-18 steps zoom and resets with Ctrl/Cmd keys', () => {
    renderBoard();
    const start = readCamera();
    expect(start.zoom).toBe(1);

    const in1 = pressKey('=', { ctrlKey: true });
    flushFrames();
    expect(in1.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomLabel()).toBe('125%');

    const out1 = pressKey('-', { ctrlKey: true });
    flushFrames();
    expect(out1.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(1);
    expect(zoomLabel()).toBe('100%');

    // pan away and zoom, then Cmd + 0 returns to the standard view
    dragTo({ x: 300, y: 300 }, { x: 900, y: 600 });
    pressKey('=', { metaKey: true });
    flushFrames();
    expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
    const moved = readCamera();
    expect(moved.x).not.toBe(start.x);

    const reset = pressKey('0', { metaKey: true });
    flushFrames();
    expect(reset.defaultPrevented).toBe(true);
    expect(readCamera()).toEqual(initialCamera());
    expect(zoomLabel()).toBe('100%');
  });

  it('TC-18b leaves shortcuts to the page when typing', () => {
    renderBoard();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const event = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    flushFrames();
    expect(event.defaultPrevented).toBe(false);
    expect(readCamera().zoom).toBe(1);
    input.remove();
  });

  // TC-29: pressing and releasing without moving changes nothing.
  it('TC-29 leaves the camera and the hint alone for a click without movement', () => {
    renderBoard();
    const before = readCamera();
    pointerDown({ x: 600, y: 400 });
    flushFrames();
    expect(mode()).toBe('panning');
    pointerUp({ x: 600, y: 400 });
    flushFrames();
    expect(mode()).toBe('idle');
    expect(readCamera()).toEqual(before);
    expect(hintVisible()).toBe(true);
    expect(zoomLabel()).toBe('100%');
  });

  // TC-30: gestures over the zoom control are UI, not board navigation.
  it('TC-30 does not zoom the board for a Ctrl wheel over the zoom control', () => {
    renderBoard();
    const before = readCamera();
    const control = screen.getByTestId('zoom-controls');
    const event = wheelAt(control, { deltaY: -100, ctrlKey: true, clientX: 1100, clientY: 700 });
    flushFrames();
    expect(readCamera()).toEqual(before);
    // the control does not swallow the browser default either
    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-30b ignores drags that start on UI instead of empty board space', () => {
    renderBoard();
    const before = readCamera();
    fireEvent.pointerDown(screen.getByTestId('zoom-controls'), {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 1100,
      clientY: 700,
    });
    flushFrames();
    expect(mode()).toBe('idle');
    fireEvent.pointerMove(viewportEl(), { pointerId: 3, clientX: 1200, clientY: 780 });
    flushFrames();
    expect(readCamera()).toEqual(before);
  });
});

/** screen -> world, computed in the test from the camera (mirrors camera.math). */
function screenToWorldish(cam: { x: number; y: number; zoom: number }, p: { x: number; y: number }) {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function viewportClassesPanning(): boolean {
  return viewportEl().className.includes('is-panning');
}
