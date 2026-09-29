import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/client/App';
import {
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  type Camera,
} from '../../src/client/canvas/camera';
import {
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  expectedTransform,
  initialCamera,
  readCamera,
  worldTransform,
} from './fixture';

/** Let pending animation frames run so coalesced camera updates are rendered. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
}

/** Points equal to well within a pixel (screen positions are CSS pixels). */
function expectClose(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(1e-6);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(1e-6);
}

async function expectRenderedCamera(expected: unknown): Promise<void> {
  await settle();
  expect(readCamera(screen.getByTestId('viewport'))).toEqual(expected);
}

/** Where the board's starting point (world 0,0) shows up on screen. */
function contentOffset(camera: Camera): { x: number; y: number } {
  return worldToScreen(camera, { x: 0, y: 0 });
}
function surface(): HTMLElement {
  return screen.getByTestId('viewport');
}

function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

describe('BoardViewport: drag to pan (TC-13, TC-14, TC-29)', () => {
  it('TC-13 moves the board exactly with the pointer and returns to Idle', async () => {
    render(<App />);
    const start = initialCamera();
    expect(readCamera(surface())).toEqual(start);
    expect(worldTransform(worldLayer())).toBe(expectedTransform(start));
    expect(surface().dataset.panning).toBe('false');

    fireEvent.pointerDown(surface(), { pointerId: 1, clientX: 300, clientY: 200, isPrimary: true });
    expect(surface().dataset.panning).toBe('true');

    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 });
    const dragged = panBy(start, 200, 100);
    await expectRenderedCamera(dragged);
    expect(worldTransform(worldLayer())).toBe(expectedTransform(dragged));

    // a dot (here: the board's starting point) moves by exactly the pointer delta
    const before = worldToScreen(start, { x: 0, y: 0 });
    const after = worldToScreen(dragged, { x: 0, y: 0 });
    expect({ x: after.x - before.x, y: after.y - before.y }).toEqual({ x: 200, y: 100 });

    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: 500, clientY: 300 });
    expect(surface().dataset.panning).toBe('false');
    expect(readCamera(surface())).toEqual(dragged);
  });

  it('TC-14 freezes the camera at the moment of a pointercancel and ignores later moves', async () => {
    render(<App />);
    const start = initialCamera();

    fireEvent.pointerDown(surface(), { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 80, clientY: 40, buttons: 1 });
    const frozen = panBy(start, 80, 40);
    await expectRenderedCamera(frozen);

    fireEvent.pointerCancel(surface(), { pointerId: 1, clientX: 80, clientY: 40 });
    expect(surface().dataset.panning).toBe('false');

    // the pointer is no longer captured, so these do nothing
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 900, clientY: 900 });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: 900, clientY: 900 });
    await settle();
    expect(readCamera(surface())).toEqual(frozen);
  });

  it('ends the drag on lostpointercapture, keeping the last camera', async () => {
    render(<App />);
    const start = initialCamera();

    fireEvent.pointerDown(surface(), { pointerId: 1, clientX: 10, clientY: 10, isPrimary: true });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 30, clientY: -20, buttons: 1 });
    const frozen = panBy(start, 20, -30);
    await expectRenderedCamera(frozen);

    fireEvent.lostPointerCapture(surface(), { pointerId: 1, clientX: 30, clientY: -20 });
    expect(surface().dataset.panning).toBe('false');

    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 400, clientY: 400, buttons: 1 });
    await settle();
    expect(readCamera(surface())).toEqual(frozen);
  });

  it('TC-29 leaves the camera and the hint alone for a click without movement', async () => {
    render(<App />);
    const start = initialCamera();

    fireEvent.pointerDown(surface(), { pointerId: 1, clientX: 123, clientY: 456, isPrimary: true });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: 123, clientY: 456 });

    await settle();
    expect(readCamera(surface())).toEqual(start);
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();
  });
});

describe('BoardViewport: wheel and gestures (TC-15, TC-16, TC-17, TC-30)', () => {
  it('TC-15 pans with a plain wheel and prevents the page from scrolling', async () => {
    render(<App />);
    const start = initialCamera();

    // fireEvent returns false when the handler called preventDefault()
    expect(
      fireEvent.wheel(surface(), {
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
      }),
    ).toBe(false);

    await expectRenderedCamera(panBy(start, 0, -100));
    const rendered = readCamera(surface());
    // scrolling down moves content up
    expect(contentOffset(rendered).y - contentOffset(start).y).toBeCloseTo(-100, 9);
    expect(rendered.y - start.y).toBeCloseTo(100 / start.zoom, 9);
    expect(rendered.zoom).toBe(start.zoom);
  });

  it('pans horizontally with a trackpad scroll and converts LINE/PAGE deltas', async () => {
    render(<App />);
    const start = initialCamera();

    fireEvent.wheel(surface(), { deltaX: 60, deltaY: 0, deltaMode: 0 });
    await expectRenderedCamera(panBy(start, -60, 0));
    // scrolling right moves content left
    expect(contentOffset(readCamera(surface())).x - contentOffset(start).x).toBeCloseTo(-60, 9);

    fireEvent.wheel(surface(), { deltaX: 0, deltaY: 3, deltaMode: 1 });
    await expectRenderedCamera(
      panBy(panBy(start, -60, 0), 0, -3 * WHEEL_LINE_HEIGHT_PX),
    );
  });

  it('TC-16 zooms around the pointer with a Ctrl wheel and keeps the page zoom', async () => {
    render(<App />);
    const start = initialCamera();
    const pointer = { x: 300, y: 200 };

    expect(
      fireEvent.wheel(surface(), {
        deltaY: -100,
        deltaMode: 0,
        ctrlKey: true,
        clientX: pointer.x,
        clientY: pointer.y,
      }),
    ).toBe(false);

    const expected = zoomAt(start, pointer, Math.exp(100 * WHEEL_ZOOM_SENSITIVITY));
    await expectRenderedCamera(expected);
    expect(readCamera(surface()).zoom).toBeGreaterThan(start.zoom);
    // the board location under the pointer stays at the same screen position
    expectClose(screenToWorld(expected, pointer), screenToWorld(start, pointer));
    expectClose(worldToScreen(expected, screenToWorld(start, pointer)), pointer);
  });

  it('TC-17 zooms with a Safari gesture, clamped at the limits', async () => {
    render(<App />);
    const start = initialCamera();
    const pointer = { x: 300, y: 200 };

    const gesture = Object.assign(
      new Event('gesturechange', { bubbles: true, cancelable: true }),
      { scale: 2, clientX: pointer.x, clientY: pointer.y },
    );
    surface().dispatchEvent(gesture);
    expect(gesture.defaultPrevented).toBe(true);

    const doubled = zoomAt(start, pointer, 2);
    await expectRenderedCamera(doubled);
    expect(readCamera(surface()).zoom).toBeCloseTo(2, 9);

    const further = Object.assign(
      new Event('gesturechange', { bubbles: true, cancelable: true }),
      { scale: 16, clientX: pointer.x, clientY: pointer.y },
    );
    surface().dispatchEvent(further);
    expect(further.defaultPrevented).toBe(true);
    await expectRenderedCamera({ ...zoomAt(doubled, pointer, 8), zoom: ZOOM_MAX });
    expect(readCamera(surface()).zoom).toBe(ZOOM_MAX);
  });

  it('TC-30 does not zoom the board for a Ctrl/Cmd wheel over the zoom controls', async () => {
    render(<App />);
    const start = initialCamera();

    // over the chrome the board does not suppress the browser default
    expect(
      fireEvent.wheel(screen.getByTestId('zoom-controls'), {
        deltaY: -100,
        deltaMode: 0,
        ctrlKey: true,
      }),
    ).toBe(true);
    await settle();
    expect(readCamera(surface())).toEqual(start);
  });
});

describe('BoardViewport: keyboard shortcuts (TC-18)', () => {
  it('zooms with Ctrl/Cmd + = and -, and resets with Ctrl/Cmd + 0', async () => {
    render(<App />);
    expect(readCamera(surface())).toEqual(initialCamera());

    expect(fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true })).toBe(false);
    await settle();
    expect(zoomPercent(readCamera(surface()))).toBe(125);

    expect(fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true })).toBe(false);
    await settle();
    expect(zoomPercent(readCamera(surface()))).toBe(100);

    // panning far away first, so reset has somewhere to come back from
    fireEvent.pointerDown(surface(), { pointerId: 2, clientX: 0, clientY: 0, isPrimary: true });
    fireEvent.pointerMove(surface(), { pointerId: 2, clientX: -4000, clientY: 2500, buttons: 1 });
    await settle();

    expect(fireEvent.keyDown(window, { key: '0', code: 'Digit0', metaKey: true })).toBe(false);
    await settle();
    expect(readCamera(surface())).toEqual(resetCamera({ width: window.innerWidth, height: window.innerHeight }));
  });

  it('ignores plain keys without Ctrl or Cmd', async () => {
    render(<App />);
    const start = initialCamera();

    expect(fireEvent.keyDown(window, { key: '=', code: 'Equal' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: '0' })).toBe(true);
    await settle();
    expect(readCamera(surface())).toEqual(start);
  });
});
