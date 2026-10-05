import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BoardPage } from '../../src/client/pages/BoardPage';
import { resetCamera, screenToWorld, type Camera } from '../../src/client/canvas/camera';
import { cameraStore } from '../../src/client/canvas/cameraStore';
import { BOARD_ID, boardExists, noConnection } from './helpers/stickyBoard';
import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINES,
  WHEEL_LINE_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** jsdom's window is the board area; the board opens framed on it. */
const AREA = { width: window.innerWidth, height: window.innerHeight };
const INITIAL = resetCamera(AREA);

const DRAG_RIGHT = 200;
const DRAG_DOWN = 100;
const POINTER_ID = 1;
const EPS_NEAR = 9;

function renderBoard(): void {
  render(<BoardPage id={BOARD_ID} connect={noConnection} check={boardExists} />);
}

function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

function camera(): Camera {
  return cameraStore.getState().camera;
}

function numbers(value: string): number[] {
  return (value.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Screen position of grid dot (column, row) as currently rendered. */
function gridDot(column: number, row: number): { x: number; y: number } {
  const style = getComputedStyle(surface());
  const [periodX, periodY] = numbers(style.backgroundSize);
  const [offsetX, offsetY] = numbers(style.backgroundPosition);
  return { x: offsetX + column * periodX, y: offsetY + row * periodY };
}

function gridPeriod(): number {
  return numbers(getComputedStyle(surface()).backgroundSize)[0];
}

function pointerEvent(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    ...init,
  });
}

function wheelEvent(x: number, y: number, init: WheelEventInit = {}): WheelEvent {
  return new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    ...init,
  });
}

function gestureEvent(kind: 'gesturestart' | 'gesturechange' | 'gestureend', scale?: number, x?: number, y?: number): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: x, clientY: y });
  return event;
}

function expectCamera(cam: Camera, x: number, y: number, zoom: number, precision = EPS_NEAR): void {
  expect(cam.x).toBeCloseTo(x, precision);
  expect(cam.y).toBeCloseTo(y, precision);
  expect(cam.zoom).toBeCloseTo(zoom, precision);
}

/** Modulo that always returns a value in `[0, period)`, written independently here. */
function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function transformFor(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

/** Wait until what is rendered reflects the camera the store holds. */
async function rendered(): Promise<void> {
  await waitFor(() => {
    const cam = cameraStore.getState().camera;
    expect(worldLayer().style.transform).toBe(transformFor(cam));
    expect(numbers(getComputedStyle(surface()).backgroundSize)[0]).toBeCloseTo(
      GRID_SPACING_WORLD * cam.zoom,
      EPS_NEAR,
    );
  });
}

describe('BoardViewport input', () => {
  it('TC-13: dragging moves the board by exactly the pointer delta (Idle -> Panning -> Idle)', async () => {
    renderBoard();
    await rendered();
    const dotStart = gridDot(0, 0);
    expect(surface().dataset.interactionState).toBe('idle');
    expect(worldLayer().style.transform).toBe(transformFor(INITIAL));

    fireEvent(surface(), pointerEvent('pointerdown', 400, 300));
    expect(surface().dataset.interactionState).toBe('panning');
    expect(surface().hasPointerCapture(POINTER_ID)).toBe(true);

    fireEvent(surface(), pointerEvent('pointermove', 400 + DRAG_RIGHT / 2, 300 + DRAG_DOWN / 2));
    fireEvent(surface(), pointerEvent('pointermove', 400 + DRAG_RIGHT, 300 + DRAG_DOWN));
    await rendered();

    expectCamera(camera(), INITIAL.x - DRAG_RIGHT, INITIAL.y - DRAG_DOWN, 1);
    // The dot grid is drawn from the same camera, so the dot that was at the grid
    // offset moved exactly with the pointer - 200 px right and 100 px down, modulo
    // one grid cell (dots on a uniform grid are indistinguishable).
    expect(gridDot(0, 0).x).toBeCloseTo(mod(dotStart.x + DRAG_RIGHT, GRID_SPACING_WORLD), EPS_NEAR);
    expect(gridDot(0, 0).y).toBeCloseTo(mod(dotStart.y + DRAG_DOWN, GRID_SPACING_WORLD), EPS_NEAR);

    fireEvent(surface(), pointerEvent('pointerup', 400 + DRAG_RIGHT, 300 + DRAG_DOWN));
    expect(surface().dataset.interactionState).toBe('idle');
    expect(worldLayer().style.transform).toBe(
      `scale(1) translate(${-(INITIAL.x - DRAG_RIGHT)}px, ${-(INITIAL.y - DRAG_DOWN)}px)`,
    );
  });

  it('TC-14: pointercancel ends the drag and later moves are ignored', async () => {
    renderBoard();
    fireEvent(surface(), pointerEvent('pointerdown', 500, 500));
    fireEvent(surface(), pointerEvent('pointermove', 540, 520));
    await rendered();
    expectCamera(camera(), INITIAL.x - 40, INITIAL.y - 20, 1);

    const frozen = camera();
    fireEvent(surface(), pointerEvent('pointercancel', 540, 520));
    expect(surface().dataset.interactionState).toBe('idle');

    fireEvent(surface(), pointerEvent('pointermove', 900, 900));
    fireEvent(surface(), pointerEvent('pointermove', 1000, 100));
    expect(camera()).toBe(frozen);
    await rendered();
    expectCamera(camera(), INITIAL.x - 40, INITIAL.y - 20, 1);
  });

  it('TC-14b: losing pointer capture ends the drag, leaving the board where it was', async () => {
    renderBoard();
    fireEvent(surface(), pointerEvent('pointerdown', 300, 300));
    fireEvent(surface(), pointerEvent('pointermove', 330, 300));
    await rendered();
    expectCamera(camera(), INITIAL.x - 30, INITIAL.y, 1);

    const frozen = camera();
    fireEvent(surface(), pointerEvent('lostpointercapture', 330, 300));
    expect(surface().dataset.interactionState).toBe('idle');
    fireEvent(surface(), pointerEvent('pointermove', 800, 800));
    expect(camera()).toBe(frozen);
  });

  it('TC-15: a plain wheel scroll pans the board vertically and horizontally, and is cancelled', async () => {
    renderBoard();
    const cancelledDown = fireEvent(surface(), wheelEvent(100, 100, { deltaY: 100 }));
    expect(cancelledDown).toBe(false);
    await rendered();
    // Scroll down: the camera advances by 100/zoom and the content moves up.
    expectCamera(camera(), INITIAL.x, INITIAL.y + 100 / INITIAL.zoom, 1);

    const cancelledRight = fireEvent(surface(), wheelEvent(100, 100, { deltaX: 100 }));
    expect(cancelledRight).toBe(false);
    await rendered();
    // Scroll right: the camera advances by 100/zoom so the content moves left.
    expectCamera(camera(), INITIAL.x + 100 / INITIAL.zoom, INITIAL.y + 100, 1);
  });

  it('TC-15b: line and page wheel deltas are converted to pixels', async () => {
    renderBoard();
    expect(fireEvent(surface(), wheelEvent(100, 100, { deltaY: 3, deltaMode: WHEEL_DELTA_MODE_LINES }))).toBe(false);
    await rendered();
    expectCamera(camera(), INITIAL.x, INITIAL.y + 3 * WHEEL_LINE_PX, 1);

    const afterLines = camera();
    expect(fireEvent(surface(), wheelEvent(100, 100, { deltaY: 0, deltaMode: WHEEL_DELTA_MODE_LINES }))).toBe(false);
    expect(camera()).toBe(afterLines);
  });

  it('TC-16: Ctrl + wheel zooms around the pointer and is cancelled', async () => {
    renderBoard();
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(INITIAL, pointer);
    const cancelled = fireEvent(surface(), wheelEvent(pointer.x, pointer.y, { deltaY: -100, ctrlKey: true }));

    expect(cancelled).toBe(false);
    await rendered();
    const after = camera();
    expect(after.zoom).toBeGreaterThan(1);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    // The board location under the pointer stayed under the pointer.
    const world = screenToWorld(after, pointer);
    expect(world.x).toBeCloseTo(before.x, EPS_NEAR);
    expect(world.y).toBeCloseTo(before.y, EPS_NEAR);
  });

  it('TC-16b: Cmd + wheel zooms as well', async () => {
    renderBoard();
    expect(fireEvent(surface(), wheelEvent(300, 200, { deltaY: -100, metaKey: true }))).toBe(false);
    await rendered();
    expect(camera().zoom).toBeGreaterThan(1);
  });

  it('TC-30: a wheel over the zoom control neither zooms the board nor cancels the browser default', async () => {
    renderBoard();
    fireEvent(surface(), wheelEvent(300, 200, { deltaY: -100, ctrlKey: true }));
    await rendered();
    const zoomed = camera();

    for (const target of [screen.getByTestId('zoom-controls'), screen.getByRole('button', { name: 'Zoom in' })]) {
      for (const init of [{ deltaY: 100 }, { deltaY: -100, ctrlKey: true }, { deltaY: -100, metaKey: true }]) {
        // true => nothing cancelled it, so the browser keeps its own behaviour here.
        expect(fireEvent(target, wheelEvent(1200, 700, init))).toBe(true);
        expect(camera()).toBe(zoomed);
      }
    }
  });

  it('TC-17: a Safari gesturechange zooms by the gesture scale, clamps, and is cancelled', async () => {
    renderBoard();
    const pointer = { x: 300, y: 200 };
    const worldUnderPointer = screenToWorld(INITIAL, pointer);
    expect(fireEvent(surface(), gestureEvent('gesturestart', 1, pointer.x, pointer.y))).toBe(false);
    expect(fireEvent(surface(), gestureEvent('gesturechange', 2, pointer.x, pointer.y))).toBe(false);
    await rendered();
    // Zoom doubled around the pointer: the world point under it is unchanged.
    expectCamera(camera(), worldUnderPointer.x - pointer.x / 2, worldUnderPointer.y - pointer.y / 2, 2);

    expect(fireEvent(surface(), gestureEvent('gesturechange', 10, pointer.x, pointer.y))).toBe(false);
    await rendered();
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it('TC-17b: gesture events with an unusable scale change nothing', async () => {
    renderBoard();
    const initial = camera();
    expect(fireEvent(surface(), gestureEvent('gesturechange', Number.NaN, 300, 200))).toBe(false);
    expect(camera()).toBe(initial);
    expect(fireEvent(surface(), gestureEvent('gesturechange', 0, 300, 200))).toBe(false);
    expect(camera()).toBe(initial);
    expect(camera().zoom).toBe(1);
  });

  it('TC-17c: after gestureend the next change scales from the current zoom', async () => {
    renderBoard();
    fireEvent(surface(), gestureEvent('gesturestart', 1, 300, 200));
    fireEvent(surface(), gestureEvent('gesturechange', 2, 300, 200));
    await rendered();
    expect(camera().zoom).toBeCloseTo(2, EPS_NEAR);

    fireEvent(surface(), gestureEvent('gestureend', 2, 300, 200));
    fireEvent(surface(), gestureEvent('gesturechange', 2, 300, 200));
    await rendered();
    expect(camera().zoom).toBeCloseTo(4, EPS_NEAR);
  });

  it('TC-18: Ctrl + =, Ctrl + - and Ctrl + 0 zoom one step, step back and reset, each cancelled', async () => {
    renderBoard();
    // A stepped zoom happens around the centre of the board area, so the world point
    // at the centre (the board's starting point) stays there.
    const centre = { x: AREA.width / 2, y: AREA.height / 2 };
    const centreWorld = screenToWorld(INITIAL, centre);

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    await rendered();
    expectCamera(
      camera(),
      centreWorld.x - centre.x / ZOOM_STEP_FACTOR,
      centreWorld.y - centre.y / ZOOM_STEP_FACTOR,
      ZOOM_STEP_FACTOR,
    );

    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    await rendered();
    expect(camera().zoom).toBe(1);
    expect(camera()).toEqual(INITIAL);

    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false);
    await rendered();
    expect(camera().zoom).toBe(1);
    expect(camera().x).toBe(-AREA.width / 2);
    expect(camera().y).toBe(-AREA.height / 2);
  });

  it("TC-18b: Cmd + = steps in, plain or Alt combinations are left to the browser, and Ctrl+A is the board's", async () => {
    renderBoard();
    expect(fireEvent.keyDown(window, { key: '=', metaKey: true })).toBe(false);
    await rendered();
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    const stepped = camera();
    expect(fireEvent.keyDown(window, { key: '=' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true, altKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true, altKey: true })).toBe(true);
    // Story 7 gave Ctrl+A to select-all, so the board swallows this keystroke now — the browser would
    // otherwise select the page's text instead. What this line still asserts is that it does nothing to
    // the camera: a shortcut taking a key is not a shortcut moving the board.
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    expect(camera()).toBe(stepped);
  });

  it('TC-18c: at a zoom limit the keyboard step is cancelled but leaves the camera untouched', async () => {
    renderBoard();
    cameraStore.setCameraTest({ zoom: ZOOM_MAX });
    await rendered();
    const atMax = camera();

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    expect(camera()).toBe(atMax);
  });

  it('TC-13b: a drag that starts on board content is not a pan', async () => {
    renderBoard();
    const initial = camera();
    fireEvent(screen.getByTestId('origin-marker'), pointerEvent('pointerdown', 100, 100));
    expect(surface().dataset.interactionState).toBe('idle');
    expect(camera()).toBe(initial);
    expect(camera()).toEqual(INITIAL);
  });

  it('TC-13c: only the primary mouse button starts a pan', async () => {
    renderBoard();
    const initial = camera();
    fireEvent(surface(), pointerEvent('pointerdown', 400, 400, { button: 2 }));
    expect(surface().dataset.interactionState).toBe('idle');
    fireEvent(surface(), pointerEvent('pointermove', 600, 600));
    expect(camera()).toBe(initial);
  });

  it('TC-13d: the dot grid period is GRID_SPACING_WORLD * zoom and its offset wraps into one cell', async () => {
    renderBoard();
    await rendered();
    expect(gridPeriod()).toBeCloseTo(GRID_SPACING_WORLD, EPS_NEAR);
    const dotAt100Percent = gridDot(1, 1);
    expect(dotAt100Percent.x).toBeCloseTo(gridPeriod() + gridDot(0, 0).x, EPS_NEAR);

    fireEvent(surface(), wheelEvent(0, 0, { deltaY: -100, ctrlKey: true }));
    await rendered();
    const zoomed = camera();
    expect(gridPeriod()).toBeCloseTo(GRID_SPACING_WORLD * zoomed.zoom, EPS_NEAR);

    fireEvent(surface(), pointerEvent('pointerdown', 200, 200));
    fireEvent(surface(), pointerEvent('pointermove', 220, 220));
    await rendered();
    const [offsetX, offsetY] = numbers(getComputedStyle(surface()).backgroundPosition);
    expect(offsetX).toBeGreaterThanOrEqual(0);
    expect(offsetY).toBeGreaterThanOrEqual(0);
    expect(offsetX).toBeLessThan(GRID_SPACING_WORLD * camera().zoom);
    expect(offsetY).toBeLessThan(GRID_SPACING_WORLD * camera().zoom);
  });

  it('TC-29: a click without movement changes nothing and keeps the hint up', async () => {
    renderBoard();
    await rendered();
    const before = camera();
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    fireEvent(surface(), pointerEvent('pointerdown', 500, 500));
    expect(surface().dataset.interactionState).toBe('panning');
    fireEvent(surface(), pointerEvent('pointerup', 500, 500));

    expect(camera()).toBe(before);
    expect(cameraStore.getState().hasNavigated).toBe(false);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(surface().dataset.interactionState).toBe('idle');
  });

  it('TC-07 (ui): resizing the board area does not move the camera', async () => {
    renderBoard();
    await waitFor(() => expect(cameraStore.getState().viewport).toEqual(AREA));
    await rendered();
    const before = camera();
    const transform = worldLayer().style.transform;

    cameraStore.setViewport({ width: 1920, height: 1080 });

    expect(camera()).toBe(before);
    expect(cameraStore.getState().viewport).toEqual({ width: 1920, height: 1080 });
    await rendered();
    expect(worldLayer().style.transform).toBe(transform);
    expect(transform).toBe(transformFor(INITIAL));
  });

  it('TC-07b: a stepped zoom uses the current viewport centre and clamps at ZOOM_MIN', async () => {
    renderBoard();
    cameraStore.setCameraTest({ zoom: ZOOM_MIN });
    await rendered();
    const atMin = camera();

    cameraStore.zoomStep('out');
    expect(camera()).toBe(atMin);

    cameraStore.zoomStep('in');
    await rendered();
    expect(camera().zoom).toBeCloseTo(ZOOM_MIN * ZOOM_STEP_FACTOR, EPS_NEAR);
  });
});
