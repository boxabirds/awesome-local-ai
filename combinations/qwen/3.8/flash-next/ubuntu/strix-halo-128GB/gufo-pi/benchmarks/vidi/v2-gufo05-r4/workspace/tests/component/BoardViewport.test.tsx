import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { panBy, resetCamera, worldToScreen, zoomAt, zoomStep } from '../../src/client/canvas/camera';
import { CameraProvider } from '../../src/client/canvas/useCamera';
import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_LINE_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR
} from '../../src/shared/config';
import {
  CENTRE,
  VIEWPORT_SIZE,
  expectedWorldTransform,
  fireGesture,
  fireKey,
  firePointer,
  fireWheel,
  flushCameraFrame,
  gridBackground,
  resizeBoardArea,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  viewportElement,
  worldTransform
} from './harness';

function renderBoard() {
  return render(
    <CameraProvider>
      <BoardViewport />
    </CameraProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pan by dragging (pan.drag)', () => {
  it('TC-13: the board follows the pointer exactly, Idle -> Panning -> Idle', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);
    expect(worldTransform(container)).toBe(expectedWorldTransform(start));

    firePointer(viewport, 'pointerdown', 400, 300);
    expect(viewport.dataset.interaction).toBe('panning');

    // Two moves of (100, 50) each: 200 px right and 100 px down in total.
    firePointer(viewport, 'pointermove', 500, 350);
    firePointer(viewport, 'pointermove', 600, 400);
    await flushCameraFrame();

    const expected = panBy(panBy(start, 100, 50), 100, 50);
    expect(worldTransform(container)).toBe(expectedWorldTransform(expected));
    // The content moved with the pointer, not against it.
    expect(expected.x).toBeCloseTo(start.x - 200, 6);
    expect(expected.y).toBeCloseTo(start.y - 100, 6);

    firePointer(viewport, 'pointerup', 600, 400);
    expect(viewport.dataset.interaction).toBe('idle');
  });

  it('TC-14: a cancelled drag stops where it was and later moves are ignored', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);

    firePointer(viewport, 'pointerdown', 100, 100);
    firePointer(viewport, 'pointermove', 200, 160);
    await flushCameraFrame();
    const frozen = worldTransform(container);

    firePointer(viewport, 'pointercancel', 200, 160);
    expect(viewport.dataset.interaction).toBe('idle');

    firePointer(viewport, 'pointermove', 900, 900);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(frozen);
  });

  it('ends the drag when pointer capture is lost', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);

    firePointer(viewport, 'pointerdown', 100, 100);
    firePointer(viewport, 'pointermove', 150, 120);
    await flushCameraFrame();
    const frozen = worldTransform(container);

    firePointer(viewport, 'lostpointercapture', 150, 120);
    expect(viewport.dataset.interaction).toBe('idle');
    firePointer(viewport, 'pointermove', 700, 700);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(frozen);
  });

  it('TC-29: a click without movement leaves the camera alone', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const before = worldTransform(container);

    firePointer(viewport, 'pointerdown', 300, 300);
    firePointer(viewport, 'pointerup', 300, 300);
    await flushCameraFrame();

    expect(worldTransform(container)).toBe(before);
  });
});

describe('pan by scrolling (pan.scroll)', () => {
  it('TC-15: a plain wheel moves the board in the scroll direction and is prevented', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);

    const event = fireWheel(viewport, 640, 400, 0, 100);
    expect(event.defaultPrevented).toBe(true);
    await flushCameraFrame();

    // Scrolling down moves content up: the camera's world y grows by 100 / zoom.
    expect(worldTransform(container)).toBe(expectedWorldTransform(panBy(start, 0, -100)));
    expect(Number(worldTransform(container).match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)?.[2])).toBeCloseTo(
      -(start.y + 100 / start.zoom),
      6
    );
  });

  it('scrolling right moves content left, and line/page deltas become pixels', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);

    fireWheel(viewport, 640, 400, 50, 0);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(expectedWorldTransform(panBy(start, -50, 0)));

    const lineMode = fireWheel(viewport, 640, 400, 0, 3, { deltaMode: 1 });
    expect(lineMode.defaultPrevented).toBe(true);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(
      expectedWorldTransform(panBy(panBy(start, -50, 0), 0, -3 * WHEEL_DELTA_LINE_PX))
    );
  });
});

describe('zoom around the pointer (zoom.pointer)', () => {
  it('TC-16: Ctrl + wheel zooms around the pointer and is prevented', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);

    const event = fireWheel(viewport, 300, 200, 0, -100, { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await flushCameraFrame();

    const expected = zoomAt(start, { x: 300, y: 200 }, Math.exp(100 * WHEEL_ZOOM_SENSITIVITY));
    expect(expected.zoom).toBeGreaterThan(start.zoom);
    expect(worldTransform(container)).toBe(expectedWorldTransform(expected));
  });

  it('treats a trackpad pinch (Ctrl wheel with Meta held) the same way', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);

    fireWheel(viewport, 200, 600, 0, -50, { metaKey: true });
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(
      expectedWorldTransform(zoomAt(start, { x: 200, y: 600 }, Math.exp(50 * WHEEL_ZOOM_SENSITIVITY)))
    );
  });

  it('TC-17: Safari gesturechange zooms by the scale ratio and is prevented', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const start = resetCamera(VIEWPORT_SIZE);

    const startEvent = fireGesture(viewport, 'gesturestart', 1);
    expect(startEvent.defaultPrevented).toBe(true);

    const change = fireGesture(viewport, 'gesturechange', 2);
    expect(change.defaultPrevented).toBe(true);
    await flushCameraFrame();

    expect(worldTransform(container)).toBe(expectedWorldTransform(zoomAt(start, CENTRE, 2)));
  });

  it('TC-17: a huge gesture scale clamps at ZOOM_MAX', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);

    fireGesture(viewport, 'gesturechange', 2);
    await flushCameraFrame();
    fireGesture(viewport, 'gesturechange', 1e6);
    await flushCameraFrame();

    expect(testCamera().zoom).toBe(ZOOM_MAX);
    expect(worldTransform(container)).toBe(expectedWorldTransform(testCamera()));
    expect(gridBackground(container).size).toBe(`${GRID_SPACING_WORLD * ZOOM_MAX}px ${GRID_SPACING_WORLD * ZOOM_MAX}px`);
  });

  it('ignores a gesture with an invalid scale', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);
    const before = worldTransform(container);

    fireGesture(viewport, 'gesturechange', Number.NaN);
    fireGesture(viewport, 'gesturechange', 0);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(before);
  });
});

describe('zoom with buttons and keys (zoom.step)', () => {
  it('TC-18: Ctrl/Cmd + = / - / 0 zoom one step and reset, each prevented', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const start = resetCamera(VIEWPORT_SIZE);

    const zoomInKey = fireKey('=', { ctrlKey: true });
    expect(zoomInKey.defaultPrevented).toBe(true);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(expectedWorldTransform(zoomStep(start, VIEWPORT_SIZE, 'in')));
    expect(worldTransform(container)).toContain(`scale(${ZOOM_STEP_FACTOR})`);

    const zoomOutKey = fireKey('-', { ctrlKey: true });
    expect(zoomOutKey.defaultPrevented).toBe(true);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(expectedWorldTransform(start));

    // Pan away, then Ctrl+0 returns to the standard view.
    const viewport = viewportElement(container);
    firePointer(viewport, 'pointerdown', 500, 500);
    firePointer(viewport, 'pointermove', 150, 120);
    await flushCameraFrame();
    expect(worldTransform(container)).not.toBe(expectedWorldTransform(start));

    const resetKey = fireKey('0', { metaKey: true });
    expect(resetKey.defaultPrevented).toBe(true);
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(expectedWorldTransform(start));
  });

  it('leaves unrelated key presses alone', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const before = worldTransform(container);

    fireKey('='); // no Ctrl/Cmd: the page keeps it
    fireKey('a', { ctrlKey: true });
    await flushCameraFrame();
    expect(worldTransform(container)).toBe(before);
  });
});

describe('negative scenarios (zoom.no_page_zoom and board-owned gestures)', () => {
  it('TC-30: Ctrl/Cmd + wheel over the zoom control does not zoom the board', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const before = { ...testCamera() };
    const controls = container.querySelector<HTMLElement>('[data-vidi6="zoom-controls"]');
    if (!controls) throw new Error('zoom control not found');
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });

    const overControl = fireWheel(controls, 1200, 780, 0, -100, { ctrlKey: true });
    await flushCameraFrame();
    expect(testCamera()).toEqual(before);
    // The board does not swallow the event outside itself: the browser keeps it.
    expect(overControl.defaultPrevented).toBe(false);

    const overButton = fireWheel(zoomIn, 1210, 780, 0, -100, { metaKey: true });
    await flushCameraFrame();
    expect(testCamera()).toEqual(before);
    expect(overButton.defaultPrevented).toBe(false);
  });

  it('TC-30: a plain scroll over the zoom control does not pan the board either', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const before = { ...testCamera() };
    const controls = container.querySelector<HTMLElement>('[data-vidi6="zoom-controls"]');
    if (!controls) throw new Error('zoom control not found');

    fireWheel(controls, 1200, 780, 40, 120);
    await flushCameraFrame();
    expect(testCamera()).toEqual(before);
  });
});

describe('dot grid rendering', () => {
  /**
   * The grid must look attached to the board: a dot is drawn on every board
   * point that is a multiple of GRID_SPACING_WORLD, including the start point.
   * The background tile holds one dot in its middle, so for the tile offset o
   * the value (o + spacing / 2 - screen position of world 0) is a whole
   * multiple of the spacing.
   */
  function expectDotOnBoardOrigin(position: string, spacingScreen: number): void {
    const camera = testCamera();
    const origin = worldToScreen(camera, { x: 0, y: 0 });
    const [offsetX, offsetY] = position.split(' ').map(Number.parseFloat);
    // Distance from the value to the nearest whole multiple of the spacing.
    const offGrid = (value: number) => {
      const remainder = Math.abs(value % spacingScreen);
      return Math.min(remainder, spacingScreen - remainder);
    };
    expect(offGrid((offsetX ?? 0) + spacingScreen / 2 - origin.x)).toBeLessThan(1e-6);
    expect(offGrid((offsetY ?? 0) + spacingScreen / 2 - origin.y)).toBeLessThan(1e-6);
  }

  it('keeps dots attached to board coordinates while panning and zooming', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const viewport = viewportElement(container);

    expect(gridBackground(container).size).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
    expectDotOnBoardOrigin(gridBackground(container).position, GRID_SPACING_WORLD);

    // Pan by an amount that is not a whole number of grid cells.
    firePointer(viewport, 'pointerdown', 400, 400);
    firePointer(viewport, 'pointermove', 437, 419);
    await flushCameraFrame();
    expectDotOnBoardOrigin(gridBackground(container).position, GRID_SPACING_WORLD);

    // ...and after zooming, the spacing scales with the zoom and dots still
    // land on board coordinates.
    fireWheel(viewport, 500, 300, 0, -100, { ctrlKey: true });
    await flushCameraFrame();
    const spacingScreen = GRID_SPACING_WORLD * testCamera().zoom;
    expect(gridBackground(container).size).toBe(`${spacingScreen}px ${spacingScreen}px`);
    expectDotOnBoardOrigin(gridBackground(container).position, spacingScreen);
  });

  it('does not move the camera when the board area is resized (TC-07 at the UI level)', async () => {
    const { container } = renderBoard();
    await flushCameraFrame();
    const before = { ...testCamera() };

    // A resize reports a new size for the same element; the camera stays put,
    // so content keeps its position relative to the top-left corner.
    await resizeBoardArea({ width: 1920, height: 1080 });
    await flushCameraFrame();
    expect(testCamera()).toEqual(before);

    await resizeBoardArea({ width: 640, height: 480 });
    await flushCameraFrame();
    expect(testCamera()).toEqual(before);
    expect(worldTransform(container)).toBe(expectedWorldTransform(before));
  });
});
