import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { zoomPercent } from '../../src/client/canvas/camera';
import {
  TEST_VIEWPORT,
  fireGesture,
  fireKey,
  fireWheel,
  flushFrames,
  markerCentre,
  pointerCoordinates,
  readWorldTransform,
  renderBoard,
  setCamera,
} from './harness';

function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

describe('viewport.input', () => {
  it('TC-13 drags the board by exactly the pointer delta (Idle -> Panning -> Idle)', async () => {
    const harness = renderBoard();
    const before = readWorldTransform(harness.world());
    const gridAttr = (name: string): number => Number(harness.grid().getAttribute(name));
    const gridBefore = {
      x: gridAttr('data-grid-offset-x'),
      y: gridAttr('data-grid-offset-y'),
    };
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');
    const markerBefore = markerCentre(harness.marker());

    const surface = harness.viewport();
    fireEvent.pointerDown(surface, pointerCoordinates(100, 100));
    expect(harness.viewport().getAttribute('data-panning')).toBe('true');

    fireEvent.pointerMove(surface, pointerCoordinates(200, 150));
    fireEvent.pointerMove(surface, pointerCoordinates(300, 200));
    await flushFrames();

    const during = readWorldTransform(harness.world());
    expect(during.zoom).toBe(before.zoom);
    // Content moved 200 px right and 100 px down; the camera moved the other way.
    expect(during.x - before.x).toBeCloseTo(-200, 6);
    expect(during.y - before.y).toBeCloseTo(-100, 6);

    const markerAfter = markerCentre(harness.marker());
    expect(markerAfter.x - markerBefore.x).toBeCloseTo(200, 6);
    expect(markerAfter.y - markerBefore.y).toBeCloseTo(100, 6);

    // The grid pattern moves with the board, modulo its spacing.
    const camera = harness.getCamera();
    const spacing = GRID_SPACING_WORLD * camera.zoom;
    const gridAfter = {
      x: gridAttr('data-grid-offset-x'),
      y: gridAttr('data-grid-offset-y'),
    };
    expect(gridAfter.x).toBeCloseTo(mod(-camera.x * camera.zoom, spacing), 6);
    expect(gridAfter.y).toBeCloseTo(mod(-camera.y * camera.zoom, spacing), 6);
    expect(gridAttr('data-grid-size')).toBeCloseTo(spacing, 6);
    // The dot pattern shifted by exactly the pointer delta, modulo the spacing.
    expect(mod(gridAfter.x - gridBefore.x, spacing)).toBeCloseTo(mod(200, spacing), 6);
    expect(mod(gridAfter.y - gridBefore.y, spacing)).toBeCloseTo(mod(100, spacing), 6);

    fireEvent.pointerUp(surface, pointerCoordinates(300, 200));
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');

    // Pointer moves after the drag ended are ignored.
    const cameraAtUp = harness.getCamera();
    fireEvent.pointerMove(surface, pointerCoordinates(500, 500));
    await flushFrames();
    expect(harness.getCamera()).toBe(cameraAtUp);
  });

  it('TC-14 keeps the board where it was when a drag is cancelled', async () => {
    const harness = renderBoard();
    const surface = harness.viewport();

    fireEvent.pointerDown(surface, pointerCoordinates(0, 0));
    fireEvent.pointerMove(surface, pointerCoordinates(120, -60));
    await flushFrames();
    const cameraAtCancel = harness.getCamera();
    const worldAtCancel = readWorldTransform(harness.world());

    fireEvent.pointerCancel(surface, pointerCoordinates(120, -60));
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');

    fireEvent.pointerMove(surface, pointerCoordinates(900, 900));
    await flushFrames();

    expect(harness.getCamera()).toBe(cameraAtCancel);
    const worldAfter = readWorldTransform(harness.world());
    expect(worldAfter.x).toBeCloseTo(worldAtCancel.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldAtCancel.y, 6);
  });

  it('TC-14b lostpointercapture ends the drag without moving the board', async () => {
    const harness = renderBoard();
    const surface = harness.viewport();

    fireEvent.pointerDown(surface, pointerCoordinates(10, 10));
    fireEvent.pointerMove(surface, pointerCoordinates(60, 10));
    await flushFrames();
    const cameraAtLost = harness.getCamera();

    fireEvent.lostPointerCapture(surface, pointerCoordinates(60, 10));
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');

    fireEvent.pointerMove(surface, pointerCoordinates(400, 400));
    await flushFrames();
    expect(harness.getCamera()).toBe(cameraAtLost);
  });

  it('TC-15 pans the board with a plain wheel scroll and prevents the page scrolling', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();
    const worldBefore = readWorldTransform(harness.world());

    const event = fireWheel(harness.viewport(), {
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      clientX: 600,
      clientY: 400,
    });
    await flushFrames();

    expect(event.defaultPrevented).toBe(true);
    const after = harness.getCamera();
    expect(after.y - before.y).toBeCloseTo(100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.zoom).toBe(before.zoom);
    // Content moves up when the user scrolls down.
    const worldAfter = readWorldTransform(harness.world());
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);

    // Horizontal trackpad scroll moves content the other way too.
    fireWheel(harness.viewport(), {
      deltaX: 50,
      deltaY: 0,
      deltaMode: 0,
      clientX: 600,
      clientY: 400,
    });
    await flushFrames();
    const scrolled = harness.getCamera();
    expect(scrolled.x - after.x).toBeCloseTo(50 / after.zoom, 6);
  });

  it('TC-15b converts line and page wheel deltas to pixels', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();
    fireWheel(harness.viewport(), {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1, // DELTA_MODE_LINE
      clientX: 600,
      clientY: 400,
    });
    await flushFrames();
    const after = harness.getCamera();
    // 3 lines * WHEEL_LINE_DELTA_PX (16) = 48 px of content movement.
    expect(after.y - before.y).toBeCloseTo(48 / before.zoom, 6);
  });

  it('TC-16 zooms around the pointer with a Ctrl+wheel and prevents page zoom', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();

    const event = fireWheel(harness.viewport(), {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    await flushFrames();

    expect(event.defaultPrevented).toBe(true);
    const after = harness.getCamera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(100 * WHEEL_ZOOM_SENSITIVITY), 9);
    expect(harness.zoomLabel().textContent).toBe(`${zoomPercent(after)}%`);

    // The world point under the pointer is unchanged.
    const worldBefore = { x: 300 / before.zoom + before.x, y: 200 / before.zoom + before.y };
    const worldAfter = { x: 300 / after.zoom + after.x, y: 200 / after.zoom + after.y };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('TC-16b clamps a huge pinch delta at ZOOM_MAX and leaves the camera alone past the limit', async () => {
    const harness = renderBoard();
    setCamera(harness, { x: 0, y: 0, zoom: ZOOM_MAX });
    await flushFrames();

    fireWheel(harness.viewport(), {
      deltaX: 0,
      deltaY: -5000,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    await flushFrames();
    expect(harness.getCamera().zoom).toBe(ZOOM_MAX);

    const atLimit = harness.getCamera();
    fireWheel(harness.viewport(), {
      deltaX: 0,
      deltaY: -5000,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    await flushFrames();
    expect(harness.getCamera()).toBe(atLimit);
  });

  it('TC-17 doubles the zoom on a Safari gesturechange and prevents the browser gesture', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();
    const el = harness.viewport();

    const start = fireGesture(el, 'gesturestart', { scale: 1, initialScale: 1, clientX: 400, clientY: 300 });
    const change = fireGesture(el, 'gesturechange', { scale: 2, initialScale: 1, clientX: 400, clientY: 300 });
    await flushFrames();

    expect(change.defaultPrevented).toBe(true);
    expect(start.defaultPrevented).toBe(true);
    const after = harness.getCamera();
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 9);

    // Point continues to zoom around the pointer.
    const worldBefore = { x: 400 / before.zoom + before.x, y: 300 / before.zoom + before.y };
    const worldAfter = { x: 400 / after.zoom + after.x, y: 300 / after.zoom + after.y };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('TC-18 zooms and resets with Ctrl+ = / - / 0 and prevents the browser shortcuts', async () => {
    const harness = renderBoard();
    const initial = harness.getCamera();

    const press = (key: string, code: string): boolean => {
      const event = fireKey(window, { key, code, ctrlKey: true, cancelable: true });
      return event.defaultPrevented;
    };

    expect(press('=', 'Equal')).toBe(true);
    await flushFrames();
    expect(harness.getCamera().zoom).toBeCloseTo(1 * ZOOM_STEP_FACTOR, 9);
    expect(harness.zoomLabel().textContent).toBe('125%');

    expect(press('-', 'Minus')).toBe(true);
    await flushFrames();
    expect(harness.getCamera().zoom).toBe(1);

    // Pan far away and zoom, then Ctrl+0 returns to the standard view.
    setCamera(harness, { x: 12345, y: -6789, zoom: ZOOM_STEP_FACTOR ** 4 });
    await flushFrames();
    expect(press('0', 'Digit0')).toBe(true);
    await flushFrames();

    const reset = harness.getCamera();
    expect(reset.zoom).toBe(1);
    expect(reset.x).toBeCloseTo(-TEST_VIEWPORT.width / 2, 6);
    expect(reset.y).toBeCloseTo(-TEST_VIEWPORT.height / 2, 6);
    expect(harness.zoomLabel().textContent).toBe('100%');
    expect(initial.zoom).toBe(1);
  });

  it('TC-18b ignores plain keys and does not prevent unrelated shortcuts', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();

    const plain = fireKey(window, { key: '=', code: 'Equal', cancelable: true });
    const alt = fireKey(window, { key: '=', code: 'Equal', ctrlKey: true, altKey: true, cancelable: true });
    await flushFrames();

    expect(plain.defaultPrevented).toBe(false);
    expect(alt.defaultPrevented).toBe(false);
    expect(harness.getCamera()).toBe(before);
  });

  it('TC-29 a click without movement leaves the camera and the hint untouched', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();
    expect(harness.hint()).not.toBeNull();

    fireEvent.pointerDown(harness.viewport(), pointerCoordinates(300, 300));
    fireEvent.pointerUp(harness.viewport(), pointerCoordinates(300, 300));
    await flushFrames();

    expect(harness.getCamera()).toBe(before);
    expect(harness.hint()).not.toBeNull();
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');
  });

  it('TC-30 Ctrl+wheel over the zoom controls does not zoom the board and is left to the browser', async () => {
    const harness = renderBoard();
    const before = harness.getCamera();

    const event = fireWheel(harness.controls(), {
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 1100,
      clientY: 780,
    });
    await flushFrames();

    expect(harness.getCamera()).toBe(before);
    expect(harness.zoomLabel().textContent).toBe('100%');
    // The board does not suppress the browser's own behaviour over its controls.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not start a pan from an overlay or from board content', async () => {
    const harness = renderBoard(<div data-testid="board-object">note</div>);
    const before = harness.getCamera();

    fireEvent.pointerDown(harness.view.getByTestId('board-object'), pointerCoordinates(10, 10));
    fireEvent.pointerMove(harness.view.getByTestId('board-object'), pointerCoordinates(200, 200));
    await flushFrames();

    expect(harness.getCamera()).toBe(before);
    expect(harness.viewport().getAttribute('data-panning')).toBe('false');
  });
});
