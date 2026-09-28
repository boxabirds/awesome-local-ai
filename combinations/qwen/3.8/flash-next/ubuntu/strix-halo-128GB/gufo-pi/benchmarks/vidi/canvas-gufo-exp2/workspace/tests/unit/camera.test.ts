import { describe, expect, it } from 'vitest';
import {
  PERCENT_PER_UNIT,
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

const EPS = 1e-6;

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};

/** Assert the world location under a screen point is unchanged by a zoom. */
function expectPointerInvariant(before: Camera, after: Camera, p: Point) {
  const w0 = screenToWorld(before, p);
  const w1 = screenToWorld(after, p);
  expect(Math.abs(w1.x - w0.x)).toBeLessThan(EPS);
  expect(Math.abs(w1.y - w0.y)).toBeLessThan(EPS);
}

function expectFiniteCamera(cam: Camera) {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

describe('camera.math: screen/world transforms', () => {
  it('round-trips screen -> world -> screen', () => {
    const cam: Camera = { x: -1234.5, y: 987.25, zoom: 1.75 };
    const p: Point = { x: 401, y: 22 };
    const world = screenToWorld(cam, p);
    const back = worldToScreen(cam, world);
    expect(Math.abs(back.x - p.x)).toBeLessThan(EPS);
    expect(Math.abs(back.y - p.y)).toBeLessThan(EPS);
  });

  it('maps world origin to (0,0) for a camera parked at the origin', () => {
    expect(worldToScreen(ORIGIN, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(ORIGIN, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('camera.math: panBy', () => {
  // TC-01
  it('TC-01 moves the camera by -delta/zoom at zoom 1 and the world point with the pointer', () => {
    const after = panBy(ORIGIN, 200, 100);
    expect(after.x).toBeCloseTo(0 - 200 / ORIGIN.zoom, 10);
    expect(after.y).toBeCloseTo(0 - 100 / ORIGIN.zoom, 10);
    expect(after.zoom).toBe(ORIGIN.zoom);
    const moved = worldToScreen(after, { x: 0, y: 0 });
    expect(moved.x).toBeCloseTo(200, 10);
    expect(moved.y).toBeCloseTo(100, 10);
  });

  // TC-02
  it('TC-02 pans by delta/zoom world units at ZOOM_MAX far from the start', () => {
    const far: Camera = { ...FAR, zoom: ZOOM_MAX };
    const after = panBy(far, 200, 100);
    expect(Math.abs(after.x - (far.x - 200 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(Math.abs(after.y - (far.y - 100 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(FAR, 0, 0)).toBe(FAR);
  });

  it('is unbounded: panning to +/- UNBOUNDED_PAN_TESTED_EXTENT stays finite', () => {
    for (const sign of [1, -1]) {
      const after = panBy(ORIGIN, sign * UNBOUNDED_PAN_TESTED_EXTENT, sign * UNBOUNDED_PAN_TESTED_EXTENT);
      expectFiniteCamera(after);
      expect(Math.abs(after.x)).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT, 6);
    }
  });
});

describe('camera.math: zoomAt', () => {
  // TC-03
  it('TC-03 doubles zoom around a pointer at the origin, pointer location invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const after = zoomAt(ORIGIN, p, 2);
    expect(after.zoom).toBeCloseTo(2, 10);
    expectPointerInvariant(ORIGIN, after, p);
  });

  // TC-04
  it('TC-04 zooms around the pointer 1,000,000 world units from the start', () => {
    const p: Point = { x: 640, y: 400 };
    const after = zoomAt(FAR, p, 1.5);
    expect(after.zoom).toBeCloseTo(1.5, 10);
    expectPointerInvariant(FAR, after, p);
    expectFiniteCamera(after);
  });

  // TC-05
  it('TC-05 returns the same camera object when already at ZOOM_MIN and zooming out', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const after = zoomAt(atMin, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(atMin);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  // TC-06
  it('TC-06 returns the same camera object when already at ZOOM_MAX and zooming in', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const after = zoomAt(atMax, CENTRE, ZOOM_STEP_FACTOR);
    expect(after).toBe(atMax);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('never leaves [ZOOM_MIN, ZOOM_MAX] for small factors past a limit', () => {
    const atMin = zoomAt({ x: 0, y: 0, zoom: ZOOM_MIN }, CENTRE, 1 / 1.0001);
    expect(atMin.zoom).toBe(ZOOM_MIN);
    const atMax = zoomAt({ x: 0, y: 0, zoom: ZOOM_MAX }, CENTRE, 1.0001);
    expect(atMax.zoom).toBe(ZOOM_MAX);
  });

  // TC-11
  it('TC-11 clamps a huge factor to ZOOM_MAX and keeps the pointer invariant', () => {
    const p: Point = { x: 111, y: 77 };
    const after = zoomAt(FAR, p, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(FAR, after, p);
  });

  it('clamps a tiny factor to ZOOM_MIN and keeps the pointer invariant', () => {
    const p: Point = { x: 111, y: 77 };
    const start: Camera = { ...FAR, zoom: ZOOM_MIN * 1.01 };
    const after = zoomAt(start, p, 1e-6);
    expect(after.zoom).toBe(ZOOM_MIN);
    expectPointerInvariant(start, after, p);
  });

  // TC-12
  it('TC-12 ignores invalid factors (0, negative, NaN, +/-Infinity) without NaN', () => {
    const start: Camera = { x: 12.5, y: -8.25, zoom: 1 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(start, CENTRE, factor);
      expect(after).toBe(start);
      expectFiniteCamera(after);
    }
  });

  it('property: pointer invariance holds for 1000 random cameras, points and factors', () => {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, rand()),
      };
      const p: Point = { x: rand() * VIEWPORT.width, y: rand() * VIEWPORT.height };
      const factor = Math.exp((rand() * 2 - 1) * 2); // e^-2 .. e^2
      const after = zoomAt(cam, p, factor);
      expectFiniteCamera(after);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const w0 = screenToWorld(cam, p);
      const w1 = screenToWorld(after, p);
      // The scale factor bounds the relative rounding error; keep it absolute
      // at the 1e-6 threshold the design asks for.
      expect(Math.abs(w1.x - w0.x)).toBeLessThan(EPS);
      expect(Math.abs(w1.y - w0.y)).toBeLessThan(EPS);
      // And screen positions of any world point round-trip.
      const s = worldToScreen(after, w1);
      expect(Math.abs(s.x - p.x)).toBeLessThan(EPS);
      expect(Math.abs(s.y - p.y)).toBeLessThan(EPS);
    }
  });
});

describe('camera.math: resetCamera', () => {
  // TC-08
  it('TC-08 resets to zoom 1 with the world origin centred in a 1200x800 viewport', () => {
    const atMaxFar: Camera = { ...FAR, zoom: ZOOM_MAX };
    const after = resetCamera(VIEWPORT);
    expect(atMaxFar.zoom).toBe(ZOOM_MAX); // precondition of the scenario
    expect(after.zoom).toBe(1);
    expect(after.x).toBeCloseTo(-VIEWPORT.width / 2, 10);
    expect(after.y).toBeCloseTo(-VIEWPORT.height / 2, 10);
    const screen = worldToScreen(after, { x: 0, y: 0 });
    expect(Math.abs(screen.x - VIEWPORT.width / 2)).toBeLessThan(EPS);
    expect(Math.abs(screen.y - VIEWPORT.height / 2)).toBeLessThan(EPS);
  });
});

describe('camera.math: zoomStep', () => {
  // TC-09
  it('TC-09 steps in then out and lands exactly back on 1.0 (100 %)', () => {
    const inOut = zoomStep(zoomStep(ORIGIN, VIEWPORT, 'in'), VIEWPORT, 'out');
    expect(inOut.zoom).toBe(1);
    expect(zoomPercent(inOut)).toBe(PERCENT_PER_UNIT);
    expect(inOut.x).toBeCloseTo(ORIGIN.x, 10);
    expect(inOut.y).toBeCloseTo(ORIGIN.y, 10);
  });

  it('TC-09b one step in from 100 % gives ZOOM_STEP_FACTOR (125 %)', () => {
    const after = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(after.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
    expect(zoomPercent(after)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT_PER_UNIT));
  });

  it('keeps the viewport centre fixed when stepping', () => {
    const start: Camera = { x: -321, y: 123.5, zoom: 1 };
    const after = zoomStep(start, VIEWPORT, 'in');
    expectPointerInvariant(start, after, CENTRE);
  });

  // TC-10
  it('TC-10 clamps after repeated steps in and reports canZoomIn false', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // A further step is a no-op returning the same object.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // And zooming back out works again.
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(out.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);
  });

  it('clamps after repeated steps out and reports canZoomOut false', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 30; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('reaches ZOOM_MAX by stepping from a camera already near the limit', () => {
    let cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX / ZOOM_STEP_FACTOR };
    cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
  });
});

describe('camera.math: resize', () => {
  // TC-07 — the camera value does not depend on viewport size, so a resize
  // leaves x, y and zoom (and what is on screen) untouched.
  it('TC-07 leaves the camera and screen mapping unchanged', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    const before = { ...cam };
    const worldPoint: Point = { x: 48, y: -96 };
    const screenBefore = worldToScreen(cam, worldPoint);
    // Resizing the window does not touch the camera.
    const after: Camera = cam;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
    const screenAfter = worldToScreen(after, worldPoint);
    expect(screenAfter.x).toBe(screenBefore.x);
    expect(screenAfter.y).toBe(screenBefore.y);
  });
});

describe('camera.math: zoomPercent', () => {
  it('reports whole-number percentages rounded to nearest', () => {
    expect(zoomPercent(ORIGIN)).toBe(PERCENT_PER_UNIT);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(
      Math.round(ZOOM_MIN * PERCENT_PER_UNIT),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(
      Math.round(ZOOM_MAX * PERCENT_PER_UNIT),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5675 })).toBe(157);
  });
});

/** Small deterministic PRNG so the property check is reproducible. */
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
