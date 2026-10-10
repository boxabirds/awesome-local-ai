import { describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
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
} from '../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../src/client/canvas/camera';

/** Tolerance from the design's camera.math contract (far-away precision). */
const EPS = 1e-6;

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const ORIGIN: Point = { x: 0, y: 0 };
const POINTER: Point = { x: 300, y: 200 };
const DRAG_X = 200;
const DRAG_Y = 100;

const AT_ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const AT_ZOOM_MIN: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
const AT_ZOOM_MAX: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
/** A camera looking at the tested far-away extent. */
function farAway(zoom: number): Camera {
  return { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom };
}

function expectCloseTo(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(EPS);
}

/** The board location under `screenPoint` must not move on screen. */
function expectPointerInvariant(before: Camera, after: Camera, screenPoint: Point): void {
  const worldBefore = screenToWorld(before, screenPoint);
  const worldAfter = screenToWorld(after, screenPoint);
  const screenBefore = worldToScreen(before, worldBefore);
  const screenAfter = worldToScreen(after, worldBefore);
  expectCloseTo(worldBefore.x, worldAfter.x);
  expectCloseTo(worldBefore.y, worldAfter.y);
  expectCloseTo(screenBefore.x, screenPoint.x);
  expectCloseTo(screenBefore.y, screenPoint.y);
  expectCloseTo(screenAfter.x, screenPoint.x);
  expectCloseTo(screenAfter.y, screenPoint.y);
}

function expectFiniteCamera(camera: Camera): void {
  for (const value of [camera.x, camera.y, camera.zoom]) {
    expect(Number.isNaN(value)).toBe(false);
    expect(Number.isFinite(value)).toBe(true);
  }
}

/** Deterministic PRNG (mulberry32) so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverse operations', () => {
    const cameras = [AT_ORIGIN, AT_ZOOM_MIN, AT_ZOOM_MAX, farAway(ZOOM_STEP_FACTOR)];
    const points = [ORIGIN, POINTER, { x: -450, y: 900 }];
    for (const camera of cameras) {
      for (const point of points) {
        const world = screenToWorld(camera, point);
        const back = worldToScreen(camera, world);
        expectCloseTo(back.x, point.x);
        expectCloseTo(back.y, point.y);
      }
    }
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01 moves the board by exactly the pointer distance at zoom 1', () => {
    const next = panBy(AT_ORIGIN, DRAG_X, DRAG_Y);

    expectCloseTo(next.x, -DRAG_X);
    expectCloseTo(next.y, -DRAG_Y);
    expect(next.zoom).toBe(AT_ORIGIN.zoom);

    // The world origin started at screen (0, 0) and is now at (200, 100).
    const before = worldToScreen(AT_ORIGIN, ORIGIN);
    const after = worldToScreen(next, ORIGIN);
    expectCloseTo(before.x, 0);
    expectCloseTo(before.y, 0);
    expect(Math.abs(after.x - (before.x + DRAG_X))).toBeLessThan(1);
    expect(Math.abs(after.y - (before.y + DRAG_Y))).toBeLessThan(1);
  });

  // TC-02
  it('TC-02 pans by whole pixels far away at maximum zoom', () => {
    const camera = farAway(ZOOM_MAX);
    const next = panBy(camera, DRAG_X, DRAG_Y);

    // Screen pixels become world units: 200 px / 4 = 50 units, 100 px / 4 = 25.
    expectCloseTo(next.x, camera.x - DRAG_X / ZOOM_MAX);
    expectCloseTo(next.y, camera.y - DRAG_Y / ZOOM_MAX);
    expect(Math.abs(next.x - camera.x)).toBeGreaterThan(1); // doubles keep the detail
    expectCloseTo(next.zoom, ZOOM_MAX);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(AT_ORIGIN, 0, 0)).toBe(AT_ORIGIN);
  });

  it('keeps the grid spacing visible at the tested extent (pan.unbounded)', () => {
    let camera = farAway(1);
    for (let i = 0; i < 5; i += 1) {
      const next = panBy(camera, DRAG_X, DRAG_Y);
      expectCloseTo(screenToWorld(next, CENTRE).x, screenToWorld(camera, CENTRE).x - DRAG_X);
      camera = next;
    }
    // The grid is drawn from the camera modulo the spacing, so it stays finite.
    const spacing = GRID_SPACING_WORLD * camera.zoom;
    const gridOffset = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
    expect(Number.isFinite(gridOffset)).toBe(true);
    expect(Math.abs(gridOffset)).toBeLessThan(spacing);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03 keeps the world point under the pointer fixed at zoom 1', () => {
    const next = zoomAt(AT_ORIGIN, POINTER, 2);

    expect(next.zoom).toBe(2);
    expectPointerInvariant(AT_ORIGIN, next, POINTER);
  });

  // TC-04
  it('TC-04 keeps the world point under the pointer far away', () => {
    const camera = farAway(1);
    const next = zoomAt(camera, POINTER, 1.5);

    expect(next.zoom).toBe(1.5);
    expectPointerInvariant(camera, next, POINTER);
  });

  // TC-05
  it('TC-05 returns the same object when zooming out below ZOOM_MIN', () => {
    const next = zoomAt(AT_ZOOM_MIN, CENTRE, 1 / ZOOM_STEP_FACTOR);

    expect(next).toBe(AT_ZOOM_MIN);
    expect(next.zoom).toBe(ZOOM_MIN);
  });

  // TC-06
  it('TC-06 returns the same object when zooming in above ZOOM_MAX', () => {
    const next = zoomAt(AT_ZOOM_MAX, CENTRE, ZOOM_STEP_FACTOR);

    expect(next).toBe(AT_ZOOM_MAX);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  // TC-11
  it('TC-11 clamps a huge factor and still keeps the pointer fixed', () => {
    const next = zoomAt(AT_ORIGIN, POINTER, 1000);

    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(AT_ORIGIN, next, POINTER);

    const down = zoomAt(AT_ORIGIN, POINTER, 1 / 1000);
    expect(down.zoom).toBe(ZOOM_MIN);
    expectPointerInvariant(AT_ORIGIN, down, POINTER);
  });

  // TC-12
  it.each([0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'TC-12 leaves the camera unchanged for an invalid factor %p',
    (factor) => {
      const next = zoomAt(AT_ORIGIN, POINTER, factor);

      expect(next).toBe(AT_ORIGIN);
      expectFiniteCamera(next);
    },
  );

  it('clamps zoom to the configured limits', () => {
    const up = zoomAt(AT_ORIGIN, CENTRE, ZOOM_STEP_FACTOR * ZOOM_MAX * ZOOM_MAX);
    expect(up.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    const down = zoomAt(AT_ORIGIN, CENTRE, 1 / (ZOOM_STEP_FACTOR * ZOOM_MAX * ZOOM_MAX));
    expect(down.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
  });

  // Property-style check from the design: pointer invariance within 1e-6.
  it('keeps the pointer world point invariant for 1,000 random cameras/points/factors', () => {
    const random = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * random();
      const spread = 5 * UNBOUNDED_PAN_TESTED_EXTENT;
      const camera: Camera = {
        x: (random() - 0.5) * spread,
        y: (random() - 0.5) * spread,
        zoom,
      };
      const point: Point = {
        x: VIEWPORT.width * random(),
        y: VIEWPORT.height * random(),
      };
      const factor = Math.exp((random() - 0.5) * 4); // e^-2 .. e^2
      const next = zoomAt(camera, point, factor);
      expectPointerInvariant(camera, next, point);
      expectFiniteCamera(next);
    }
  });
});

describe('zoomStep', () => {
  // TC-09
  it('TC-09 steps in and back out to exactly the same zoom', () => {
    const in1 = zoomStep(AT_ORIGIN, VIEWPORT, 'in');
    expect(in1.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(in1)).toBe(
      Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE),
    );

    const outAgain = zoomStep(in1, VIEWPORT, 'out');
    expect(outAgain.zoom).toBe(1);
    expect(zoomPercent(outAgain)).toBe(ZOOM_PERCENT_SCALE);
  });

  // TC-10
  it('TC-10 clamps after many steps in and reports canZoomIn false', () => {
    let camera: Camera = AT_ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      camera = zoomStep(camera, VIEWPORT, 'in');
    }

    expect(camera.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(camera)).toBe(false);
    expect(canZoomOut(camera)).toBe(true);

    let atMin: Camera = AT_ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      atMin = zoomStep(atMin, VIEWPORT, 'out');
    }
    expect(atMin.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(atMin)).toBe(false);
    expect(canZoomIn(atMin)).toBe(true);
  });

  it('keeps the board location at the viewport centre fixed', () => {
    const camera = zoomStep(AT_ORIGIN, VIEWPORT, 'in');
    expectPointerInvariant(AT_ORIGIN, camera, CENTRE);
  });
});

describe('resetCamera', () => {
  // TC-08
  it('TC-08 resets to 100% with the board start centred', () => {
    const camera = resetCamera(VIEWPORT);

    expect(camera.zoom).toBe(1);
    expectCloseTo(camera.x, -VIEWPORT.width / 2);
    expectCloseTo(camera.y, -VIEWPORT.height / 2);

    // The board's starting point sits in the middle of the board area.
    const screen = worldToScreen(camera, ORIGIN);
    expectCloseTo(screen.x, VIEWPORT.width / 2);
    expectCloseTo(screen.y, VIEWPORT.height / 2);

    // Reset returns the same standard view no matter where the user is, so the
    // value does not depend on the camera being replaced (far away at max zoom).
    const fromAnywhere = resetCamera(VIEWPORT);
    expect(fromAnywhere).toEqual(camera);
    expect(farAway(ZOOM_MAX).x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
  });

  it('reports zoom limits through canZoomIn / canZoomOut', () => {
    expect(canZoomIn(AT_ZOOM_MIN)).toBe(true);
    expect(canZoomOut(AT_ZOOM_MIN)).toBe(false);
    expect(canZoomIn(AT_ZOOM_MAX)).toBe(false);
    expect(canZoomOut(AT_ZOOM_MAX)).toBe(true);
    expect(canZoomIn(AT_ORIGIN)).toBe(true);
    expect(canZoomOut(AT_ORIGIN)).toBe(true);
  });
});

describe('viewport resize', () => {
  // TC-07: a resize is not user input, so the camera never changes.
  it('TC-07 leaves the camera unchanged when the viewport size changes', () => {
    const small: Size = { width: 1200, height: 800 };
    const large: Size = { width: 1920, height: 1080 };
    const before = { ...AT_ORIGIN };
    const camera = AT_ORIGIN;

    // Nothing in the camera depends on the viewport size.
    expect(camera).toEqual(before);
    expect(panBy(camera, DRAG_X, DRAG_Y)).toEqual(panBy(camera, DRAG_X, DRAG_Y));

    const zoomedSmall = zoomStep(camera, small, 'in');
    const zoomedLarge = zoomStep(camera, large, 'in');
    expect(zoomedSmall.zoom).toBe(zoomedLarge.zoom);
    expect(camera.x).toBe(before.x);
    expect(camera.y).toBe(before.y);
    expect(camera.zoom).toBe(before.zoom);
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent(AT_ORIGIN)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent(AT_ZOOM_MIN)).toBe(10);
    expect(zoomPercent(AT_ZOOM_MAX)).toBe(400);
  });
});
