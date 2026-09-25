import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ZOOM_MAX, ZOOM_MIN, WHEEL_DELTA_MODE_LINE_PX } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  dispatch,
  gestureEvent,
  keyEvent,
  pointerEvent,
  renderBoard,
  seedCamera,
  settle,
  wheelEvent,
  VIEWPORT,
} from './harness';

describe('drag to pan (TC-13, TC-14)', () => {
  it('TC-13 moves the board by exactly the pointer delta and returns to Idle', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    expect(harness.board().dataset.panning).toBe('false');

    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 400, clientY: 300 }),
    );
    expect(harness.board().dataset.panning).toBe('true');
    expect(harness.camera()).toEqual(before);

    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 600, clientY: 400 }),
    );
    const during = harness.camera();
    expect(during.x).toBeCloseTo(before.x - 200, 6);
    expect(during.y).toBeCloseTo(before.y - 100, 6);
    expect(harness.worldLayer().dataset.transform).toBe(
      `scale(1) translate(${-during.x}px, ${-during.y}px)`,
    );

    await dispatch(
      harness.board(),
      pointerEvent('pointerup', { clientX: 600, clientY: 400 }),
    );
    expect(harness.board().dataset.panning).toBe('false');
    expect(harness.camera()).toEqual(during);
  });

  it('TC-14 freezes the camera on pointercancel and ignores later moves', async () => {
    const harness = renderBoard();
    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 400, clientY: 300 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 500, clientY: 350 }),
    );
    const atCancel = harness.camera();

    await dispatch(
      harness.board(),
      pointerEvent('pointercancel', { clientX: 500, clientY: 350 }),
    );
    expect(harness.board().dataset.panning).toBe('false');
    expect(harness.camera()).toEqual(atCancel);

    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 900, clientY: 900 }),
    );
    expect(harness.camera()).toEqual(atCancel);
  });

  it('TC-14 ends the drag on lostpointercapture and resumes on a new press', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 400, clientY: 300 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 450, clientY: 300 }),
    );
    const afterFirst = harness.camera();

    await dispatch(
      harness.board(),
      pointerEvent('lostpointercapture', { clientX: 450, clientY: 300 }),
    );
    expect(harness.board().dataset.panning).toBe('false');

    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 800, clientY: 600 }),
    );
    expect(harness.camera()).toEqual(afterFirst);

    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 400, clientY: 300 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointermove', { clientX: 410, clientY: 300 }),
    );
    expect(harness.camera().x).toBeCloseTo(afterFirst.x - 10, 6);
    expect(harness.camera().y).toBeCloseTo(before.y, 6);
  });

  it('TC-29 a click without movement leaves the camera and the hint alone', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(
      harness.board(),
      pointerEvent('pointerdown', { clientX: 300, clientY: 300 }),
    );
    await dispatch(
      harness.board(),
      pointerEvent('pointerup', { clientX: 300, clientY: 300 }),
    );
    expect(harness.camera()).toEqual(before);
    expect(harness.hint()).not.toBeNull();
  });
});

describe('scroll to pan (TC-15)', () => {
  it('TC-15 a plain wheel scrolls the board and prevents the page default', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    const { defaultPrevented } = await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: 100, clientX: 600, clientY: 400 }),
    );
    const after = harness.camera();
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(defaultPrevented).toBe(true);
  });

  it('TC-15 a horizontal trackpad scroll moves content sideways', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    const { defaultPrevented } = await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaX: 80, clientX: 200, clientY: 200 }),
    );
    const after = harness.camera();
    expect(after.x).toBeCloseTo(before.x + 80, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(defaultPrevented).toBe(true);
  });

  it('TC-15 non-pixel deltaMode values are converted to pixels', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: 3, deltaMode: 1, clientX: 100, clientY: 100 }),
    );
    // LINE mode: 3 lines * WHEEL_DELTA_MODE_LINE_PX.
    expect(harness.camera().y).toBeCloseTo(before.y + 3 * WHEEL_DELTA_MODE_LINE_PX, 6);
  });

  it('scrolls while zoomed by delta / zoom', async () => {
    const harness = renderBoard();
    await seedCamera(harness, { x: 0, y: 0, zoom: 2 });
    const before = harness.camera();
    await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: 100, clientX: 100, clientY: 100 }),
    );
    expect(harness.camera().y).toBeCloseTo(before.y + 50, 6);
  });
});

describe('pinch and Ctrl/Cmd + scroll zoom (TC-16, TC-17)', () => {
  it('TC-16 zooms around the pointer and prevents the page default', async () => {
    const harness = renderBoard();
    const point = { x: 300, y: 200 };
    const beforeCamera = harness.camera();
    const anchorBefore = screenToWorld(beforeCamera, point);

    const { defaultPrevented } = await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 }),
    );
    const after = harness.camera();
    expect(after.zoom).toBeGreaterThan(beforeCamera.zoom);
    expect(defaultPrevented).toBe(true);
    const anchorAfter = screenToWorld(after, point);
    expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(1e-6);
  });

  it('TC-16 Meta + scroll zooms too (macOS)', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    const { defaultPrevented } = await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: -50, metaKey: true, clientX: 400, clientY: 400 }),
    );
    expect(harness.camera().zoom).toBeGreaterThan(before.zoom);
    expect(defaultPrevented).toBe(true);
  });

  it('TC-16 zooms out with a positive delta and clamps at ZOOM_MIN', async () => {
    const harness = renderBoard();
    await seedCamera(harness, { x: -100, y: -100, zoom: 0.11 });
    await dispatch(
      harness.board(),
      wheelEvent('wheel', { deltaY: 400, ctrlKey: true, clientX: 600, clientY: 400 }),
    );
    expect(harness.camera().zoom).toBe(ZOOM_MIN);
    expect(harness.label()).toBe('10%');
  });

  it('TC-17 a Safari gesturechange doubles the zoom and prevents the default', async () => {
    const harness = renderBoard();
    const point = { x: 500, y: 300 };
    const before = harness.camera();
    const anchorBefore = screenToWorld(before, point);

    await dispatch(
      harness.board(),
      gestureEvent('gesturestart', { scale: 1, clientX: 500, clientY: 300 }),
    );
    const { defaultPrevented } = await dispatch(
      harness.board(),
      gestureEvent('gesturechange', { scale: 2, clientX: 500, clientY: 300 }),
    );
    const after = harness.camera();
    expect(after.zoom).toBeCloseTo(before.zoom * 2, 6);
    expect(defaultPrevented).toBe(true);
    const anchorAfter = screenToWorld(after, point);
    expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(1e-6);
  });

  it('TC-17 a gesture that grows past ZOOM_MAX clamps and keeps the point fixed', async () => {
    const harness = renderBoard();
    await dispatch(harness.board(), gestureEvent('gesturestart', { scale: 1 }));
    await dispatch(harness.board(), gestureEvent('gesturechange', { scale: 100 }));
    expect(harness.camera().zoom).toBe(ZOOM_MAX);
    expect(harness.label()).toBe('400%');
  });

  it('TC-17 ignores gesture events without a usable scale', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(harness.board(), gestureEvent('gesturechange', { scale: 0 }));
    await dispatch(harness.board(), gestureEvent('gesturechange', { scale: Number.NaN }));
    expect(harness.camera()).toEqual(before);
    expect(harness.hint()).not.toBeNull();
  });
});

describe('keyboard shortcuts (TC-18)', () => {
  it('TC-18 Ctrl/Cmd + = zooms in, - zooms out and 0 resets', async () => {
    const harness = renderBoard();
    const start = harness.camera();

    const plus = await dispatch(window, keyEvent('=', { ctrlKey: true }));
    expect(harness.camera().zoom).toBeCloseTo(1.25, 10);
    expect(harness.label()).toBe('125%');
    expect(plus.defaultPrevented).toBe(true);

    const minus = await dispatch(window, keyEvent('-', { metaKey: true }));
    expect(harness.camera().zoom).toBe(1);
    expect(harness.label()).toBe('100%');
    expect(minus.defaultPrevented).toBe(true);

    const zero = await dispatch(window, keyEvent('0', { ctrlKey: true }));
    expect(harness.camera()).toEqual({
      x: -VIEWPORT.width / 2,
      y: -VIEWPORT.height / 2,
      zoom: 1,
    });
    expect(zero.defaultPrevented).toBe(true);
    expect(start.zoom).toBe(1);
  });

  it('keeps plain keys and unmodified shortcuts alone', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    await dispatch(window, keyEvent('='));
    await dispatch(window, keyEvent('-'));
    await dispatch(window, keyEvent('0'));
    expect(harness.camera()).toEqual(before);
    expect(harness.hint()).not.toBeNull();
  });

  it('Cmd + 0 on a far-away, zoomed-in camera resets to the standard view', async () => {
    const harness = renderBoard();
    await seedCamera(harness, { x: 1_000_000, y: -1_000_000, zoom: 3 });
    const { defaultPrevented } = await dispatch(window, keyEvent('0', { metaKey: true }));
    expect(harness.camera()).toEqual({
      x: -VIEWPORT.width / 2,
      y: -VIEWPORT.height / 2,
      zoom: 1,
    });
    expect(defaultPrevented).toBe(true);
  });
});

describe('zoom controls wired to the board (TC-30, TC-32)', () => {
  it('TC-30 Ctrl + wheel over the zoom control does not zoom the board', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    const controls = harness.button('Zoom in').closest<HTMLElement>('.zoom-controls');
    if (!controls) throw new Error('zoom controls container is missing');

    const { defaultPrevented } = await dispatch(
      controls,
      wheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 1200, clientY: 700 }),
    );
    expect(harness.camera()).toEqual(before);
    // Browser behaviour over the control is untouched.
    expect(defaultPrevented).toBe(false);
  });

  it('TC-32 a disabled zoom button does not change the camera', async () => {
    const harness = renderBoard();
    await seedCamera(harness, { x: 0, y: 0, zoom: ZOOM_MAX });
    const zoomIn = harness.button('Zoom in');
    expect(zoomIn.disabled).toBe(true);
    const before = harness.camera();
    zoomIn.click();
    await settle();
    expect(harness.camera()).toEqual(before);
    expect(harness.label()).toBe('400%');
  });

  it('zoom buttons step around the centre of the board area', async () => {
    const harness = renderBoard();
    const before = harness.camera();
    harness.button('Zoom in').click();
    await settle();
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const anchorBefore = screenToWorld(before, centre);
    const anchorAfter = screenToWorld(harness.camera(), centre);
    expect(harness.camera().zoom).toBeCloseTo(1.25, 10);
    expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(1e-6);

    harness.button('Zoom out').click();
    await settle();
    expect(harness.camera().zoom).toBe(1);
  });
});

describe('realistic pointer input through user-event (TC-13, TC-32)', () => {
  it('a full click sequence on a zoom control does not start a board drag', async () => {
    const user = userEvent.setup();
    const harness = renderBoard();
    const zoomIn = harness.button('Zoom in');

    await user.click(zoomIn);
    await settle();

    expect(harness.board().dataset.panning).toBe('false');
    expect(harness.camera().zoom).toBeCloseTo(1.25, 10);
    expect(harness.label()).toBe('125%');

    // A disabled control swallows the whole sequence.
    const atMax = renderBoard();
    await seedCamera(atMax, { x: 0, y: 0, zoom: ZOOM_MAX });
    const frozen = atMax.camera();
    const zoomInDisabled = atMax.button('Zoom in');
    expect(zoomInDisabled.disabled).toBe(true);
    await user.click(zoomInDisabled);
    await settle();
    expect(atMax.camera()).toEqual(frozen);
  });
});
