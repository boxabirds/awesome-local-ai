import { describe, expect, it } from 'vitest';

import {
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** toBeCloseTo precision (digits) for maths near the origin: ~1e-9. */
const PRECISION_NEAR = 9;
/** toBeCloseTo precision (digits) at UNBOUNDED_PAN_TESTED_EXTENT: design says 1e-6. */
const PRECISION_FAR = 6;

/** Drag used by the PRD's own verification: 200 px right, 100 px down. */
const DRAG_RIGHT = 200;
const DRAG_DOWN = 100;

const VIEWPORT_LAPTOP: Size = { width: 1200, height: 800 };
const VIEWPORT_WIDE: Size = { width: 1920, height: 1080 };

const POINT_MID: Point = { x: 300, y: 200 };
const CENTRE_LAPTOP: Point = {
  x: VIEWPORT_LAPTOP.width / 2,
  y: VIEWPORT_LAPTOP.height / 2,
};

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const FAR_AWAY: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};

function expectPointsEqual(actual: Point, expected: Point, precision: number): void {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

function expectCameraFinite(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

describe('camera.math', () => {
  it('TC-01: panBy at zoom 1 moves the camera by -delta and the content by +delta', () => {
    const after = panBy(ORIGIN, DRAG_RIGHT, DRAG_DOWN);

    expect(after.zoom).toBe(ORIGIN.zoom);
    expect(after.x).toBeCloseTo(ORIGIN.x - DRAG_RIGHT / ORIGIN.zoom, PRECISION_NEAR);
    expect(after.y).toBeCloseTo(ORIGIN.y - DRAG_DOWN / ORIGIN.zoom, PRECISION_NEAR);

    // The world point (0,0) - a visible grid dot - ends up DRAG px away on screen.
    expectPointsEqual(worldToScreen(after, { x: 0, y: 0 }), { x: DRAG_RIGHT, y: DRAG_DOWN }, PRECISION_NEAR);
    // And the round trip still agrees.
    expectPointsEqual(screenToWorld(after, worldToScreen(after, { x: 0, y: 0 })), { x: 0, y: 0 }, PRECISION_NEAR);
  });

  it('TC-02: panBy far away at ZOOM_MAX shifts by exactly delta/zoom world units', () => {
    const cam: Camera = { x: FAR_AWAY.x, y: FAR_AWAY.y, zoom: ZOOM_MAX };
    const after = panBy(cam, DRAG_RIGHT, DRAG_DOWN);

    expect(after.x).toBeCloseTo(cam.x - DRAG_RIGHT / ZOOM_MAX, PRECISION_FAR);
    expect(after.y).toBeCloseTo(cam.y - DRAG_DOWN / ZOOM_MAX, PRECISION_FAR);
    expect(after.zoom).toBe(ZOOM_MAX);
    // Sub-pixel precision survives far away: a one-pixel drag is not lost.
    const onePx = panBy(cam, 1, 1);
    expect(onePx.x).toBeCloseTo(cam.x - 1 / ZOOM_MAX, PRECISION_FAR);
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('TC-03: zoomAt keeps the world point under the pointer fixed near the origin', () => {
    const factor = 2;
    const after = zoomAt(ORIGIN, POINT_MID, factor);
    const step = ZOOM_STEP_FACTOR;

    expect(after.zoom).toBeCloseTo(ORIGIN.zoom * factor, PRECISION_NEAR);
    expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    expectPointsEqual(screenToWorld(after, POINT_MID), screenToWorld(ORIGIN, POINT_MID), PRECISION_NEAR);
    // A step zoom out of the same camera also keeps the pointer point fixed.
    const down = zoomAt(ORIGIN, POINT_MID, 1 / step);
    expectPointsEqual(screenToWorld(down, POINT_MID), screenToWorld(ORIGIN, POINT_MID), PRECISION_NEAR);
  });

  it('TC-04: zoomAt keeps the world point under the pointer fixed far away', () => {
    const factor = 1.5;
    const after = zoomAt(FAR_AWAY, POINT_MID, factor);

    expect(after.zoom).toBeCloseTo(FAR_AWAY.zoom * factor, PRECISION_NEAR);
    expectPointsEqual(screenToWorld(after, POINT_MID), screenToWorld(FAR_AWAY, POINT_MID), PRECISION_FAR);
    // Zooming back out by the reciprocal returns near the original camera.
    const back = zoomAt(after, POINT_MID, 1 / factor);
    expect(back.x).toBeCloseTo(FAR_AWAY.x, PRECISION_FAR);
    expect(back.y).toBeCloseTo(FAR_AWAY.y, PRECISION_FAR);
    expect(back.zoom).toBeCloseTo(FAR_AWAY.zoom, PRECISION_NEAR);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const after = zoomAt(cam, CENTRE_LAPTOP, 1 / ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expect(after.zoom).toBe(ZOOM_MIN);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
    expect(canZoomOut(cam)).toBe(false);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const after = zoomAt(cam, CENTRE_LAPTOP, ZOOM_STEP_FACTOR);

    expect(after).toBe(cam);
    expect(after.zoom).toBe(ZOOM_MAX);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-07: changing the viewport size leaves the camera unchanged', () => {
    const before = panBy(resetCamera(VIEWPORT_LAPTOP), DRAG_RIGHT, DRAG_DOWN);
    // A resize is not user input to the camera: the only functions that read the
    // viewport size are the centre-based zoom and reset. At a zoom limit the
    // centre-based zoom is clamped, so a resize cannot move x/y.
    const atLimit: Camera = { x: before.x, y: before.y, zoom: ZOOM_MAX };

    expect(zoomStep(atLimit, VIEWPORT_LAPTOP, 'in')).toBe(atLimit);
    expect(zoomStep(atLimit, VIEWPORT_WIDE, 'in')).toBe(atLimit);
    expect(zoomStep(atLimit, VIEWPORT_WIDE, 'in').x).toBe(atLimit.x);
    expect(zoomStep(atLimit, VIEWPORT_WIDE, 'in').y).toBe(atLimit.y);

    // Nothing else takes a viewport, so a resize produces no camera transition.
    const after = before;
    expect(after).toBe(before);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-08: resetCamera returns to zoom 1 with the origin centred', () => {
    const cam: Camera = { x: FAR_AWAY.x, y: FAR_AWAY.y, zoom: ZOOM_MAX };
    const after = resetCamera(VIEWPORT_LAPTOP);

    expect(after.zoom).toBe(1);
    expect(after.x).toBeCloseTo(-VIEWPORT_LAPTOP.width / 2, PRECISION_NEAR);
    expect(after.y).toBeCloseTo(-VIEWPORT_LAPTOP.height / 2, PRECISION_NEAR);
    expect(cam.zoom).toBe(ZOOM_MAX);
    expectPointsEqual(
      worldToScreen(after, { x: 0, y: 0 }),
      { x: VIEWPORT_LAPTOP.width / 2, y: VIEWPORT_LAPTOP.height / 2 },
      PRECISION_NEAR,
    );
    expect(zoomPercent(after)).toBe(100);
  });

  it('TC-09: one step in then one step out returns exactly the starting zoom', () => {
    const inOnce = zoomStep(ORIGIN, VIEWPORT_LAPTOP, 'in');

    expect(inOnce.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, PRECISION_NEAR);
    expect(zoomPercent(inOnce)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));

    const outOnce = zoomStep(inOnce, VIEWPORT_LAPTOP, 'out');
    expect(outOnce.zoom).toBe(1);
    expect(zoomPercent(outOnce)).toBe(100);
    // The centre point stays put across the round trip.
    expectPointsEqual(screenToWorld(outOnce, CENTRE_LAPTOP), screenToWorld(ORIGIN, CENTRE_LAPTOP), PRECISION_NEAR);
  });

  it('TC-10: repeated steps in clamp at ZOOM_MAX and disable further zoom in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT_LAPTOP, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * 100));
    // The camera does not drift once clamped.
    expect(zoomStep(cam, VIEWPORT_LAPTOP, 'in')).toBe(cam);
  });

  it('TC-10b: repeated steps out clamp at ZOOM_MIN and disable further zoom out', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT_LAPTOP, 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }

    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * 100));
    expect(zoomStep(cam, VIEWPORT_LAPTOP, 'out')).toBe(cam);
  });

  it('TC-11: a huge zoom factor clamps at ZOOM_MAX and still keeps the pointer invariant', () => {
    const after = zoomAt(ORIGIN, POINT_MID, 1000);

    expect(after.zoom).toBe(ZOOM_MAX);
    expectPointsEqual(screenToWorld(after, POINT_MID), screenToWorld(ORIGIN, POINT_MID), PRECISION_NEAR);

    const tiny = zoomAt(ORIGIN, POINT_MID, 1 / 1000);
    expect(tiny.zoom).toBe(ZOOM_MIN);
    expectPointsEqual(screenToWorld(tiny, POINT_MID), screenToWorld(ORIGIN, POINT_MID), PRECISION_NEAR);
  });

  it('TC-12: invalid zoom factors leave the camera unchanged and never produce NaN', () => {
    const invalid = [0, -0, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const factor of invalid) {
      const after = zoomAt(ORIGIN, POINT_MID, factor);
      expect(after).toBe(ORIGIN);
      expectCameraFinite(after);
      const far = zoomAt(FAR_AWAY, POINT_MID, factor);
      expect(far).toBe(FAR_AWAY);
      expectCameraFinite(far);
    }
  });

  it('property: the world point under the pointer is invariant for 1000 seeded cameras', () => {
    let seed = 0x5eed1e;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const zoomSpan = Math.log(ZOOM_MAX / ZOOM_MIN);

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * Math.exp(random() * zoomSpan),
      };
      const p: Point = {
        x: (random() * 2 - 1) * VIEWPORT_WIDE.width,
        y: (random() * 2 - 1) * VIEWPORT_WIDE.height,
      };
      const factor = Math.exp((random() * 2 - 1) * 4);
      const after = zoomAt(cam, p, factor);

      expectCameraFinite(after);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointsEqual(screenToWorld(after, p), screenToWorld(cam, p), PRECISION_FAR);
    }
  });

  it('grid geometry: one grid cell is GRID_SPACING_WORLD * zoom screen pixels wide', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const cellWorld = { x: GRID_SPACING_WORLD, y: GRID_SPACING_WORLD };
    const screen = worldToScreen(zoomAt(cam, { x: 0, y: 0 }, ZOOM_STEP_FACTOR), cellWorld);

    expect(screen.x).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_STEP_FACTOR, PRECISION_NEAR);
    expect(screen.y).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_STEP_FACTOR, PRECISION_NEAR);
  });
});

/** Is `zoom` a power of ZOOM_STEP_FACTOR (the value the step zoom lands on)? */
function isOnStepLadder(zoom: number): boolean {
  const steps = Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_STEP_FACTOR);
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

describe('zoomStep', () => {
  it('TC-09b: a zoom carrying float noise is snapped back onto the ladder', () => {
    // A wheel zoom can leave a value that is a ladder value plus float noise; the
    // step must land exactly on the ladder (design: snap within a named epsilon).
    const noisy = ZOOM_STEP_FACTOR + ZOOM_STEP_FACTOR * 1e-13;
    const cam: Camera = { x: 0, y: 0, zoom: noisy };

    const out = zoomStep(cam, VIEWPORT_LAPTOP, 'out');

    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(100);
  });

  it('TC-09f: a step from a zoom between ladder values scales by the step factor', () => {
    // Snapping only removes float noise, it does not drag arbitrary zooms onto the ladder.
    const cam: Camera = { x: 12, y: -34, zoom: 1.3 };
    expect(isOnStepLadder(cam.zoom)).toBe(false);

    expect(zoomStep(cam, VIEWPORT_LAPTOP, 'in').zoom).toBeCloseTo(1.3 * ZOOM_STEP_FACTOR, PRECISION_NEAR);
    expect(zoomStep(cam, VIEWPORT_LAPTOP, 'out').zoom).toBeCloseTo(1.3 / ZOOM_STEP_FACTOR, PRECISION_NEAR);
  });

  it('TC-09g: a step happens around the centre of the board area', () => {
    const cam: Camera = { x: -512, y: -384, zoom: 1 };
    const centre = { x: VIEWPORT_LAPTOP.width / 2, y: VIEWPORT_LAPTOP.height / 2 };
    const before = screenToWorld(cam, centre);

    const after = zoomStep(cam, VIEWPORT_LAPTOP, 'in');

    expect(after.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, PRECISION_NEAR);
    expectPointsEqual(screenToWorld(after, centre), before, PRECISION_NEAR);
  });

  it('TC-09h: at the zoom limits a step returns the same camera object', () => {
    const atMax: Camera = { x: 7, y: 9, zoom: ZOOM_MAX };
    const atMin: Camera = { x: 7, y: 9, zoom: ZOOM_MIN };

    expect(zoomStep(atMax, VIEWPORT_LAPTOP, 'in')).toBe(atMax);
    expect(zoomStep(atMin, VIEWPORT_LAPTOP, 'out')).toBe(atMin);
    expect(canZoomIn(atMax)).toBe(false);
    expect(canZoomOut(atMin)).toBe(false);
  });
});
