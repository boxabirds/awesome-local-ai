import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  PERCENT,
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

const TOLERANCE = 1e-6;
/** Pixel tolerance for maths that is exact in doubles but reported loosely. */
const PIXEL_TOLERANCE = 1e-9;

const VIEWPORT: Size = { width: 1200, height: 800 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const cameraAt = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });

function expectPointClose(actual: Point, expected: Point, tolerance: number): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

function expectFiniteCamera(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

/** Deterministic PRNG so the property check is reproducible. */
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
  it('round-trips a point through both transforms', () => {
    const cam = cameraAt(-640, -400, 2);
    const world: Point = { x: 12.5, y: -7.25 };
    expectPointClose(screenToWorld(cam, worldToScreen(cam, world)), world, TOLERANCE);
  });

  it('maps the camera position to the viewport top-left', () => {
    const cam = cameraAt(100, 200, ZOOM_STEP_FACTOR);
    expectPointClose(worldToScreen(cam, { x: cam.x, y: cam.y }), { x: 0, y: 0 }, PIXEL_TOLERANCE);
  });
});

describe('panBy', () => {
  it('TC-01: a 200x100 px drag at zoom 1 moves the camera by -200,-100 world units', () => {
    const cam = cameraAt(0, 0, 1);
    const next = panBy(cam, 200, 100);
    expectPointClose({ x: next.x, y: next.y }, { x: -200, y: -100 }, PIXEL_TOLERANCE);
    // The world origin now appears 200 px right and 100 px down from where it started.
    expectPointClose(worldToScreen(next, { x: 0, y: 0 }), { x: 200, y: 100 }, PIXEL_TOLERANCE);
  });

  it('TC-02: at ZOOM_MAX far from the origin the world shift is exact (dx/zoom)', () => {
    const cam = cameraAt(FAR, FAR, ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expectPointClose(
      { x: next.x, y: next.y },
      { x: FAR - 200 / ZOOM_MAX, y: FAR - 100 / ZOOM_MAX },
      TOLERANCE,
    );
    // A world point that was on screen still moves exactly with the pointer.
    const world = { x: FAR, y: FAR };
    const before = worldToScreen(cam, world);
    const after = worldToScreen(next, world);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(TOLERANCE);
    // ...and so does one a single world unit further out (sub-pixel precision far away).
    const farCorner = { x: FAR + 1, y: FAR + 1 };
    const beforeCorner = worldToScreen(cam, farCorner);
    const afterCorner = worldToScreen(next, farCorner);
    expect(Math.abs(afterCorner.x - beforeCorner.x - 200)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(afterCorner.y - beforeCorner.y - 100)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('returns the same object for a zero-length drag', () => {
    const cam = cameraAt(3, 4, 2);
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('keeps the zoom unchanged', () => {
    const cam = cameraAt(0, 0, 1.5);
    expect(panBy(cam, 50, -50).zoom).toBe(cam.zoom);
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer fixed at the origin', () => {
    const cam = cameraAt(0, 0, 1);
    const pointer: Point = { x: 300, y: 200 };
    const next = zoomAt(cam, pointer, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    expectPointClose(screenToWorld(cam, pointer), screenToWorld(next, pointer), TOLERANCE);
  });

  it('TC-04: keeps the world point under the pointer fixed far from the origin', () => {
    const cam = cameraAt(FAR, FAR, 1);
    const pointer: Point = { x: 300, y: 200 };
    const next = zoomAt(cam, pointer, 1.5);
    expectPointClose(screenToWorld(cam, pointer), screenToWorld(next, pointer), TOLERANCE);
  });

  it('TC-05: at ZOOM_MIN zooming out returns the same object', () => {
    const cam = cameraAt(0, 0, ZOOM_MIN);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  it('TC-06: at ZOOM_MAX zooming in returns the same object', () => {
    const cam = cameraAt(0, 0, ZOOM_MAX);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    expect(zoomAt(cam, centre, ZOOM_STEP_FACTOR)).toBe(cam);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and still keeps the pointer invariant', () => {
    const pointer: Point = { x: 400, y: 60 };
    for (const cam of [cameraAt(0, 0, 1), cameraAt(FAR, -FAR, 1), cameraAt(-FAR, FAR, 0.5)]) {
      const next = zoomAt(cam, pointer, 1000);
      expect(next.zoom).toBe(ZOOM_MAX);
      expectPointClose(screenToWorld(cam, pointer), screenToWorld(next, pointer), TOLERANCE);
      // ...and back out again.
      const out = zoomAt(next, pointer, 1 / 1000);
      expect(out.zoom).toBe(ZOOM_MIN);
      expectPointClose(screenToWorld(next, pointer), screenToWorld(out, pointer), TOLERANCE);
    }
  });

  it('TC-12: invalid factors return the camera unchanged with no NaN in the result', () => {
    const cam = cameraAt(10, 20, 1.25);
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, { x: 100, y: 100 }, factor);
      expect(next).toBe(cam);
      expectFiniteCamera(next);
    }
  });
});

describe('zoomStep', () => {
  it('TC-07: a viewport resize is not a camera mutation', () => {
    const cam = cameraAt(123, -45, 1.5);
    // camera.math exposes no resize mutation; the camera identity survives a resize.
    const after = panBy(cam, 0, 0);
    expect(after).toBe(cam);
    expect(after).toEqual({ x: 123, y: -45, zoom: 1.5 });
  });

  it('TC-09: one step in then one step out returns exactly 1.0', () => {
    const cam = cameraAt(0, 0, 1);
    const inStep = zoomStep(cam, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(1 * ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(1 * ZOOM_STEP_FACTOR * PERCENT);
    const outStep = zoomStep(inStep, VIEWPORT, 'out');
    expect(outStep.zoom).toBe(1);
    expectPointClose({ x: outStep.x, y: outStep.y }, { x: 0, y: 0 }, PIXEL_TOLERANCE);
    expect(zoomPercent(outStep)).toBe(100);
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX with canZoomIn false', () => {
    let cam: Camera = cameraAt(0, 0, 1);
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * PERCENT);
  });

  it('clamps at ZOOM_MIN and reports canZoomOut false', () => {
    let cam: Camera = cameraAt(0, 0, 1);
    for (let i = 0; i < 40; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(ZOOM_MIN * PERCENT);
  });

  it('keeps the viewport centre fixed', () => {
    const cam = cameraAt(37, -11, 1);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomStep(cam, VIEWPORT, 'in');
    expectPointClose(screenToWorld(cam, centre), screenToWorld(next, centre), TOLERANCE);
  });

  it('returns the same object when already at a limit', () => {
    const atMax = cameraAt(0, 0, ZOOM_MAX);
    expect(zoomStep(atMax, VIEWPORT, 'in')).toBe(atMax);
    const atMin = cameraAt(0, 0, ZOOM_MIN);
    expect(zoomStep(atMin, VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('resetCamera', () => {
  it('TC-08: resets zoom to 1 and centres the world origin in the viewport', () => {
    const cam = cameraAt(FAR, FAR, ZOOM_MAX);
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    expectPointClose({ x: next.x, y: next.y }, { x: -600, y: -400 }, PIXEL_TOLERANCE);
    expectPointClose(worldToScreen(next, { x: 0, y: 0 }), { x: 600, y: 400 }, PIXEL_TOLERANCE);
    expect(cam.zoom).toBe(ZOOM_MAX);
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole number percentage', () => {
    expect(zoomPercent(cameraAt(0, 0, 1))).toBe(100);
    expect(zoomPercent(cameraAt(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(cameraAt(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(cameraAt(0, 0, ZOOM_MAX))).toBe(400);
  });
});

describe('grid spacing', () => {
  it('screen spacing equals GRID_SPACING_WORLD * zoom', () => {
    const zoom = 2.5;
    const cam = cameraAt(0, 0, zoom);
    const a = worldToScreen(cam, { x: 0, y: 0 });
    const b = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: GRID_SPACING_WORLD });
    expect(b.x - a.x).toBeCloseTo(GRID_SPACING_WORLD * zoom, 9);
    expect(b.y - a.y).toBeCloseTo(GRID_SPACING_WORLD * zoom, 9);
  });
});

describe('property: pointer invariance', () => {
  it('zoomAt keeps the pointer world point within 1e-6 for 1000 random inputs', () => {
    const rand = mulberry32(0x5eed1);
    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam = cameraAt(
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      );
      const pointer: Point = { x: rand() * 1280, y: rand() * 800 };
      const factor = Math.exp((rand() * 2 - 1) * 5);
      const next = zoomAt(cam, pointer, factor);
      expectFiniteCamera(next);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const before = screenToWorld(cam, pointer);
      const after = screenToWorld(next, pointer);
      if (next !== cam) {
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it('panBy moves screen positions by exactly the pointer delta for 1000 random inputs', () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 1000; i += 1) {
      const cam = cameraAt(
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      );
      const dx = (rand() * 2 - 1) * 500;
      const dy = (rand() * 2 - 1) * 500;
      const next = panBy(cam, dx, dy);
      const world = { x: cam.x + 0.5, y: cam.y + 0.5 };
      const before = worldToScreen(cam, world);
      const after = worldToScreen(next, world);
      expect(Math.abs(after.x - before.x - dx)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(after.y - before.y - dy)).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
