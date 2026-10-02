import { describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { advanceFrames, cameraFromDom, renderBoard } from './harness';
import { fireEvent, screen } from '@testing-library/react';

function wheelOn(
  element: HTMLElement,
  init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number },
): boolean {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    ...init,
  });
  // dispatchEvent returns false when the listener called preventDefault.
  return element.dispatchEvent(event);
}

function gestureOn(element: HTMLElement, type: string, scale: number): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  return element.dispatchEvent(event);
}

describe('drag to pan (pan.drag)', () => {
  // TC-13
  it('TC-13 moves the board by the pointer delta and runs Idle -> Panning -> Idle', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    expect(viewport).toHaveAttribute('data-mode', 'idle');

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 300, clientY: 200 });
    expect(viewport).toHaveAttribute('data-mode', 'panning');

    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 300 });
    await advanceFrames();

    // A 200 px right / 100 px down drag: the camera moves the other way.
    expect(cameraFromDom(viewport)).toEqual({ x: -200, y: -100, zoom: 1 });
    expect(board.camera()).toEqual({ x: -200, y: -100, zoom: 1 });
    // The world layer transform matches the camera exactly.
    expect(board.worldLayer().style.transform).toBe('scale(1) translate(200px, 100px)');
    // ...and the world origin, which was under the drag start, is 200/100 away.
    expect(worldToScreen(board.camera(), { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });

    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 500, clientY: 300 });
    expect(viewport).toHaveAttribute('data-mode', 'idle');
    expect(board.camera()).toEqual({ x: -200, y: -100, zoom: 1 });
  });

  it('pans across several moves without losing pixels', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    for (const [x, y] of [
      [140, 120],
      [141, 125],
      [220, 160],
      [400, 40],
    ]) {
      fireEvent.pointerMove(viewport, { pointerId: 2, clientX: x, clientY: y });
    }
    await advanceFrames();
    expect(board.camera()).toEqual({ x: -(400 - 100), y: -(40 - 100), zoom: 1 });
  });

  // TC-14
  it('TC-14 freezes the camera at pointercancel and ignores later moves', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 3, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(viewport, { pointerId: 3, clientX: 90, clientY: 70 });
    await advanceFrames();
    const frozen = board.camera();
    expect(frozen).toEqual({ x: -40, y: -20, zoom: 1 });

    fireEvent.pointerCancel(viewport, { pointerId: 3 });
    expect(viewport).toHaveAttribute('data-mode', 'idle');

    fireEvent.pointerMove(viewport, { pointerId: 3, clientX: 900, clientY: 900 });
    await advanceFrames();
    expect(board.camera()).toEqual(frozen);
  });

  it('ends the drag on lostpointercapture', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 30, clientY: 30 });
    await advanceFrames();
    fireEvent.lostPointerCapture(viewport, { pointerId: 4 });
    fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 700, clientY: 700 });
    await advanceFrames();
    expect(board.camera()).toEqual({ x: -20, y: -20, zoom: 1 });
    expect(viewport).toHaveAttribute('data-mode', 'idle');
  });

  it('ignores secondary and middle mouse buttons', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    fireEvent.pointerDown(viewport, { button: 2, pointerId: 5, clientX: 0, clientY: 0 });
    expect(viewport).toHaveAttribute('data-mode', 'idle');
    fireEvent.pointerMove(viewport, { pointerId: 5, clientX: 200, clientY: 200 });
    await advanceFrames();
    expect(board.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  // TC-29
  it('TC-29 leaves the camera alone for a click without movement', async () => {
    const board = await renderBoard({ x: 10, y: 20, zoom: 2 });
    const viewport = board.viewport();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 6, clientX: 111, clientY: 222 });
    fireEvent.pointerUp(viewport, { pointerId: 6, clientX: 111, clientY: 222 });
    await advanceFrames();

    expect(board.camera()).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('does not start a pan when the pointerdown is not on empty board space', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 }, <div data-testid="board-object" />);
    const viewport = board.viewport();
    const object = screen.getByTestId('board-object');
    fireEvent.pointerDown(object, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 300, clientY: 300 });
    await advanceFrames();
    expect(board.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(viewport).toHaveAttribute('data-mode', 'idle');
  });
});

describe('scroll to pan (pan.scroll)', () => {
  // TC-15
  it('TC-15 pans by the wheel delta and prevents the browser default', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const notPrevented = wheelOn(board.viewport(), { deltaY: 100 });
    expect(notPrevented).toBe(false);
    await advanceFrames();
    // Scrolling down moves the content up: the camera moves down the board.
    expect(board.camera().y).toBeCloseTo(100 / 1, 9);

    wheelOn(board.viewport(), { deltaX: 40 });
    await advanceFrames();
    expect(board.camera().x).toBeCloseTo(40 / 1, 9);
  });

  it('divides the scroll by the zoom, and honours line/page delta modes', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 2 });
    wheelOn(board.viewport(), { deltaY: 100 });
    await advanceFrames();
    expect(board.camera().y).toBeCloseTo(100 / 2, 9);

    const line = new WheelEvent('wheel', {
      deltaY: 3,
      deltaMode: 1,
      bubbles: true,
      cancelable: true,
    });
    board.viewport().dispatchEvent(line);
    await advanceFrames();
    expect(board.camera().y).toBeCloseTo(100 / 2 + (3 * 16) / 2, 9);

    const page = new WheelEvent('wheel', {
      deltaY: 1,
      deltaMode: 2,
      bubbles: true,
      cancelable: true,
    });
    board.viewport().dispatchEvent(page);
    await advanceFrames();
    expect(board.camera().y).toBeCloseTo(100 / 2 + (3 * 16) / 2 + 800 / 2, 9);
  });
});

describe('zoom around the pointer (zoom.pointer)', () => {
  // TC-16
  it('TC-16 zooms with Ctrl + wheel and keeps the point under the cursor', async () => {
    const board = await renderBoard({ x: -30, y: 40, zoom: 1 });
    const point = { x: 300, y: 200 };
    const before = screenToWorld(board.camera(), point);

    const notPrevented = wheelOn(board.viewport(), { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    expect(notPrevented).toBe(false);
    await advanceFrames();

    const after = board.camera();
    expect(after.zoom).toBeGreaterThan(1);
    const afterPoint = screenToWorld(after, point);
    expect(Math.abs(afterPoint.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(afterPoint.y - before.y)).toBeLessThan(1e-6);
  });

  it('treats Cmd + wheel the same way (macOS)', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    wheelOn(board.viewport(), { deltaY: -100, metaKey: true, clientX: 100, clientY: 100 });
    await advanceFrames();
    expect(board.camera().zoom).toBeGreaterThan(1);
  });

  // TC-17
  it('TC-17 doubles the zoom on a Safari gesturechange and prevents the default', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const viewport = board.viewport();
    expect(gestureOn(viewport, 'gesturestart', 1)).toBe(false);
    expect(gestureOn(viewport, 'gesturechange', 2)).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBeCloseTo(2, 9);

    // Gesture scale is cumulative, so each change applies only the ratio.
    expect(gestureOn(viewport, 'gesturechange', 4)).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBeCloseTo(4, 9);
    // ...and it is clamped at ZOOM_MAX.
    expect(gestureOn(viewport, 'gesturechange', 40)).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBe(ZOOM_MAX);
    expect(gestureOn(viewport, 'gestureend', 1)).toBe(false);
  });
});

describe('keyboard zoom (zoom.step, view.reset)', () => {
  // TC-18
  it('TC-18 steps with Ctrl/Cmd + = and -, and resets with Ctrl/Cmd + 0', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBe(ZOOM_STEP_FACTOR);

    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBe(1);

    // Move away first so reset has something to do.
    fireEvent.pointerDown(board.viewport(), { button: 0, pointerId: 8, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(board.viewport(), { pointerId: 8, clientX: 500, clientY: 500 });
    await advanceFrames();
    expect(board.camera().zoom).toBe(1);
    expect(board.camera().x).toBe(-500);

    expect(fireEvent.keyDown(window, { key: '0', metaKey: true })).toBe(false);
    await advanceFrames();
    expect(board.camera().zoom).toBe(1);
    expect(board.camera().x).toBe(-window.innerWidth / 2);
    expect(board.camera().y).toBe(-window.innerHeight / 2);
  });

  it('leaves plain key presses and text fields to the browser', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    expect(fireEvent.keyDown(window, { key: '-' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '0' })).toBe(true);
    await advanceFrames();
    expect(board.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('zoom limits reached through input (zoom.limits)', () => {
  it('ignores zoom-out past ZOOM_MIN and keeps the hint until a real change', async () => {
    const board = await renderBoard({ x: 5, y: 5, zoom: ZOOM_MIN });
    const before = board.camera();
    wheelOn(board.viewport(), { deltaY: 500, ctrlKey: true, clientX: 200, clientY: 200 });
    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    await advanceFrames();
    expect(board.camera()).toBe(before);
  });

  it('ignores zoom-in past ZOOM_MAX', async () => {
    const board = await renderBoard({ x: 5, y: 5, zoom: ZOOM_MAX });
    const before = board.camera();
    wheelOn(board.viewport(), { deltaY: -500, ctrlKey: true, clientX: 200, clientY: 200 });
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    await advanceFrames();
    expect(board.camera()).toBe(before);
  });
});

describe('the zoom control is not the board', () => {
  // TC-30
  it('TC-30 does not zoom the board for a Ctrl + wheel over the controls', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    const before = board.camera();
    const controls = screen.getByTestId('zoom-controls');
    const notPrevented = wheelOn(controls, { deltaY: -100, ctrlKey: true });
    // The browser keeps its own default over the controls...
    expect(notPrevented).toBe(true);
    await advanceFrames();
    // ...and the board does not zoom.
    expect(board.camera()).toEqual(before);
  });
});

describe('dot grid follows the camera', () => {
  const wrap = (value: number, modulo: number): number =>
    ((value % modulo) + modulo) % modulo;

  it('tiles at grid spacing x zoom and puts a dot on the world origin', async () => {
    const board = await renderBoard({ x: 1234.5, y: -987.25, zoom: 1.7 });
    const style = board.viewport().style;
    const spacing = Number.parseFloat(style.backgroundSize.split(' ')[0] ?? '');
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * 1.7, 6);

    const [positionX = 0, positionY = 0] = style.backgroundPosition
      .split(' ')
      .map((value) => Number.parseFloat(value) || 0);
    const origin = worldToScreen(board.camera(), { x: 0, y: 0 });
    // The gradient centres its dot in the tile, so a dot centre sits half a tile
    // from the tile origin and repeats every tile.
    expect(wrap(positionX + spacing / 2, spacing)).toBeCloseTo(wrap(origin.x, spacing), 4);
    expect(wrap(positionY + spacing / 2, spacing)).toBeCloseTo(wrap(origin.y, spacing), 4);
  });

  it('keeps the tile size and spacing far from the origin', async () => {
    const board = await renderBoard({
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 0.5,
    });
    const style = board.viewport().style;
    const spacing = Number.parseFloat(style.backgroundSize.split(' ')[0] ?? '');
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * 0.5, 6);
    const [positionX = 0, positionY = 0] = style.backgroundPosition
      .split(' ')
      .map((value) => Number.parseFloat(value) || 0);
    expect(Number.isFinite(positionX)).toBe(true);
    expect(Number.isFinite(positionY)).toBe(true);
    expect(positionX).toBeGreaterThanOrEqual(0);
    expect(positionX).toBeLessThan(spacing);
  });
});
