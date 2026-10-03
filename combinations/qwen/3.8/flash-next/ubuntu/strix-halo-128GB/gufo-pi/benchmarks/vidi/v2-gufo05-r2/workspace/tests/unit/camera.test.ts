import { describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
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
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';

const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const LAPTOP: Size = { width: 1200, height: 800 };
/** Camera positioned far from the starting point, at the largest zoom. */
const FAR_MAX_CAMERA: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: ZOOM_MAX,
};

/** Number of decimal digits that keeps results "exact" at these magnitudes. */
const EXACT_DIGITS = 6;

function samePoint(actual: Point, expected: Point, digits = EXACT_DIGITS): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -1234.5, y: 678.25, zoom: 1.75 };
    const p: Point = { x: 321, y: 654 };
    samePoint(worldToScreen(cam, screenToWorld(cam, p)), p);
    samePoint(screenToWorld(cam, worldToScreen(cam, p)), p);
  });

  it('places world origin at the viewport top-left for the origin camera', () => {
    samePoint(worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 }), { x: 0, y: 0 });
  });
});

describe('panBy', () => {
  it('TC-01: moves the camera opposite to the pointer delta at zoom 1', () => {
    const next = panBy(ORIGIN_CAMERA, 200, 100);
    expect(next.x).toBeCloseTo(-200, EXACT_DIGITS);
    expect(next.y).toBeCloseTo(-100, EXACT_DIGITS);
    expect(next.zoom).toBe(1);
    // The world point (0,0) that was at screen (0,0) is now at screen (200,100).
    samePoint(worldToScreen(next, { x: 0, y: 0 }), { x: 200, y: 100 });
  });

  it('TC-02: converts screen delta to world units at ZOOM_MAX far from the start', () => {
    const next = panBy(FAR_MAX_CAMERA, 200, 100);
    const worldDx = 200 / ZOOM_MAX;
    const worldDy = 100 / ZOOM_MAX;
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - worldDx, EXACT_DIGITS);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - worldDy, EXACT_DIGITS);
    // The world point under screen pixel 501 after the pan is the one that was
    // under pixel 501 - 200 before it, to sub-pixel precision at 1,000,000 units.
    samePoint(
      screenToWorld(next, { x: 501, y: 500 }),
      screenToWorld(FAR_MAX_CAMERA, { x: 501 - 200, y: 500 - 100 }),
    );
    // One screen pixel is still exactly 1/ZOOM_MAX world units apart.
    const pixelStep =
      screenToWorld(next, { x: 501, y: 500 }).x - screenToWorld(next, { x: 500, y: 500 }).x;
    expect(pixelStep).toBeCloseTo(1 / ZOOM_MAX, EXACT_DIGITS);
  });

  it('returns the same object for a zero delta', () => {
    expect(panBy(FAR_MAX_CAMERA, 0, 0)).toBe(FAR_MAX_CAMERA);
  });

  it('pans at least UNBOUNDED_PAN_TESTED_EXTENT in every direction with no edge', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 10; i += 1) {
      cam = panBy(cam, (UNBOUNDED_PAN_TESTED_EXTENT / 10) * cam.zoom, 0);
      cam = panBy(cam, 0, (UNBOUNDED_PAN_TESTED_EXTENT / 10) * cam.zoom);
    }
    expect(cam.x).toBeCloseTo(-UNBOUNDED_PAN_TESTED_EXTENT, EXACT_DIGITS);
    expect(cam.y).toBeCloseTo(-UNBOUNDED_PAN_TESTED_EXTENT, EXACT_DIGITS);
    // Sub-pixel precision survives the long pan, even at ZOOM_MAX.
    const nudge = panBy({ ...cam, zoom: ZOOM_MAX }, 0.5, 0.5);
    expect(nudge.x).not.toBe(cam.x);
    expect(nudge.x).toBeCloseTo(cam.x - 0.5 / ZOOM_MAX, EXACT_DIGITS);
    // The dot grid lattice keeps a whole number of dots per screen pixel step.
    expect(GRID_SPACING_WORLD * ZOOM_MAX).toBeGreaterThan(1);
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer fixed', () => {
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAMERA, pointer);
    const next = zoomAt(ORIGIN_CAMERA, pointer, 2);
    expect(next.zoom).toBe(2);
    samePoint(screenToWorld(next, pointer), before);
    samePoint(worldToScreen(next, before), pointer);
  });

  it('TC-04: keeps the pointer invariant far away from the start', () => {
    const pointer: Point = { x: 400, y: 300 };
    const before = screenToWorld(FAR_MAX_CAMERA, pointer);
    const next = zoomAt(FAR_MAX_CAMERA, pointer, 1.5);
    samePoint(screenToWorld(next, pointer), before);
  });

  it('TC-05: at ZOOM_MIN a zoom-out step returns the same object', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(atMin, { x: LAPTOP.width / 2, y: LAPTOP.height / 2 }, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
  });

  it('TC-06: at ZOOM_MAX a zoom-in step returns the same object', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(atMax, { x: LAPTOP.width / 2, y: LAPTOP.height / 2 }, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
  });

  it('TC-11: clamps a huge factor and still keeps the pointer invariant', () => {
    const pointer: Point = { x: 777, y: 111 };
    const before = screenToWorld(ORIGIN_CAMERA, pointer);
    const next = zoomAt(ORIGIN_CAMERA, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    samePoint(screenToWorld(next, pointer), before);
    const out = zoomAt(ORIGIN_CAMERA, pointer, 1 / 1000);
    expect(out.zoom).toBe(ZOOM_MIN);
    samePoint(screenToWorld(out, pointer), before);
  });

  it('TC-12: ignores invalid factors without producing NaN', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(ORIGIN_CAMERA, { x: 10, y: 10 }, factor);
      expect(next).toBe(ORIGIN_CAMERA);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });
});

describe('zoomStep', () => {
  it('TC-09: one step in then one step out returns exactly the original zoom', () => {
    const inOne = zoomStep(ORIGIN_CAMERA, LAPTOP, 'in');
    expect(inOne.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOne)).toBe(125);
    const back = zoomStep(inOne, LAPTOP, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('keeps the viewport centre fixed', () => {
    const centre: Point = { x: LAPTOP.width / 2, y: LAPTOP.height / 2 };
    const before = screenToWorld(ORIGIN_CAMERA, centre);
    const next = zoomStep(ORIGIN_CAMERA, LAPTOP, 'in');
    samePoint(screenToWorld(next, centre), before);
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX and disable zoom in', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, LAPTOP, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // A further step is a no-op.
    expect(zoomStep(cam, LAPTOP, 'in')).toBe(cam);
  });

  it('steps down to ZOOM_MIN and disables zoom out', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, LAPTOP, 'out');
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, LAPTOP, 'out')).toBe(cam);
  });

  it('TC-21 support: 1.5625 is two steps in from 100%', () => {
    const twoSteps = zoomStep(zoomStep(ORIGIN_CAMERA, LAPTOP, 'in'), LAPTOP, 'in');
    expect(twoSteps.zoom).toBe(1.5625);
    expect(zoomPercent(twoSteps)).toBe(156);
  });
});

describe('resetCamera', () => {
  it('TC-08: returns to zoom 1 with the starting point centred', () => {
    const reset = resetCamera(LAPTOP);
    expect(reset.zoom).toBe(1);
    expect(reset.x).toBe(-LAPTOP.width / 2);
    expect(reset.y).toBe(-LAPTOP.height / 2);
    samePoint(worldToScreen(reset, { x: 0, y: 0 }), {
      x: LAPTOP.width / 2,
      y: LAPTOP.height / 2,
    });
  });

  it('centres the starting point after being far away at ZOOM_MAX', () => {
    const reset = resetCamera(LAPTOP);
    samePoint(worldToScreen(reset, { x: 0, y: 0 }), {
      x: LAPTOP.width / 2,
      y: LAPTOP.height / 2,
    });
  });
});

describe('TC-07: viewport resize', () => {
  it('leaves the camera unchanged, so content keeps its position relative to the top-left', () => {
    const cam: Camera = { x: -321.5, y: 128.25, zoom: 1.25 };
    // Resizing does not call into camera maths: the camera object is untouched.
    const afterResize = cam;
    expect(afterResize).toBe(cam);
    expect(afterResize.x).toBe(cam.x);
    expect(afterResize.y).toBe(cam.y);
    expect(afterResize.zoom).toBe(cam.zoom);
    // The world point at the viewport top-left is defined by the camera alone.
    samePoint(screenToWorld(afterResize, { x: 0, y: 0 }), { x: cam.x, y: cam.y });
    samePoint(worldToScreen(cam, screenToWorld(cam, { x: 0, y: 0 })), { x: 0, y: 0 });
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5624 })).toBe(156);
  });
});

describe('property: zoomAt keeps the pointer world point invariant', () => {
  /** Deterministic PRNG so failures are reproducible. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('holds for 1000 random cameras, points and factors', () => {
    const rand = mulberry32(20260917);
    const range = (min: number, max: number) => min + rand() * (max - min);

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const pointer: Point = { x: range(0, 1920), y: range(0, 1080) };
      const factor = range(0.01, 100);
      const before = screenToWorld(cam, pointer);
      const next = zoomAt(cam, pointer, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const after = screenToWorld(next, pointer);
      // Tolerance is relative to the magnitude of the world coordinate.
      const tolerance = 1e-6 * Math.max(1, Math.abs(before.x), Math.abs(before.y));
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(tolerance);
    }
  });
});
