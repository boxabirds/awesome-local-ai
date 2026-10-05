import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { resetCamera, screenToWorld } from '../../src/client/canvas/camera';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  DRAG_DX,
  DRAG_DY,
  INITIAL_ZOOM,
  PERCENT,
  POINTER,
  VIEWPORT,
  WHEEL_DELTA,
  WORLD_DIGITS,
  board,
  dispatchGesture,
  dispatchWheel,
  dragBy,
  pressKey,
  pointer,
  renderHarness,
  renderedCamera,
  setCamera,
  settle,
  worldLayer,
  zoomLabel,
} from './harness';

/** One plain-wheel zoom gesture: exp(-deltaY * sensitivity). */
const WHEEL_ZOOM_FACTOR = Math.exp(WHEEL_DELTA * WHEEL_ZOOM_SENSITIVITY);
/** Grid background offset: camera position modulo the on-screen grid spacing. */
const gridOffset = (value: number, spacing: number): number =>
  Number(((((value % spacing) + spacing) % spacing).toFixed(6)));

describe('board viewport input', () => {
  // TC-13
  it('TC-13 pans by the exact drag distance and tracks Idle -> Panning -> Idle', async () => {
    renderHarness();
    const el = board();
    const initial = renderedCamera();
    expect(initial).toEqual(resetCamera(VIEWPORT));
    expect(el.dataset['panning']).toBe('false');

    pointer('pointerDown', el, { x: 400, y: 300 });
    await settle();
    expect(el.dataset['panning']).toBe('true');

    pointer('pointerMove', el, { x: 400 + DRAG_DX, y: 300 + DRAG_DY });
    await settle();
    const panned = renderedCamera();
    expect(panned.x).toBeCloseTo(initial.x - DRAG_DX / INITIAL_ZOOM, WORLD_DIGITS);
    expect(panned.y).toBeCloseTo(initial.y - DRAG_DY / INITIAL_ZOOM, WORLD_DIGITS);

    // The world layer transform matches the camera, so content follows exactly.
    const transform = `scale(${panned.zoom}) translate(${-panned.x}px, ${-panned.y}px)`;
    expect(worldLayer().dataset['transform']).toBe(transform);
    expect(worldLayer().style.transform).toBe(transform);

    pointer('pointerUp', el, { x: 400 + DRAG_DX, y: 300 + DRAG_DY });
    await settle();
    expect(el.dataset['panning']).toBe('false');
    expect(renderedCamera()).toEqual(panned);
  });

  // TC-14
  it('TC-14 freezes the camera at pointercancel and ignores later moves', async () => {
    renderHarness();
    const el = board();

    pointer('pointerDown', el, { x: 400, y: 300 });
    pointer('pointerMove', el, { x: 440, y: 340 });
    await settle();
    const frozen = renderedCamera();
    expect(frozen.x).toBeCloseTo(resetCamera(VIEWPORT).x - 40, WORLD_DIGITS);

    pointer('pointerCancel', el, { x: 440, y: 340 });
    await settle();
    expect(el.dataset['panning']).toBe('false');

    pointer('pointerMove', el, { x: 900, y: 900 });
    await settle();
    expect(renderedCamera()).toEqual(frozen);
  });

  it('TC-14 ends the drag when pointer capture is lost', async () => {
    renderHarness();
    const el = board();

    pointer('pointerDown', el, { x: 500, y: 300, pointerId: 11 });
    pointer('pointerMove', el, { x: 520, y: 320, pointerId: 11 });
    await settle();
    const frozen = renderedCamera();

    fireEventLostCapture(el);
    await settle();
    expect(el.dataset['panning']).toBe('false');

    pointer('pointerMove', el, { x: 100, y: 100, pointerId: 11 });
    await settle();
    expect(renderedCamera()).toEqual(frozen);
  });

  // TC-15
  it('TC-15 pans on a plain wheel event and cancels the page scroll', async () => {
    renderHarness();
    const el = board();
    const initial = renderedCamera();

    const event = dispatchWheel(el, { deltaY: WHEEL_DELTA });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    const after = renderedCamera();
    // Scrolling down moves the board content up: the camera moves down.
    expect(after.y).toBeCloseTo(initial.y + WHEEL_DELTA / initial.zoom, WORLD_DIGITS);
    expect(after.x).toBeCloseTo(initial.x, WORLD_DIGITS);

    // Scrolling right moves the content left: the camera moves right.
    dispatchWheel(el, { deltaX: WHEEL_DELTA });
    await settle();
    expect(renderedCamera().x).toBeCloseTo(after.x + WHEEL_DELTA / after.zoom, WORLD_DIGITS);

    // deltaMode LINE is converted to pixels.
    const before = renderedCamera();
    dispatchWheel(el, { deltaY: 1, deltaMode: 1 });
    await settle();
    expect(renderedCamera().y).toBeGreaterThan(before.y);
  });

  // TC-16
  it('TC-16 zooms on Ctrl + wheel around the pointer and cancels page zoom', async () => {
    renderHarness();
    const el = board();
    const initial = renderedCamera();
    const worldUnderPointer = screenToWorld(initial, POINTER);

    const event = dispatchWheel(el, { deltaY: -WHEEL_DELTA, ctrlKey: true, point: POINTER });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    const after = renderedCamera();
    expect(after.zoom).toBeGreaterThan(initial.zoom);
    expect(after.zoom).toBeCloseTo(initial.zoom * WHEEL_ZOOM_FACTOR, 9);
    // The board location under the pointer stayed put.
    const invariant = screenToWorld(after, POINTER);
    expect(invariant.x).toBeCloseTo(worldUnderPointer.x, WORLD_DIGITS);
    expect(invariant.y).toBeCloseTo(worldUnderPointer.y, WORLD_DIGITS);
  });

  it('TC-16 clamps Ctrl + wheel at the zoom limits', async () => {
    renderHarness();
    const el = board();

    for (let i = 0; i < 12; i += 1) {
      dispatchWheel(el, { deltaY: -5000, ctrlKey: true, point: POINTER });
    }
    await settle();
    expect(renderedCamera().zoom).toBe(ZOOM_MAX);
    const atMax = renderedCamera();
    dispatchWheel(el, { deltaY: -5000, ctrlKey: true, point: POINTER });
    await settle();
    expect(renderedCamera()).toEqual(atMax);
  });

  // TC-17
  it('TC-17 zooms on the Safari gesture event and cancels page zoom', async () => {
    renderHarness();
    const el = board();
    const initial = renderedCamera();
    const worldUnderPointer = screenToWorld(initial, POINTER);

    const event = dispatchGesture(el, 2);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    const after = renderedCamera();
    expect(after.zoom).toBeCloseTo(initial.zoom * 2, 9);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    const invariant = screenToWorld(after, POINTER);
    expect(invariant.x).toBeCloseTo(worldUnderPointer.x, WORLD_DIGITS);
    expect(invariant.y).toBeCloseTo(worldUnderPointer.y, WORLD_DIGITS);

    // A gesture that would exceed ZOOM_MAX clamps instead of doing nothing.
    dispatchGesture(el, ZOOM_MAX * 2, 1);
    await settle();
    expect(renderedCamera().zoom).toBe(ZOOM_MAX);
    expect(zoomLabel().textContent).toBe(`${Math.round(ZOOM_MAX * PERCENT)}%`);
  });

  // TC-18
  it('TC-18 zooms and resets with Ctrl/Cmd keyboard shortcuts', async () => {
    renderHarness();
    const initial = renderedCamera();
    expect(initial.zoom).toBe(INITIAL_ZOOM);

    expect(pressKey('=')).toBe(false);
    await settle();
    expect(renderedCamera().zoom).toBeCloseTo(INITIAL_ZOOM * ZOOM_STEP_FACTOR, 9);
    expect(zoomLabel().textContent).toBe(`${Math.round(ZOOM_STEP_FACTOR * PERCENT)}%`);

    expect(pressKey('-', 'metaKey')).toBe(false);
    await settle();
    expect(renderedCamera().zoom).toBe(INITIAL_ZOOM);

    // Pan away first so the reset is observable.
    dragBy(DRAG_DX, DRAG_DY, { x: 300, y: 300 }, 7);
    await settle();
    expect(renderedCamera().x).not.toBe(initial.x);

    expect(pressKey('0')).toBe(false);
    await settle();
    expect(renderedCamera()).toEqual(resetCamera(VIEWPORT));
    expect(zoomLabel().textContent).toBe(`${Math.round(INITIAL_ZOOM * PERCENT)}%`);
  });

  // TC-29 (negative)
  it('TC-29 leaves the camera and the hint alone for a click without movement', async () => {
    renderHarness();
    const el = board();
    const initial = renderedCamera();

    pointer('pointerDown', el, { x: 420, y: 320 });
    pointer('pointerUp', el, { x: 420, y: 320 });
    await settle();

    expect(renderedCamera()).toEqual(initial);
    expect(el.dataset['panning']).toBe('false');
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  // TC-30 (negative)
  it('TC-30 does not zoom the board for a Ctrl + wheel over the zoom control', async () => {
    renderHarness();
    const initial = renderedCamera();

    const event = dispatchWheel(screen.getByTestId('zoom-controls'), {
      deltaY: -WHEEL_DELTA,
      ctrlKey: true,
    });
    await settle();

    expect(renderedCamera()).toEqual(initial);
    // The browser default is not suppressed outside the board.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not start a drag on the zoom controls', async () => {
    renderHarness();
    const initial = renderedCamera();

    pointer('pointerDown', screen.getByTestId('zoom-controls'), { x: 1200, y: 700 });
    pointer('pointerMove', board(), { x: 900, y: 500 });
    pointer('pointerUp', board(), { x: 900, y: 500 });
    await settle();

    expect(renderedCamera()).toEqual(initial);
    expect(board().dataset['panning']).toBe('false');
  });

  it('keeps the dot grid attached to the board while panning and zooming', async () => {
    const handle = renderHarness();
    const el = board();
    const cell = (spacing: number): string => `${spacing}px ${spacing}px`;
    expect(el.style.backgroundSize).toBe(cell(GRID_SPACING_WORLD));

    pointer('pointerDown', el, { x: 300, y: 200, pointerId: 3 });
    pointer('pointerMove', el, { x: 301, y: 200, pointerId: 3 });
    pointer('pointerUp', el, { x: 301, y: 200, pointerId: 3 });
    await settle();
    const cam = renderedCamera();
    // The grid moved with the camera and never jumped a whole cell.
    const cellSize = GRID_SPACING_WORLD * cam.zoom;
    expect(el.style.backgroundPosition).toBe(
      `${gridOffset(-cam.x * cam.zoom, cellSize)}px ${gridOffset(-cam.y * cam.zoom, cellSize)}px`,
    );

    pressKey('=');
    await settle();
    const zoomed = renderedCamera();
    expect(el.style.backgroundSize).toBe(cell(GRID_SPACING_WORLD * zoomed.zoom));

    // One million units from the start the grid stays evenly spaced.
    await setCamera(handle, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT });
    const far = renderedCamera();
    expect(far.x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
    expect(el.style.backgroundSize).toBe(cell(GRID_SPACING_WORLD * far.zoom));
    const offset = Number.parseFloat(el.style.backgroundPosition.split(' ')[0] ?? 'NaN');
    expect(Number.isFinite(offset)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(GRID_SPACING_WORLD * far.zoom);

    // Panning still follows the pointer exactly this far out.
    const beforeFar = renderedCamera();
    dragBy(DRAG_DX, DRAG_DY, { x: 300, y: 300 }, 13);
    await settle();
    const movedFar = renderedCamera();
    expect(movedFar.x).toBeCloseTo(beforeFar.x - DRAG_DX / beforeFar.zoom, WORLD_DIGITS);
    expect(movedFar.y).toBeCloseTo(beforeFar.y - DRAG_DY / beforeFar.zoom, WORLD_DIGITS);
  });
});

/** jsdom implements no pointer capture, so the event is fired directly. */
function fireEventLostCapture(el: HTMLElement): void {
  el.dispatchEvent(new window.Event('lostpointercapture'));
}
