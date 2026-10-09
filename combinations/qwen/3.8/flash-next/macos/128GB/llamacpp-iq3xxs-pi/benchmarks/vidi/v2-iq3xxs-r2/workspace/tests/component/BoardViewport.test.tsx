import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  WHEEL_PIXELS_PER_LINE,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { worldLayerTransform } from '../../src/client/canvas/BoardViewport';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  VIEWPORT_FIXTURE,
  boardState,
  buttonByLabel,
  expectCameraCloseTo,
  flushFrames,
  screenPointOf,
  worldPointAt,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  readCamera,
  renderBoard,
  safariGesture,
  waitForCamera,
  wheel,
  worldTransform,
} from './fixtures/board';

describe('pan by dragging (TC-13)', () => {
  it('moves the board by exactly the pointer delta and runs Idle -> Panning -> Idle', async () => {
    await renderBoard();
    const before = readCamera();
    expect(boardState()).toBe('idle');

    pointerDown(400, 300);
    pointerMove(500, 350);
    await flushFrames();
    expect(boardState()).toBe('panning');
    const midDrag = readCamera();
    expectCameraCloseTo(midDrag, { x: before.x - 100, y: before.y - 50, zoom: before.zoom });

    pointerMove(550, 375);
    pointerMove(600, 400);
    pointerUp(600, 400);
    await flushFrames();

    const after = readCamera();
    // A 200x100 drag moves the content 200 right and 100 down.
    expectCameraCloseTo(after, { x: before.x - 200, y: before.y - 100, zoom: before.zoom });
    expect(boardState()).toBe('idle');
    // The world layer is positioned from the same camera the inputs produced.
    expect(worldTransform()).toBe(worldLayerTransform(after));
  });

  it('ends the drag on pointercancel and ignores later moves (TC-14)', async () => {
    await renderBoard();
    const before = readCamera();

    pointerDown(300, 300);
    pointerMove(360, 330);
    await flushFrames();
    const frozen = readCamera();
    expectCameraCloseTo(frozen, { x: before.x - 60, y: before.y - 30, zoom: before.zoom });

    pointerCancel(360, 330);
    await flushFrames();
    expect(boardState()).toBe('idle');

    pointerMove(900, 700);
    pointerUp(900, 700);
    await flushFrames();
    expectCameraCloseTo(readCamera(), frozen);
  });
});

describe('pan and zoom with the wheel (TC-15, TC-16)', () => {
  it('pans by a plain wheel scroll and prevents the page from scrolling (TC-15)', async () => {
    await renderBoard();
    const before = readCamera();

    const { defaultPrevented } = wheel({ deltaY: 100 });
    expect(defaultPrevented).toBe(true);
    const after = await waitForCamera((cam) => cam.y !== before.y);
    // Scrolling down moves content up: the camera moves down by deltaY / zoom.
    expectCameraCloseTo(after, {
      x: before.x,
      y: before.y + 100 / before.zoom,
      zoom: before.zoom,
    });
  });

  it('zooms around the pointer for Ctrl + wheel and prevents page zoom (TC-16)', async () => {
    await renderBoard();
    const before = readCamera();
    const pointer = { x: 300, y: 200 };
    const worldUnderPointer = worldPointAt(before, pointer);

    const { defaultPrevented } = wheel({ deltaY: -100, ctrlKey: true }, pointer);
    expect(defaultPrevented).toBe(true);

    const after = await waitForCamera((cam) => cam.zoom > before.zoom);
    // Zoom factor is exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) = exp(1).
    expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(1), 6);
    // The same board location is still drawn under the pointer.
    const drawn = screenPointOf(after, worldUnderPointer);
    expect(drawn.x).toBeCloseTo(pointer.x, 6);
    expect(drawn.y).toBeCloseTo(pointer.y, 6);
  });

  it('converts line-mode wheel deltas to pixels', async () => {
    await renderBoard();
    const before = readCamera();
    wheel({ deltaY: 3, deltaMode: 1 }, { x: 100, y: 100 });
    const after = await waitForCamera((cam) => cam.y !== before.y);
    expect(after.y).toBeGreaterThan(before.y);
    expectCameraCloseTo(after, {
      x: before.x,
      y: before.y + 3 * WHEEL_PIXELS_PER_LINE / before.zoom,
      zoom: before.zoom,
    });
  });
});

describe('zoom with Safari gestures (TC-17)', () => {
  it('doubles the zoom for gesturechange scale 2 and prevents the default', async () => {
    await renderBoard();
    const before = readCamera();
    const pointer = { x: 640, y: 400 };
    const worldUnderPointer = worldPointAt(before, pointer);

    const start = safariGesture('gesturestart', 1, pointer);
    expect(start.defaultPrevented).toBe(true);
    const change = safariGesture('gesturechange', 2, pointer);
    expect(change.defaultPrevented).toBe(true);

    const after = await waitForCamera((cam) => cam.zoom > before.zoom);
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, 4), 6);
    const drawn = screenPointOf(after, worldUnderPointer);
    expect(drawn.x).toBeCloseTo(pointer.x, 6);
    expect(drawn.y).toBeCloseTo(pointer.y, 6);
    safariGesture('gestureend', 2, pointer);
  });
});

describe('zoom and reset with the keyboard (TC-18)', () => {
  function press(key: string, options: { ctrlKey?: boolean } = {}): boolean {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: options.ctrlKey ?? true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('Ctrl + = steps in, Ctrl + - steps out and Ctrl + 0 resets, each prevented', async () => {
    await renderBoard();
    const before = readCamera();
    expect(before.zoom).toBe(1);

    expect(press('=')).toBe(true);
    const zoomedIn = await waitForCamera((cam) => cam.zoom !== 1);
    expect(zoomedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(document.querySelector('[data-testid="zoom-label"]')?.textContent).toBe(
      `${Math.round(ZOOM_STEP_FACTOR * 100)}%`,
    );

    expect(press('-')).toBe(true);
    const backOut = await waitForCamera((cam) => cam.zoom !== zoomedIn.zoom);
    expect(backOut.zoom).toBeCloseTo(1, 9);

    // Pan away first so the reset has something to undo.
    pointerDown(200, 200);
    pointerMove(500, 500);
    pointerUp(500, 500);
    await flushFrames();
    expect(press('0')).toBe(true);
    const reset = await waitForCamera((cam) => cam.x === -VIEWPORT_FIXTURE.width / 2);
    expectCameraCloseTo(reset, {
      x: -VIEWPORT_FIXTURE.width / 2,
      y: -VIEWPORT_FIXTURE.height / 2,
      zoom: 1,
    });
  });

  it('ignores plain keys and does not preventDefault for them', async () => {
    await renderBoard();
    const before = readCamera();
    const event = new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    await flushFrames();
    expect(event.defaultPrevented).toBe(false);
    expectCameraCloseTo(readCamera(), before);
  });
});

describe('negative cases', () => {
  it('TC-29: a click without moving leaves the camera unchanged and keeps the hint', async () => {
    await renderBoard();
    const before = readCamera();

    pointerDown(420, 260);
    pointerUp(420, 260);
    await flushFrames();

    expectCameraCloseTo(readCamera(), before);
    expect(boardState()).toBe('idle');
    expect(document.querySelector('[data-testid="navigation-hint"]')?.textContent).toBe(
      NAVIGATION_HINT_TEXT,
    );
  });

  it('TC-30: Ctrl + wheel over the zoom control does not zoom the board', async () => {
    await renderBoard();
    const before = readCamera();
    const controls = document.querySelector<HTMLElement>('[data-testid="zoom-controls"]');
    if (!controls) throw new Error('zoom controls are not mounted');

    const { defaultPrevented } = wheel({ deltaY: -100, ctrlKey: true }, { x: 1200, y: 780 }, controls);
    await flushFrames(3);

    expect(defaultPrevented).toBe(false);
    expectCameraCloseTo(readCamera(), before);
  });

  it('does not pan for touch pointers (touch navigation is out of scope)', async () => {
    await renderBoard();
    const before = readCamera();

    pointerDown(300, 300, { pointerType: 'touch' });
    pointerMove(500, 500, { pointerType: 'touch' });
    pointerUp(500, 500, { pointerType: 'touch' });
    await flushFrames();

    expectCameraCloseTo(readCamera(), before);
    expect(boardState()).toBe('idle');
  });
});

describe('dot grid', () => {
  it('scales with zoom so the grid appears attached to the board', async () => {
    await renderBoard();
    const element = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!element) throw new Error('viewport is not mounted');
    expect(element.style.backgroundSize).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    buttonByLabel('Zoom in').click();
    const after = await waitForCamera((cam) => cam.zoom !== 1);
    expect(element.style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * after.zoom}px ${GRID_SPACING_WORLD * after.zoom}px`,
    );
  });
});
