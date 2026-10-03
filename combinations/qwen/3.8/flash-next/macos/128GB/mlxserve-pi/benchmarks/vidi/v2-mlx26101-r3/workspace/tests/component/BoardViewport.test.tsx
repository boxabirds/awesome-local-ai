import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { drag, flushFrames, gesture, mountBoard, wheel, VIEWPORT } from './helpers';

const EPSILON = 6; // decimal places for toBeCloseTo on values around 1e3

describe('board viewport input', () => {
  it('TC-13: dragging moves the board by exactly the pointer delta and returns to Idle', async () => {
    const { board, camera, gridStyle } = await mountBoard();
    const before = camera();
    // The standard view: 100% with the board's starting point centred.
    expect(before.zoom).toBe(1);
    expect(before.x).toBeCloseTo(-VIEWPORT.width / 2, EPSILON);
    expect(before.y).toBeCloseTo(-VIEWPORT.height / 2, EPSILON);
    expect(board.getAttribute('data-panning')).toBe('false');

    // Idle -> Panning
    fireEvent.pointerDown(board, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 500,
      clientY: 300,
    });
    expect(board.getAttribute('data-panning')).toBe('true');

    fireEvent.pointerMove(board, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 700,
      clientY: 400,
    });
    await flushFrames();

    const during = camera();
    expect(during.zoom).toBe(1);
    expect(during.x).toBeCloseTo(before.x - 200, EPSILON);
    expect(during.y).toBeCloseTo(before.y - 100, EPSILON);
    // The world layer transform matches the camera.
    expect(during.transform).toBe(`scale(${during.zoom}) translate(${-during.x}px, ${-during.y}px)`);
    // The dot grid moves with the board.
    expect(gridStyle().size).toBe(`${GRID_SPACING_WORLD * during.zoom}px ${GRID_SPACING_WORLD * during.zoom}px`);

    fireEvent.pointerUp(board, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 700,
      clientY: 400,
    });
    await flushFrames();
    // Panning -> Idle
    expect(board.getAttribute('data-panning')).toBe('false');
    expect(camera()).toEqual(during);
  });

  it('TC-14: pointercancel freezes the camera and later moves are ignored', async () => {
    const { board, camera } = await mountBoard();
    fireEvent.pointerDown(board, {
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerMove(board, {
      pointerId: 2,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 450,
      clientY: 420,
    });
    await flushFrames();
    const atCancel = camera();

    fireEvent.pointerCancel(board, { pointerId: 2, pointerType: 'mouse' });
    await flushFrames();
    expect(camera()).toEqual(atCancel);
    expect(board.getAttribute('data-panning')).toBe('false');

    fireEvent.pointerMove(board, {
      pointerId: 2,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 900,
      clientY: 900,
    });
    await flushFrames();
    expect(camera()).toEqual(atCancel);
  });

  it('TC-15: a plain wheel scrolls the board in the scroll direction', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();

    const down = wheel(board, { deltaY: 100, clientX: 640, clientY: 400 });
    await flushFrames();
    expect(down.defaultPrevented).toBe(true);
    expect(camera().y).toBeCloseTo(before.y + 100 / before.zoom, EPSILON);
    expect(camera().zoom).toBe(before.zoom);

    const right = wheel(board, { deltaX: 50, clientX: 640, clientY: 400 });
    await flushFrames();
    expect(right.defaultPrevented).toBe(true);
    // Scrolling right moves the board left: the camera advances in world x.
    expect(camera().x).toBeCloseTo(before.x + 50 / before.zoom, EPSILON);
  });

  it('TC-15b: wheel deltas reported in lines are converted to pixels', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();
    wheel(board, { deltaY: 3, deltaMode: 1, clientX: 640, clientY: 400 });
    await flushFrames();
    expect(camera().y).toBeGreaterThan(before.y);
    expect(Math.abs(camera().y - before.y)).toBeGreaterThan(0);
  });

  it('TC-16: Ctrl + wheel zooms the board around the pointer', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();
    const pointer = { x: 300, y: 200 };
    const beforeWorld = { x: before.x + pointer.x / before.zoom, y: before.y + pointer.y / before.zoom };

    const event = wheel(board, {
      deltaY: -100,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    await flushFrames();
    expect(event.defaultPrevented).toBe(true);
    const after = camera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 6);
    // The board location under the pointer stays at the same screen position.
    const afterWorld = { x: after.x + pointer.x / after.zoom, y: after.y + pointer.y / after.zoom };
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 6);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 6);
  });

  it('TC-17: a Safari gesturechange zooms by the gesture scale', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();

    const start = gesture('gesturestart', { scale: 1, clientX: 300, clientY: 200 });
    board.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    const change = gesture('gesturechange', { scale: 1.2, clientX: 300, clientY: 200 });
    board.dispatchEvent(change);
    await flushFrames();
    expect(change.defaultPrevented).toBe(true);
    const zoomed = camera();
    expect(zoomed.zoom).toBeCloseTo(before.zoom * 1.2, 6);

    // A further gesturechange reports the scale since the gesture started, so the total
    // zoom is 1.5x, not 1.2x * 1.5x. (Scales stay well below ZOOM_MAX so a clamp cannot
    // make the difference invisible.)
    const more = gesture('gesturechange', { scale: 1.5, clientX: 300, clientY: 200 });
    board.dispatchEvent(more);
    await flushFrames();
    expect(camera().zoom).toBeCloseTo(before.zoom * 1.5, 6);

    const end = gesture('gestureend', { scale: 1.5, clientX: 300, clientY: 200 });
    board.dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
  });

  it('TC-17b: a pinch that would exceed ZOOM_MAX is clamped', async () => {
    const { board, camera } = await mountBoard();
    board.dispatchEvent(gesture('gesturestart', { scale: 1, clientX: 300, clientY: 200 }));
    board.dispatchEvent(gesture('gesturechange', { scale: 1000, clientX: 300, clientY: 200 }));
    await flushFrames();
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('TC-18: Ctrl/Cmd + =, - and 0 zoom in, out and reset the view', async () => {
    const { board, camera } = await mountBoard();
    const standard = camera();
    expect(standard.zoom).toBe(1);

    const zoomIn = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(zoomIn);
    await flushFrames();
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(camera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);

    const zoomOut = new KeyboardEvent('keydown', { key: '-', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(zoomOut);
    await flushFrames();
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(camera().zoom).toBe(1);

    // Pan away and zoom, then Ctrl+0 returns to the standard view.
    drag(board, { x: 600, y: 400 }, { x: 200, y: 200 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }));
    await flushFrames();
    expect(camera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);

    const reset = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(reset);
    await flushFrames();
    expect(reset.defaultPrevented).toBe(true);
    expect(camera()).toEqual(standard);
  });

  it('TC-29: a click without movement leaves the camera unchanged', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();
    fireEvent.pointerDown(board, {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 500,
      clientY: 500,
    });
    fireEvent.pointerUp(board, {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 500,
      clientY: 500,
    });
    await flushFrames();
    expect(camera()).toEqual(before);
    expect(board.getAttribute('data-panning')).toBe('false');
  });

  it('TC-30: Ctrl + wheel over the zoom control does not zoom the board', async () => {
    const { board, camera } = await mountBoard();
    const before = camera();
    const controls = document.querySelector<HTMLElement>('[data-testid="zoom-controls"]');
    if (controls === null) {
      throw new Error('zoom controls are missing');
    }
    const event = wheel(controls, { deltaY: -100, ctrlKey: true, clientX: 1200, clientY: 760 });
    await flushFrames();
    expect(camera()).toEqual(before);
    // The browser default is not suppressed over the control.
    expect(event.defaultPrevented).toBe(false);
    expect(board.getAttribute('data-panning')).toBe('false');
  });

  it('TC-07 (component): a window resize does not move the board', async () => {
    const { board, camera, resize } = await mountBoard();
    drag(board, { x: 640, y: 400 }, { x: 500, y: 300 });
    await flushFrames();
    const before = camera();
    await resize({ width: 1920, height: 1080 });
    const after = camera();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-07b: a resize before the first navigation leaves the camera alone too', async () => {
    const { camera, resize } = await mountBoard();
    const before = camera();
    // The standard view is 100% with the board's starting point centred in the window.
    expect(before.zoom).toBe(1);
    expect(before.x).toBeCloseTo(-VIEWPORT.width / 2, EPSILON);
    expect(before.y).toBeCloseTo(-VIEWPORT.height / 2, EPSILON);

    await resize({ width: 1920, height: 1080 });

    const after = camera();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
  });

  it('keeps the grid spacing equal to GRID_SPACING_WORLD * zoom on screen', async () => {
    const { board, camera, gridStyle } = await mountBoard();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }));
    await flushFrames();
    const zoom = camera().zoom;
    expect(gridStyle().size).toBe(`${GRID_SPACING_WORLD * zoom}px ${GRID_SPACING_WORLD * zoom}px`);
    expect(board.getAttribute('data-panning')).toBe('false');
  });
});
